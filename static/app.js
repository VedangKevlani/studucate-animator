const textInput = document.getElementById("text-input");
const wordCount = document.getElementById("word-count");
const generateBtn = document.getElementById("generate-btn");
const errorMessage = document.getElementById("error-message");
const resultsList = document.getElementById("results-list");
const clearHistoryBtn = document.getElementById("clear-history-btn");
const emptyState = document.getElementById("empty-state");
const loadingHistory = document.getElementById("loading-history");
const progress = document.getElementById("progress");
const progressBar = document.getElementById("progress-bar");
const progressLabel = document.getElementById("progress-label");
const stopBtn = document.getElementById("stop-btn");
const themeToggle = document.getElementById("theme-toggle");
const iconSun = themeToggle.querySelector(".icon-sun");
const iconMoon = themeToggle.querySelector(".icon-moon");
const stu = document.getElementById("stu");
const stuStatus = document.getElementById("stu-status");
const teleprompterEl = document.getElementById("teleprompter");
const teleprompter = new Teleprompter(teleprompterEl);

// <stu-avatar> is an ES module, so it's defined after this classic script
// runs. Everything Stu does goes through here - if the module fails to load,
// the designer and its players keep working without him.
const stuReady = customElements.whenDefined("stu-avatar");
const STU_IDLE_STATUS = "Hi, I'm Stu!";
let stuMedia = null;

function stuUnlock() {
	// Must run synchronously inside a click/keypress (browser audio rule).
	if (typeof stu.unlock === "function") {
		stu.unlock();
	}
}

function stuSetPose(pose, status) {
	stuStatus.textContent = status;
	stuReady.then(() => stu.setPose(pose));
}

// Stu lip-syncs to the card's own <audio>, which keeps playing the sound, so
// seek/speed/volume on the card still apply.
function stuFollow(audio, cuesUrl) {
	if (stuMedia === audio) {
		return; // resuming after a pause - already following this clip
	}
	stuMedia = audio;
	stuStatus.textContent = "";
	stuReady
		// Moods drive his poses, so skip the default open-arms opener.
		.then(() => stu.follow(audio, { cues: cuesUrl || null, gesture: false }))
		.catch((err) => console.warn("Stu couldn't lip-sync this clip:", err))
		.finally(() => {
			if (stuMedia === audio) {
				stuMedia = null;
				stuStatus.textContent = STU_IDLE_STATUS;
				stuCalm();
			}
		});
}

// Per-sentence body language: mood.js reads each sentence of the playing
// clip, and Stu switches mood as the teleprompter reaches it.
const MOOD_LABELS = {
	neutral: "",
	happy: "Happy",
	excited: "Excited",
	greeting: "Saying hi",
	reassuring: "Reassuring",
	agree: "Agreeing",
	disagree: "Disagreeing",
	curious: "Curious",
	thoughtful: "Thinking it over",
	surprised: "Surprised",
	sad: "Sad",
	frustrated: "Frustrated",
};
let moodAudio = null;
let moodPlan = [];
let moodIndex = -1;

function stuCalm() {
	moodIndex = -1;
	stuReady.then(() => stu.setMood("neutral"));
}

function startMoods(audio, text) {
	if (moodAudio !== audio) {
		moodAudio = audio;
		moodPlan = analyzeMoods(text);
	}
	moodIndex = -1;
	applyMoodAt(Math.max(teleprompter.current, 0));
}

function applyMoodAt(wordIndex) {
	if (!moodAudio || moodAudio.paused || !moodPlan.length) {
		return;
	}
	let index = 0;
	while (index + 1 < moodPlan.length && moodPlan[index + 1].startToken <= wordIndex) {
		index += 1;
	}
	if (index === moodIndex) {
		return;
	}
	moodIndex = index;
	const { mood, intensity } = moodPlan[index];
	stuStatus.textContent = MOOD_LABELS[mood] ?? "";
	stuReady.then(() => stu.setMood(mood, intensity));
}

teleprompterEl.addEventListener("wordchange", (e) => {
	if (e.detail.audio === moodAudio) {
		applyMoodAt(e.detail.index);
	}
});

function pauseOtherClips(current) {
	document.querySelectorAll(".player__audio").forEach((other) => {
		if (other !== current && !other.paused) {
			other.pause();
		}
	});
}

const THEME_KEY = "studucate-theme";

function applyTheme(theme) {
	document.documentElement.setAttribute("data-theme", theme);
	iconSun.hidden = theme === "dark";
	iconMoon.hidden = theme !== "dark";
	themeToggle.setAttribute("aria-label", theme === "dark" ? "Switch to light mode" : "Switch to dark mode");
}

function initTheme() {
	let stored = null;
	try {
		stored = localStorage.getItem(THEME_KEY);
	} catch (err) {
		// Storage unavailable (private mode, etc.) - fall back to system preference.
	}
	const systemTheme = window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
	applyTheme(stored || systemTheme);
}

themeToggle.addEventListener("click", () => {
	const next = document.documentElement.getAttribute("data-theme") === "dark" ? "light" : "dark";
	applyTheme(next);
	try {
		localStorage.setItem(THEME_KEY, next);
	} catch (err) {
		// Ignore - theme just won't persist across reloads.
	}
});

initTheme();

const POLL_INTERVAL_MS = 700;

function countWords(text) {
	const trimmed = text.trim();
	return trimmed ? trimmed.split(/\s+/).length : 0;
}

function updateWordCount() {
	const words = countWords(textInput.value);
	wordCount.textContent = `${words} word${words === 1 ? "" : "s"}`;
}

function setLoading(loading) {
	generateBtn.disabled = loading;
	generateBtn.classList.toggle("btn--loading", loading);
}

function showError(message) {
	errorMessage.textContent = message;
	errorMessage.classList.remove("error--neutral");
	errorMessage.hidden = false;
}

function showNotice(message) {
	errorMessage.textContent = message;
	errorMessage.classList.add("error--neutral");
	errorMessage.hidden = false;
}

function clearError() {
	errorMessage.hidden = true;
	errorMessage.textContent = "";
	errorMessage.classList.remove("error--neutral");
}

function showProgress() {
	progress.hidden = false;
	progressBar.classList.add("progress__bar--indeterminate");
	progressBar.style.width = "";
	progressLabel.textContent = "Generating...";
	stopBtn.disabled = false;
	stopBtn.textContent = "Stop";
}

function updateProgress(completed, total) {
	if (!total) {
		return;
	}
	const percent = Math.round((completed / total) * 100);
	progressBar.classList.remove("progress__bar--indeterminate");
	progressBar.style.width = `${percent}%`;
	progressLabel.textContent = `${percent}% - part ${completed} of ${total}`;
}

function hideProgress() {
	progress.hidden = true;
}

function escapeHtml(str) {
	const div = document.createElement("div");
	div.textContent = str;
	return div.innerHTML;
}

const ICON_PLAY = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M7 4l14 8-14 8V4z"/></svg>';
const ICON_PAUSE = '<svg viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>';
const ICON_VOLUME = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M4 9v6h4l5 5V4L8 9H4z"/><path d="M16.5 8.5a5 5 0 010 7" stroke="currentColor" stroke-width="1.8" fill="none" stroke-linecap="round"/></svg>';
const ICON_MUTED = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M4 9v6h4l5 5V4L8 9H4z"/><path d="M16 9l5 6M21 9l-5 6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>';

function formatTime(seconds) {
	if (!isFinite(seconds) || seconds < 0) {
		return "0:00";
	}
	const mins = Math.floor(seconds / 60);
	const secs = Math.floor(seconds % 60);
	return `${mins}:${String(secs).padStart(2, "0")}`;
}

function slugify(text) {
	const words = text.trim().split(/\s+/).slice(0, 6).join(" ");
	const slug = words.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-+|-+$)/g, "");
	return slug || "chatterbox-clip";
}

async function downloadClip(url, suggestedName) {
	const input = window.prompt("Save as", suggestedName);
	if (!input) {
		return;
	}
	const filename = input.toLowerCase().endsWith(".mp3") ? input : `${input}.mp3`;

	if (window.showSaveFilePicker) {
		try {
			const handle = await window.showSaveFilePicker({
				suggestedName: filename,
				types: [{ description: "MP3 audio", accept: { "audio/mpeg": [".mp3"] } }],
			});
			const response = await fetch(url);
			const blob = await response.blob();
			const writable = await handle.createWritable();
			await writable.write(blob);
			await writable.close();
			return;
		} catch (err) {
			if (err.name === "AbortError") {
				return;
			}
			// Fall through to the plain-download fallback below.
		}
	}

	const a = document.createElement("a");
	a.href = url;
	a.download = filename;
	document.body.appendChild(a);
	a.click();
	a.remove();
}

function initPlayer(card, url, cuesUrl, text) {
	const audio = card.querySelector(".player__audio");
	const toggleBtn = card.querySelector(".player__toggle");
	const seek = card.querySelector(".player__seek");
	const timeLabel = card.querySelector(".player__time");
	const speed = card.querySelector(".player__speed");
	const muteBtn = card.querySelector(".player__mute");
	const volume = card.querySelector(".player__volume");
	let scrubbing = false;

	function setPlayIcon(playing) {
		toggleBtn.innerHTML = playing ? ICON_PAUSE : ICON_PLAY;
		toggleBtn.setAttribute("aria-label", playing ? "Pause" : "Play");
	}

	toggleBtn.addEventListener("click", () => {
		stuUnlock();
		if (audio.paused) {
			audio.play().catch((err) => {
				showError(`Couldn't play this clip: ${err.message}`);
			});
		} else {
			audio.pause();
		}
	});

	audio.addEventListener("play", () => {
		setPlayIcon(true);
		pauseOtherClips(audio);
		card.classList.add("result-card--playing");
		teleprompter.follow(audio, text, cuesUrl);
		stuFollow(audio, cuesUrl);
		// After stuFollow: starting to follow resets his pose, so moods go on top.
		startMoods(audio, text);
	});
	audio.addEventListener("pause", () => {
		setPlayIcon(false);
		card.classList.remove("result-card--playing");
		if (moodAudio === audio) {
			stuCalm();
			if (stuMedia === audio) {
				stuStatus.textContent = "";
			}
		}
	});
	audio.addEventListener("ended", () => setPlayIcon(false));

	audio.addEventListener("loadedmetadata", () => {
		seek.max = audio.duration;
		timeLabel.textContent = `0:00 / ${formatTime(audio.duration)}`;
	});

	audio.addEventListener("timeupdate", () => {
		if (!scrubbing) {
			seek.value = audio.currentTime;
		}
		timeLabel.textContent = `${formatTime(audio.currentTime)} / ${formatTime(audio.duration)}`;
	});

	seek.addEventListener("input", () => {
		scrubbing = true;
		timeLabel.textContent = `${formatTime(seek.value)} / ${formatTime(audio.duration)}`;
	});
	seek.addEventListener("change", () => {
		audio.currentTime = seek.value;
		scrubbing = false;
	});

	speed.addEventListener("change", () => {
		audio.playbackRate = parseFloat(speed.value);
	});

	volume.addEventListener("input", () => {
		audio.volume = parseFloat(volume.value);
		audio.muted = audio.volume === 0;
		muteBtn.innerHTML = audio.muted ? ICON_MUTED : ICON_VOLUME;
	});

	muteBtn.addEventListener("click", () => {
		audio.muted = !audio.muted;
		muteBtn.innerHTML = audio.muted ? ICON_MUTED : ICON_VOLUME;
		if (!audio.muted && audio.volume === 0) {
			audio.volume = 1;
			volume.value = 1;
		}
	});
}

// ---------- video download ----------
// Each card can render Stu saying its clip as an MP4 (see video-export.js).
// The shape and captions choice is remembered per browser.

const VIDEO_PREFS_KEY = "studucate-video-prefs";
const VIDEO_FORMATS = [
	{ id: "square", label: "Square", detail: "1:1" },
	{ id: "vertical", label: "Vertical", detail: "9:16" },
	{ id: "landscape", label: "Landscape", detail: "16:9" },
];
let videoPanelCount = 0;
let videoServerCheck = null;

// Whether the server can build videos. An older server.py still running
// won't have the endpoint - better to say so than render for nothing.
function checkVideoServer() {
	if (!videoServerCheck) {
		videoServerCheck = fetch("/api/video")
			.then((response) => response.ok)
			.catch(() => false);
	}
	return videoServerCheck;
}

function loadVideoPrefs() {
	try {
		return { format: "square", captions: false, ...JSON.parse(localStorage.getItem(VIDEO_PREFS_KEY) || "{}") };
	} catch (err) {
		return { format: "square", captions: false };
	}
}

function saveVideoPrefs(prefs) {
	try {
		localStorage.setItem(VIDEO_PREFS_KEY, JSON.stringify(prefs));
	} catch (err) {
		// Not persisted - fine.
	}
}

function videoPanelHtml() {
	videoPanelCount += 1;
	const name = `video-format-${videoPanelCount}`;
	const prefs = loadVideoPrefs();
	const formats = VIDEO_FORMATS.map((f) => `
		<label class="video-export__format">
			<input type="radio" name="${name}" value="${f.id}"${f.id === prefs.format ? " checked" : ""} />
			<span>${f.label}<small>${f.detail}</small></span>
		</label>`).join("");
	return `
		<div class="video-export" hidden>
			<fieldset class="video-export__formats">
				<legend class="video-export__legend">Shape</legend>
				${formats}
			</fieldset>
			<label class="video-export__captions">
				<input type="checkbox" class="video-export__captions-input"${prefs.captions ? " checked" : ""} />
				Captions
			</label>
			<div class="video-export__actions">
				<button class="btn btn--primary btn--small video-export__render" type="button">Render video</button>
				<span class="hint video-export__status" aria-live="polite"></span>
			</div>
			<div class="progress__track video-export__track" hidden>
				<div class="progress__bar video-export__bar"></div>
			</div>
		</div>`;
}

function initVideoPanel(card, clip) {
	const toggle = card.querySelector(".result-card__video-toggle");
	const panel = card.querySelector(".video-export");
	const renderBtn = card.querySelector(".video-export__render");
	const status = card.querySelector(".video-export__status");
	const track = card.querySelector(".video-export__track");
	const bar = card.querySelector(".video-export__bar");
	const captionsInput = card.querySelector(".video-export__captions-input");

	if (typeof VideoEncoder === "undefined") {
		toggle.disabled = true;
		toggle.title = "Video download needs a recent Chrome, Edge or Safari.";
	}

	toggle.addEventListener("click", async () => {
		panel.hidden = !panel.hidden;
		toggle.setAttribute("aria-expanded", String(!panel.hidden));
		if (!panel.hidden && !(await checkVideoServer())) {
			renderBtn.disabled = true;
			status.classList.add("video-export__status--error");
			status.textContent = "The server needs a restart to make videos (it's running an older version).";
		}
	});

	renderBtn.addEventListener("click", async () => {
		const format = card.querySelector(".video-export__formats input:checked").value;
		const captions = captionsInput.checked;
		saveVideoPrefs({ format, captions });
		const filename = `${slugify(clip.text)}-${format}.mp4`;

		// Ask where to save now: browsers only allow the save dialog straight
		// from a click, and rendering takes a while.
		let handle = null;
		if (window.showSaveFilePicker) {
			try {
				handle = await window.showSaveFilePicker({
					suggestedName: filename,
					types: [{ description: "MP4 video", accept: { "video/mp4": [".mp4"] } }],
				});
			} catch (err) {
				if (err.name === "AbortError") {
					return;
				}
			}
		}

		renderBtn.disabled = true;
		toggle.disabled = true;
		track.hidden = false;
		bar.style.width = "0%";
		status.classList.remove("video-export__status--error");
		status.textContent = "Preparing...";
		try {
			const { exportVideo } = await import("/static/video-export.js");
			const blob = await exportVideo({
				audioUrl: clip.url,
				cuesUrl: clip.cuesUrl,
				text: clip.text,
				format,
				captions,
				onProgress: (fraction, label) => {
					bar.style.width = `${Math.round(fraction * 100)}%`;
					status.textContent = `${label} ${Math.round(fraction * 100)}%`;
				},
			});
			if (handle) {
				const writable = await handle.createWritable();
				await writable.write(blob);
				await writable.close();
			} else {
				const a = document.createElement("a");
				a.href = URL.createObjectURL(blob);
				a.download = filename;
				document.body.appendChild(a);
				a.click();
				a.remove();
				setTimeout(() => URL.revokeObjectURL(a.href), 60000);
			}
			status.textContent = "Video saved.";
		} catch (err) {
			status.classList.add("video-export__status--error");
			status.textContent = err.message || "Couldn't render the video.";
			// The save dialog already created the file - don't leave it empty.
			if (handle && handle.remove) {
				handle.remove().catch(() => {});
			}
		} finally {
			renderBtn.disabled = false;
			toggle.disabled = false;
			track.hidden = true;
		}
	});
}

function addResult({ url, text, cuesUrl }) {
	clearHistoryBtn.hidden = false;
	emptyState.hidden = true;

	const li = document.createElement("li");
	li.className = "result-card";

	li.innerHTML = `
		<div class="player">
			<button class="icon-btn player__toggle" type="button" aria-label="Play">${ICON_PLAY}</button>
			<div class="player__main">
				<input type="range" class="player__seek" min="0" max="0" value="0" step="0.01" />
				<div class="player__meta">
					<span class="player__time">0:00 / 0:00</span>
					<div class="player__right">
						<select class="player__speed" aria-label="Playback speed">
							<option value="0.5">0.5x</option>
							<option value="0.75">0.75x</option>
							<option value="1" selected>1x</option>
							<option value="1.25">1.25x</option>
							<option value="1.5">1.5x</option>
							<option value="2">2x</option>
						</select>
						<button class="icon-btn player__mute" type="button" aria-label="Mute">${ICON_VOLUME}</button>
						<input type="range" class="player__volume" min="0" max="1" step="0.05" value="1" />
					</div>
				</div>
			</div>
			<audio class="player__audio" preload="metadata" src="${url}"></audio>
		</div>
		<p class="result-card__text">${escapeHtml(text)}</p>
		<div class="result-card__footer">
			<button class="btn btn--ghost result-card__video-toggle" type="button" aria-expanded="false">Download video</button>
			<button class="btn btn--ghost result-card__download" type="button">Download audio</button>
		</div>
		${videoPanelHtml()}
	`;

	li.querySelector(".result-card__download").addEventListener("click", () => {
		downloadClip(url, `${slugify(text)}.mp3`);
	});
	initVideoPanel(li, { url, cuesUrl, text });

	resultsList.prepend(li);
	initPlayer(li, url, cuesUrl, text);
	return li;
}

function pollJob(jobId, text) {
	return new Promise((resolve, reject) => {
		const timer = setInterval(async () => {
			try {
				const response = await fetch(`/api/generate/${jobId}`);
				const job = await response.json();

				if (!response.ok) {
					throw new Error(job.error || "Something went wrong.");
				}

				updateProgress(job.completed, job.total);
				if (job.status === "running" && job.stage === "lipsync") {
					progressLabel.textContent = "Syncing Stu's lips...";
					// Audio is already finished at this point - nothing left to stop.
					stopBtn.disabled = true;
				}

				if (job.status === "done") {
					clearInterval(timer);
					resolve({ url: job.url, text, cuesUrl: job.cues_url });
				} else if (job.status === "cancelled") {
					clearInterval(timer);
					resolve(null);
				} else if (job.status === "error") {
					clearInterval(timer);
					reject(new Error(job.error || "Generation failed."));
				}
			} catch (err) {
				clearInterval(timer);
				reject(err);
			}
		}, POLL_INTERVAL_MS);
	});
}

let currentJobId = null;

async function generate() {
	const text = textInput.value.trim();
	clearError();

	if (!text) {
		showError("Enter some text first.");
		return;
	}

	stuUnlock();
	stuSetPose("think", "Thinking...");
	teleprompter.preview(text);
	setLoading(true);
	showProgress();
	let spoke = false;
	try {
		const response = await fetch("/api/generate", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ text }),
		});
		const data = await response.json();

		if (!response.ok) {
			throw new Error(data.error || "Something went wrong.");
		}

		currentJobId = data.job_id;
		const result = await pollJob(data.job_id, text);
		if (result) {
			const card = addResult(result);
			textInput.value = "";
			updateWordCount();
			// Play the new clip right away; the card's "play" handler hands it to Stu.
			const audio = card.querySelector(".player__audio");
			spoke = true;
			audio.play().catch(() => {
				stuSetPose("idle", STU_IDLE_STATUS);
				showNotice("Clip ready - press play to hear it.");
			});
		} else {
			showNotice("Generation stopped.");
		}
	} catch (err) {
		showError(err.message);
	} finally {
		if (!spoke) {
			stuSetPose("idle", STU_IDLE_STATUS);
			teleprompter.reset();
		}
		setLoading(false);
		hideProgress();
		currentJobId = null;
	}
}

stopBtn.addEventListener("click", async () => {
	if (!currentJobId) {
		return;
	}
	// Cancellation only takes effect between chunks, not instantly - stays
	// disabled/relabeled until generate() hides the whole progress area.
	stopBtn.disabled = true;
	stopBtn.textContent = "Stopping...";
	await fetch(`/api/generate/${currentJobId}/cancel`, { method: "POST" });
});

textInput.addEventListener("input", updateWordCount);
generateBtn.addEventListener("click", generate);
textInput.addEventListener("keydown", (e) => {
	if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
		generate();
	}
});

clearHistoryBtn.addEventListener("click", async () => {
	if (!window.confirm("Delete all saved generations? This can't be undone.")) {
		return;
	}
	try {
		const response = await fetch("/api/history", { method: "DELETE" });
		if (!response.ok) {
			const data = await response.json().catch(() => ({}));
			throw new Error(data.error || "Couldn't clear history.");
		}
		pauseOtherClips(null);
		teleprompter.reset();
		resultsList.innerHTML = "";
		clearHistoryBtn.hidden = true;
		emptyState.hidden = false;
	} catch (err) {
		showError(err.message);
	}
});

async function loadHistory() {
	try {
		const response = await fetch("/api/history");
		const history = await response.json();
		history.forEach((item) => addResult({ url: item.url, text: item.text, cuesUrl: item.cues_url }));
	} catch (err) {
		// History is a nice-to-have; ignore failures.
	} finally {
		loadingHistory.hidden = true;
		if (resultsList.children.length === 0) {
			emptyState.hidden = false;
		}
	}
}

loadHistory();
