"""Restore the Haeon Air Rescue v25 runtime assets from an existing local copy."""

import argparse
import hashlib
import json
import os
import re
import shutil
import stat
import sys
import tempfile
import zipfile
from collections import Counter
from contextlib import ExitStack
from pathlib import Path, PurePosixPath


ROOT = Path(__file__).resolve().parents[1]
MANIFEST = Path(__file__).with_name("v25-assets.jsonl")
ARCHIVE_ROOT = "Haeon-Air-Rescue/"
RESERVED_NAME = re.compile(r"^(?:CON|PRN|AUX|NUL|COM[1-9¹²³]|LPT[1-9¹²³])(?:\.|$)", re.I)


def asset_path(name):
    path = PurePosixPath(name)
    if (path.as_posix() != name or path.is_absolute() or ".." in path.parts
            or "\\" in name or ":" in name
            or not name.startswith(("models/", "remake/art/", "remake/data/"))
            or any(part.endswith((" ", ".")) or RESERVED_NAME.match(part)
                   for part in path.parts)):
        raise ValueError(f"Invalid asset path: {name!r}")
    return path


def safe_location(root, relative):
    result = root
    for component in relative.parts:
        result = result / component
        try:
            info = result.lstat()
        except FileNotFoundError:
            continue
        if (stat.S_ISLNK(info.st_mode) or
                getattr(info, "st_reparse_tag", 0) in (0xA0000003, 0xA000000C)):
            raise ValueError(f"Refusing symbolic link or junction: {result}")
    if not result.resolve().is_relative_to(root):
        raise ValueError(f"Path leaves selected directory: {relative}")
    return result


def rows():
    seen = set()
    for line in MANIFEST.read_text(encoding="utf-8").splitlines():
        row = json.loads(line)
        path = asset_path(row["path"])
        name = row["path"].casefold()
        if (name in seen or row["zip"] != ARCHIVE_ROOT + path.as_posix()
                or not re.fullmatch(r"[0-9a-f]{64}", row["sha256"])
                or not isinstance(row["size"], int) or row["size"] < 0
                or "eol" in row and (path.suffix not in (".json", ".svg")
                                     or row["eol"] not in ("crlf", "lf"))):
            raise ValueError(f"Invalid manifest entry: {path}")
        seen.add(name)
        yield path, row


def checked_bytes(stream, row):
    size = row["size"]
    limit = size * (2 if "eol" in row else 1)
    data = stream.read(limit + 1)
    if len(data) > limit:
        raise ValueError(f"Size mismatch: {row['path']}")
    # Honor line-ending conversions performed by ZIP packagers or Git on checkout.
    if "eol" in row:
        data = data.replace(b"\r\n", b"\n")
        if row["eol"] == "crlf":
            data = data.replace(b"\n", b"\r\n")
    if len(data) != size or hashlib.sha256(data).hexdigest() != row["sha256"]:
        raise ValueError(f"Content differs from v25: {row['path']}")
    return data


def run(source, verify):
    existing = 0
    pending = []
    for path, row in rows():
        dest = safe_location(ROOT, path)
        if dest.exists():
            # Reject modified files before installing any missing asset.
            with dest.open("rb") as stream:
                checked_bytes(stream, row)
            existing += 1
        else:
            pending.append((path, row))
    if not pending:
        print(f"Verified {existing} v25 assets.")
        return
    if verify:
        raise ValueError(f"{len(pending)} v25 assets missing; first: {pending[0][0]}")

    source = Path(source).resolve(strict=True)
    with ExitStack() as stack:
        directory = None
        archive = None
        if source.is_dir():
            directory = source
            wrapped = safe_location(directory, PurePosixPath(ARCHIVE_ROOT))
            if not (directory / "models").is_dir() and wrapped.is_dir():
                directory = wrapped
        else:
            archive = stack.enter_context(zipfile.ZipFile(source))
            names = Counter(archive.namelist())
        stage = Path(stack.enter_context(tempfile.TemporaryDirectory()))
        for index, (path, row) in enumerate(pending):
            if archive is not None:
                if names[row["zip"]] != 1:
                    raise ValueError(f"Missing or duplicated in ZIP: {row['zip']}")
                entry = archive.getinfo(row["zip"])
                if entry.is_dir() or stat.S_ISLNK(entry.external_attr >> 16):
                    raise ValueError(f"Invalid ZIP file: {entry.filename}")
                handle = archive.open(entry)
            else:
                handle = safe_location(directory, path).open("rb")
            with handle:
                (stage / str(index)).write_bytes(checked_bytes(handle, row))

        for index, (path, row) in enumerate(pending):
            dest = safe_location(ROOT, path)
            dest.parent.mkdir(parents=True, exist_ok=True)
            # Create the whole file alongside its final path, then publish only
            # if that path is still empty. Another import can finish first.
            with tempfile.NamedTemporaryFile(dir=dest.parent, delete=False) as out:
                temporary = Path(out.name)
                try:
                    with (stage / str(index)).open("rb") as src:
                        shutil.copyfileobj(src, out)
                except BaseException:
                    out.close()
                    temporary.unlink(missing_ok=True)
                    raise
            try:
                if os.name == "nt":
                    os.rename(temporary, dest)   # Windows refuses to replace.
                else:
                    os.link(temporary, dest)     # Atomic, refuses to replace.
            except FileExistsError:
                with safe_location(ROOT, path).open("rb") as current:
                    checked_bytes(current, row)
            finally:
                temporary.unlink(missing_ok=True)
    print(f"Restored {len(pending)} assets; verified {existing} already present.")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", nargs="?", help="v25 Windows ZIP, extracted game folder, or deployed dist folder")
    parser.add_argument("--verify", action="store_true", help="only verify this checkout against the v25 manifest")
    args = parser.parse_args()
    if not args.source and not args.verify:
        parser.error("provide the local v25 ZIP/folder or --verify")
    try:
        run(args.source, args.verify)
    except (OSError, ValueError, KeyError, zipfile.BadZipFile, RuntimeError) as err:
        print(f"Asset check failed: {err}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
