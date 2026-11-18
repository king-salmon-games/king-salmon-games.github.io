"""Integrate sunlight through the river's looping cloud volume onto a ground tile."""

from pathlib import Path

import numpy as np
from PIL import Image


def smooth(value):
    value = np.clip(value, 0, 1)
    return value * value * (3 - 2 * value)


def sample(volume, x, y, z):
    """Periodic trilinear lookup in the shader's 62 × 62 × 64 noise field."""
    z, y, x = z * 64, y * 62, x * 62
    iz, iy, ix = np.floor(z).astype(int), int(np.floor(y)), np.floor(x).astype(int)
    dz, dy, dx = z - iz, y - iy, x - ix
    result = np.zeros((*x.shape, 2), dtype=np.float32)
    for oz, wz in enumerate((1 - dz, dz)):
        for oy, wy in enumerate((1 - dy, dy)):
            for ox, wx in enumerate((1 - dx, dx)):
                cell = volume[(iz + oz) % 64, (iy + oy) % 62, (ix + ox) % 62]
                result += cell * (wz * wy * wx)[..., None]
    return result


def bake_cloud_shadow(directory):
    directory = Path(directory)
    with Image.open(directory / "cloud-noise.png") as image:
        atlas = np.asarray(image.convert("RGB"))[::-1, :512, :2]
    # Eight square slices per row, with one guard texel around each slice.
    slices = atlas.reshape(8, 64, 8, 64, 2).transpose(0, 2, 1, 3, 4)
    volume = slices.reshape(64, 64, 64, 2)[:, 1:-1, 1:-1].astype(np.float32) / 255
    z, x = (np.indices((128, 128), dtype=np.float32) + 0.5) / 128
    optical_depth = np.zeros_like(x)
    steps = 24
    for i in range(steps):
        height = (i + 0.5) / steps
        # Project an oblique beam through the full depth of the sunlit deck.
        field = sample(volume, x + 0.23 * height, 0.37 * (0.74 + 1.08 * height),
                       z + 0.13 * height)
        profile = smooth(height / 0.24) * (1 - smooth((height - 0.55) / 0.45))
        eroded = field[..., 0] - (0.24 + 0.23 * field[..., 1]) - 0.16 * (1 - profile)
        optical_depth += smooth((eroded + 0.08) / 0.47) * profile * (3.65 / steps)
    light = np.exp(-optical_depth)
    # The sun has finite angular size. Wrap the penumbra across both tile edges.
    for axis in (0, 1):
        light = (np.roll(light, 2, axis) + 4 * np.roll(light, 1, axis) + 6 * light
                 + 4 * np.roll(light, -1, axis) + np.roll(light, -2, axis)) / 16
    Image.fromarray(np.rint(light[::-1] * 255).astype(np.uint8)).save(
        directory / "cloud-shadow.png", optimize=True)
