#!/usr/bin/env python3
"""Bake a seamless transparent film of the lowest layer of river mist.

Run with Python, NumPy, and Pillow: python tools/build_river_mist.py
All coordinates are registered to the original desktop landscape. The mobile
film uses exactly the same world rays and the same 820..1553 portrait crop.
"""

from pathlib import Path

import numpy as np
from PIL import Image

ASSETS = Path(__file__).resolve().parents[1] / "assets" / "river-scene"
PLATE_WIDTH, PLATE_HEIGHT = 1717, 916
STRIP_HEIGHT = 300
WIDTH, HEIGHT = 480, 84
FRAMES, FRAME_MS = 160, 100
STEPS = 16
TAU = 2 * np.pi
# Dimensions of the tileable noise volume, in metres, ordered X, Y, Z.
DOMAIN = np.array([6.4, 3.2, 16], dtype=np.float32)


def smooth(x):
    x = np.clip(x, 0, 1)
    return x * x * (3 - 2 * x)


def vapor_field():
    """Band-limited isotropic turbulence stretched downwind in world space."""
    rng = np.random.default_rng(42133)
    shape = (96, 40, 96)
    nz, ny, nx = shape
    fz = np.fft.fftfreq(nz, d=DOMAIN[2] / nz)[:, None, None]
    fy = np.fft.fftfreq(ny, d=DOMAIN[1] / ny)[None, :, None]
    fx = np.fft.rfftfreq(nx, d=DOMAIN[0] / nx)[None, None, :]
    volume = np.zeros(shape, np.float32)
    for weight, lx, ly, lz in [
        (0.70, 0.89, 0.32, 0.63),
        (0.32, 0.40, 0.14, 0.31),
        (0.10, 0.18, 0.085, 0.13),
    ]:
        spectrum = np.fft.rfftn(rng.standard_normal(shape))
        response = np.exp(
            -2 * np.pi**2 * ((lx * fx) ** 2 + (ly * fy) ** 2 + (lz * fz) ** 2)
        )
        band = np.fft.irfftn(spectrum * response, s=shape, axes=(0, 1, 2))
        volume += weight * ((band - band.mean()) / band.std()).astype(np.float32)
    return volume


def sample_volume(volume, x, y, z):
    nz, ny, nx = volume.shape
    x = x * (nx / DOMAIN[0])
    y = y * (ny / DOMAIN[1])
    z = z * (nz / DOMAIN[2])
    xi, yi, zi = (np.floor(axis).astype(np.int32) for axis in (x, y, z))
    xf, yf, zf = (
        axis - index.astype(np.float32) for axis, index in zip((x, y, z), (xi, yi, zi))
    )
    x0, y0, z0 = xi % nx, yi % ny, zi % nz
    x1, y1, z1 = (x0 + 1) % nx, (y0 + 1) % ny, (z0 + 1) % nz
    near = (volume[z0, y0, x0] * (1 - xf) + volume[z0, y0, x1] * xf) * (1 - yf)
    near += (volume[z0, y1, x0] * (1 - xf) + volume[z0, y1, x1] * xf) * yf
    far = (volume[z1, y0, x0] * (1 - xf) + volume[z1, y0, x1] * xf) * (1 - yf)
    far += (volume[z1, y1, x0] * (1 - xf) + volume[z1, y1, x1] * xf) * yf
    return near * (1 - zf) + far * zf


class MistVolume:
    def __init__(self):
        self.field = vapor_field()
        crop = (0, PLATE_HEIGHT - STRIP_HEIGHT, PLATE_WIDTH, PLATE_HEIGHT)
        with Image.open(ASSETS / "water-mask.png") as image:
            bank = image.getchannel("G").resize(
                (PLATE_WIDTH, PLATE_HEIGHT), Image.Resampling.BILINEAR
            )
            bank = bank.crop(crop).resize((WIDTH, HEIGHT), Image.Resampling.LANCZOS)
        bank = np.asarray(bank, dtype=np.float32) / 255
        self.water = bank > 0.002
        self.coverage = bank[self.water]
        row, col = np.nonzero(self.water)
        px = ((col.astype(np.float32) + 0.5) * PLATE_WIDTH / WIDTH)[None, :]
        py = (crop[1] + (row.astype(np.float32) + 0.5) * STRIP_HEIGHT / HEIGHT)[None, :]
        # These camera parameters invert the same perspective as poolToPixel
        # in water.frag. Z grows downstream and Y is altitude above the water.
        rx, ry = (px - 1100) / 902.016, (py - 388.96) / 902.016
        self.y = ((STEPS - np.arange(STEPS, dtype=np.float32) - 0.5) * 1.44 / STEPS)[
            :, None
        ]
        distance = (4.88 - self.y) / ry
        self.x, self.z = rx * distance, 15.552 - distance
        self.ds = np.sqrt(1 + rx * rx + ry * ry) / ry * (1.44 / STEPS)
        self.near = smooth((self.z - 1.25) / 4.5)

    def frame(self, index):
        cycle = index / FRAMES
        phase = TAU * cycle
        x, y, z = self.x, self.y, self.z
        # Moist plumes gather in the downstream troughs between standing
        # waves. The two sources wander independently and leave gaps between.
        lower = (
            7.3 + 0.91 * np.sin(0.74 * x + 0.55) + 0.43 * np.cos(0.64 * x - phase - 0.8)
        )
        upper = (
            4.2 + 0.95 * np.sin(0.61 * x - 1.8) + 0.35 * np.cos(0.83 * x + phase + 0.1)
        )
        lanes = np.exp(-(((z - lower) / 1.27) ** 2)) + 0.44 * np.exp(
            -(((z - upper) / 1.07) ** 2)
        )
        # Over one loop the wind transports each parcel exactly one volume
        # period to the right. Vertical shear, curls and zero-mean gusts keep
        # each height moving differently while preserving the cyclic boundary.
        travel = (
            DOMAIN[0] * cycle
            + 0.22 * np.sin(phase - 0.37 * z)
            + 0.08 * np.sin(2 * phase - 0.63 * x)
        )
        curl = np.sin(0.74 * x + 0.59 * z - phase) + 0.43 * np.cos(
            0.81 * z + 0.53 * x + 2 * phase
        )
        vx = x - travel + 0.34 * curl + 0.27 * np.sin(phase - 0.87 * z + 2.1 * y) * y
        vy = y + 0.14 * curl + 0.07 * np.sin(1.3 * x - 1.7 * z - phase)
        vz = (
            z
            + 0.54 * np.sin(0.52 * x - 0.44 * z - phase)
            + 0.28 * np.sin(0.83 * x + 2.9 * y + phase)
        )
        vapor = sample_volume(self.field, vx, vy, vz)
        body = smooth((vapor + 0.46) / 1.30)
        # Patches of unsaturated air slice through the ribbons. This second
        # scale keeps the close water visible between banks of drifting mist.
        opening = np.sin(0.92 * x - 0.80 * z - 0.67 * curl - phase)
        opening += 0.42 * np.cos(1.47 * x + 0.44 * z + 0.52 * curl + phase)
        pockets = 0.06 + 0.94 * smooth((opening + 0.63) / 1.16)
        loft = 0.20 + 0.25 * body + 0.16 * lanes
        height = 0.19 + 0.18 * body + 0.10 * curl
        profile = np.exp(-(((y - height) / loft) ** 2))
        density = self.near * (0.14 + 1.10 * lanes) * body * profile * pockets
        # Front-to-back single scattering in a shallow layer. A second sample
        # toward the sky estimates local shadowing inside each passing bank.
        light_sample = sample_volume(self.field, vx + 0.46, vy + 0.34, vz - 0.29)
        light = np.clip(
            0.64
            + 0.13 * y
            - 0.21 * smooth((light_sample + 0.51) / 1.4)
            + 0.08 * np.sin(x * 0.25 + 0.2),
            0,
            1,
        )
        optical_depth = density * self.ds * 1.08
        preceding = np.cumsum(optical_depth, axis=0) - optical_depth
        weight = np.exp(-preceding) * (-np.expm1(-optical_depth))
        alpha = weight.sum(axis=0)
        lit = (weight * light).sum(axis=0) / np.maximum(alpha, 0.00001)
        # Straight alpha sRGB for standard browser composition. Sky fill is
        # cool teal in shadow and slightly warmer toward the open sky at right.
        shadow = np.array([0.45, 0.56, 0.65]) ** 2.2
        sun = np.array([0.74, 0.81, 0.85]) ** 2.2
        rgb = ((1 - lit[:, None]) * shadow + lit[:, None] * sun) ** (1 / 2.2)
        pixels = np.zeros((HEIGHT, WIDTH, 4), dtype=np.uint8)
        pixels[self.water] = (
            np.column_stack((rgb * 255, alpha * self.coverage * 255))
            .round()
            .astype(np.uint8)
        )
        pixels[pixels[:, :, 3] == 0] = 0
        return Image.fromarray(pixels)


def portrait(frame):
    box = (WIDTH * 820 / PLATE_WIDTH, 0, WIDTH * 1553 / PLATE_WIDTH, HEIGHT)
    return frame.resize((205, HEIGHT), Image.Resampling.LANCZOS, box=box)


def save(frames, name):
    first, *rest = frames
    first.save(ASSETS / f"river-mist-{name}-still.webp", quality=80, method=6)
    first.save(
        ASSETS / f"river-mist-{name}.webp",
        save_all=True,
        append_images=rest,
        duration=FRAME_MS,
        loop=0,
        quality=75,
        method=5,
    )


def main():
    volume = MistVolume()
    frames = [volume.frame(i) for i in range(FRAMES)]
    save(frames, "desktop")
    save([portrait(frame) for frame in frames], "mobile")


if __name__ == "__main__":
    main()
