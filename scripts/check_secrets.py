#!/usr/bin/env python3
"""Reject provider credentials embedded in tracked release material."""

from __future__ import annotations

import argparse
import re
import subprocess
from pathlib import Path
from typing import Iterable


EXCLUDED_PARTS = frozenset({".git", "artifacts", "cache", "node_modules"})
PROVIDER_CREDENTIAL_PATTERNS = (
    re.compile(rb"https://[a-z0-9.-]*g\.alchemy\.com/v2/[A-Za-z0-9_-]{8,}", re.I),
    re.compile(rb"https://[a-z0-9.-]*infura\.io/v3/[A-Za-z0-9_-]{8,}", re.I),
    re.compile(rb"https://[A-Za-z0-9_-]{8,}\.[a-z0-9.-]*quiknode\.pro(?:/|\b)", re.I),
)


def tracked_files(root: Path) -> list[Path]:
    result = subprocess.run(
        ["git", "ls-files", "--cached", "--others", "--exclude-standard", "-z"],
        cwd=root,
        check=True,
        capture_output=True,
    )
    return [
        root / raw.decode()
        for raw in result.stdout.split(b"\0")
        if raw and (root / raw.decode()).is_file()
    ]


def iter_files(paths: Iterable[Path]) -> Iterable[Path]:
    for path in paths:
        if path.is_dir():
            yield from (
                candidate
                for candidate in path.rglob("*")
                if candidate.is_file()
                and not any(part in EXCLUDED_PARTS for part in candidate.parts)
            )
        elif path.is_file() and not any(
            part in EXCLUDED_PARTS for part in path.parts
        ):
            yield path


def contains_provider_credential(path: Path) -> bool:
    try:
        data = path.read_bytes()
    except OSError:
        return True
    return any(pattern.search(data) for pattern in PROVIDER_CREDENTIAL_PATTERNS)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--repo-root",
        type=Path,
        default=Path(__file__).resolve().parents[1],
    )
    parser.add_argument("--paths", nargs="*", type=Path)
    args = parser.parse_args()

    root = args.repo_root.resolve()
    candidates = (
        list(iter_files(args.paths)) if args.paths else tracked_files(root)
    )
    violations = [path for path in candidates if contains_provider_credential(path)]
    if violations:
        print("Embedded provider credential detected in:")
        for path in violations:
            print(f"  {path}")
        return 1
    print(f"Provider credential gate passed for {len(candidates)} files.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
