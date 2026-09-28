# Prompt for Claude Code

First, copy the whole `stu-avatar-kit` folder into the root of your voice designer project. Then open Claude Code in that project and paste everything below the line.

---

I've added `stu-avatar-kit/` to this repo. Read `stu-avatar-kit/README.md` first. I want every Chatterbox TTS generation in this app to also show Stu, our animated mascot, lip-syncing to the generated audio. He should appear beside the audio output, exactly like `stu-avatar-kit/frontend/demo.html`.

Please:

1. **Explore first.** Find where this app calls Chatterbox and saves the audio, how that audio reaches the UI (endpoint, Gradio output, file path, etc.), and what frontend stack the UI uses. Give me a short summary and your plan before you change anything.

2. **Backend.** Run `python stu-avatar-kit/backend/install_rhubarb.py` and add `backend/tools/` to `.gitignore`. Put `stu_lipsync.py` somewhere importable. Right after each clip is saved, call `make_cues(wav_path, text=<the exact text that was synthesized>)` and return the cues to the frontend along with the audio. Cues can be the JSON itself or a URL to `<clip>.cues.json`. If Rhubarb fails, log it and still return the audio: Stu then falls back to a loudness-based mouth, so generation must never break because of lip sync.

3. **Frontend.** Serve `stu-avatar-kit/frontend/stu-avatar/` (the .js file and `assets/` together) as static files. Load `stu-avatar.js` as an ES module and place `<stu-avatar>` beside the audio player or output.
   - When the user clicks generate, call `stu.unlock()` inside that click handler, then `stu.setPose('think')` while generating.
   - When the clip is ready, call `stu.speak({ audio, cues })`.
   - If the UI has its own audio player, make sure Stu's audio and the player don't both play at once. Either let Stu play it and keep the player for replay, or mute one. Ask me if it's unclear.
   - If the UI is Gradio, use a `gr.HTML` block plus custom JS (`js=` / `head=`) and serve the folder with `gr.set_static_paths` or an equivalent.

4. **Don't modify** the images in `assets/` or the mouth-shape mapping in `stu-avatar.js` unless I ask.

5. **Test it.** Generate one clip end to end, confirm `<clip>.cues.json` was written and non-empty, and confirm the page loads `stu-avatar.js` and all images without 404s. Tell me exactly how to run it so I can watch Stu talk.
