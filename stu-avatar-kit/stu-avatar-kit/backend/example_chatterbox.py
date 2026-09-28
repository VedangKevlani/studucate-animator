"""
Example: generate a Chatterbox clip and its Stu lip-sync file together.

This is a reference, not something you must run. Your voice designer already
generates audio; the only new step is the `make_cues(...)` call after saving the WAV.

    pip install chatterbox-tts
    python example_chatterbox.py "Hi, I'm Stu. Whenever you need me, I'm here."
"""
import sys
from pathlib import Path

import torchaudio as ta
from chatterbox.tts import ChatterboxTTS

from stu_lipsync import make_cues

OUT = Path("out")
OUT.mkdir(exist_ok=True)


def generate_line(text: str, voice_prompt: str | None = None, name: str = "line") -> dict:
    model = ChatterboxTTS.from_pretrained(device="cuda")  # or "cpu" / "mps"
    wav = model.generate(text, audio_prompt_path=voice_prompt) if voice_prompt else model.generate(text)
    wav_path = OUT / f"{name}.wav"
    ta.save(str(wav_path), wav, model.sr)

    # New step: timing file for <stu-avatar>. Passing the text improves accuracy.
    make_cues(wav_path, text=text)  # writes out/<name>.cues.json

    return {"audio": f"/out/{name}.wav", "cues": f"/out/{name}.cues.json"}


if __name__ == "__main__":
    print(generate_line(" ".join(sys.argv[1:]) or "Hi, I'm Stu. Whenever you need me, I'm here."))
