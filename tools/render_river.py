#!/usr/bin/env python3
"""Render the live river, clouds and forest into the films and their opening stills.

Install Python Playwright and FFmpeg with libx264 and libwebp. Use an installed Chrome with:
    python -m pip install playwright
    python tools/render_river.py --browser-channel chrome --output-dir rendered-river

Alternatively, install Playwright's Chromium with 'playwright install chromium'
and omit --browser-channel. Only the offline encoder requires these tools.
"""

import argparse
import base64
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


SETUP = """async () => {
    const { createRiverScene, openSceneContext, landscape, sceneStartTime } = await import('/river-scene.js');
    const surface = document.createElement('canvas');
    surface.width = landscape.width;
    surface.height = landscape.height;
    const gl = openSceneContext(surface);
    if (!gl) throw Error('WebGL is required for offline rendering.');
    const scene = await createRiverScene(gl);
    const image = document.createElement('canvas');
    image.width = surface.width;
    image.height = surface.height;
    const imageContext = image.getContext('2d', {alpha: false});
    const crop = [0, 0, 1, 1];

    window.renderFrame = ({time, duration, blend}) => {
        if (gl.isContextLost()) throw Error('Lost the encoding WebGL context.');
        scene.render(sceneStartTime + time, crop, true);
        imageContext.globalAlpha = 1;
        imageContext.drawImage(surface, 0, 0);
        if (blend > 0) {
            scene.render(sceneStartTime + time - duration, crop, true);
            imageContext.globalAlpha = blend;
            imageContext.drawImage(surface, 0, 0);
        }
        return image.toDataURL('image/png').split(',')[1];
    };
}"""


def encode(page, ffmpeg, destination):
    filenames = ["river-desktop.mp4", "river-mobile.mp4"]
    with TemporaryDirectory(dir=destination) as staging:
        files = [Path(staging) / name for name in filenames]
        filters = (
            "[0:v]split=2[wide][tall];"
            "[wide]scale=1600:854:flags=lanczos:out_color_matrix=bt709,setsar=1[desktop];"
            "[tall]crop=733:916:820:0:exact=1,"
            "scale=720:900:flags=lanczos:out_color_matrix=bt709,setsar=1[mobile]"
        )
        command = [
            ffmpeg, "-hide_banner", "-loglevel", "error", "-f", "image2pipe",
            "-framerate", str(FPS), "-c:v", "png", "-i", "pipe:0", "-filter_complex", filters
        ]
        for stream, maxrate, target in zip(("desktop", "mobile"), (3200, 1850), files):
            command.extend([
                "-map", f"[{stream}]", "-an", "-c:v", "libx264", "-threads", "4",
                "-preset", "slow", "-crf", "25", "-g", str(FPS * 2),
                "-maxrate", f"{maxrate}k", "-bufsize", f"{maxrate * 2}k",
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
        posters = []
        for film in files:
            poster = film.with_name(film.stem.replace("river-", "river-start-") + ".webp")
            # WebP uses BT.601 YUV. Preserve the displayed colors of the
            # decoded H.264 opening frame when preparing the static layer.
            subprocess.run([
                ffmpeg, "-hide_banner", "-loglevel", "error", "-i", str(film),
                "-frames:v", "1", "-vf", "scale=in_color_matrix=bt709:out_color_matrix=bt601",
                "-c:v", "libwebp", "-quality", "88", "-compression_level", "5", str(poster)
            ], check=True)
            posters.append(poster)
        for file in files + posters:
            final = file.replace(destination / file.name)
            print(f"Rendered {final} ({final.stat().st_size:,} bytes)", flush=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--output-dir", required=True, type=Path, help="Destination for the films and opening stills.")
    parser.add_argument("--browser-channel", help="Use an installed Chrome (chrome) or Edge (msedge).")
    args = parser.parse_args()
    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        parser.error("Install the optional renderer dependency with python -m pip install playwright")
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
                page.evaluate(SETUP)
                encode(page, ffmpeg, args.output_dir)
                browser.close()
        finally:
            server.shutdown()
            thread.join()


if __name__ == "__main__":
    main()
