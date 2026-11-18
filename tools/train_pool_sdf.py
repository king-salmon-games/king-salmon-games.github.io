"""Fit a near-surface neural signed distance field to measured wave elevations.

Input NPZ keys are x, y (metres), t (seconds), height[t, y, x] (metres).
Train on normal offsets from the measured free surface. The model is monotone
in altitude, so its zero crossing can be exported without a root finder.
"""

import argparse
import json
from pathlib import Path

import numpy as np
import torch
from torch import nn


class PoolSDF(nn.Module):
    def __init__(self):
        super().__init__()
        self.register_buffer(
            "frequencies", torch.tensor([1.0, 2.0, 4.0, 8.0]) * torch.pi
        )
        self.layers = nn.Sequential(
            nn.Linear(27, 64),
            nn.SiLU(),
            nn.Linear(64, 64),
            nn.SiLU(),
            nn.Linear(64, 64),
            nn.SiLU(),
            nn.Linear(64, 2),
        )

    def surface(self, coordinates):
        # x, y and time have been mapped to [-1, 1] over the captured patch.
        phase = (coordinates.unsqueeze(-1) * self.frequencies).flatten(1)
        prediction = self.layers(
            torch.cat((coordinates, phase.sin(), phase.cos()), dim=1)
        )
        height = prediction[:, 0]
        normal_z = 0.25 + 0.75 * torch.sigmoid(prediction[:, 1] + 3.0)
        return height, normal_z

    def forward(self, coordinates, altitude):
        height, normal_z = self.surface(coordinates)
        return (altitude - height) * normal_z, normal_z


def training_device(name):
    if name == "directml":
        import torch_directml

        return torch_directml.device(), torch_directml.device_name(0).rstrip("\0")
    device = torch.device(name)
    label = torch.cuda.get_device_name(device) if device.type == "cuda" else str(device)
    return device, label


def observations(path):
    with np.load(path, allow_pickle=False) as sample:
        x, y, t, water = (
            sample[k].astype(np.float32) for k in ("x", "y", "t", "height")
        )
    if water.shape != (len(t), len(y), len(x)) or min(water.shape) < 8:
        raise ValueError(
            "Expected a time sequence of at least 8 by 8 measured water heights"
        )
    for axis in (x, y, t):
        if not np.all(np.isfinite(axis)) or not np.all(np.diff(axis) > 0):
            raise ValueError("Coordinates must be finite and strictly increasing")
    slope_y, slope_x = np.gradient(water, y, x, axis=(1, 2))
    normal = np.stack((-slope_x, -slope_y, np.ones_like(water)), axis=-1)
    normal /= np.sqrt(np.sum(normal**2, axis=-1, keepdims=True))
    it, iy, ix = np.nonzero(np.isfinite(water) & np.isfinite(normal).all(axis=-1))
    # Keep complete frames out of training, including their spatial derivatives.
    held = it % 8 == 4
    if not held.any() or held.all():
        raise ValueError("Insufficient train and validation observations")
    height = water[it, iy, ix]
    center, scale = height[~held].mean(), height[~held].std()
    if scale < 1e-5:
        raise ValueError("The training data contain no measurable wave motion")
    coordinates = np.column_stack((x[ix], y[iy], t[it]))
    low = np.array([x[0], y[0], t[0]])
    span = np.array([np.ptp(x), np.ptp(y), np.ptp(t)])
    coordinates = (coordinates - low) * (2 / span) - 1
    return (
        coordinates,
        (height - center) / scale,
        normal[it, iy, ix],
        held,
        low,
        span,
        center,
        scale,
    )


def infer_height(model, device, coordinates):
    with torch.no_grad():
        batches = np.array_split(coordinates, max(1, (len(coordinates) + 8191) // 8192))
        return np.concatenate(
            [
                model.surface(torch.from_numpy(batch).to(device))[0].cpu().numpy()
                for batch in batches
            ]
        )


def signed_offset_error(model, device, pos, heights, normals, scale, span):
    """Check both signs independently on complete unseen time slices."""
    errors = []
    for sign in (-1, 1):
        offset = sign * 0.5
        shifted = pos.copy()
        shifted[:, :2] += normals[:, :2] * (offset * 2 * scale / span[:2])
        altitude = heights + offset * normals[:, 2]
        with torch.no_grad():
            for start in range(0, len(pos), 8192):
                batch = slice(start, start + 8192)
                distance, _ = model(
                    torch.from_numpy(shifted[batch]).to(device),
                    torch.from_numpy(altitude[batch]).to(device),
                )
                errors.append((distance.cpu().numpy() - offset) * scale)
    return float(np.sqrt(np.mean(np.concatenate(errors) ** 2)))


def export_surface(model, device, center, scale, path):
    axis = np.linspace(-1, 1, 64, dtype=np.float32)
    times = np.linspace(-1, 1, 96, dtype=np.float32)
    ts, ys, xs = np.meshgrid(times, axis, axis, indexing="ij")
    coords = np.stack((xs, ys, ts), axis=-1).reshape(-1, 3)
    height = infer_height(model, device, coords).reshape(ts.shape) * scale + center
    np.savez_compressed(path, height=height)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "sample",
        type=Path,
        nargs="?",
        help="Train on this patch, or omit to export saved weights",
    )
    parser.add_argument("--weights", type=Path, required=True)
    parser.add_argument(
        "--surface",
        type=Path,
        required=True,
        help="Dense zero crossing for the atlas baker",
    )
    parser.add_argument("--device", choices=("directml", "cuda", "cpu"), required=True)
    parser.add_argument("--steps", type=int, default=2400)
    args = parser.parse_args()
    if args.steps < 1:
        parser.error("--steps must be positive")
    device, hardware = training_device(args.device)
    torch.manual_seed(431)
    model = PoolSDF().to(device)
    if args.sample is None:
        with np.load(args.weights, allow_pickle=False) as saved:
            model.load_state_dict(
                {key: torch.from_numpy(saved[key]) for key in model.state_dict()}
            )
            model.eval()
            export_surface(
                model,
                device,
                saved["height_center"],
                saved["height_scale"],
                args.surface,
            )
        return
    rng = np.random.default_rng(431)
    pos, heights, normals, held, low, span, center, scale = observations(args.sample)
    train = np.flatnonzero(~held)
    optimizer = torch.optim.Adam(model.parameters(), lr=0.0015, foreach=False)
    print(
        f"Training on {hardware}, {len(train)} points, {held.sum()} held out",
        flush=True,
    )

    def tensor(array):
        return torch.from_numpy(np.ascontiguousarray(array)).to(device)

    for step in range(args.steps):
        indices = rng.choice(train, 2048)
        n = normals[indices]
        # d is measured in units of the training-set height standard deviation.
        # Query above, below and exactly on the water at the measured normals.
        d = rng.uniform(-0.5, 0.5, len(indices)).astype(np.float32)
        d[::3] = 0
        coords = pos[indices].copy()
        coords[:, :2] += n[:, :2] * d[:, None] * (2 * scale / span[:2])
        altitude = heights[indices] + n[:, 2] * d
        distance, normal_z = model(tensor(coords), tensor(altitude))
        loss = (distance - tensor(d)).square().mean() + 0.45 * (
            normal_z - tensor(n[:, 2])
        ).square().mean()
        optimizer.zero_grad(set_to_none=True)
        loss.backward()
        optimizer.step()
        if step == int(args.steps * 0.75):
            optimizer.param_groups[0]["lr"] *= 0.35
        if (step + 1) % 400 == 0:
            print(f"Step {step + 1}, normalized loss {loss.item():.5f}", flush=True)
    model.eval()
    fitted = infer_height(model, device, pos[held])
    error = (fitted - heights[held]) * scale
    rmse = float(np.sqrt(np.mean(error**2)))
    baseline = float(np.sqrt(np.mean((heights[held] * scale) ** 2)))
    offset_rmse = signed_offset_error(
        model, device, pos[held], heights[held], normals[held], scale, span
    )
    print(
        json.dumps(
            {
                "device": hardware,
                "steps": args.steps,
                "validation_points": int(held.sum()),
                "heldout_surface_rmse_m": rmse,
                "mean_plane_rmse_m": baseline,
                "heldout_near_surface_sdf_rmse_m": offset_rmse,
            }
        ),
        flush=True,
    )
    if not np.isfinite(rmse) or rmse >= baseline:
        raise RuntimeError(
            "Held-out zero crossings did not improve on the training mean"
        )
    weights = {
        name: value.detach().cpu().numpy() for name, value in model.state_dict().items()
    }
    np.savez_compressed(
        args.weights,
        coord_min=low,
        coord_span=span,
        height_center=center,
        height_scale=scale,
        **weights,
    )
    export_surface(model, device, center, scale, args.surface)


if __name__ == "__main__":
    main()
