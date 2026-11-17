#!/usr/bin/env python3
"""Bake a periodic depth-averaged river simulation into a WebGL data texture.

Optional bake dependencies: python -m pip install numpy numba pillow
Run: python tools/bake_water_dynamics.py
World units are metres and seconds. X runs right and Z downstream. The solver
uses a staggered grid, gravity-driven momentum, conservative depth fluxes,
and a foam tracer transported by those same fluxes. The WebP packs 64 frames
row-major in an 8 x 8 grid. R maps -0.25..0.25 m of surface elevation, GB map
-0.6..0.6 of X/Z slope, and alpha 0.5..1 maps the surface foam fraction.
The minimum alpha keeps signed channels intact through browser image decoding.
"""

import argparse
from pathlib import Path
from tempfile import NamedTemporaryFile

import numpy as np
from numba import njit
from PIL import Image

ASSETS = Path(__file__).resolve().parents[1] / "assets" / "river-scene"
TILE_W, TILE_H = 192, 96
FRAMES = 64
PERIOD = 8.0
SUBSTEPS = 12
DT = PERIOD / (FRAMES * SUBSTEPS)
CELL = 0.086
X_MIN, Z_MIN = -11.1, -0.18
NX, NZ = 259, 90


def screen_to_world(px, py):
    s = (py - 672) / 244
    return (px - 1100) / (58 + 50 * s), 7.2 * s / (0.55 + 0.45 * s)


def world_to_screen(x, z):
    q = z / 7.2
    s = 0.55 * q / (1 - 0.45 * q)
    return 1100 + x * (58 + 50 * s), 672 + 244 * s


def bilinear(field, x, z):
    x = np.clip(x, 0, field.shape[1] - 1.001)
    z = np.clip(z, 0, field.shape[0] - 1.001)
    i, j = np.floor(x).astype(int), np.floor(z).astype(int)
    fx, fz = x - i, z - j
    a = field[j, i] * (1 - fx) + field[j, i + 1] * fx
    b = field[j + 1, i] * (1 - fx) + field[j + 1, i + 1] * fx
    return a * (1 - fz) + b * fz


@njit
def distance_to(seeds):
    """Eight-neighbour chamfer distance in metres, including oblique banks."""
    d = np.where(seeds, 0.0, 1000.0)
    diag = np.sqrt(2.0) * CELL
    for j in range(1, NZ - 1):
        for i in range(1, NX - 1):
            d[j, i] = min(
                d[j, i],
                d[j - 1, i] + CELL,
                d[j, i - 1] + CELL,
                d[j - 1, i - 1] + diag,
                d[j - 1, i + 1] + diag,
            )
    for j in range(NZ - 2, 0, -1):
        for i in range(NX - 2, 0, -1):
            d[j, i] = min(
                d[j, i],
                d[j + 1, i] + CELL,
                d[j, i + 1] + CELL,
                d[j + 1, i + 1] + diag,
                d[j + 1, i - 1] + diag,
            )
    return d


def domain(mask_path):
    z, x = np.mgrid[:NZ, :NX]
    x = X_MIN + x * CELL
    z = Z_MIN + z * CELL
    px, py = world_to_screen(x, z)
    green = np.asarray(Image.open(mask_path).convert("RGB"))[:, :, 1] / 255.0
    mask = bilinear(green, px * green.shape[1] / 1717 - 0.5, py * green.shape[0] / 916 - 0.5)
    wet = mask > 0.48
    wet[[0, -1], :] = False
    wet[:, [0, -1]] = False
    bank_sdf = distance_to(~wet) - distance_to(wet)
    depth = 0.22 + 0.32 * np.tanh(np.maximum(bank_sdf, 0) / 0.95)
    # Shoaling upstream of two partly submerged bars makes their wakes diverge.
    depth -= 0.13 * np.exp(-(((x + 1.6) / 1.2) ** 2) - ((z - 4.15) / 0.42) ** 2)
    depth -= 0.11 * np.exp(-(((x - 3.0) / 1.7) ** 2) - ((z - 5.45) / 0.48) ** 2)

    # Individual waterfall tongues strike the far waterline at different angles.
    # Jet pressure heads force the gravity waves and mass injection supplies flow.
    locations = [
        (720, 703),
        (795, 708),
        (898, 704),
        (968, 705),
        (1004, 703),
        (1064, 702),
        (1107, 703),
        (1147, 705),
        (1193, 706),
        (1237, 703),
        (1271, 704),
        (1326, 705),
        (1381, 706),
        (1420, 711),
        (1483, 711),
    ]
    jets = []
    for n, (px0, py0) in enumerate(locations):
        cx, cz = screen_to_world(px0, py0)
        radius = 0.24 + 0.14 * (0.5 + 0.5 * np.sin(n * 2.31))
        kernel = np.exp(
            -0.5 * (((x - cx + 0.22 * (z - cz)) / radius) ** 2 + ((z - cz) / (radius * 0.84)) ** 2)
        )
        jets.append(kernel * wet)
    # A relaxation layer at the open camera-side boundary absorbs outgoing waves.
    outlet = np.clip((z - 6.25) / 1.15, 0, 1) ** 2
    outlet = np.maximum(outlet, np.clip((x - 9.0) / 1.8, 0, 1) ** 2)
    return wet, depth, np.stack(jets), outlet, bank_sdf


def forcing(jet_count):
    steps = FRAMES * SUBSTEPS
    angle = 2 * np.pi * np.arange(steps) / steps
    rng = np.random.default_rng(741)
    heads = np.empty((steps, jet_count))
    for n in range(jet_count):
        phase = rng.uniform(0, 2 * np.pi, 4)
        f = rng.integers(6, 13)
        # Integer harmonics of the eight-second boundary cycle.
        beat = (
            0.58 * np.sin(f * angle + phase[0])
            + 0.25 * np.sin((f + 3) * angle + phase[1])
            + 0.17 * np.sin((f - 3) * angle + phase[2])
        )
        surge = 0.78 + 0.22 * np.sin(2 * angle + phase[3])
        heads[:, n] = (0.20 + 0.135 * beat) * surge
    return heads


@njit
def advance(eta, u, v, foam, wet, depth, jets, outlet, bank_sdf, heads):
    """Advance momentum on wet faces, then transfer water volume and foam mass."""
    pressure = np.zeros_like(eta)
    discharge = np.zeros_like(eta)
    un, vn = np.zeros_like(u), np.zeros_like(v)
    fx, fz = np.zeros_like(u), np.zeros_like(v)
    next_eta, next_foam = np.zeros_like(eta), np.zeros_like(foam)
    ratio = DT / CELL
    for step in range(heads.shape[0]):
        # The pressure head of falling water acts on the pool around each toe.
        for j in range(1, NZ - 1):
            for i in range(1, NX - 1):
                if not wet[j, i]:
                    continue
                head = 0.0
                if j < 38:
                    for k in range(jets.shape[0]):
                        head += heads[step, k] * jets[k, j, i]
                pressure[j, i] = 9.81 * (eta[j, i] + head)
                discharge[j, i] = 0.36 * head

        for j in range(1, NZ - 1):
            for i in range(1, NX - 1):
                if not wet[j, i]:
                    continue
                drag = 0.14 + 0.12 * np.exp(-bank_sdf[j, i] / 0.40)
                if wet[j, i - 1]:
                    ux = u[j, i]
                    vz = 0.25 * (v[j, i] + v[j + 1, i] + v[j, i - 1] + v[j + 1, i - 1])
                    gradx = ux - u[j, i - 1] if ux >= 0 else u[j, i + 1] - ux
                    gradz = ux - u[j - 1, i] if vz >= 0 else u[j + 1, i] - ux
                    un[j, i] = ux - ratio * (
                        ux * gradx + vz * gradz + pressure[j, i] - pressure[j, i - 1]
                    )
                    un[j, i] += DT * (-0.08 - drag * ux)
                    left = i - 1 if un[j, i] >= 0 else i
                    fx[j, i] = un[j, i] * (depth[j, left] + eta[j, left])
                if wet[j - 1, i]:
                    vz = v[j, i]
                    ux = 0.25 * (u[j, i] + u[j, i + 1] + u[j - 1, i] + u[j - 1, i + 1])
                    gradx = vz - v[j, i - 1] if ux >= 0 else v[j, i + 1] - vz
                    gradz = vz - v[j - 1, i] if vz >= 0 else v[j + 1, i] - vz
                    vn[j, i] = vz - ratio * (
                        ux * gradx + vz * gradz + pressure[j, i] - pressure[j - 1, i]
                    )
                    vn[j, i] += DT * (0.13 + discharge[j, i] * 1.8 - drag * vz)
                    back = j - 1 if vn[j, i] >= 0 else j
                    fz[j, i] = vn[j, i] * (depth[back, i] + eta[back, i])

        for j in range(1, NZ - 1):
            for i in range(1, NX - 1):
                if not wet[j, i]:
                    continue
                net = (fx[j, i] - fx[j, i + 1] + fz[j, i] - fz[j + 1, i]) / CELL
                old_h = depth[j, i] + eta[j, i]
                e = eta[j, i] + DT * (net + discharge[j, i])
                # Outgoing radiation is absorbed at the open downstream boundary.
                e *= 1.0 - DT * 6.0 * outlet[j, i]
                next_eta[j, i] = e
                # The same face discharges carry surface foam mass through cells.
                left = foam[j, i - 1] if fx[j, i] >= 0 else foam[j, i]
                right = foam[j, i] if fx[j, i + 1] >= 0 else foam[j, i + 1]
                back = foam[j - 1, i] if fz[j, i] >= 0 else foam[j, i]
                front = foam[j, i] if fz[j + 1, i] >= 0 else foam[j + 1, i]
                net_foam = (
                    fx[j, i] * left - fx[j, i + 1] * right + fz[j, i] * back - fz[j + 1, i] * front
                )
                f = (foam[j, i] * old_h + ratio * net_foam) / max(
                    0.03, old_h + DT * (net + discharge[j, i])
                )
                compress = max(0.0, (un[j, i] - un[j, i + 1] + vn[j, i] - vn[j + 1, i]) / CELL - 0.14)
                aeration = 5.8 * discharge[j, i] + 0.64 * compress
                next_foam[j, i] = min(1.0, max(0.0, f + DT * (aeration * (1 - f) - 0.43 * f)))
        eta[:], foam[:] = next_eta, next_foam
        u[:], v[:] = un, vn


def bake(mask_path, output):
    wet, depth, jets, outlet, bank = domain(mask_path)
    forces = forcing(len(jets))
    eta, u, v, foam = [np.zeros_like(depth) for _ in range(4)]
    # Warm the pool and capture two consecutive forced cycles. At the wrap we
    # use the actual consecutive states of one continuous integration.
    for _ in range(3):
        advance(eta, u, v, foam, wet, depth, jets, outlet, bank, forces)
    history = []
    for _ in range(2):
        cycle = []
        for f in range(FRAMES):
            cycle.append((eta.copy(), foam.copy()))
            advance(
                eta,
                u,
                v,
                foam,
                wet,
                depth,
                jets,
                outlet,
                bank,
                forces[f * SUBSTEPS : (f + 1) * SUBSTEPS],
            )
        history.append(cycle)
    min_depth = min(np.min((depth + e)[wet]) for cycle in history for e, _ in cycle)
    if min_depth <= 0:
        raise ValueError(f"Negative fluid-column depth at a recorded state: {min_depth:.3f} m.")
    height_mean = np.mean([e for e, _ in history[-1]], axis=0)
    # The loop taper has zero slope at the join. It only removes the residual
    # difference between successive settled cycles; no frame is held or reversed.
    atlas = np.empty((8 * TILE_H, 8 * TILE_W, 4), np.uint8)
    xp, zp = np.meshgrid(np.linspace(480, 1717, TILE_W), np.linspace(672, 916, TILE_H))
    wx, wz = screen_to_world(xp, zp)
    gx, gz = (wx - X_MIN) / CELL, (wz - Z_MIN) / CELL
    for f in range(FRAMES):
        t = f / FRAMES
        taper = t**3 * (10 + t * (-15 + 6 * t))
        e = (1 - taper) * history[1][f][0] + taper * history[0][f][0] - height_mean
        a = (1 - taper) * history[1][f][1] + taper * history[0][f][1]
        # Mirror the shoreline sample when either side of a slope stencil is dry.
        left = np.where(np.roll(wet, 1, 1), np.roll(e, 1, 1), e)
        right = np.where(np.roll(wet, -1, 1), np.roll(e, -1, 1), e)
        back = np.where(np.roll(wet, 1, 0), np.roll(e, 1, 0), e)
        front = np.where(np.roll(wet, -1, 0), np.roll(e, -1, 0), e)
        sx, sz = (right - left) / (2 * CELL), (front - back) / (2 * CELL)
        channels = [0.5 + e / 0.5, 0.5 + sx / 1.2, 0.5 + sz / 1.2, 0.5 + a * 0.5]
        tile = np.stack([bilinear(c, gx, gz) for c in channels], axis=2)
        if not np.isfinite(tile).all():
            raise ValueError("Unstable water depth: check CFL, pressure head and outlet.")
        pixels = np.uint8(np.rint(np.clip(tile, 0, 1) * 255))
        row, col = divmod(f, 8)
        atlas[row * TILE_H : (row + 1) * TILE_H, col * TILE_W : (col + 1) * TILE_W] = pixels
    wet_texels = bilinear(wet.astype(float), gx, gz) > 0.8
    tiles = atlas.reshape(8, TILE_H, 8, TILE_W, 4).transpose(0, 2, 1, 3, 4)
    heights = tiles.reshape(FRAMES, TILE_H, TILE_W, 4)[:, :, :, 0].astype(float)
    steps = np.mean(np.abs(np.roll(heights, -1, axis=0) - heights)[:, wet_texels], axis=1)
    average_step = np.median(steps)
    if average_step == 0 or steps[-1] > average_step * 1.75:
        raise ValueError("Discontinuity between final and first atlas frame.")

    output.parent.mkdir(parents=True, exist_ok=True)
    with NamedTemporaryFile(dir=output.parent, suffix=".webp", delete=False) as temp:
        staging = Path(temp.name)
    try:
        Image.fromarray(atlas).save(staging, "WEBP", lossless=True, method=6, exact=True)
        staging.replace(output)
    finally:
        staging.unlink(missing_ok=True)
    print(f"{output}: {atlas.shape[1]} x {atlas.shape[0]}, {output.stat().st_size:,} bytes")
    print(f"Wet cells {wet.sum():,}; minimum recorded water depth {min_depth:.3f} m.")
    print(f"Loop wrap / median height step: {steps[-1] / average_step:.3f}")
    print("Final-cycle elevation RMS, metres:", np.std(history[1][0][0][wet] - height_mean[wet]))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--mask", type=Path, default=ASSETS / "water-mask.png")
    parser.add_argument("--output", type=Path, default=ASSETS / "water-dynamics.webp")
    args = parser.parse_args()
    bake(args.mask, args.output)
