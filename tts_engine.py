import os
import re
import subprocess
import sys
import tempfile
import threading
from pathlib import Path

# The `chatterbox` package lives under src/ (src layout). Locally it's
# importable because of the editable install from pyproject.toml, but
# deployment (HF Spaces) installs from requirements.txt without that
# editable install, so make sure src/ is on the path either way.
_SRC_DIR = str(Path(__file__).resolve().parent / "src")
if _SRC_DIR not in sys.path:
	sys.path.insert(0, _SRC_DIR)

import soundfile as sf
import torch
from chatterbox.tts_turbo import ChatterboxTurboTTS

# See CLAUDE.md "Voice settings (locked)" - do not change these without an
# explicit request. This module is the single source of truth for the
# cloning/generation pipeline; app.py and server.py both call into it.
REFERENCE_AUDIO = "male_voice.mp3"
PITCH_SHIFT_SEMITONES = 1


def build_reference_wav(source_path=REFERENCE_AUDIO):
	pitch_factor = 2 ** (PITCH_SHIFT_SEMITONES / 12)
	reference_wav = tempfile.NamedTemporaryFile(suffix=".wav", delete=False).name
	subprocess.run(
		[
			"ffmpeg", "-y", "-i", source_path,
			"-af", (
				"equalizer=f=1100:t=q:w=2.5:g=-8,treble=g=3:f=6000,"
				f"rubberband=pitch={pitch_factor}:formant=preserved,"
				"loudnorm=I=-27:TP=-2:LRA=7"
			),
			"-ar", "24000", "-ac", "1", reference_wav,
		],
		check=True,
		stdout=subprocess.DEVNULL,
		stderr=subprocess.DEVNULL,
	)
	return reference_wav


def chunk_text(text, max_words=25):
	# Any generation whose text exceeds ~25 words gets chunked on sentence
	# boundaries, to stay clear of Turbo's 1000-token cap where pacing/quality
	# degrade. See CLAUDE.md "Chunking long generations".
	sentences = re.split(r"(?<=[.!?])\s+", text.strip())
	chunks, current, current_words = [], [], 0
	for sentence in sentences:
		words = len(sentence.split())
		if current and current_words + words > max_words:
			chunks.append(" ".join(current))
			current, current_words = [sentence], words
		else:
			current.append(sentence)
			current_words += words
	if current:
		chunks.append(" ".join(current))
	return chunks


class GenerationCancelled(Exception):
	pass


class TTSEngine:
	"""Lazily loads the model + reference conditioning once, then serializes
	generations behind a lock (the underlying model isn't safe for concurrent
	calls)."""

	def __init__(self):
		self._lock = threading.Lock()
		self._model = None
		self._reference_wav = None

	def ensure_loaded(self):
		if self._model is not None:
			return
		with self._lock:
			if self._model is not None:
				return
			self._reference_wav = build_reference_wav()
			# Auto-detect: CPU everywhere by default, GPU when one is actually
			# available (e.g. HF Spaces ZeroGPU), for much faster generation.
			device = "cuda" if torch.cuda.is_available() else "cpu"
			model = ChatterboxTurboTTS.from_pretrained(device=device)
			model.prepare_conditionals(self._reference_wav, norm_loudness=True)
			self._model = model

	def generate_to_file(self, text, output_path, on_progress=None, should_stop=None):
		"""on_progress(done, total), called after each chunk finishes generating.
		should_stop() -> bool, checked between chunks; raises GenerationCancelled
		if it returns True. Generation can only stop between chunks, not mid-chunk -
		there's no way to interrupt a single model.generate() call partway through."""
		self.ensure_loaded()
		with self._lock:
			model = self._model
			chunks = chunk_text(text)
			silence = torch.zeros(1, int(0.25 * model.sr))
			chunk_wavs = []
			for i, chunk in enumerate(chunks):
				if should_stop and should_stop():
					raise GenerationCancelled()
				chunk_wavs.append(model.generate(chunk, temperature=0.8))
				chunk_wavs.append(silence)
				if on_progress:
					on_progress(i + 1, len(chunks))
			wav = torch.cat(chunk_wavs[:-1], dim=1)

			wav_path = tempfile.NamedTemporaryFile(suffix=".wav", delete=False).name
			try:
				sf.write(wav_path, wav.squeeze().detach().cpu().numpy(), model.sr)
				subprocess.run(
					["ffmpeg", "-y", "-i", wav_path, "-codec:a", "libmp3lame", "-q:a", "2", output_path],
					check=True,
					stdout=subprocess.DEVNULL,
					stderr=subprocess.DEVNULL,
				)
			finally:
				os.unlink(wav_path)
