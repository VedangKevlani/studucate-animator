# Studucate Voice Designer (Stu)

A local web app: type a script, and it is spoken in Stu's voice by an
animated Stu avatar. Stu lip-syncs and acts out the mood of each sentence.
You can download the audio (MP3) or a video of Stu speaking it (MP4).

It runs on [Chatterbox-Turbo](#chatterbox-tts), Resemble AI's open-source
text-to-speech model, which is included in this repo under `src/chatterbox`.
Everything runs on your own machine. You don't need an account or API key.

## 1. What you need

| Tool | Why | How to install |
|---|---|---|
| **Git** | To download the code | https://git-scm.com/downloads |
| **Python 3.11 or 3.12** | Runs the server and the model. 3.12 is tested. Avoid 3.14 for now. | https://www.python.org/downloads/ (or let `uv` install it, below) |
| **uv** (recommended) | Installs the exact tested package versions from `uv.lock` | https://docs.astral.sh/uv/getting-started/installation/ |
| **FFmpeg, with the `rubberband` filter** | Prepares Stu's voice, converts audio to MP3, builds videos | Windows: `winget install Gyan.FFmpeg` · macOS: `brew install ffmpeg` · Ubuntu/Debian: `sudo apt install ffmpeg` |
| **Chrome, Edge or Safari** (recent) | The web page. Video download needs WebCodecs, which Firefox lacks. | — |

Hardware: runs on CPU, or on an NVIDIA GPU if one is detected (much faster).
The first run downloads the model weights from Hugging Face, so you need an
internet connection and a few GB of free disk space.

**Check FFmpeg before continuing.** Open a new terminal and run:

```shell
ffmpeg -hide_banner -filters | grep rubberband        # macOS / Linux / Git Bash
ffmpeg -hide_banner -filters | findstr rubberband     # Windows PowerShell / cmd
```

You should see a line containing `rubberband`. If `ffmpeg` isn't found,
restart your terminal (or your computer) after installing it. If the command
runs but prints nothing, your FFmpeg build lacks rubberband: install a "full"
build (the Windows `winget` command above installs one).

## 2. Install

```shell
git clone https://github.com/VedangKevlani/studucate-voice-designer.git
cd studucate-voice-designer
```

**Option A: uv (recommended)**

```shell
uv sync --python 3.12
```

This creates a `.venv` folder with everything installed, including PyTorch.
It takes a few minutes.

**Option B: plain pip**

```shell
python -m venv .venv
# Windows:        .venv\Scripts\activate
# macOS / Linux:  source .venv/bin/activate
pip install -e .
```

On Windows, if `python` opens the Microsoft Store, use `py -3.12` instead of
`python`, or turn off the alias in *Settings → Apps → Advanced app settings →
App execution aliases*.

**Optional: NVIDIA GPU.** The default install may give you a CPU-only
PyTorch. For GPU speed, install the CUDA build of `torch`/`torchaudio` 2.6.0
from https://pytorch.org/get-started/locally/ into the same environment.

## 3. Install Rhubarb (lip sync, recommended)

Stu's mouth shapes come from [Rhubarb Lip Sync](https://github.com/DanielSWolf/rhubarb-lip-sync)
(free, MIT). This downloads it into `./tools/`:

```shell
uv run python install_rhubarb.py      # or, with an activated venv: python install_rhubarb.py
```

Without Rhubarb the app still works, but Stu's mouth only follows loudness.
On macOS, if the system blocks it, run the `xattr` command the script prints.

## 4. Run

```shell
uv run python server.py               # or, with an activated venv: python server.py
```

Open **http://127.0.0.1:7860** in your browser.

- The first start downloads the model (a few minutes), then loads it and
  prepares Stu's voice. The page shows when it's ready.
- Type a script, press **Generate**, and Stu speaks it. A progress bar shows
  each chunk being generated. On CPU, expect roughly real time or slower.
- Past clips are listed in the history panel. The files are saved in
  `outputs/`.
- Stop the server with `Ctrl+C`.

### Settings (environment variables, all optional)

| Variable | Default | What it does |
|---|---|---|
| `PORT` | `7860` | Port the server listens on |
| `HOST` | `127.0.0.1` | Set to `0.0.0.0` to allow other devices on your network (or a container) to connect |
| `STU_LIPSYNC_RECOGNIZER` | `pocketSphinx` | `phonetic` is about 4x faster, with slightly looser mouth timing |
| `RHUBARB_PATH` | auto | Full path to a Rhubarb executable, if it isn't in `./tools/` or on `PATH` |
| `HF_TOKEN` | none | Hugging Face token. Not required. Only useful if downloads are rate-limited. |

Example: `PORT=8000 uv run python server.py` (macOS/Linux) or
`$env:PORT=8000; uv run python server.py` (PowerShell).

## 5. Writing scripts for Stu

- **Sounds:** `[laugh]`, `[chuckle]`, `[sigh]`, `[gasp]`, `[cough]`, `[groan]`,
  `[sniff]`, `[clear throat]`, `[shush]` are performed as sounds.
- **Don't use** `[pause]` or `*asterisks*`. They are read out loud as words.
  To make a pause, use punctuation (`...`, or start a new sentence).
- **Emotions:** Stu picks an emotion for each sentence from its wording and
  punctuation (e.g. "Don't worry, you've got this." reads as reassuring).
  [STU_EMOTIONS.md](STU_EMOTIONS.md) lists every emotion and the words that
  trigger it.
- **Long text is fine** (up to 5000 characters). It's split into short
  groups of sentences automatically, so quality holds up over long scripts.

## Other tools in this repo

| Command | What it does |
|---|---|
| `uv run python app.py` | Generates one test line in Stu's voice to `test-turbo.mp3`, with no web UI |
| `uv run python stu_lipsync.py clip.mp3 --text "the words spoken"` | Makes a `clip.cues.json` lip-sync file for any audio clip |
| `uv run python build_stu_rig.py` | Rebuilds Stu's cut-out puppet layers in `static/stu-avatar/assets/rig/` from the pose art. Only needed if you change the artwork. |

## Project layout

```
server.py            Flask web server: page, generation jobs, history, video export
tts_engine.py        Voice pipeline: prepares the reference voice, chunks text, runs Chatterbox-Turbo
stu_lipsync.py       Runs Rhubarb to make mouth-shape cues for a clip
install_rhubarb.py   Downloads Rhubarb into ./tools/
male_voice.mp3       Reference recording that Stu's voice is cloned from
static/              The web page (index.html, app.js, mood.js, video-export.js, ...)
static/stu-avatar/   The <stu-avatar> web component and its art
src/chatterbox/      The Chatterbox TTS model code (upstream, Resemble AI)
outputs/             Generated clips, lip-sync files and history (created on first run, not committed)
CLAUDE.md            Voice settings and why they were chosen. Read this before changing the voice.
```

## Troubleshooting

| Problem | Fix |
|---|---|
| `FileNotFoundError: ... 'ffmpeg'` | FFmpeg isn't installed or isn't on `PATH`. Install it (step 1), then open a **new** terminal. |
| Error mentioning `rubberband` / `No such filter` | Your FFmpeg build lacks rubberband. Install a full build (step 1). |
| Page says the model is still loading for a long time | The first run is downloading the model. Watch the terminal for progress. Later starts are faster. |
| Stu's mouth doesn't match the words well | Install Rhubarb (step 3). Check the terminal for `Lip sync failed` messages. |
| Video download button is disabled | Use a recent Chrome, Edge or Safari. |
| `Address already in use` | Another program uses port 7860. Stop it, or set `PORT` to a different number. |
| Generation is slow | Normal on CPU. Use an NVIDIA GPU with CUDA PyTorch for a big speedup. |

---

*The rest of this file is the original Chatterbox documentation from Resemble AI.*

![Chatterbox Multilingual Image](./Chatterbox-Multilingual.png)


# Chatterbox TTS

[![Alt Text](https://img.shields.io/badge/listen-demo_samples-blue)](https://resemble-ai.github.io/chatterbox_demopage/)
[![Alt Text](https://huggingface.co/datasets/huggingface/badges/resolve/main/open-in-hf-spaces-sm.svg)](https://huggingface.co/spaces/ResembleAI/Chatterbox-Multilingual-TTS)
[![Alt Text](https://static-public.podonos.com/badges/insight-on-pdns-sm-dark.svg)](https://podonos.com/resembleai/chatterbox)
[![Discord](https://img.shields.io/discord/1377773249798344776?label=join%20discord&logo=discord&style=flat)](https://discord.gg/rJq9cRJBJ6)

*Made with ♥️ by* <a href="https://resemble.ai" target="_blank"><img width="100" alt="resemble-logo-horizontal" src="https://github.com/user-attachments/assets/35cf756b-3506-4943-9c72-c05ddfa4e525" /></a>

**Chatterbox** is a family of state-of-the-art, open-source text-to-speech models by Resemble AI.

## Latest Release: Chatterbox Multilingual V3

**Chatterbox Multilingual V3** is the latest general-purpose multilingual TTS model in the Chatterbox family. It keeps the same 0.5B model size while improving speaker similarity, reducing hallucinations, and producing more natural, conversational speech across languages.

V3 is designed for broad language coverage like V2, but with stronger stability and more expressive generation. It is the recommended multilingual model for users who want one voice cloning model that works across many languages.

Alongside V3, we are releasing the **Single Language Pack**: dedicated finetunes for priority languages where tighter quality control, stronger language-specific behavior, and more specialized speech generation are valuable.

- **Broad Multilingual Coverage:** Designed as the main general-purpose multilingual Chatterbox model, supporting wide language coverage similar to V2.
- **Single Language Pack:** Dedicated single-language models provide stronger specialization and quality control where language- and regional-dialect-specific performance matters most.
- **More Consistent Speaker Similarity:** Improves voice identity and accent preservation across languages, making cross-language voice cloning more stable and reliable.
- **Reduced Hallucination:** V3 is optimized to reduce unwanted continuation, repetition, and off-prompt speech, especially in cases where earlier multilingual models were less stable.

For low-latency English voice agents, **Chatterbox-Turbo** is our most efficient model. Built on a streamlined 350M parameter architecture, **Turbo** delivers high-quality speech with less compute and VRAM than our previous models. We have also distilled the speech-token-to-mel decoder, previously a bottleneck, reducing generation from 10 steps to just **one**, while retaining high-fidelity audio output.

**Paralinguistic tags** are now native to the Turbo model, allowing you to use `[cough]`, `[laugh]`, `[chuckle]`, and more to add distinct realism. While Turbo was built primarily for low-latency voice agents, it excels at narration and creative workflows.

For the most resource-constrained deployments, **Chatterbox-Nano** shares Turbo's architecture in an even smaller 110M parameter package. It targets on-device and CPU inference — running **3x faster than realtime on 8 CPU cores** — while keeping the same single-step decoder and native paralinguistic tag support. Nano is the recommended model when memory and latency budgets are tightest.

If you like the model but need to scale or tune it for higher accuracy, check out our competitively priced TTS service (<a href="https://resemble.ai">link</a>). It delivers reliable performance with ultra-low latency of sub 200ms—ideal for production use in agents, applications, or interactive media.

<img width="1200" height="600" alt="Podonos Turbo Eval" src="https://storage.googleapis.com/chatterbox-demo-samples/turbo/podonos_turbo.png" />

### ⚡ Model Zoo

Choose the right model for your application.

| Model                                                                                                           | Size | Languages | Key Features                                            | Best For                                     | 🤗                                                                  | Examples |
|:----------------------------------------------------------------------------------------------------------------| :--- | :--- |:--------------------------------------------------------|:---------------------------------------------|:--------------------------------------------------------------------------| :--- |
| **Chatterbox-Turbo**                                                                                            | **350M** | **English** | Paralinguistic Tags (`[laugh]`), Lower Compute and VRAM | Zero-shot voice agents,  Production          | [Demo](https://huggingface.co/spaces/ResembleAI/chatterbox-turbo-demo)        | [Listen](https://resemble-ai.github.io/chatterbox_turbo_demopage/) |
| **Chatterbox-Nano**                                                                                             | **110M** | **English** | Same architecture as Turbo, Paralinguistic Tags, Runs on CPU (3x realtime on 8 cores) | On-device / CPU inference, tight latency & memory budgets | [Model](https://huggingface.co/ResembleAI/chatterbox-nano)        | — |
| **Chatterbox-Multilingual V3** [(Language list)](#supported-languages)                                          | **500M** | **23+** | Improved speaker similarity, reduced hallucinations, more natural multilingual speech | Global applications, localization, cross-language voice cloning | [Demo](https://huggingface.co/spaces/ResembleAI/Chatterbox-Multilingual-TTS) | [Listen](https://resemble-ai.github.io/chatterbox_demopage/) |
| **Single Language Pack** [(Models)](#single-language-pack)                                                      | 500M each | 6 dedicated finetunes | Language- and region-specific quality control           | Priority languages and dialect-sensitive applications | [Models](#single-language-pack) | [Demos](#single-language-pack) |
| Chatterbox [(Tips and Tricks)](#original-chatterbox-tips)                                                       | 500M | English | CFG & Exaggeration tuning                               | General zero-shot TTS with creative controls | [Demo](https://huggingface.co/spaces/ResembleAI/Chatterbox)              | [Listen](https://resemble-ai.github.io/chatterbox_demopage/) |

## Installation
```shell
pip install chatterbox-tts
```

Alternatively, you can install from source:
```shell
# conda create -yn chatterbox python=3.11
# conda activate chatterbox

git clone https://github.com/resemble-ai/chatterbox.git
cd chatterbox
pip install -e .
```
We developed and tested Chatterbox on Python 3.11 on Debian 11 OS; the versions of the dependencies are pinned in `pyproject.toml` to ensure consistency. You can modify the code or dependencies in this installation mode.

## Usage

##### Chatterbox-Turbo

```python
import torchaudio as ta
import torch
from chatterbox.tts_turbo import ChatterboxTurboTTS

# Load the Turbo model
model = ChatterboxTurboTTS.from_pretrained(device="cuda")

# Generate with Paralinguistic Tags
text = "Hi there, Sarah here from MochaFone calling you back [chuckle], have you got one minute to chat about the billing issue?"

# Generate audio (requires a reference clip for voice cloning)
wav = model.generate(text, audio_prompt_path="your_10s_ref_clip.wav")

ta.save("test-turbo.wav", wav, model.sr)
```

##### Chatterbox-Nano

Nano shares Turbo's architecture and is loaded through the same `ChatterboxTurboTTS` class by passing `nano=True`:

```python
import torchaudio as ta
import torch
from chatterbox.tts_turbo import ChatterboxTurboTTS

# Load the Nano model (also runs on CPU: device="cpu")
model = ChatterboxTurboTTS.from_pretrained(device="cuda", nano=True)

# Generate with Paralinguistic Tags
text = "Hi there, Sarah here from MochaFone calling you back [chuckle], have you got one minute to chat about the billing issue?"

# Generate audio (requires a reference clip for voice cloning)
wav = model.generate(text, audio_prompt_path="your_10s_ref_clip.wav")

ta.save("test-nano.wav", wav, model.sr)
```

##### Chatterbox and Chatterbox-Multilingual

```python

import torchaudio as ta
from chatterbox.tts import ChatterboxTTS
from chatterbox.mtl_tts import ChatterboxMultilingualTTS

device = "cuda"  # or "cpu" / "mps"

# English example
model = ChatterboxTTS.from_pretrained(device=device)

text = "Ezreal and Jinx teamed up with Ahri, Yasuo, and Teemo to take down the enemy's Nexus in an epic late-game pentakill."
wav = model.generate(text)
ta.save("test-english.wav", wav, model.sr)

# Multilingual V3 examples
multilingual_model = ChatterboxMultilingualTTS.from_pretrained(device=device, t3_model="v3")
# To use the legacy V2 multilingual checkpoint, omit t3_model or pass t3_model="v2".

french_text = "Bonjour, comment ça va? Ceci est le modèle de synthèse vocale multilingue Chatterbox, il prend en charge 23 langues."
wav_french = multilingual_model.generate(french_text, language_id="fr")
ta.save("test-french.wav", wav_french, multilingual_model.sr)

chinese_text = "你好，今天天气真不错，希望你有一个愉快的周末。"
wav_chinese = multilingual_model.generate(chinese_text, language_id="zh")
ta.save("test-chinese.wav", wav_chinese, multilingual_model.sr)

# If you want to synthesize with a different voice, specify the audio prompt
AUDIO_PROMPT_PATH = "YOUR_FILE.wav"
wav = model.generate(text, audio_prompt_path=AUDIO_PROMPT_PATH)
ta.save("test-2.wav", wav, model.sr)
```
See `example_tts.py`, `example_tts_turbo.py`, `example_tts_nano.py`, and `example_vc.py` for more examples.

## Supported Languages
The general-purpose Chatterbox Multilingual model supports the following languages:

Arabic (ar) • Danish (da) • German (de) • Greek (el) • English (en) • Spanish (es) • Finnish (fi) • French (fr) • Hebrew (he) • Hindi (hi) • Italian (it) • Japanese (ja) • Korean (ko) • Malay (ms) • Dutch (nl) • Norwegian (no) • Polish (pl) • Portuguese (pt) • Russian (ru) • Swedish (sv) • Swahili (sw) • Turkish (tr) • Chinese (zh)

## Single Language Pack

The Single Language Pack provides dedicated finetunes for priority languages and regional variants. Use these when you want stronger language-specific behavior, tighter quality control, or dialect-aware generation beyond the general multilingual model.

| Language | Model Card | Demo Space |
| --- | --- | --- |
| Chinese | [ResembleAI/Chatterbox-Multilingual-zh-cmn](https://huggingface.co/ResembleAI/Chatterbox-Multilingual-zh-cmn) | [Demo](https://huggingface.co/spaces/ResembleAI/Chatterbox-Multilingual-TTS-zh-cmn) |
| Latam Spanish | [ResembleAI/Chatterbox-Multilingual-es-mx-latam](https://huggingface.co/ResembleAI/Chatterbox-Multilingual-es-mx-latam) | [Demo](https://huggingface.co/spaces/ResembleAI/Chatterbox-Multilingual-TTS-es-mx-latam) |
| Brazilian Portuguese | [ResembleAI/Chatterbox-Multilingual-pt-br](https://huggingface.co/ResembleAI/Chatterbox-Multilingual-pt-br) | [Demo](https://huggingface.co/spaces/ResembleAI/Chatterbox-Multilingual-TTS-pt-br) |
| Spain Spanish | [ResembleAI/Chatterbox-Multilingual-es-es](https://huggingface.co/ResembleAI/Chatterbox-Multilingual-es-es) | [Demo](https://huggingface.co/spaces/ResembleAI/Chatterbox-Multilingual-TTS-es-es) |
| Portugal Portuguese | [ResembleAI/Chatterbox-Multilingual-pt-pt](https://huggingface.co/ResembleAI/Chatterbox-Multilingual-pt-pt) | [Demo](https://huggingface.co/spaces/ResembleAI/Chatterbox-Multilingual-TTS-pt-pt) |
| Hindi | [ResembleAI/Chatterbox-Multilingual-hi](https://huggingface.co/ResembleAI/Chatterbox-Multilingual-hi) | [Demo](https://huggingface.co/spaces/ResembleAI/Chatterbox-Multilingual-TTS-hi) |

## Original Chatterbox Tips
- **General Use (TTS and Voice Agents):**
  - Ensure that the reference clip matches the specified language tag. Otherwise, language transfer outputs may inherit the accent of the reference clip’s language. To mitigate this, set `cfg_weight` to `0`.
  - The default settings (`exaggeration=0.5`, `cfg_weight=0.5`) work well for most prompts across all languages.
  - If the reference speaker has a fast speaking style, lowering `cfg_weight` to around `0.3` can improve pacing.

- **Expressive or Dramatic Speech:**
  - Try lower `cfg_weight` values (e.g. `~0.3`) and increase `exaggeration` to around `0.7` or higher.
  - Higher `exaggeration` tends to speed up speech; reducing `cfg_weight` helps compensate with slower, more deliberate pacing.


## Built-in PerTh Watermarking for Responsible AI

Every audio file generated by Chatterbox includes [Resemble AI's Perth (Perceptual Threshold) Watermarker](https://github.com/resemble-ai/perth) - imperceptible neural watermarks that survive MP3 compression, audio editing, and common manipulations while maintaining nearly 100% detection accuracy.


## Watermark extraction

You can look for the watermark using the following script.

```python
import perth
import librosa

AUDIO_PATH = "YOUR_FILE.wav"

# Load the watermarked audio
watermarked_audio, sr = librosa.load(AUDIO_PATH, sr=None)

# Initialize watermarker (same as used for embedding)
watermarker = perth.PerthImplicitWatermarker()

# Extract watermark
watermark = watermarker.get_watermark(watermarked_audio, sample_rate=sr)
print(f"Extracted watermark: {watermark}")
# Output: 0.0 (no watermark) or 1.0 (watermarked)
```


## Official Discord

👋 Join us on [Discord](https://discord.gg/rJq9cRJBJ6) and let's build something awesome together!

## Evaluation
Chatterbox Turbo was evaluated using Podonos, a platform for reproducible subjective speech evaluation.

We compared Chatterbox Turbo to competitive TTS systems using Podonos' standardized evaluation suite, focusing on overall preference, naturalness, and expressiveness.

Evaluation reports:
- [Chatterbox Turbo vs ElevenLabs Turbo v2.5](https://podonos.com/resembleai/chatterbox-turbo-vs-elevenlabs-turbo)
- [Chatterbox Turbo vs Cartesia Sonic 3](https://podonos.com/resembleai/chatterbox-turbo-vs-cartesia-sonic3)
- [Chatterbox Turbo vs VibeVoice 7B](https://podonos.com/resembleai/chatterbox-turbo-vs-vibevoice7b)

These evaluations were conducted under identical conditions and are publicly accessible via Podonos.

## Acknowledgements
- [Podonos](https://podonos.com) — for supporting reproducible subjective speech evaluation
- [Cosyvoice](https://github.com/FunAudioLLM/CosyVoice)
- [Real-Time-Voice-Cloning](https://github.com/CorentinJ/Real-Time-Voice-Cloning)
- [HiFT-GAN](https://github.com/yl4579/HiFTNet)
- [Llama 3](https://github.com/meta-llama/llama3)
- [S3Tokenizer](https://github.com/xingchensong/S3Tokenizer)

## Citation
If you find this model useful, please consider citing.
```
@misc{chatterboxtts2025,
  author       = {{Resemble AI}},
  title        = {{Chatterbox-TTS}},
  year         = {2025},
  howpublished = {\url{https://github.com/resemble-ai/chatterbox}},
  note         = {GitHub repository}
}
```
## Disclaimer
Don't use this model to do bad things. Prompts are sourced from freely available data on the internet.
