#!/usr/bin/env python3
"""Render the six-second waterfall loops used on the studio homepage.

Optional rendering tools: Python 3 with NumPy and OpenCV, and FFmpeg with the
libx264 encoder on PATH. The website itself does not need these tools.

    python -m pip install numpy opencv-python-headless
    python tools/render_river.py --output-dir rendered-river

The default source is assets/river-scene/river-desktop.webp. To use a different
export of the same artwork, pass --input PATH. All points below are hand-traced
in the 1717 x 916 source image. Origin is the top left, with y increasing down.
"""

import argparse
from pathlib import Path
import shutil
import subprocess
from tempfile import TemporaryDirectory

try:
    import cv2
    import numpy as np
except ImportError:
    cv2 = None


ASSETS = Path(__file__).resolve().parents[1] / "assets" / "river-scene"
WIDTH, HEIGHT = 1717, 916
FPS = 24
FRAME_COUNT = 6 * FPS
DESKTOP_SIZE = (1440, 768)
MOBILE_SIZE = (640, 800)
MOBILE_CROP = slice(820, 1553)

# Each ledge has a separate outline and feather radius in pixels so the
# exposed basalt between tiers stays in place as water travels over it.
LEDGES = [
    (5, [
        (980, 378), (1015, 370), (1052, 371), (1054, 388), (1093, 383),
        (1122, 370), (1161, 372), (1215, 364), (1294, 361), (1394, 349),
        (1471, 330), (1555, 317), (1623, 303), (1630, 340), (1608, 405),
        (1605, 437), (1543, 485), (1503, 553), (1460, 618), (1418, 681),
        (1363, 696), (1037, 687), (1048, 613), (1039, 530), (1000, 465),
        (964, 448), (989, 410),
    ]),
    (3, [(850, 409), (890, 409), (886, 448), (895, 461), (852, 462), (845, 448)]),
    (4, [
        (992, 456), (1024, 457), (1042, 478), (1036, 519), (1051, 565),
        (1036, 610), (991, 604), (951, 572), (858, 570), (859, 522),
        (889, 481), (951, 468),
    ]),
    (3, [
        (742, 510), (791, 486), (856, 472), (915, 472), (904, 496),
        (867, 556), (850, 570), (764, 560), (725, 554),
    ]),
    (4, [
        (738, 570), (795, 574), (860, 593), (917, 608), (952, 622), (989, 665),
        (988, 685), (783, 695), (742, 678), (758, 641), (729, 610),
    ]),
]

BROOK = [
    (478, 702), (625, 693), (866, 686), (1157, 693), (1350, 696), (1438, 699),
    (1507, 689), (1643, 729), (1717, 711), (1717, 916), (868, 916), (835, 880),
    (750, 866), (678, 854), (624, 817), (564, 801), (568, 766), (475, 737),
]

SPRAY = [
    (939, 637), (1024, 587), (1106, 586), (1182, 607), (1336, 555), (1510, 471),
    (1561, 453), (1560, 486), (1493, 558), (1439, 613), (1403, 666), (1381, 704),
    (1109, 710), (948, 686),
]


def feathered_mask(points, radius):
    mask = np.zeros((HEIGHT, WIDTH), dtype=np.uint8)
    cv2.fillPoly(mask, [np.array(points, dtype=np.int32)], 255, lineType=cv2.LINE_AA)
    return cv2.GaussianBlur(mask, (0, 0), radius).astype(np.float32) / 255


def smoothstep(values):
    t = np.clip(values, 0, 1)
    return t * t * (3 - 2 * t)


def water_frames(image):
    y, x = np.mgrid[:HEIGHT, :WIDTH].astype(np.float32)
    original = image.astype(np.float32)
    blue = original[:, :, 0]
    red = original[:, :, 2]

    # Within the outline, give the blue-white water more motion than dark rock.
    surface = smoothstep((blue - red - 2) / 24) * smoothstep((blue - 54) / 67)
    waterfall = np.maximum.reduce([feathered_mask(points, radius) for radius, points in LEDGES])
    falling_water = waterfall * (0.13 + 0.87 * cv2.GaussianBlur(surface, (0, 0), 2.2))
    brook = feathered_mask(BROOK, 5) * (0.43 + 0.57 * smoothstep((blue - red + 4) / 30))
    spray = feathered_mask(SPRAY, 23) * smoothstep((blue - 102) / 100)

    # Distances are source pixels traveled per phase. The flow accelerates
    # down the rock face and spreads out horizontally as it enters the brook.
    fall_speed = (38 + 13 * np.clip((y - 370) / 300, 0, 1)) * falling_water
    fall_slope = -0.22 - 0.16 * np.sin(x * 0.011) - 0.1 * np.sin(y * 0.016)
    brook_speed = 14 + np.maximum(0, y - 695) * 0.092
    flow_x = fall_slope * fall_speed + brook_speed * brook * (0.78 * np.sin(x * 0.004 + 1.9) + 0.22)
    flow_y = fall_speed + (7 + np.maximum(0, y - 700) * 0.082) * brook

    offset = (
        0.115 * np.sin(x * 0.011 + y * 0.004)
        + 0.13 * np.sin(x * 0.0043 - y * 0.0086)
        + 0.04 * np.sin(x * 0.036)
        + 0.11 * np.sin(y * 0.016)
    )
    strength = np.clip(np.maximum(brook, waterfall) * 0.83 + spray * 0.13, 0, 0.92)[:, :, None]
    for frame in range(FRAME_COUNT):
        t = frame / FRAME_COUNT
        angle = 2 * np.pi * t
        # Crossfade two phases half a cycle apart to hide the texture reset.
        phase_a = (7 * t + offset) % 1 - 0.5
        phase_b = (phase_a + 1) % 1 - 0.5
        weight = (0.5 + 0.5 * np.cos(2 * np.pi * phase_a))[:, :, None]
        shimmer = (
            0.94 * np.sin(x * 0.027 + y * 0.039 + angle * 3)
            + 0.48 * np.sin(x * 0.011 - y * 0.055 - angle * 5)
        ) * brook
        mist_x = (1.6 * np.sin(y * 0.032 + x * 0.004 + angle) + 0.6 * np.cos(x * 0.019 - angle * 2)) * spray
        mist_y = 1.5 * np.sin(x * 0.016 + y * 0.014 - angle * 2) * spray
        base_x, base_y = x + shimmer + mist_x, y + mist_y
        a = cv2.remap(image, base_x - flow_x * phase_a, base_y - flow_y * phase_a,
                      cv2.INTER_LINEAR, borderMode=cv2.BORDER_REPLICATE)
        b = cv2.remap(image, base_x - flow_x * phase_b, base_y - flow_y * phase_b,
                      cv2.INTER_LINEAR, borderMode=cv2.BORDER_REPLICATE)
        displaced = a * weight + b * (1 - weight)
        yield np.clip(original + (displaced - original) * strength, 0, 255).astype(np.uint8)


def encoder(ffmpeg, target, size, quality):
    return subprocess.Popen([
        ffmpeg, "-hide_banner", "-loglevel", "error", "-f", "rawvideo",
        "-pix_fmt", "bgr24", "-s:v", f"{size[0]}x{size[1]}", "-r", str(FPS),
        "-i", "pipe:0", "-an", "-c:v", "libx264", "-threads", "4",
        "-crf", str(quality), "-preset", "slow", "-profile:v", "high",
        "-g", str(FRAME_COUNT), "-pix_fmt", "yuv420p", "-movflags", "+faststart",
        str(target),
    ], stdin=subprocess.PIPE)


def render(ffmpeg, source, destination):
    image = cv2.imdecode(np.frombuffer(source.read_bytes(), dtype=np.uint8), cv2.IMREAD_COLOR)
    if image is None or image.shape[:2] != (HEIGHT, WIDTH):
        raise ValueError(f"The traced masks require a decodable {WIDTH} x {HEIGHT} source image.")

    destination.mkdir(parents=True, exist_ok=True)
    # Finish both encodes before replacing any previously rendered files.
    with TemporaryDirectory(dir=destination) as staging:
        desktop_file = Path(staging) / "river-desktop.mp4"
        mobile_file = Path(staging) / "river-mobile.mp4"
        with encoder(ffmpeg, desktop_file, DESKTOP_SIZE, 22) as desktop, \
                encoder(ffmpeg, mobile_file, MOBILE_SIZE, 23) as mobile:
            for frame in water_frames(image):
                wide = cv2.resize(frame, DESKTOP_SIZE, interpolation=cv2.INTER_AREA)
                portrait = cv2.resize(frame[:, MOBILE_CROP], MOBILE_SIZE, interpolation=cv2.INTER_AREA)
                desktop.stdin.write(wide.tobytes())
                mobile.stdin.write(portrait.tobytes())

        if desktop.returncode or mobile.returncode:
            raise RuntimeError("FFmpeg failed to encode the river videos.")
        for file in (desktop_file, mobile_file):
            target = file.replace(destination / file.name)
            print(f"Rendered {target} ({target.stat().st_size:,} bytes)")


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--input", type=Path, default=ASSETS / "river-desktop.webp",
                        help="Full-resolution source image (default: checked-in desktop poster).")
    parser.add_argument("--output-dir", type=Path, required=True,
                        help="Write river-desktop.mp4 and river-mobile.mp4 here, replacing existing versions.")
    args = parser.parse_args()
    if cv2 is None:
        parser.error("Install the rendering dependencies with: python -m pip install numpy opencv-python-headless")
    ffmpeg = shutil.which("ffmpeg")
    if not ffmpeg:
        parser.error("Install FFmpeg with libx264 support and add it to PATH.")
    try:
        render(ffmpeg, args.input, args.output_dir)
    except (OSError, ValueError, RuntimeError) as error:
        parser.exit(1, f"Render failed: {error}\n")


if __name__ == "__main__":
    main()
