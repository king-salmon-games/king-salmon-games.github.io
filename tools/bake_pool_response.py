"""Bake the pool's causal shallow-water response to three waterfall impacts.

Run `python tools/bake_pool_response.py` with NumPy, Numba and Pillow.
X points right and Z downstream in metres, in the same domain as the base
river simulation. Each pressure pulse starts from rest. The browser combines
independently timed copies of these signed responses. No mass is added at a toe.
"""

import argparse
from pathlib import Path
from tempfile import NamedTemporaryFile

import numpy as np
from bake_water_dynamics import (
    ASSETS,
    CELL,
    X_MIN,
    Z_MIN,
    bilinear,
    distance_to,
    domain,
    screen_to_world,
)
from PIL import Image

GRAVITY = 9.81
DT = 1 / 96
PULSE_TIME = 0.60
DURATION = 8.0
FRAMES = 64
W, H = 128, 64
TOES = ((900, 704), (1145, 704), (1345, 705))
SCALES = np.array([.18, .26, .58])


def integrate(wet, depth, damping, head, steps, cell=CELL, dt=DT, initial=None,
              stride=12, open_edges=()):
    """Return surface elevations at t=0,stride*dt,..., in metres.

    The input head is the peak pressure / (rho*g) in metres. The pulse drives
    momentum on wet faces for PULSE_TIME. Initial state is (eta, u, v) with
    velocities on west/north faces at t=-dt/2. A missing or dry neighbour is a
    reflecting wall. An open east or south edge radiates flux q = sqrt(gh)*eta.
    """
    if np.sqrt(2 * GRAVITY * np.max(depth[wet])) * dt >= cell:
        raise ValueError("The wave step exceeds its two-dimensional CFL limit.")
    if steps % stride:
        raise ValueError("The final simulation step must fall on a recorded frame.")
    if initial is None:
        eta, u, v = (np.zeros(wet.shape) for _ in range(3))
    else:
        eta, u, v = (field.copy() for field in initial)
    eta[~wet] = 0
    face_x = wet[:, :-1] & wet[:, 1:]
    face_z = wet[:-1, :] & wet[1:, :]
    hx = np.where(face_x, .5 * (depth[:, :-1] + depth[:, 1:]), 0)
    hz = np.where(face_z, .5 * (depth[:-1, :] + depth[1:, :]), 0)
    drag = np.broadcast_to(damping, wet.shape)
    loss_x = np.exp(-.5 * dt * (drag[:, :-1] + drag[:, 1:])) * face_x
    loss_z = np.exp(-.5 * dt * (drag[:-1, :] + drag[1:, :])) * face_z
    qx = np.zeros((wet.shape[0], wet.shape[1] + 1))
    qz = np.zeros((wet.shape[0] + 1, wet.shape[1]))
    out_x = np.sqrt(GRAVITY * depth[:, -1]) * wet[:, -1] * ("east" in open_edges)
    out_z = np.sqrt(GRAVITY * depth[-1, :]) * wet[-1, :] * ("south" in open_edges)
    ratio = dt / cell
    frames = [eta.copy()]
    for n in range(steps):
        time = (n + .5) * dt
        surface = eta + head * np.sin(np.pi * time / PULSE_TIME) ** 2 if time < PULSE_TIME else eta
        u[:, 1:] = loss_x * (u[:, 1:] - GRAVITY * ratio * np.diff(surface, axis=1))
        v[1:, :] = loss_z * (v[1:, :] - GRAVITY * ratio * np.diff(surface, axis=0))
        qx[:, 1:-1] = hx * u[:, 1:]
        qz[1:-1, :] = hz * v[1:, :]
        qx[:, -1] = out_x * eta[:, -1]
        qz[-1, :] = out_z * eta[-1, :]
        eta -= ratio * (np.diff(qx, axis=1) + np.diff(qz, axis=0))
        if (n + 1) % stride == 0:
            frames.append(eta.copy())
    return np.asarray(frames)


def pool_domain(mask_path):
    wet, depth, _, outlet, old_bank = domain(mask_path)
    # Continue the last wet cells through the open ends of the picture. These
    # cells radiate into the off-camera river and shouldn't form a fake shoal.
    wet[-1, :] = wet[-2, :]
    wet[:, -1] = wet[:, -2]
    bank = distance_to(~wet) - distance_to(wet)
    bank[-1, :] = bank[-2, :]
    bank[:, -1] = bank[:, -2]
    depth += .32 * (np.tanh(np.maximum(bank, 0) / .95) - np.tanh(np.maximum(old_bank, 0) / .95))
    drag = .24 + .34 * np.exp(-np.maximum(bank, 0) / .40) + 3.6 * outlet
    return wet, depth, bank, drag


def slopes(eta, wet):
    """Central derivative with mirrored shore samples and one-sided image edges."""
    def axis_slope(axis):
        ahead = np.where(np.roll(wet, -1, axis), np.roll(eta, -1, axis), eta)
        behind = np.where(np.roll(wet, 1, axis), np.roll(eta, 1, axis), eta)
        result = (ahead - behind) / (2 * CELL)
        end = [slice(None), slice(None)]
        end[axis] = -1
        result[tuple(end)] = ((eta - behind) / CELL)[tuple(end)]
        return result
    return axis_slope(1), axis_slope(0)


def bake(mask_path, output):
    wet, depth, bank, damping = pool_domain(mask_path)
    z, x = np.indices(wet.shape) * CELL
    x += X_MIN
    z += Z_MIN
    px, py = np.meshgrid(np.linspace(480, 1717, W), np.linspace(672, 916, H))
    wx, wz = screen_to_world(px, py)
    gx, gz = (wx - X_MIN) / CELL, (wz - Z_MIN) / CELL

    def sample(*fields):
        return np.stack([bilinear(field, gx, gz) for field in fields], axis=-1)

    atlas = np.zeros((25 * H, 8 * W, 3), np.uint8)

    def tile(row, col, data):
        atlas[row * H:(row + 1) * H, col * W:(col + 1) * W] = np.rint(np.clip(data, 0, 255))

    # Dry cells carry no wave. Normalizing by the wet sampling weight extends
    # the water value up to its edge without creating a fictitious zero trough.
    water_weight = np.maximum(bilinear(wet.astype(float), gx, gz), .001)
    for source, (sx, sy) in enumerate(TOES):
        cx, cz = screen_to_world(sx, sy)
        dx, dz = x - cx, z - cz
        head = .14 * np.exp(-.5 * (((dx + .18 * dz) / .54) ** 2 + (dz / .27) ** 2)) * wet
        waves = integrate(wet, depth, damping, head, round(DURATION / DT),
                          open_edges=("east", "south"))
        print(f"Toe {source}, signed height {waves.min():.3f}..{waves.max():.3f} m")
        sampled_peak = np.zeros(3)
        for f in range(FRAMES):
            eta = waves[f]
            sx, sz = slopes(eta, wet)
            state = sample(eta, sx * wet, sz * wet) / water_weight[:, :, None]
            sampled_peak = np.maximum(sampled_peak, abs(state).max(axis=(0, 1)))
            # Signed square-root encoding preserves the weak returning wave.
            code = np.sign(state) * np.sqrt(abs(state) / SCALES) * 127 + 128
            tile(8 * source + f // 8, f % 8, code)
        print("Peak exported height, x slope, z slope:", sampled_peak)
        if not np.isfinite(sampled_peak).all() or np.any(sampled_peak > SCALES):
            raise ValueError("Impact atlas would clip a signed surface component.")
    dz, dx = np.gradient(bank, CELL)
    length = np.maximum(np.hypot(dx, dz), 1.e-6)
    normal = sample(dx / length, dz / length)
    metadata = sample(depth, bank)
    if np.min(np.rint(metadata[:, :, 0] * 255) / 255) < .12:
        raise ValueError("Lower impactMinDepth in impact-response.glsl to match the new bathymetry.")
    dz, dx = np.gradient(depth, CELL)
    bed_slope = sample(dx, dz)
    if np.max(np.abs(bed_slope)) > .5:
        raise ValueError("Impact atlas would clip the bathymetric gradient.")
    tile(24, 0, np.stack([metadata[:, :, 0] * 255, 128 + metadata[:, :, 1] * (127 / 2.5),
                          128 + bed_slope[:, :, 0] * 254], axis=-1))
    tile(24, 1, np.dstack((128 + normal * 127, 128 + bed_slope[:, :, 1] * 254)))
    output.parent.mkdir(parents=True, exist_ok=True)
    with NamedTemporaryFile(dir=output.parent, suffix=".webp", delete=False) as tmp:
        staging = Path(tmp.name)
    try:
        Image.fromarray(atlas).save(staging, lossless=True, method=6)
        staging.replace(output)
    finally:
        staging.unlink(missing_ok=True)
    print(f"{output} ({output.stat().st_size:,} bytes)")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--mask", type=Path, default=ASSETS / "water-mask.png")
    parser.add_argument("--output", type=Path, default=ASSETS / "impact-response.webp")
    args = parser.parse_args()
    bake(args.mask, args.output)
