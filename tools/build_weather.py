#!/usr/bin/env python3
"""Build the sky/canopy matte and a tileable volume for the weather shader.

Run with Python, NumPy, and Pillow. All contour coordinates refer to the
original 1717 x 916 landscape, with the origin in the upper left.
"""
from argparse import ArgumentParser
from pathlib import Path
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

ASSETS = Path(__file__).resolve().parents[1] / "assets" / "river-scene"
WIDTH, HEIGHT = 1717, 916
CLOUD_ROWS = 232
# Farthest visible ridge. Individual fir needles and crest details are refined
# from the photograph rather than clipped against this broad outline.
SKYLINE = [
    (0, 0), (535, 5), (635, 73), (700, 124), (795, 150), (955, 145),
    (974, 137), (995, 130), (1022, 122), (1050, 113), (1080, 102),
    (1110, 99), (1137, 101), (1160, 109), (1182, 120), (1193, 120),
    (1215, 132), (1238, 145), (1262, 146), (1300, 147), (1346, 150),
    (1374, 149), (1396, 156), (1421, 162), (1444, 151), (1465, 149),
    (1487, 155), (1502, 163), (1526, 157), (1540, 159), (1556, 164),
    (1570, 157), (1587, 160), (1606, 152), (1630, 147), (1655, 153),
    (1683, 150), (1717, 145),
]
# Anchors of near conifer tips. Height-dependent flex locks each crown to its
# own stem and gives the taller trees a longer motion arc.
FIRS = [
    (646, 17, 128, 49), (697, 0, 118, 49), (740, 0, 183, 59),
    (783, 62, 174, 36), (859, -11, 204, 72), (931, 52, 204, 55),
    (975, 129, 207, 34), (1013, 147, 240, 39), (1046, 154, 245, 35),
    (1087, 183, 270, 32), (1129, 221, 292, 27), (1167, 213, 296, 31),
    (1216, 226, 301, 27), (1257, 265, 320, 22), (1287, 255, 315, 24),
    (1340, 282, 325, 21), (1592, 219, 301, 35), (1625, 213, 299, 31),
    (1678, 105, 297, 66), (1720, 140, 280, 52),
]


def clamp01(a):
    return np.clip(a, 0., 1.)


def smooth(a):
    a = clamp01(a)
    return a * a * (3. - 2. * a)


def gray(values):
    return Image.fromarray(np.rint(255 * clamp01(values)).astype("uint8"))


def blur(values, radius):
    return np.asarray(gray(values).filter(ImageFilter.GaussianBlur(radius)),
                      dtype=np.float32) / 255.


def polygon(points, softness):
    image = Image.new("L", (WIDTH, HEIGHT), 0)
    ImageDraw.Draw(image).polygon(points, fill=255)
    return np.asarray(image.filter(ImageFilter.GaussianBlur(softness)),
                      dtype=np.float32) / 255.


def make_masks(image):
    rgb = np.asarray(image, dtype=np.float32) / 255.
    r, g, b = rgb.transpose(2, 0, 1)
    y, x = np.ogrid[:HEIGHT, :WIDTH]
    horizon = np.interp(x, *np.asarray(SKYLINE).T)
    # Bright blue openings among the dark foreground firs are sky. At right
    # the rim needles and distant mountains are purple and less saturated.
    pine_gate = smooth((r - .235) / .16) * smooth((b - .32) / .16)
    right_gate = smooth((r - .37) / .19)
    gate = np.where(x < 994, pine_gate, 1.)
    gate = np.where(x > 1642, right_gate, gate)
    sky = smooth((horizon + 2. - y) / 4.5) * gate
    near_ridge = (x >= 973) & (x < 1229) & (np.abs(y - horizon) < 10)
    # Tiny treetops along the ridge have a cooler red/blue ratio than the
    # cloud bank behind them. Preserve their silhouette.
    sky *= np.where(near_ridge, .12 + .88 * smooth((r / (b + .015) - .57) / .17), 1.)
    sky *= smooth((x - 545) / 90)
    # Layered canopy pieces with explicit feathered joints. The main trunk and
    # basalt are omitted; only suspended branches, leaves, and fern tips bend.
    limbs = [
        ([(160,0),(625,0),(794,44),(730,58),(638,47),(556,92),(455,115),
          (344,139),(282,122),(261,81)], 8, .91),
        ([(37,0),(154,0),(175,28),(119,109),(64,136),(0,151),(0,81)], 9,.71),
        ([(245,102),(320,76),(450,112),(578,159),(691,206),(643,227),
          (517,210),(401,176),(315,178)], 11,.75),
        ([(570,159),(692,146),(748,183),(770,248),(850,290),(830,332),
          (739,297),(686,259),(631,204)], 10,.63),
        ([(429,409),(513,420),(573,399),(644,420),(601,461),(517,470),
          (453,457)], 6,.48),
        ([(0,381),(91,335),(169,343),(200,365),(286,389),(325,413),
          (254,431),(156,404),(42,435),(0,432)],6,.72),
        ([(0,470),(93,452),(147,478),(184,506),(201,541),(267,579),
          (322,635),(250,638),(172,596),(87,577),(0,595)],8,.88),
    ]
    flex = np.zeros((HEIGHT,WIDTH),np.float32)
    for outline, feather, strength in limbs:
        flex = np.maximum(flex, polygon(outline,feather) * strength)
    # The large diagonal trunk remains rigid, including small gaps at its edge.
    trunk = polygon([(186,0),(258,0),(233,98),(211,178),(185,263),(155,357),
                     (131,457),(93,474),(112,370),(149,242),(180,100)],7)
    flex *= 1-trunk
    for cx, tip, root, radius in FIRS:
        above_root = smooth((root-y) / (root-tip))
        spread = radius*(.51+.60*clamp01((y-tip)/(root-tip)))
        crown = smooth((spread - abs(x-cx) + 8.)/15.) * smooth((y-tip+7.)/10.)
        flex = np.maximum(flex, .86 * above_root*crown)
    # Larger sway at the last few inches, less near the branch bases.
    flex *= .72 + .28 * smooth((.24-g)/.15)
    # Mist moves between the layered mountains and is occluded by the front
    # treeline. The luminance test models foreground pine needles inside gaps.
    fog = polygon([(966,142),(1040,115),(1117,100),(1194,125),(1265,148),
                   (1348,150),(1426,167),(1480,165),(1560,165),(1642,150),
                   (1657,201),(1618,222),(1570,238),(1518,249),(1450,273),
                   (1370,310),(1325,291),(1285,270),(1246,266),(1212,242),
                   (1168,236),(1126,246),(1095,214),(1034,183),(982,169)], 7)
    fog *= smooth((r - .28) / .27) * (1.-sky)
    return sky, flex, fog


def periodic_value(shape, cells, rng):
    # Smooth interpolation on a periodic coarse lattice. Arrays are Z,Y,X.
    lattice = rng.random((cells, cells, cells), dtype=np.float32)
    result = np.zeros(shape, np.float32)
    axes = [np.arange(n, dtype=np.float32) * cells / n for n in shape]
    coords = np.meshgrid(*axes, indexing="ij", sparse=True)
    indices = [p.astype(np.int32) for p in coords]
    weights = [smooth(p - i) for p, i in zip(coords, indices)]
    for z in (0,1):
        for y in (0,1):
            for x in (0,1):
                corner = (z, y, x)
                index = tuple((i + j) % cells for i, j in zip(indices, corner))
                weight = 1.
                for alpha, offset in zip(weights, corner):
                    weight = weight * (alpha if offset else 1. - alpha)
                result += lattice[index] * weight
    return result


def periodic_worley(shape, cells, rng):
    # Distance to periodic cell feature points forms billows and ragged edges.
    features = rng.uniform(.08, .92, (cells, cells, cells, 3)).astype(np.float32)
    axes = [np.arange(n, dtype=np.float32) * cells / n for n in shape]
    points = np.meshgrid(*axes, indexing="ij", sparse=True)
    bases = [p.astype(np.int32) for p in points]
    fractions = [p - i for p, i in zip(points, bases)]
    nearest = np.full(shape, 4., np.float32)
    for z in (-1, 0, 1):
        for y in (-1, 0, 1):
            for x in (-1, 0, 1):
                offset = (z, y, x)
                index = tuple((i + j) % cells for i, j in zip(bases, offset))
                centers = features[index]
                squared = sum(
                    (fraction - j - centers[..., k]) ** 2
                    for k, (fraction, j) in enumerate(zip(fractions, offset))
                )
                nearest = np.minimum(nearest, squared)
    return clamp01(1. - np.sqrt(nearest) / 1.05)


def make_noise(image, sky):
    rng = np.random.default_rng(17063)
    shape = (64, 62, 62)
    coarse = (.56 * periodic_value(shape, 3, rng)
              + .29 * periodic_value(shape, 6, rng)
              + .15 * periodic_value(shape, 13, rng))
    billows = .63 * periodic_worley(shape, 5, rng) + .37 * periodic_worley(shape, 11, rng)
    body = clamp01(.5 + 1.55 * ((.64 * coarse + .36 * billows) - .5))
    erosion = clamp01(.67 * periodic_worley(shape, 13, rng) + .33 * periodic_value(shape, 27, rng))
    atlas = np.zeros((512, 512, 3), dtype=np.uint8)
    for z in range(64):
        y, x = divmod(z, 8)
        for channel, values in enumerate((body, erosion)):
            tile = (np.pad(values[z], 1, mode="wrap") * 255).round().astype("uint8")
            atlas[y*64:y*64+64, x*64:x*64+64, channel] = tile
    # Blue stores a separate, broad map of cloud column coverage. Its structure
    # is recovered from the sky plate's luminance residual, never from branches.
    luminance = np.asarray(image.convert("L"), dtype=np.float32) / 255.
    nearby_sky = blur(sky, 18.)
    local = blur(luminance * sky, 18.) / np.maximum(nearby_sky, .008)
    broad = blur(luminance * sky, 63.) / np.maximum(blur(sky, 63.), .008)
    in_sky = sky * sky
    optical = clamp01(.52 + 2. * (broad - (luminance * in_sky + local * (1. - in_sky))))
    optical = np.where(nearby_sky > .035, optical, .52)
    atlas = atlas[::-1].copy()
    atlas[..., 2] = np.asarray(gray(optical[:CLOUD_ROWS]).resize((512, 512), Image.Resampling.LANCZOS))
    return Image.fromarray(atlas)


def main():
    parser = ArgumentParser(description=__doc__)
    parser.add_argument("--output-dir", type=Path, default=ASSETS)
    parser.add_argument("--overlay", type=Path, help="Optional color overlay of sky, foliage and valley mist.")
    args = parser.parse_args()
    image = Image.open(ASSETS / "river-desktop.webp").convert("RGB")
    if image.size != (WIDTH, HEIGHT):
        parser.error("Expected the original 1717 x 916 landscape")
    sky, flex, fog = make_masks(image)
    masks = Image.merge("RGB", (gray(sky), gray(flex), gray(fog)))
    args.output_dir.mkdir(parents=True, exist_ok=True)
    masks.resize((1288, 687), Image.Resampling.LANCZOS).save(args.output_dir / "weather-mask.png", optimize=True)
    make_noise(image, sky).save(args.output_dir / "cloud-noise.png", optimize=True)
    if args.overlay:
        Image.blend(image, masks, .5).save(args.overlay)


if __name__ == "__main__":
    main()
