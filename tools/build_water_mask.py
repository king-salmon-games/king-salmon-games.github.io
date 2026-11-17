#!/usr/bin/env python3
"""Pack waterfall, brook and spray coverage into the live shader's RGB texture.

Run with Python, NumPy and OpenCV:
    python tools/build_water_mask.py
    python tools/build_water_mask.py --overlay mask-overlay.jpg

All traced coordinates are pixels of the 1717 × 916 desktop river artwork,
measured from the upper left. WebGL applies the screen crop at run time.
"""

import argparse
from pathlib import Path

try:
    import cv2
    import numpy as np
except ImportError:
    cv2 = None

from render_river import ASSETS, BROOK, HEIGHT, LEDGES, SPRAY, WIDTH, feathered_mask, smoothstep


# The offline film's traces identify the five tiers. The live shader adds
# normals and refraction, so exposed islands within those outlines need holes.
EXPOSED_BASALT = [
    (3, [(871, 481), (901, 468), (928, 465), (954, 464), (979, 456),
         (1000, 455), (1025, 456), (1037, 465), (1041, 487), (1035, 529),
         (1017, 565), (1008, 591), (979, 608), (934, 604), (909, 592),
         (890, 577), (873, 563)]),
    (2, [(1057, 374), (1067, 363), (1086, 365), (1102, 367), (1114, 373),
         (1107, 383), (1094, 385), (1088, 402), (1081, 407), (1072, 409),
         (1064, 421), (1057, 416)]),
    (2, [(1195, 406), (1201, 395), (1213, 390), (1232, 388), (1237, 390),
         (1228, 410), (1219, 435), (1216, 459), (1207, 475), (1202, 498),
         (1197, 509), (1198, 472), (1201, 435)]),
]

# The pool boundary follows the far waterline, then the right bank, then the
# jagged silhouette of both foreground boulders. Keep the warm sky reflections
# inside this contour, including pixels whose color resembles the bank.
POOL = [
    (581, 691), *BROOK[1:5], (1397, 698), (1452, 700), (1512, 701),
    (1577, 707), (1644, 713), (1717, 714), (1717, 916), (825, 916),
    (812, 892), (793, 877), (773, 860), (744, 851), (716, 848),
    (678, 850), (646, 850), (630, 854), (605, 852), (573, 851),
    (566, 838), (558, 817), (553, 807), (544, 801), (535, 786),
    (524, 778), (516, 769), (516, 766), (560, 767), (595, 764),
    (636, 761), (631, 746), (627, 729), (625, 714), (617, 707),
    (596, 706), (582, 702),
]

# Spray diffuses laterally past the main sheets, but a large outcrop occludes
# it at lower right. A soft exclusion keeps that high-contrast silhouette dry.
RIGHT_BANK = [
    (1398, 697), (1404, 679), (1413, 657), (1436, 644), (1453, 643),
    (1469, 627), (1488, 616), (1519, 608), (1554, 597), (1589, 601),
    (1624, 598), (1656, 587), (1682, 568), (1717, 543), (1717, 720),
]


def channel_masks(source):
    blue, green, red = cv2.split(source.astype(np.float32))
    sheets = np.maximum.reduce([feathered_mask(points, radius) for radius, points in LEDGES])
    shelves = np.maximum.reduce([feathered_mask(points, radius) for radius, points in EXPOSED_BASALT])

    # A low-frequency material matte suppresses rock in the narrow channels.
    # Soft local values keep texture in the source art from stippling the water.
    cool = smoothstep((blue - red - 13) / 36)
    bright = smoothstep((blue - 69) / 72)
    # The brightest breaking crests pick up the warm sky and lose their
    # blue cast. Keep them attached to the colored water beneath each lip.
    whitewater = smoothstep((np.minimum.reduce([blue, green, red]) - 164) / 67)
    water_color = cv2.GaussianBlur(np.maximum(cool * bright, whitewater), (0, 0), 2.4)
    sheets *= water_color * (1 - shelves)
    pool = feathered_mask(POOL, 2.4)

    spray = feathered_mask(SPRAY, 21) * smoothstep((blue - 94) / 97)
    spray *= 1 - feathered_mask(RIGHT_BANK, 3)
    spray *= 1 - shelves
    # Wind-blown mist gives way to surface shading below the impact line.
    row = np.arange(HEIGHT, dtype=np.float32)[:, None]
    spray *= 1 - smoothstep((row - 687) / 19)
    sheets *= 1 - 0.62 * spray
    return sheets, pool, spray


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--input", type=Path, default=ASSETS / "river-desktop.webp")
    parser.add_argument("--output", type=Path, default=ASSETS / "water-mask.png")
    parser.add_argument("--overlay", type=Path, help="Also write a full-size RGB overlay for checking alignment.")
    args = parser.parse_args()
    if cv2 is None:
        parser.error("Install the optional rendering tools with python -m pip install numpy opencv-python-headless")
    source = cv2.imdecode(np.frombuffer(args.input.read_bytes(), np.uint8), cv2.IMREAD_COLOR)
    if source is None or source.shape[:2] != (HEIGHT, WIDTH):
        parser.error(f"Expected a {WIDTH} × {HEIGHT} landscape for these traces.")
    sheets, pool, spray = channel_masks(source)
    # OpenCV's encoder expects channels in BGR order.
    coverage = np.dstack((spray, pool, sheets))
    packed = np.rint(255 * cv2.resize(coverage, ((WIDTH + 1) // 2, HEIGHT // 2), interpolation=cv2.INTER_AREA))
    if not cv2.imwrite(str(args.output), packed.astype(np.uint8), [cv2.IMWRITE_PNG_COMPRESSION, 9]):
        parser.exit(1, f"Failed to write {args.output}\n")
    if args.overlay:
        opacity = 0.53 * np.max(coverage, axis=2, keepdims=True)
        overlay = np.clip(source * (1 - opacity) + 140 * coverage, 0, 255)
        if not cv2.imwrite(str(args.overlay), overlay.astype(np.uint8)):
            parser.exit(1, f"Failed to write {args.overlay}\n")


if __name__ == "__main__":
    main()
