# Chatterbox TTS notes (app.py)

## Chunking long generations

Chatterbox's Turbo model has a 1000-token generation cap. Text long enough to
approach that cap causes autoregressive decoding to degrade near the end -
pacing rushes and speech turns to gibberish. (One real run: ~200 words of
text hit 821/1000 tokens in a single generation and the tail came out
garbled.)

**Rule: any generation whose text exceeds ~25 words must be chunked.**

- Split on sentence boundaries (`.`, `!`, `?`), grouping sentences up to
  ~25 words per chunk (see `chunk_text()` in `app.py`).
- Call `model.prepare_conditionals(reference_wav, norm_loudness=True)` once,
  then `model.generate(chunk, temperature=...)` per chunk - no need to
  re-pass `audio_prompt_path` after the first call, it reuses the cached
  conditioning.
- Concatenate the resulting waveforms with a short silence gap (~0.25s,
  `torch.zeros(1, int(0.25 * model.sr))`) between chunks.
- Apply this regardless of which model (Turbo/Nano/full) is in use - the
  same failure mode applies to long autoregressive generations generally.

## Voice settings (locked - do not change without an explicit request)

These were arrived at through many rounds of listening feedback. Don't
re-tune them as a side effect of an unrelated change.

- **Reference audio**: `male_voice.mp3`, cloned directly. Never clone the
  ElevenLabs sample in this repo (if present) - that's a licensed synthetic
  voice, and cloning it is a legal/commercial-use risk. It may be used only
  as a stylistic reference to tune toward, never as generation input.
- **Pitch**: +1 semitone via `rubberband=pitch=<factor>:formant=preserved`
  on the reference clip. History: 0 semitones ("too deep") and +2 semitones
  ("too high pitched") were both rejected; +1 is the agreed middle ground.
  `formant=preserved` matters - `formant=shifted` (the rubberband default)
  moves the vocal-tract resonance and repeatedly came back sounding nasal
  across several tested amounts.
- **De-nasal EQ**: `equalizer=f=1100:t=q:w=2.5:g=-8` cuts the nasal
  resonance specific to this recording; `treble=g=3:f=6000` adds
  warmth/brightness without reintroducing nasality. A narrower/shallower
  cut and a presence boost around 3kHz were both tried and made the nasal
  issue worse, not better.
- **Loudness**: `loudnorm=I=-27:TP=-2:LRA=7` on the reference clip, matching
  what the model expects (-27 LUFS); the raw clip peaks much hotter than
  that, so skipping this feeds the cloning step a mismatched, over-driven
  signal.
- **Model**: `ChatterboxTurboTTS`, not the full `ChatterboxTTS`. Turbo is
  required for `[cough]`/`[laugh]`/`[chuckle]`/etc. paralinguistic tags,
  which the full model cannot perform (it reads the bracketed words
  literally). Trade-off: the full model has real `exaggeration`/`cfg_weight`
  expressiveness controls that Turbo ignores - only switch to it if tag
  support is explicitly not needed for that generation.
- **Generation**: `temperature=0.8` (Turbo's default). A higher temperature
  (0.9-1.15) combined with long, near-cap generations was part of why
  pacing felt rushed; keep it at default and rely on chunking for length.
- **Supported paralinguistic tags**: `[cough]`, `[laugh]`, `[chuckle]`,
  `[sigh]`, `[gasp]`, `[groan]`, `[sniff]`, `[clear throat]`, `[shush]`.
  `[pause]` is NOT a real tag - it gets read as the literal word "pause".
  `*asterisk*` emphasis is also not supported markup and gets read/dropped
  literally. Don't use either in TTS scripts.
