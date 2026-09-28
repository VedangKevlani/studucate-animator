"""
stu_lipsync.py: turn a Chatterbox clip into a lip-sync timing file for <stu-avatar>.

It runs Rhubarb Lip Sync (free, MIT licence) on the audio and returns its
"mouthCues" JSON: a list of {start, end, value} where value is a mouth shape
letter (A-H, X). The <stu-avatar> web component reads this directly.

Use it from Python:

    from stu_lipsync import make_cues
    cues = make_cues("out/line.wav", text="Hi, I'm Stu. Whenever you need me, I'm here.")
    # -> dict, also written to out/line.cues.json by default

or from the command line:

    python stu_lipsync.py out/line.wav --text "Hi, I'm Stu..."

Passing the exact text Stu says makes the timing noticeably more accurate.
Rhubarb itself is installed by install_rhubarb.py (or set RHUBARB_PATH).
"""
from __future__ import annotations

import argparse
import json
import os
import platform
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
EXE = "rhubarb.exe" if platform.system() == "Windows" else "rhubarb"


def find_rhubarb() -> str:
    """Locate the Rhubarb executable: $RHUBARB_PATH, ./tools/, then PATH."""
    env = os.environ.get("RHUBARB_PATH")
    if env and Path(env).exists():
        return env
    for p in (HERE / "tools").glob(f"**/{EXE}"):
        return str(p)
    found = shutil.which("rhubarb")
    if found:
        return found
    raise FileNotFoundError(
        "Rhubarb Lip Sync not found. Run `python install_rhubarb.py` "
        "or set RHUBARB_PATH to the rhubarb executable."
    )


def _as_wav(audio_path: Path, tmpdir: Path) -> Path:
    """Rhubarb reads WAV and OGG. Convert anything else (mp3, flac, ...) with ffmpeg."""
    if audio_path.suffix.lower() in (".wav", ".ogg"):
        return audio_path
    if not shutil.which("ffmpeg"):
        raise RuntimeError(f"{audio_path.name} is not WAV/OGG and ffmpeg is not installed to convert it.")
    out = tmpdir / "input.wav"
    subprocess.run(
        ["ffmpeg", "-loglevel", "error", "-y", "-i", str(audio_path), "-ac", "1", "-ar", "16000", str(out)],
        check=True,
    )
    return out


def make_cues(
    audio_path: str | os.PathLike,
    text: str | None = None,
    out_path: str | os.PathLike | None = "auto",
    recognizer: str = "pocketSphinx",
) -> dict:
    """
    Generate mouth cues for one clip.

    audio_path  the Chatterbox output (WAV recommended; other formats need ffmpeg)
    text        the exact words spoken (optional, improves accuracy)
    out_path    where to write the JSON. "auto" = next to the audio as <name>.cues.json,
                None = don't write a file.
    recognizer  "pocketSphinx" (English, best) or "phonetic" (any language)
    Returns the Rhubarb JSON as a dict: {"metadata": ..., "mouthCues": [...]}
    """
    audio_path = Path(audio_path)
    rhubarb = find_rhubarb()
    with tempfile.TemporaryDirectory() as td:
        tmp = Path(td)
        wav = _as_wav(audio_path, tmp)
        cmd = [rhubarb, "-q", "-f", "json", "--extendedShapes", "GHX", "-r", recognizer, str(wav)]
        if text:
            dialog = tmp / "dialog.txt"
            dialog.write_text(text, encoding="utf-8")
            cmd[1:1] = ["-d", str(dialog)]
        result = subprocess.run(cmd, capture_output=True, text=True)
        if result.returncode != 0:
            raise RuntimeError(f"Rhubarb failed: {result.stderr.strip()}")
        data = json.loads(result.stdout)

    if out_path == "auto":
        out_path = audio_path.with_suffix(".cues.json")
    if out_path:
        Path(out_path).write_text(json.dumps(data), encoding="utf-8")
    return data


def main(argv=None):
    ap = argparse.ArgumentParser(description="Make a <stu-avatar> lip-sync file from a TTS clip.")
    ap.add_argument("audio", help="WAV/OGG file (or mp3 etc. if ffmpeg is installed)")
    ap.add_argument("--text", help="exact words spoken (improves accuracy)")
    ap.add_argument("-o", "--out", help="output JSON path (default: <audio>.cues.json)")
    ap.add_argument("--phonetic", action="store_true", help="use the language-independent recognizer")
    args = ap.parse_args(argv)
    data = make_cues(args.audio, text=args.text, out_path=args.out or "auto",
                     recognizer="phonetic" if args.phonetic else "pocketSphinx")
    print(f"{len(data['mouthCues'])} mouth cues written")


if __name__ == "__main__":
    sys.exit(main())
