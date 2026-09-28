"""
Download Rhubarb Lip Sync 1.13.0 for this OS into ./tools/ (next to this file).
Free and open source (MIT): https://github.com/DanielSWolf/rhubarb-lip-sync

    python install_rhubarb.py
"""
import io
import os
import platform
import stat
import sys
import urllib.request
import zipfile
from pathlib import Path

VERSION = "1.13.0"
BASE = f"https://github.com/DanielSWolf/rhubarb-lip-sync/releases/download/v{VERSION}/"
ASSETS = {
    "Windows": f"Rhubarb-Lip-Sync-{VERSION}-Windows.zip",
    "Darwin": f"Rhubarb-Lip-Sync-{VERSION}-macOS.zip",
    "Linux": f"Rhubarb-Lip-Sync-{VERSION}-Linux.zip",
}


def main():
    system = platform.system()
    if system not in ASSETS:
        sys.exit(f"No Rhubarb build for {system}. Download one manually from {BASE}")
    dest = Path(__file__).resolve().parent / "tools"
    dest.mkdir(exist_ok=True)
    url = BASE + ASSETS[system]
    print(f"Downloading {url}")
    with urllib.request.urlopen(url) as r:
        zipfile.ZipFile(io.BytesIO(r.read())).extractall(dest)
    exe = next(dest.glob("**/rhubarb.exe" if system == "Windows" else "**/rhubarb"))
    if system != "Windows":
        exe.chmod(exe.stat().st_mode | stat.S_IEXEC | stat.S_IXGRP | stat.S_IXOTH)
    print(f"Installed: {exe}")
    if system == "Darwin":
        print("If macOS blocks it, run:  xattr -dr com.apple.quarantine " + str(exe.parent))


if __name__ == "__main__":
    main()
