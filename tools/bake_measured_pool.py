#!/usr/bin/env python3
"""Bake neural free-surface heights in metres into a tileable pool texture.

The input NPZ contains `height[time, y, x]` on a regular grid. The scene
covers four metres in each horizontal direction and loops every 16 seconds.
Install NumPy and Pillow, then run:
    python tools/bake_measured_pool.py recording.npz
"""

import argparse
from pathlib import Path

import numpy as np
from PIL import Image

OUTPUT = Path(__file__).resolve().parents[1] / "assets/river-scene/measured-pool.webp"
SIZE = 64
WORLD_SIZE = 4.0
TARGET_RMS = 0.024
# Fixed physical units for the signed RGB codes in measured-pool.glsl.
HEIGHT_RANGE = 0.16
SLOPE_RANGE = 1.20


def sample_cubic(values, coords):
    """Sample along the first axis of the recording using centered tangents."""
    i = np.floor(coords).astype(int)
    t = (coords - i).reshape((-1,) + (1,) * (values.ndim - 1))
    a, b, c, d = (values[np.clip(i + k, 0, len(values) - 1)] for k in (-1, 0, 1, 2))
    return b + 0.5 * t * (
        c - a + t * (2 * a - 5 * b + 4 * c - d + t * (-a + 3 * b - 3 * c + d))
    )


def wrap_axis(field, axis):
    values = np.moveaxis(field, axis, 0)
    end = len(values) - 1
    overlap = max(2, round(0.20 * end))
    period = end - overlap
    # Spatial texels represent cell centers. The periodic boundary cuts the
    # linear segment between the last and first texels at its midpoint, so
    # their quantization cannot produce a slope kink at the tile edge.
    offset = 0.0 if axis == 0 else 0.5
    coords = (np.arange(SIZE) + offset) * (period / SIZE)
    t = np.minimum(1.0, coords / overlap)
    weight = (t * t * (3 - 2 * t)).reshape((-1,) + (1,) * (field.ndim - 1))
    # The head and tail keep travelling forward. At the wrap, both sides
    # sample the same interior point with the same tangent. Smoothstep's
    # zero end derivatives also join the sole recording after the overlap.
    head = sample_cubic(values, coords)
    tail = sample_cubic(values, np.minimum(coords + period, end))
    return np.moveaxis(tail + weight * (head - tail), 0, axis)


def slope(height, axis):
    return (np.roll(height, -1, axis) - np.roll(height, 1, axis)) / (
        2 * WORLD_SIZE / SIZE
    )


def bake(height, output):
    if height.ndim != 3 or min(height.shape) < 8 or not np.isfinite(height).all():
        raise ValueError(
            "height must be a finite time-by-y-by-x grid with at least 8 samples on each axis"
        )
    field = np.asarray(height, dtype=np.float64)
    # Remove the observation patch's sea-level heave at each instant. The
    # site's shallow-water solver already sets the river's mean level.
    field = field - field.mean(axis=(1, 2), keepdims=True)
    # The observed waves travel mainly toward -Y; the river runs toward +Y.
    field = field[:, ::-1, :]
    for axis in range(3):
        field = wrap_axis(field, axis)
    # The cropped overlap covers a different area of the measurement. Keep
    # that finished tile's reference level fixed through the animation, too.
    field -= field.mean(axis=(1, 2), keepdims=True)
    rms = np.sqrt(np.mean(field**2))
    if rms < 1e-10:
        raise ValueError("height contains no measurable waves")
    max_slope = max(np.max(np.abs(slope(field, axis))) for axis in (1, 2))
    gain = min(
        TARGET_RMS / rms,
        0.99 * HEIGHT_RANGE / np.max(np.abs(field)),
        0.98 * SLOPE_RANGE / max(max_slope, 1e-10),
    )
    field *= gain

    def encode(values, extent):
        return (128 + np.rint(values * (127 / extent))).astype(np.uint8)

    codes = encode(field, HEIGHT_RANGE)
    # Take the gradient of the actual decoded height, using neighbors across
    # the wrap. Both the intersection and normal see the same scaled surface.
    recovered = (codes.astype(float) - 128) * (HEIGHT_RANGE / 127)
    dx = slope(recovered, 2)
    dy = slope(recovered, 1)
    channels = np.stack(
        [codes, encode(dx, SLOPE_RANGE), encode(dy, SLOPE_RANGE)], axis=-1
    )
    tiles = np.pad(channels, ((0, 0), (1, 1), (1, 1), (0, 0)), mode="wrap")
    pitch = SIZE + 2
    atlas = (
        tiles.reshape(8, 8, pitch, pitch, 3)
        .transpose(0, 2, 1, 3, 4)
        .reshape(8 * pitch, 8 * pitch, 3)
    )
    output.parent.mkdir(parents=True, exist_ok=True)
    Image.fromarray(atlas).save(output, format="WEBP", lossless=True, method=6)
    print(
        f"{output}: {output.stat().st_size:,} bytes; {SIZE} frames; tile {WORLD_SIZE:g} m"
    )
    print(
        f"height RMS {np.sqrt(np.mean(recovered**2)):.5f} m; "
        f"peak {np.max(np.abs(recovered)):.5f} m; peak slope {max(abs(dx).max(), abs(dy).max()):.4f}"
    )


def main():
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument(
        "input", type=Path, help="NPZ containing height[time, y, x] in metres."
    )
    parser.add_argument("--output", type=Path, default=OUTPUT)
    args = parser.parse_args()
    with np.load(args.input, allow_pickle=False) as data:
        bake(data["height"], args.output)


if __name__ == "__main__":
    main()
