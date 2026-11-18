#!/usr/bin/env python3
"""Build the sky/canopy matte and a tileable volume for the weather shader.

Run with Python, NumPy, and Pillow. All contour coordinates refer to the
original 1717 x 916 landscape, with the origin in the upper left.
"""
from argparse import ArgumentParser
from pathlib import Path

import numpy as np
from build_cloud_shadow import bake_cloud_shadow
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
    (1374, 149), (1396, 156), (1421, 166), (1444, 172), (1465, 178),
    (1490, 187), (1505, 187), (1520, 184), (1540, 179), (1556, 176),
    (1566, 174), (1577, 165), (1587, 161), (1606, 158), (1630, 150), (1655, 153),
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
    (1185, 236, 301, 22), (1243, 246, 308, 20), (1311, 271, 320, 21),
    (1340, 282, 325, 21), (1548, 273, 315, 17), (1592, 219, 301, 35), (1625, 227, 299, 27),
    (1678, 105, 297, 66), (1720, 140, 280, 52),
]

# Bottom of the open valley, behind the nearer firs. Rendering extinction
# behind this silhouette keeps branches sharp as a low bank passes them.
FRONT_TREES = [
    (950,145),(985,159),(996,174),(1013,147),(1026,174),(1036,174),
    (1046,153),(1059,177),(1068,199),(1087,183),(1101,210),(1114,225),
    (1129,222),(1140,238),(1153,236),(1166,213),(1177,234),(1185,234),
    (1196,251),(1215,227),(1228,248),(1240,256),(1246,248),(1258,268),
    (1273,281),(1288,258),(1300,279),(1310,274),(1324,291),(1332,276),
    (1344,294),(1355,288),(1370,306),(1390,291),(1405,282),(1420,278),
    (1440,260),(1460,247),(1499,237),(1520,219),(1541,210),(1568,204),
    (1594,201),(1630,196),(1649,176),(1662,158),(1676,112),(1717,145)
]
# The weather atlas stores recovered hillside color and a separate optical
# depth guide over the valley; both cover this rectangle in plate pixels.
VALLEY_BOX = (800, 75, 1717, 368)


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
    # At the sunset opening the farther ridge rises behind the nearer one.
    # Resolve its warm, antialiased edge directly from the high-resolution art.
    warm_rim = smooth((x-1405.)/30.)*smooth((1648.-x)/18.)*smooth((8.-abs(y-horizon))/4.)
    sky = (1.-warm_rim)*sky + warm_rim*smooth((r-.77)/.19)
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
        spread = radius*(.5+.65*clamp01((y-tip)/(root-tip)))
        # Carry the inverse warp through the air on either side of the tip.
        # Constricting it to the original silhouette pins the leading needles.
        crown = smooth((spread - abs(x-cx) + 16.)/19.) * smooth((y-tip+22.)/15.)
        flex = np.maximum(flex, above_root*crown)
    autumn = polygon([(485,132),(679,138),(738,173),(749,219),(782,251),
                      (853,295),(860,326),(806,336),(731,286),(634,237),
                      (558,192),(489,175)],7)
    leaf_mass = blur(smooth((r-b+.008)/.15),3.5)
    flex = np.maximum(flex, autumn*(.26 + .70*leaf_mass))
    # Larger sway at the last few inches, less near the branch bases.
    flex *= .72 + .28 * smooth((.24-g)/.15)
    front = np.interp(x, *np.asarray(FRONT_TREES).T)
    # Within the last few pixels of the bank the darker pixels are individual
    # foreground needles. Farther back the volume may cover even dark terrain.
    rim = smooth((front+15.-y)/20.)
    rim *= 1.-smooth((y-front+10.)/19.)*(1.-smooth((r-.26)/.17))
    valley = rim*smooth((y-horizon-5.)/14.)*smooth((x-954.)/32.)*(1.-sky)
    # Two shallow volumes of airborne spray immediately above the cascade.
    # Terminate at its rock lip, well above the foreground river.
    lip = np.interp(x,[800,867,913,957,996,1080,1180,1290,1380,1480,1570,1624,1717],
                      [362,347,342,344,357,359,361,354,345,330,314,305,281])
    shelf = smooth((lip-y-7.)/11.)*smooth((y-lip+114.)/42.)
    plumes = np.exp(-((x-982.)/118.)**2)+.83*np.exp(-((x-1510.)/128.)**2)
    fog = np.maximum(valley, shelf*plumes*smooth((r-.18)/.22))
    fog *= smooth((x-800.)/40.)
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


def valley_layers(image, fog):
    """Separate the illuminated vapor from the mountains it obscures.

    A grayscale morphological opening at ridge scale recovers the local dark
    envelope in each color channel. Ignore the open sky and the near trees
    when estimating that envelope so their colors cannot bleed into the bank.
    """
    valley = image.crop(VALLEY_BOX)
    small_size = (306, 98)
    visible = np.asarray(gray(fog).crop(VALLEY_BOX).resize(small_size, Image.Resampling.BOX)) > 45
    colors = np.asarray(valley.resize(small_size, Image.Resampling.BOX))
    result = []
    for channel in colors.transpose(2, 0, 1):
        inside = Image.fromarray(np.where(visible, channel, 255).astype(np.uint8))
        floor = np.asarray(inside.filter(ImageFilter.MinFilter(21)))
        floor = Image.fromarray(np.where(visible, floor, 0).astype(np.uint8))
        result.append(floor.filter(ImageFilter.MaxFilter(21)).filter(ImageFilter.GaussianBlur(1)))
    floor = np.asarray(Image.merge("RGB", result).resize(valley.size, Image.Resampling.BICUBIC), dtype=np.float32)/255.
    original = np.asarray(valley, dtype=np.float32)/255.
    soft = np.asarray(valley.filter(ImageFilter.GaussianBlur(1.8)),dtype=np.float32)/255.
    excess = np.maximum(.7*soft + .3*original - floor, 0)
    luminance = np.array([.2126,.7152,.0722],np.float32)
    excess *= smooth((excess @ luminance - .012)/.065)[...,None]
    restriction = np.asarray(gray(fog).crop(VALLEY_BOX),dtype=np.float32)/255.
    clear = clamp01(original - excess*smooth(restriction/.70)[...,None])
    # The extinction guide is independent of the receiving hillside. This
    # lets the shader advect bright cloud shapes without moving mountain edges.
    extinction = clamp01((excess @ luminance) / np.maximum(.84 - clear @ luminance, .09))
    # Avoid importing an edge from outside the flyable volume on advection.
    # The cloud continues behind each tree. Fill the hidden part of the optical
    # guide from unobstructed neighboring cloud, otherwise advecting it copies
    # a whole pine silhouette or a strip of bright sky onto the hillside.
    valid = smooth((restriction-.20)/.63)
    support = blur(valid,16.)
    continuation = blur(extinction*valid,16.) / np.maximum(support,.035)
    extinction = extinction*valid + continuation*(1.-valid)
    clean = Image.fromarray((255*clear).round().astype(np.uint8))
    return clean, gray(extinction)


def make_noise(image, sky, fog):
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
    # The original guarded 3D slices and column coverage occupy the left half.
    # The right holds the clear mountain plate above its optical-depth guide.
    packed = Image.new("RGB",(1024,512))
    packed.paste(Image.fromarray(atlas))
    clear, extinction = valley_layers(image,fog)
    for y, layer in ((0,clear),(256,extinction)):
        field = np.asarray(layer.convert("RGB").resize((510,254),Image.Resampling.LANCZOS))
        guarded = np.pad(field, ((1,1),(1,1),(0,0)), mode="edge")
        packed.paste(Image.fromarray(guarded), (512,y))
    return packed


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
    make_noise(image, sky, fog).save(args.output_dir / "cloud-noise.png", optimize=True)
    bake_cloud_shadow(args.output_dir)
    if args.overlay:
        Image.blend(image, masks, .5).save(args.overlay)


if __name__ == "__main__":
    main()
