#!/usr/bin/env python3
"""Reject synthetic private build values in browser-served Next.js artifacts."""
import os
from pathlib import Path
import sys
import tempfile

PRIVATE_ENV = (
    "TURNSTILE_SECRET_KEY",
    "ZITADEL_SERVICE_USER_TOKEN",
    "ZITADEL_SESSION_COOKIE_SECRET",
)


def check_files(files, sentinels):
    for path in files:
        content = path.read_bytes()
        for name, value in sentinels.items():
            if value in content:
                raise ValueError(f"{name} exposed in public artifact {path}")


def public_files(root):
    directories = (
        root / "static",
        root / "standalone/apps/login/.next/static",
        root / "standalone/public",
    )
    files = []
    for directory in directories:
        found = [path for path in directory.rglob("*") if path.is_file()]
        if not found:
            raise ValueError(f"Missing or empty public artifact directory: {directory}")
        files.extend(found)
    # Prerendered HTML and RSC are browser-visible too; server JS is not.
    for directory in (root / "server", root / "standalone/apps/login/.next/server"):
        files.extend(path for path in directory.rglob("*") if path.is_file() and path.suffix in (".html", ".rsc", ".body"))
    return files


def self_test():
    with tempfile.TemporaryDirectory() as temporary:
        path = Path(temporary) / "client.js"
        path.write_bytes(b"public site key only")
        check_files([path], {"PRIVATE": b"private-sentinel"})
        path.write_bytes(b"prefix-private-sentinel-suffix")
        try:
            check_files([path], {"PRIVATE": b"private-sentinel"})
        except ValueError:
            pass
        else:
            raise AssertionError("Leaked sentinel was accepted")
        try:
            public_files(Path(temporary))
        except ValueError:
            pass
        else:
            raise AssertionError("Missing build artifacts were accepted")
    print("Client secret scan rejects leaks and missing artifacts")


if __name__ == "__main__":
    try:
        if sys.argv[1:] == ["--self-test"]:
            self_test()
        elif len(sys.argv) == 2:
            sentinels = {name: os.environ[name].encode() for name in PRIVATE_ENV}
            if any(not value for value in sentinels.values()):
                raise ValueError("Private build sentinels must be nonempty")
            files = public_files(Path(sys.argv[1]))
            check_files(files, sentinels)
            print(f"No private build sentinels in {len(files)} public artifacts")
        else:
            raise ValueError("usage: check_login_client_secrets.py NEXT_BUILD_DIR | --self-test")
    except (KeyError, ValueError) as error:
        sys.exit(str(error))
