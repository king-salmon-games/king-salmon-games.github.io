"""Extract a patch from a fixed-camera high-speed recording of falling water.

    python -m pip install numpy
    python tools/extract_measured_falls.py --output measured-falls.npz

Requires FFmpeg on PATH. The default downloads the selected 92 MB recording
from the experiment archive and unpacks it with 7-Zip (with RAR support).
Use --video path/to/0.03.MP4 if the original recording is available locally.
The clip's SHA-256 is checked in both cases.

Maurine Lodomez, Blake Tullis, Pierre Archambeau, Vasileios Kitsikoudis,
Michel Pirotton, Benjamin Dewals and Sébastien Erpicum (2020). Accompanying
dataset for "Nappe oscillations on free-overfall structures, data from
laboratory experiments (audio and video)". https://doi.org/10.5281/zenodo.3686591
CC BY 4.0, https://creativecommons.org/licenses/by/4.0/
Experimental method: https://doi.org/10.1038/s41597-020-0521-8

The confined, half-round weir is 3.45 m wide with a 3 m fall. Unit discharge
is 0.03 m²/s. The GoPro looks at the falling sheet from downstream. Crop and
2x area reduction isolate the water between the lip and the receiving tank.
gray[t,y,x] is observed grayscale image intensity on [0,1]. It expresses
optical appearance, with no measured surface depth or thickness. Axes x and y
are normalized pixel centers in the original image, rightward and downward.
t is recorded time in seconds. The source audio is excluded.
"""

import argparse
import hashlib
import os
import shutil
import subprocess
from concurrent.futures import ThreadPoolExecutor
from http.client import IncompleteRead
from pathlib import Path
from tempfile import TemporaryDirectory
from time import sleep
from urllib.error import URLError
from urllib.request import Request, urlopen

import numpy as np

DOI = "https://doi.org/10.5281/zenodo.3686591"
LICENSE = "https://creativecommons.org/licenses/by/4.0/"
EXPERIMENT = "M1_C_HR_W=345cm_L=300cm"
ARCHIVE = f"https://zenodo.org/records/3686591/files/{EXPERIMENT}.rar"
MEMBER = f"{EXPERIMENT}/Video/0.03.MP4"
VIDEO_SHA256 = "e19c54884ed3ec8479397d54b6e61cbab003af2ac449ec3414686e0f5881c43f"
SOURCE_WIDTH, SOURCE_HEIGHT = 848, 480
LEFT, TOP, CROP_WIDTH, CROP_HEIGHT = 260, 128, 320, 224
WIDTH, HEIGHT = 160, 112
FIRST, STRIDE, COUNT = 960, 2, 192
FPS = 240000 / 1001


def archive_bytes(span):
    start, stop = span
    request = Request(ARCHIVE, headers={"Range": f"bytes={start}-{stop - 1}"})
    for attempt in range(3):
        try:
            with urlopen(request, timeout=60) as response:
                if (
                    response.headers.get("Content-Range")
                    != f"bytes {start}-{stop - 1}/197287528"
                ):
                    raise ValueError(
                        "The experiment does not match the published byte ranges."
                    )
                data = response.read()
            if len(data) == stop - start:
                return data
        except (IncompleteRead, TimeoutError, URLError):
            if attempt == 2:
                raise
        if attempt < 2:
            sleep(2**attempt)
    raise OSError(f"Incomplete range {start}–{stop} from the experiment archive.")


def fetch_recording(directory):
    archive = directory / "experiment.rar"
    recording = directory / "0.03.MP4"
    sevenzip = shutil.which("7zz") or shutil.which("7z")
    if not sevenzip and os.name == "nt":
        installed = Path(os.environ.get("ProgramFiles", "")) / "7-Zip" / "7z.exe"
        if installed.is_file():
            sevenzip = str(installed)
    if not sevenzip:
        raise RuntimeError(
            "Install 7-Zip with RAR support, or pass the extracted MP4 via --video."
        )

    # Zenodo's versioned RAR5 is non-solid. Copy its main header, this member's
    # complete header and compressed bytes, and the original end-of-archive
    # marker. The offsets and file checksum pin this to the cited release.
    member_start, member_end = 102236978, 193996752
    block = 1024 * 1024
    ranges = (
        [(0, 26)]
        + [
            (begin, min(member_end, begin + block))
            for begin in range(member_start, member_end, block)
        ]
        + [(197287520, 197287528)]
    )
    with ThreadPoolExecutor(max_workers=6) as pool, archive.open("wb") as handle:
        for part in pool.map(archive_bytes, ranges):
            handle.write(part)
    with recording.open("wb") as handle:
        subprocess.run(
            [sevenzip, "x", "-so", str(archive), MEMBER], stdout=handle, check=True
        )
    return recording


def extract(recording, ffmpeg):
    checksum = hashlib.sha256()
    with recording.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            checksum.update(block)
    if checksum.hexdigest() != VIDEO_SHA256:
        raise ValueError(f"Expected the original {MEMBER} from {DOI}.")

    indices = FIRST + STRIDE * np.arange(COUNT)
    select = rf"select=between(n\,{FIRST}\,{indices[-1]})*not(mod(n-{FIRST}\,{STRIDE}))"
    filters = (
        f"{select},crop={CROP_WIDTH}:{CROP_HEIGHT}:{LEFT}:{TOP},"
        f"scale={WIDTH}:{HEIGHT}:flags=area,format=gray"
    )
    data = subprocess.check_output(
        [
            ffmpeg,
            "-v",
            "error",
            "-i",
            str(recording),
            "-map",
            "0:v:0",
            "-an",
            "-vf",
            filters,
            "-frames:v",
            str(COUNT),
            "-fps_mode",
            "passthrough",
            "-pix_fmt",
            "gray",
            "-f",
            "rawvideo",
            "pipe:1",
        ]
    )
    gray = np.frombuffer(data, dtype=np.uint8).reshape(COUNT, HEIGHT, WIDTH)
    return {
        "gray": gray.astype(np.float32) / 255,
        "t": indices / FPS,
        "x": (LEFT + (np.arange(WIDTH) + 0.5) * CROP_WIDTH / WIDTH) / SOURCE_WIDTH,
        "y": (TOP + (np.arange(HEIGHT) + 0.5) * CROP_HEIGHT / HEIGHT) / SOURCE_HEIGHT,
        "source": DOI,
        "license": LICENSE,
        "crop_xywh": np.array([LEFT, TOP, CROP_WIDTH, CROP_HEIGHT]),
        "source_size": np.array([SOURCE_WIDTH, SOURCE_HEIGHT]),
        "frame_indices": indices,
    }


def main():
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument(
        "--output", type=Path, required=True, help="Destination NPZ file."
    )
    parser.add_argument(
        "--video", type=Path, help="Local copy of the original 0.03.MP4 recording."
    )
    args = parser.parse_args()
    ffmpeg = shutil.which("ffmpeg")
    if not ffmpeg:
        parser.error("Install FFmpeg and add it to PATH.")
    with TemporaryDirectory() as temporary:
        recording = (
            args.video if args.video is not None else fetch_recording(Path(temporary))
        )
        sample = extract(recording, ffmpeg)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    with args.output.open("wb") as handle:
        np.savez_compressed(handle, **sample)
    print(f"{args.output}: {sample['gray'].shape} measured optical intensities")


if __name__ == "__main__":
    main()
