"""Fit moving, image-plane signed distances and contrast from a falling sheet.

Train with a measured gray[t,y,x] NPZ, or omit the sample to bake a saved fit.
The coarse optical features and neural weights travel together in the checkpoint.
"""

import argparse
from pathlib import Path

import numpy as np
import torch
from bake_measured_pool import sample_cubic
from PIL import Image
from scipy.ndimage import (
    distance_transform_edt,
    gaussian_filter,
    gaussian_filter1d,
    map_coordinates,
)
from torch import nn
from train_pool_sdf import training_device

STRIDE = 3
BAND = 7.0  # distance supervision in pixels of the extracted camera image


def observed_targets(gray):
    if gray.ndim != 3 or min(gray.shape) < 16 or not np.isfinite(gray).all():
        raise ValueError("Expected a finite sequence of grayscale frames")
    train = np.arange(len(gray)) % 8 != 4
    # Subtract the fixed light pattern seen through the sheet. The two targets
    # describe moving glints and ribbons, independent of the laboratory lights.
    signal = gaussian_filter(gray - gray[train].mean(axis=0), (0, 0.9, 0.9))
    scale = signal[train].std()
    if scale < 1e-4:
        raise ValueError("The capture has no measurable temporal variation")
    signal /= scale
    distances = np.empty_like(signal)
    for i, frame in enumerate(signal):
        bright = frame > 0.35
        distance = distance_transform_edt(~bright) - distance_transform_edt(bright)
        distances[i] = (
            np.sign(distance) * np.minimum(np.abs(distance) - 0.5, BAND) / BAND
        )

    # Estimate downstream displacement on adjacent training frames. Refine the
    # best integer displacement with the local curvature of the matching error.
    frames = np.flatnonzero(train[:-1] & train[1:])[::3]
    h = gray.shape[1]
    shifts = np.arange(9)
    costs = [
        np.mean(
            (signal[frames, 9 : h - 9] - signal[frames + 1, 9 + q : h - 9 + q]) ** 2
        )
        for q in shifts
    ]
    q = int(np.argmin(costs))
    speed = float(q)
    if 0 < q < len(shifts) - 1:
        speed += (
            0.5
            * (costs[q - 1] - costs[q + 1])
            / (costs[q - 1] - 2 * costs[q] + costs[q + 1])
        )
    # Only odd (training) frames supply the coarse optical guide. Quantize
    # it here so the training and saved-checkpoint inference paths agree.
    guide = gaussian_filter(signal[1::2], (0, 1.1, 1.1))[:, ::STRIDE, ::STRIDE]
    guide = np.rint(np.clip(guide, -4, 4) * 31).astype(np.int8)
    return signal, distances, train, guide, speed


def features(guide, shape, speed, points):
    """Sample coarse glints along falling trajectories around each query."""
    time, row, col = points.T
    key = np.clip((time - 1) * 0.5, 0, len(guide) - 1)
    low = np.floor(key)
    high = np.minimum(low + 1, len(guide) - 1)
    spatial = []

    def at(frame, dx, dy):
        moved = row + dy + (2 * frame + 1 - time) * speed
        return map_coordinates(
            guide,
            [frame, moved / STRIDE, (col + dx) / STRIDE],
            output=np.float32,
            order=1,
            mode="nearest",
        )

    for dx, dy in ((0, 0), (-2, 0), (2, 0), (0, -3), (0, 3)):
        a, b = at(low, dx, dy), at(high, dx, dy)
        spatial.append((a + (key - low) * (b - a)) / 31)
    unit = points / (np.array(shape, dtype=np.float32) - 1) * 2 - 1
    return np.column_stack([unit, *spatial]).astype(np.float32)


class FallsField(nn.Module):
    def __init__(self):
        super().__init__()
        self.register_buffer(
            "frequencies", torch.tensor([1.0, 2.0, 4.0, 8.0]) * torch.pi
        )
        self.decoder = nn.Sequential(
            nn.Linear(32, 48), nn.SiLU(), nn.Linear(48, 48), nn.SiLU(), nn.Linear(48, 2)
        )

    def forward(self, samples):
        phase = (samples[:, :3, None] * self.frequencies).flatten(1)
        return self.decoder(torch.cat((samples, phase.sin(), phase.cos()), dim=1))


def query(model, guide, shape, speed, points, device):
    with torch.no_grad():
        outputs = []
        for start in range(0, len(points), 16384):
            inputs = features(guide, shape, speed, points[start : start + 16384])
            outputs.append(model(torch.from_numpy(inputs).to(device)).cpu().numpy())
        return np.concatenate(outputs)


def fit(gray, device, steps, path):
    signal, sdf, train, guide, speed = observed_targets(gray)
    shape = gray.shape
    rng = np.random.default_rng(942)
    torch.manual_seed(942)
    model = FallsField().to(device)
    optimizer = torch.optim.Adam(model.parameters(), lr=0.0015, foreach=False)
    # Prepare a representative sample on the host, then train the continuous
    # decoder on the card. Full held-out frames never enter this sample.
    coords = np.column_stack(
        (
            rng.choice(np.flatnonzero(train), 360000),
            rng.integers(shape[1], size=360000),
            rng.integers(shape[2], size=360000),
        )
    )
    index = tuple(coords.T)
    inputs = torch.from_numpy(features(guide, shape, speed, coords)).to(device)
    targets = torch.from_numpy(np.column_stack((signal[index], sdf[index]))).to(device)
    for step in range(steps):
        ids = torch.from_numpy(rng.integers(len(coords), size=2048, dtype=np.int64)).to(
            device
        )
        error = model(inputs.index_select(0, ids)) - targets.index_select(0, ids)
        loss = error[:, 0].square().mean() + 2 * error[:, 1].square().mean()
        optimizer.zero_grad(set_to_none=True)
        loss.backward()
        optimizer.step()
        if step == steps * 3 // 4:
            optimizer.param_groups[0]["lr"] *= 0.35
    model.eval()
    time, y, x = np.meshgrid(
        np.flatnonzero(~train), np.arange(shape[1]), np.arange(shape[2]), indexing="ij"
    )
    held = np.column_stack((time.ravel(), y.ravel(), x.ravel()))
    pred = query(model, guide, shape, speed, held, device)
    actual = sdf[~train].ravel()
    rmse = np.sqrt(np.mean((pred[:, 1] - actual) ** 2)) * BAND
    static_error = np.sqrt(np.mean((sdf[~train] - sdf[train].mean(axis=0)) ** 2)) * BAND
    inside, bright = pred[:, 1] < 0, actual < 0
    iou = np.sum(inside & bright) / np.sum(inside | bright)
    print(
        f"Held out {len(time)} frames; truncated signed-distance RMSE {rmse:.3f} px; "
        f"static baseline {static_error:.3f} px; bright-region IoU {iou:.3f}; drift {speed:.3f} px/step",
        flush=True,
    )
    if not np.isfinite(rmse) or rmse >= static_error:
        raise RuntimeError("The fitted field did not resolve the measured motion")
    weights = {k: p.detach().cpu().numpy() for k, p in model.state_dict().items()}
    np.savez_compressed(path, guide=guide, shape=shape, speed=speed, **weights)
    return model, guide, shape, speed


def periodic_crop(field, axis, size):
    values = np.moveaxis(field, axis, 0)
    end = len(values) - 1
    overlap = max(2, round(end * 0.18))
    period = end - overlap
    coords = np.arange(size) * period / size
    weight = np.minimum(1, coords / overlap)
    weight = (weight**2 * (3 - 2 * weight)).reshape((-1,) + (1,) * (field.ndim - 1))
    tail = sample_cubic(values, np.minimum(end, coords + period))
    return np.moveaxis(
        tail + weight * (sample_cubic(values, coords) - tail), 0, axis
    ), period


def bake(model, guide, shape, speed, device, destination):
    frames, rows, cols = shape
    y, x = np.indices((rows, cols), dtype=np.float32).reshape(2, -1)
    estimates = []
    for t in range(frames):
        points = np.column_stack((np.full_like(y, t), y, x))
        estimates.append(
            query(model, guide, shape, speed, points, device).reshape(rows, cols, 2)
        )
    field = np.stack(estimates)
    field, _ = periodic_crop(field, 2, 128)
    field, period_y = periodic_crop(field, 1, 96)
    # Remove bulk image translation before retiming the material. Gravity in
    # the browser provides the downward transport and stretches each stream.
    for i, frame in enumerate(field):
        offset = i * speed * len(frame) / period_y
        whole = int(np.floor(offset))
        a = np.roll(frame, -whole, axis=0)
        field[i] = a + (offset - whole) * (np.roll(a, -1, axis=0) - a)
    field, _ = periodic_crop(gaussian_filter1d(field, 0.9, axis=0), 0, 64)
    relief = field[..., 0]
    ribbon = -np.tanh(field[..., 1] * BAND / 2)
    # Keep soft ribbon cores while resolving the bright edges separately.
    ribbon -= 0.7 * gaussian_filter(ribbon, (0, 2, 2), mode="wrap")
    lean = 0.5 * (np.roll(relief, -1, axis=2) - np.roll(relief, 1, axis=2))
    rgb = np.stack((relief, ribbon, lean), axis=-1)
    rgb -= rgb.mean(axis=(0, 1, 2), keepdims=True)
    extent = np.maximum(np.quantile(np.abs(rgb), 0.985, axis=(0, 1, 2)), 1e-5)
    codes = np.rint(128 + 127 * np.clip(rgb / extent, -1, 1)).astype(np.uint8)
    tiles = np.pad(codes, ((0, 0), (1, 1), (1, 1), (0, 0)), mode="wrap")
    atlas = (
        tiles.reshape(8, 8, 98, 130, 3).transpose(0, 2, 1, 3, 4).reshape(784, 1040, 3)
    )
    Image.fromarray(atlas).save(destination, lossless=True, method=6)
    print(f"Wrote {destination} ({destination.stat().st_size:,} bytes)", flush=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("sample", type=Path, nargs="?")
    parser.add_argument("--device", choices=("cpu", "cuda", "directml"), required=True)
    parser.add_argument("--weights", type=Path, required=True)
    parser.add_argument("--atlas", type=Path, required=True)
    parser.add_argument("--steps", type=int, default=1800)
    args = parser.parse_args()
    device, hardware = training_device(args.device)
    if args.sample:
        if args.steps < 1:
            parser.error("--steps must be positive")
        print(f"Training waterfall field on {hardware}", flush=True)
        with np.load(args.sample, allow_pickle=False) as capture:
            gray, times = capture["gray"].astype(np.float32), capture["t"]
        if (
            len(times) != len(gray)
            or not np.all(np.diff(times) > 0)
            or not np.allclose(np.diff(times), np.diff(times)[0])
        ):
            raise ValueError("Expected uniformly sampled capture time")
        model, guide, shape, speed = fit(gray, device, args.steps, args.weights)
    else:
        model = FallsField().to(device)
        with np.load(args.weights, allow_pickle=False) as saved:
            model.load_state_dict(
                {k: torch.from_numpy(saved[k]) for k in model.state_dict()}
            )
            guide, shape, speed = saved["guide"], saved["shape"], float(saved["speed"])
    bake(model.eval(), guide, shape, speed, device, args.atlas)


if __name__ == "__main__":
    main()
