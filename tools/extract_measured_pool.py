"""Extract a measured water-surface patch for offline training.

Source: Guimarães et al., A Data Set of Sea Surface Stereo Images to Resolve
Space-Time Wave Fields, Ifremer (2019), doi:10.12770/af599f42-2770-4d6d-8209-13f40e2c292f.
This is a Black Sea stereo-camera recording from 2011-10-01 16:18 UTC. The
authors reconstructed the sea surface onto a regular grid with WASS. This
script crops the published observations, unpacks metres, and orders the axes.
Dataset license: CC BY 4.0 (https://creativecommons.org/licenses/by/4.0/).
The data publisher's license record is https://sextant.ifremer.fr/geonetwork/srv/api/records/af599f42-2770-4d6d-8209-13f40e2c292f/formatters/xml .

    python -m pip install numpy h5py "fsspec[http]"
    python tools/extract_measured_pool.py --output measured-pool.npz

The NPZ contains height[t,y,x] in metres, valid[t,y,x] as booleans, and 1-D
x/y axes in metres and t in seconds since the start of the acquisition.
Invalid heights are NaN. The default slice is 240 consecutive frames at 15 Hz
of a 32 x 32 patch, with nominal 5 cm spatial spacing. Multiple disjoint time
windows can be extracted by changing --start-frame.
"""

import argparse
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from urllib.request import Request, urlopen

import fsspec
import h5py
import numpy as np

SOURCE = (
    "https://data-dataref.ifremer.fr/stereo/BS_2011/2011-10-01_16-18-00_15Hz/"
    "nc/Surfaces_20111001_161800_short.nc"
)
DATASET_DOI = "https://doi.org/10.12770/af599f42-2770-4d6d-8209-13f40e2c292f"
LICENSE = "https://creativecommons.org/licenses/by/4.0/"


def decode(variable, packed):
    """Apply this NetCDF variable's missing value, scale factor and offset."""
    values = packed.astype(np.float64)
    values[packed == variable.attrs["_FillValue"].item()] = np.nan
    return (
        values * variable.attrs["scale_factor"].item()
        + variable.attrs["add_offset"].item()
    )


def read_range(bounds):
    first, last = bounds
    request = Request(SOURCE, headers={"Range": f"bytes={first}-{last}"})
    with urlopen(request, timeout=30) as response:
        content_range = response.headers.get("Content-Range", "")
        if response.status != 206 or not content_range.startswith(
            f"bytes {first}-{last}/"
        ):
            raise OSError("The archive did not serve the requested byte range.")
        data = response.read(last - first + 2)
    if len(data) != last - first + 1:
        raise OSError("Incomplete water-surface sample from the archive.")
    return data


def extract(start_frame, frames):
    start, width = 100, 32
    stop = start + width
    patch = np.s_[start:stop, start:stop]
    with (
        fsspec.open(SOURCE, "rb", block_size=32768, cache_type="blockcache") as remote,
        h5py.File(remote, "r") as file,
    ):
        z = file["Z"]
        if start_frame < 0 or frames < 1 or start_frame + frames > z.shape[0]:
            raise ValueError(f"Choose a valid frame interval within [0, {z.shape[0]}).")
        # In this export physical X varies along storage rows, and physical
        # Y along columns. The similarly named 1-D X is a dimension marker.
        x_grid = decode(file["_nc4_non_coord_X"], file["_nc4_non_coord_X"][patch])
        y_grid = decode(file["Y"], file["Y"][patch])
        x, y = x_grid[:, 0], y_grid[0, :]
        if not (np.allclose(x_grid, x[:, None]) and np.allclose(y_grid, y[None, :])):
            raise ValueError("Expected a rectilinear measured grid.")
        stable = file["mask_Z"][patch].T == 1
        t = file["time"][start_frame : start_frame + frames]

        # Each uncompressed HDF5 chunk stores a single frame in row-major
        # order. Request its narrow strip to skip the rest of the 1.5 GB
        # archive. h5py supplies the exact chunk locations from its index.
        rows, columns = z.shape[1:]
        if (
            z.chunks != (1, rows, columns)
            or z.id.get_create_plist().get_nfilters() != 0
        ):
            raise ValueError("Unexpected source chunk layout.")
        bounds = []
        for frame in range(start_frame, start_frame + frames):
            chunk = z.id.get_chunk_info_by_coord((frame, 0, 0))
            first = chunk.byte_offset + start * columns * z.dtype.itemsize
            bounds.append((first, first + width * columns * z.dtype.itemsize - 1))
        with ThreadPoolExecutor(max_workers=8) as pool:
            packed = np.stack(
                [
                    np.frombuffer(strip, dtype=z.dtype)
                    .reshape(width, columns)[:, start:stop]
                    .T
                    for strip in pool.map(read_range, bounds)
                ]
            )
        # Compare against a direct HDF5 hyperslab read to catch layout or
        # endianness changes before writing any observations.
        if not np.array_equal(packed[0], z[start_frame, start:stop, start:stop].T):
            raise ValueError("Remote strip and HDF5 hyperslab disagree.")
        height = decode(z, packed).astype(np.float32)
        valid = np.isfinite(height) & stable[None, :, :]
        height[~valid] = np.nan
    return {
        "height": height,
        "valid": valid,
        "x": x,
        "y": y,
        "t": t,
        "source": SOURCE,
        "dataset_doi": DATASET_DOI,
        "license": LICENSE,
        "start_frame": start_frame,
    }


def main():
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument(
        "--output", type=Path, required=True, help="Destination .npz file."
    )
    parser.add_argument(
        "--start-frame", type=int, default=0, help="First archive frame (zero based)."
    )
    parser.add_argument(
        "--frames", type=int, default=240, help="Number of consecutive frames."
    )
    args = parser.parse_args()
    sample = extract(args.start_frame, args.frames)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    with args.output.open("wb") as handle:
        np.savez_compressed(handle, **sample)
    print(
        f"{args.output}: {sample['height'].shape}, {sample['valid'].mean():.1%} valid"
    )


if __name__ == "__main__":
    main()
