import json
import logging
import mimetypes
import os
import re
import subprocess
import tempfile
import threading
import time
import uuid
from pathlib import Path

from flask import Flask, Response, jsonify, request, send_from_directory

from stu_lipsync import make_cues
from tts_engine import GenerationCancelled, TTSEngine

BASE_DIR = Path(__file__).resolve().parent
OUTPUT_DIR = BASE_DIR / "outputs"
OUTPUT_DIR.mkdir(exist_ok=True)
STATIC_DIR = BASE_DIR / "static"
HISTORY_PATH = OUTPUT_DIR / "history.json"
HISTORY_LIMIT = 50

MAX_CHARS = 5000

# Video export: the browser renders and encodes Stu's animation; this caps the
# upload (a minute of 1080p at the encoder's bitrate is ~50MB).
MAX_VIDEO_BYTES = 400 * 1024 * 1024
CLIP_NAME = re.compile(r"^[0-9a-f]{32}\.mp3$")

# Windows' MIME registry often lacks .webp, which Stu's pose images use.
mimetypes.add_type("image/webp", ".webp")

# Rhubarb recognizer for Stu's lip-sync cues. "pocketSphinx" is the most
# accurate for English but runs at roughly real time on CPU; "phonetic" is
# ~4x faster and language-independent, with slightly looser timing.
LIPSYNC_RECOGNIZER = os.environ.get("STU_LIPSYNC_RECOGNIZER", "pocketSphinx")

log = logging.getLogger(__name__)

app = Flask(__name__, static_folder=None)
engine = TTSEngine()

jobs = {}
cancel_events = {}
jobs_lock = threading.Lock()
history_lock = threading.Lock()


def load_history():
	if not HISTORY_PATH.exists():
		return []
	try:
		return json.loads(HISTORY_PATH.read_text(encoding="utf-8"))
	except (json.JSONDecodeError, OSError):
		return []


def append_history(record):
	with history_lock:
		history = load_history()
		history.append(record)
		history = history[-HISTORY_LIMIT:]
		HISTORY_PATH.write_text(json.dumps(history), encoding="utf-8")


def write_cues(output_path, text):
	"""Write <clip>.cues.json for <stu-avatar> and return its URL, or None if
	lip sync failed - the clip must still be delivered, and Stu falls back to a
	loudness-based mouth without cues."""
	# Paralinguistic tags like [chuckle] aren't spoken as words, so leave them
	# out of the transcript Rhubarb aligns against.
	spoken = re.sub(r"\[[^\]]*\]", " ", text)
	try:
		make_cues(output_path, text=spoken, recognizer=LIPSYNC_RECOGNIZER)
	except Exception:
		log.exception("Lip sync failed for %s", output_path.name)
		return None
	return f"/outputs/{output_path.with_suffix('.cues.json').name}"


def run_job(job_id, text, output_path):
	def on_progress(done, total):
		with jobs_lock:
			jobs[job_id]["completed"] = done
			jobs[job_id]["total"] = total

	stop_event = cancel_events[job_id]

	try:
		engine.generate_to_file(
			text, str(output_path),
			on_progress=on_progress,
			should_stop=stop_event.is_set,
		)
		url = f"/outputs/{output_path.name}"
		with jobs_lock:
			jobs[job_id]["stage"] = "lipsync"
		cues_url = write_cues(output_path, text)
		with jobs_lock:
			jobs[job_id]["status"] = "done"
			jobs[job_id]["url"] = url
			jobs[job_id]["cues_url"] = cues_url
		append_history({
			"id": job_id,
			"text": text,
			"url": url,
			"cues_url": cues_url,
			"created_at": jobs[job_id]["created_at"],
		})
	except GenerationCancelled:
		with jobs_lock:
			jobs[job_id]["status"] = "cancelled"
		output_path.unlink(missing_ok=True)
	except Exception as exc:
		with jobs_lock:
			jobs[job_id]["status"] = "error"
			jobs[job_id]["error"] = str(exc)
	finally:
		cancel_events.pop(job_id, None)


@app.get("/")
def index():
	return send_from_directory(STATIC_DIR, "index.html")


@app.get("/static/<path:filename>")
def static_files(filename):
	return send_from_directory(STATIC_DIR, filename)


@app.get("/outputs/<path:filename>")
def output_files(filename):
	return send_from_directory(OUTPUT_DIR, filename)


@app.get("/api/video")
def video_available():
	"""Lets the page check this server can build videos before rendering."""
	return jsonify({"ok": True})


@app.post("/api/video")
def build_video():
	"""Mux a browser-rendered animation with its clip's voice into an MP4.

	Body: the encoded video stream - raw H.264 (Annex B) or VP9 in IVF, per
	?codec=h264|vp9. ?clip=<id>.mp3 names the generated clip whose audio goes
	in. Returns the MP4 (H.264 + AAC, fast-start so it plays while loading)."""
	clip = request.args.get("clip", "")
	codec = request.args.get("codec", "")
	fps = request.args.get("fps", "30")
	if not CLIP_NAME.match(clip) or not (OUTPUT_DIR / clip).exists():
		return jsonify({"error": "Unknown clip."}), 404
	if codec not in ("h264", "vp9") or not fps.isdigit() or not 1 <= int(fps) <= 60:
		return jsonify({"error": "Unsupported video stream."}), 400
	if not request.content_length or request.content_length > MAX_VIDEO_BYTES:
		return jsonify({"error": "Video is empty or too large."}), 413

	with tempfile.TemporaryDirectory() as tmp:
		tmp = Path(tmp)
		video_in = tmp / ("video.h264" if codec == "h264" else "video.ivf")
		video_in.write_bytes(request.get_data())
		out = tmp / "out.mp4"
		# A raw H.264 stream has no timestamps: give it the frame rate and
		# generate them.
		video_input = ["-fflags", "+genpts", "-f", "h264", "-framerate", fps, "-i", str(video_in)] if codec == "h264" else ["-i", str(video_in)]
		# H.264 from the browser is copied as-is; VP9 is re-encoded so the MP4
		# plays everywhere.
		video_codec = ["-c:v", "copy"] if codec == "h264" else ["-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p"]
		cmd = [
			"ffmpeg", "-y", "-loglevel", "error",
			*video_input,
			"-i", str(OUTPUT_DIR / clip),
			"-map", "0:v:0", "-map", "1:a:0",
			*video_codec,
			# No -shortest: with a raw H.264 input it drops the audio track. The
			# browser renders exactly the clip's length anyway.
			"-c:a", "aac", "-b:a", "128k",
			"-movflags", "+faststart",
			str(out),
		]
		result = subprocess.run(cmd, capture_output=True, text=True)
		if result.returncode != 0 or not out.exists():
			log.error("Video mux failed for %s: %s", clip, result.stderr.strip())
			return jsonify({"error": "Couldn't add the voice to the video."}), 500
		data = out.read_bytes()
	return Response(data, mimetype="video/mp4")


@app.get("/api/status")
def status():
	return jsonify({"ready": engine._model is not None})


@app.post("/api/generate")
def generate():
	data = request.get_json(silent=True) or {}
	text = (data.get("text") or "").strip()

	if not text:
		return jsonify({"error": "Enter some text first."}), 400
	if len(text) > MAX_CHARS:
		return jsonify({"error": f"Text is too long (max {MAX_CHARS} characters)."}), 400

	job_id = uuid.uuid4().hex
	output_path = OUTPUT_DIR / f"{job_id}.mp3"

	with jobs_lock:
		jobs[job_id] = {
			"status": "running",
			"completed": 0,
			"total": None,
			"text": text,
			"url": None,
			"cues_url": None,
			"stage": "generating",
			"error": None,
			"created_at": time.time(),
		}
	cancel_events[job_id] = threading.Event()

	threading.Thread(target=run_job, args=(job_id, text, output_path), daemon=True).start()
	return jsonify({"job_id": job_id})


@app.get("/api/generate/<job_id>")
def job_status(job_id):
	with jobs_lock:
		job = jobs.get(job_id)
		if job is None:
			return jsonify({"error": "Unknown job."}), 404
		return jsonify(job)


@app.post("/api/generate/<job_id>/cancel")
def cancel_job(job_id):
	with jobs_lock:
		job = jobs.get(job_id)
		if job is None:
			return jsonify({"error": "Unknown job."}), 404
		if job["status"] != "running":
			return jsonify({"error": "Job already finished."}), 400
		event = cancel_events.get(job_id)
	if event is not None:
		event.set()
	return jsonify({"ok": True})


@app.get("/api/history")
def history():
	return jsonify(load_history())


@app.delete("/api/history")
def clear_history():
	with history_lock:
		for record in load_history():
			file_path = OUTPUT_DIR / Path(record["url"]).name
			file_path.unlink(missing_ok=True)
			file_path.with_suffix(".cues.json").unlink(missing_ok=True)
		HISTORY_PATH.unlink(missing_ok=True)
	return jsonify({"ok": True})


if __name__ == "__main__":
	# Warm the model up in the background so the first click from the UI
	# doesn't have to eat the (slow) model + reference-conditioning load.
	threading.Thread(target=engine.ensure_loaded, daemon=True).start()
	# HOST=0.0.0.0 is required in a container (Render/HF Spaces) so the
	# platform's proxy can reach the process; local dev keeps 127.0.0.1.
	host = os.environ.get("HOST", "127.0.0.1")
	port = int(os.environ.get("PORT", 7860))
	app.run(host=host, port=port, threaded=True)
