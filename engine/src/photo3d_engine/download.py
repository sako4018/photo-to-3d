"""Download model files with byte progress, pause and resume (docs/phase-2-app.md, 2.1).

A file is written to `<name>.part` first and renamed when it is complete, so a stopped
download carries on from where it was (HTTP Range) instead of starting again.
"""

from __future__ import annotations

import urllib.request
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path

from .engines.base import Cancelled

CHUNK = 1024 * 1024
BytesFn = Callable[[int, int], None]  # (bytes done, bytes in total)


@dataclass(frozen=True)
class RemoteFile:
    name: str  # path inside the model folder, e.g. "vae/config.json"
    url: str
    size: int


def done_bytes(files: list[RemoteFile], folder: Path) -> int:
    """Bytes already on disk: finished files plus the parts of unfinished ones."""
    total = 0
    for item in files:
        path = folder / item.name
        if path.is_file():
            total += item.size
        elif path.with_name(path.name + ".part").is_file():
            total += path.with_name(path.name + ".part").stat().st_size
    return total


def download(
    files: list[RemoteFile],
    folder: Path,
    on_bytes: BytesFn,
    cancelled: Callable[[], bool] = lambda: False,
    opener: Callable[..., object] = urllib.request.urlopen,
) -> None:
    """Fetch every missing file into `folder`. Raises Cancelled when stopped (resumable)."""
    total = sum(item.size for item in files)
    done = done_bytes(files, folder)
    on_bytes(done, total)
    for item in files:
        path = folder / item.name
        if path.is_file():
            continue
        path.parent.mkdir(parents=True, exist_ok=True)
        part = path.with_name(path.name + ".part")
        have = part.stat().st_size if part.is_file() else 0
        if have > item.size:  # the remote file changed; start this one again
            done -= have
            part.unlink()
            have = 0
        if have < item.size:
            request = urllib.request.Request(item.url, headers={"Range": f"bytes={have}-"})
            with opener(request, timeout=60) as response, part.open("ab") as out:
                if have and getattr(response, "status", 206) != 206:
                    # the server ignored the range: write the file again from the start
                    out.truncate(0)
                    done -= have
                while chunk := response.read(CHUNK):
                    out.write(chunk)
                    done += len(chunk)
                    on_bytes(done, total)
                    if cancelled():
                        raise Cancelled()
        if part.stat().st_size != item.size:
            raise OSError(
                f"{item.name}: got {part.stat().st_size} bytes, expected {item.size}. "
                "Try the download again."
            )
        part.replace(path)
    on_bytes(total, total)
