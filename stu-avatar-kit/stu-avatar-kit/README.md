# Stu avatar kit

Stu lip-syncs to any Chatterbox clip, just like the demo.

Every time your voice designer generates a clip, the server also makes a timing file for Stu's mouth. The page then plays both with the `<stu-avatar>` component.

```
Chatterbox → line.wav ──► stu_lipsync.make_cues() ──► line.cues.json
                 │                                        │
                 └──────────► <stu-avatar>.speak({ audio, cues }) ◄┘
```

Everything here is free: Rhubarb Lip Sync is MIT-licensed, and the component has no dependencies.

## What's inside

| Path | What it is |
|---|---|
| `frontend/stu-avatar/stu-avatar.js` | The `<stu-avatar>` web component. It works in plain HTML, React, Vue and so on. |
| `frontend/stu-avatar/assets/` | Stu's poses, 7 mouth shapes and closed-eye overlays. Keep them next to the .js file. |
| `frontend/demo.html` | A standalone test page. |
| `backend/stu_lipsync.py` | `make_cues(wav, text=...)` runs Rhubarb and writes `<name>.cues.json`. |
| `backend/install_rhubarb.py` | Downloads Rhubarb for your OS (Windows, macOS or Linux) into `backend/tools/`. |
| `backend/example_chatterbox.py` | A reference: Chatterbox generation followed by `make_cues`. |
| `samples/` | Your sample line and its timing file. |
| `CLAUDE_CODE_PROMPT.md` | A prompt to paste into Claude Code inside your voice designer project. |

## Try it in 1 minute

```bash
cd stu-avatar-kit
python -m http.server 8000
# open http://localhost:8000/frontend/demo.html
```

The page has to be served over http. It won't work when opened as a file.

## Backend: one extra call after each clip

```bash
python backend/install_rhubarb.py        # once
```

```python
from stu_lipsync import make_cues

ta.save(wav_path, wav, model.sr)          # your existing Chatterbox save
make_cues(wav_path, text=text)            # new: writes <wav_path>.cues.json
```

- Pass the exact `text` Stu spoke. You already have it at generation time, and it makes the timing much more accurate.
- It takes about a second per line on a laptop. Mp3 or flac input needs `ffmpeg` on the PATH; WAV works without it.
- If `rhubarb` lives somewhere else, set `RHUBARB_PATH` to its location.
- For languages other than English, call `make_cues(..., recognizer="phonetic")`.

## Frontend

```html
<script type="module" src="/static/stu-avatar/stu-avatar.js"></script>
<stu-avatar id="stu" style="max-width:360px"></stu-avatar>

<script type="module">
  const stu = document.getElementById('stu');
  generateButton.addEventListener('click', async () => {
    stu.unlock();                           // must happen inside the click (browser audio rule)
    stu.setPose('think');                   // optional: "thinking" while the clip generates
    const { audio, cues } = await yourGenerateCall();
    await stu.speak({ audio, cues });       // resolves when he finishes talking
  });
</script>
```

**API**

- `speak({ audio, cues, gesture })` returns a Promise.
  - `audio` can be a URL, Blob, ArrayBuffer or AudioBuffer.
  - `cues` can be the JSON object, its `mouthCues` array, or a URL to the .cues.json file.
  - Without cues, the mouth follows loudness only, which is less accurate.
  - `gesture: false` skips the open-arms opening.
- `stop()`, `setPose('idle' | 'open' | 'think')` and `unlock()`.
- Events: `speakstart` and `speakend`. `speakend` carries `detail.interrupted`.
- Attributes: `assets="/path/to/assets/"`, `pose`, `gestures="off"`, `motion="off"`.
- CSS: set the size with `width` or `max-width` on the element. `--stu-shadow` sets the floor shadow colour.

**React:** `<stu-avatar ref={ref} />` and then `ref.current.speak(...)`. Import the .js file once, for example in `main.jsx`.

**Mobile app:** show a page containing `<stu-avatar>` in a WebView. The same files work as-is.

## How the mouth shapes map

Rhubarb outputs a letter for each moment of speech. The component shows these images:

| Rhubarb | Sounds | Stu mouth |
|---|---|---|
| X, A | silence, M B P | rest (closed smile) |
| B | most consonants, "ee" | small open with teeth (mid if held) |
| C, H | "eh", "ae", L | mid |
| D | "ah" | open (wide if held) |
| E, F | "oh", "oo", W | round |
| G | F, V | grin (teeth on lip) |

To change the mapping, edit `RHUBARB` at the top of `stu-avatar.js`.

## Adding more poses later

1. Generate the new pose **without a mouth**, with the same framing as the idle image.
2. Crop it the same way: 1024×1024 source, crop box (170,160)–(860,910).
3. Add it to `POSES` in `stu-avatar.js`.

The mouths line up automatically as long as the face stays in the same place.
