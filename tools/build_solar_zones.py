"""Pack soft landscape lighting regions for the Eastern daylight compositor."""
from pathlib import Path

from PIL import Image, ImageChops, ImageFilter


def main():
    scene = Path(__file__).resolve().parents[1] / "assets" / "river-scene"
    size = (300, 160)
    sky, _, valley = Image.open(scene / "weather-mask.png").convert("RGB").split()
    falls, pool, spray = Image.open(scene / "water-mask.png").convert("RGB").split()
    atmosphere = ImageChops.lighter(sky, valley.point(lambda value: value * 0.55))
    water = ImageChops.lighter(ImageChops.lighter(falls, pool), spray)
    # These are diffuse lighting regions. Soft boundaries let moving branches,
    # advancing crests and spray pass through the light without a painted edge.
    regions = [mask.resize(size, Image.Resampling.LANCZOS).filter(ImageFilter.GaussianBlur(1.8))
               for mask in (atmosphere, water, pool)]
    # Locate warm light caught on the far ridge and in the photographed pool.
    # Reserve the upper half of alpha to keep RGB precise in premultiplied
    # browser decoders. Only the low-frequency color cast is used at runtime.
    base = Image.open(scene / "river-desktop.webp").convert("RGB").resize(size, Image.Resampling.LANCZOS)
    red, green, blue = base.split()
    warm = ImageChops.subtract(red, Image.blend(green, blue, .5), scale=.16, offset=45)
    regions.append(warm.filter(ImageFilter.GaussianBlur(1.5)).point(lambda v: 128 + v * 127 / 255))
    Image.merge("RGBA", regions).save(scene / "solar-zones.png", optimize=True)


if __name__ == "__main__":
    main()
