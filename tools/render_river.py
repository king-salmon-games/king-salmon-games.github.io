#!/usr/bin/env python3
"""Render the river films, their opening stills, and the scroll-controlled pool detail.

Install Python Playwright, Pillow and FFmpeg with libx264 and libwebp. Use an installed Chrome with:
    python -m pip install playwright pillow
    python tools/render_river.py --browser-channel chrome --output-dir rendered-river

Alternatively, install Playwright's Chromium with 'playwright install chromium'
and omit --browser-channel. Only the offline encoder requires these tools.
"""

import argparse
import base64
from dataclasses import dataclass
import functools
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import shutil
import subprocess
from tempfile import TemporaryDirectory
from threading import Thread


ROOT = Path(__file__).resolve().parents[1]
FPS = 30
SECONDS = 48  # One whole cloud cycle and three cycles of the plunge pool.
OVERLAP = 1.25
PLATE_SIZE = (1717, 916)
# Keep a filtering margin above the first displayed detail row in both crops.
DETAIL_TOP = 640


@dataclass(frozen=True)
class Rendition:
    name: str
    width: int
    height: int
    detail_height: int
    source_left: int
    source_width: int
    maxrate: int

    @property
    def strip_top(self):
        # Keep the detail strip on a separate H.264 macroblock row.
        return ((self.height + 15) // 16) * 16


RENDITIONS = (
    Rendition("desktop", 1600, 854, 240, 0, 1717, 3850),
    Rendition("mobile", 720, 900, 256, 820, 733, 2300),
)


class SceneFiles(SimpleHTTPRequestHandler):
    def do_GET(self):
        if self.path == "/__encode":
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.end_headers()
            self.wfile.write(b"<!doctype html><title>River encoder</title>")
            return
        super().do_GET()

    def log_message(self, format, *args):
        pass


SETUP = """async detailTop => {
    const { createRiverScene, openSceneContext, landscape, sceneStartTime } = await import('/river-scene.js');
    const surface = document.createElement('canvas');
    surface.width = landscape.width;
    surface.height = landscape.height;
    const gl = openSceneContext(surface);
    if (!gl) throw Error('WebGL is required for offline rendering.');
    const scene = await createRiverScene(gl);
    const image = document.createElement('canvas');
    image.width = surface.width;
    const detailHeight = surface.height - detailTop;
    image.height = surface.height + detailHeight;
    const imageContext = image.getContext('2d', {alpha: false});
    const crop = [0, 0, 1, 1];

    function draw(time, opacity) {
        imageContext.globalAlpha = opacity;
        scene.render(time, crop, true, 0);
        imageContext.drawImage(surface, 0, 0);
        scene.render(time, crop, true, 1);
        imageContext.drawImage(surface, 0, detailTop, surface.width, detailHeight,
                               0, surface.height, surface.width, detailHeight);
    }
    window.renderFrame = ({time, duration, blend}) => {
        if (gl.isContextLost()) throw Error('Lost the encoding WebGL context.');
        draw(sceneStartTime + time, 1);
        if (blend > 0) draw(sceneStartTime + time - duration, blend);
        return image.toDataURL('image/png').split(',')[1];
    };
}"""


def packing_filters():
    _, height = PLATE_SIZE
    filters = [
        "[0:v]split[upper][lower]",
        f"[upper]crop=iw:{height}:0:0:exact=1,split[base_desktop][base_mobile]",
        f"[lower]crop=iw:{height - DETAIL_TOP}:0:{height}:exact=1,"
        f"pad=iw:{height}:0:{DETAIL_TOP},split[detail_desktop][detail_mobile]",
    ]
    for out in RENDITIONS:
        # Scale both renders from the same full-plate coordinates so every
        # sample in the strip registers with its counterpart in the base.
        scale = (
            f"crop={out.source_width}:{height}:{out.source_left}:0:exact=1,"
            f"scale={out.width}:{out.height}:flags=lanczos:out_color_matrix=bt709,"
            "format=yuv420p,setsar=1"
        )
        filters.extend([
            f"[base_{out.name}]{scale},pad=iw:{out.strip_top}:0:0,"
            f"fillborders=bottom={out.strip_top - out.height}:mode=smear[scene_{out.name}]",
            f"[detail_{out.name}]{scale},crop=iw:{out.detail_height}:0:{out.height - out.detail_height}"
            f"[strip_{out.name}]",
            f"[scene_{out.name}][strip_{out.name}]vstack=inputs=2[{out.name}]",
        ])
    return ";".join(filters)


def write_pool_mask(out, target):
    from PIL import Image

    with Image.open(ROOT / "assets/river-scene/water-mask.png") as mask:
        pool = mask.getchannel("G").resize(PLATE_SIZE, Image.Resampling.BILINEAR)
    pool = pool.crop((out.source_left, 0, out.source_left + out.source_width, PLATE_SIZE[1]))
    pool = pool.resize((out.width, out.height), Image.Resampling.BILINEAR)
    pool = pool.crop((0, out.height - out.detail_height, out.width, out.height))
    # The shader starts shading the pool at G > .01. Bring in the filmed
    # detail gently at shorelines and use its full strength by G = .20.
    ramp = []
    for value in range(256):
        t = min(1, max(0, (value / 255 - .01) / .19))
        ramp.append(round(255 * t * t * (3 - 2 * t)))
    matte = Image.new("LA", pool.size, (255, 255))
    matte.putalpha(pool.point(ramp))
    matte.save(target, optimize=True)


def encode(page, ffmpeg, destination):
    with TemporaryDirectory(dir=destination) as staging:
        files = [Path(staging) / f"river-pool-{out.name}.mp4" for out in RENDITIONS]
        command = [
            ffmpeg, "-hide_banner", "-loglevel", "error", "-f", "image2pipe",
            "-framerate", str(FPS), "-c:v", "png", "-i", "pipe:0", "-filter_complex", packing_filters()
        ]
        for out, target in zip(RENDITIONS, files):
            command.extend([
                "-map", f"[{out.name}]", "-an", "-c:v", "libx264", "-threads", "4",
                "-preset", "slow", "-crf", "25", "-g", str(FPS * 2),
                "-maxrate", f"{out.maxrate}k", "-bufsize", f"{out.maxrate * 2}k",
                "-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "iec61966-2-1",
                "-pix_fmt", "yuv420p", "-movflags", "+faststart", str(target)
            ])
        with subprocess.Popen(command, stdin=subprocess.PIPE) as encoder:
            for i in range(FPS * SECONDS):
                t = i / FPS
                # Weather and pool dynamics are already in phase at both ends:
                # this blend closes only the non-periodic whitewater and spray.
                x = max(0.0, (t - (SECONDS - OVERLAP)) / OVERLAP)
                blend = x * x * (3.0 - 2.0 * x)
                frame = page.evaluate("args => renderFrame(args)", {"time": t, "duration": SECONDS, "blend": blend})
                encoder.stdin.write(base64.b64decode(frame))
                if i % (FPS * 4) == 0:
                    print(f"Rendered {i} / {FPS * SECONDS} frames", flush=True)
        if encoder.returncode:
            raise RuntimeError(f"FFmpeg exited with status {encoder.returncode}")
        stills = []
        for out, film in zip(RENDITIONS, files):
            poster = film.with_name(f"river-start-{out.name}.webp")
            # Round the decoded BT.709 video to full-range RGB before the
            # WebP encoder converts to its own color matrix.
            subprocess.run([
                ffmpeg, "-hide_banner", "-loglevel", "error", "-i", str(film),
                "-frames:v", "1", "-vf", f"crop={out.width}:{out.height}:0:0,"
                "scale=flags=accurate_rnd+full_chroma_int,format=bgra",
                "-c:v", "libwebp", "-pix_fmt", "bgra", "-quality", "91",
                "-compression_level", "5", str(poster)
            ], check=True)
            mask = film.with_name(f"pool-detail-{out.name}.png")
            write_pool_mask(out, mask)
            stills.extend([poster, mask])
        for file in files + stills:
            final = file.replace(destination / file.name)
            print(f"Rendered {final} ({final.stat().st_size:,} bytes)", flush=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--output-dir", required=True, type=Path, help="Destination for the films, posters and detail masks.")
    parser.add_argument("--browser-channel", help="Use an installed Chrome (chrome) or Edge (msedge).")
    args = parser.parse_args()
    try:
        from playwright.sync_api import sync_playwright
        import PIL
    except ImportError:
        parser.error("Install the optional renderer dependencies with python -m pip install playwright pillow")
    ffmpeg = shutil.which("ffmpeg")
    if not ffmpeg:
        parser.error("Install FFmpeg with libx264 and libwebp support.")
    args.output_dir.mkdir(parents=True, exist_ok=True)
    with ThreadingHTTPServer(("127.0.0.1", 0), functools.partial(SceneFiles, directory=ROOT)) as server:
        thread = Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            with sync_playwright() as playwright:
                browser = playwright.chromium.launch(channel=args.browser_channel,
                    args=["--enable-unsafe-swiftshader", "--disable-background-timer-throttling"])
                page = browser.new_page()
                page.goto(f"http://127.0.0.1:{server.server_port}/__encode")
                page.evaluate(SETUP, DETAIL_TOP)
                encode(page, ffmpeg, args.output_dir)
                browser.close()
        finally:
            server.shutdown()
            thread.join()


if __name__ == "__main__":
    main()
