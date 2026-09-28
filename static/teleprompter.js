// Teleprompter: shows the line Stu is reading and scrolls it in time with the
// clip. Rhubarb cues describe mouth shapes, not words, so word start times are
// estimated: each word gets a share of the clip's speaking time proportional
// to its length, and the silent stretches in the cues (pauses between
// sentences and between generation chunks) are skipped over. Without cues
// (older clips, or Rhubarb failed) the whole clip counts as speaking time.

const TELEPROMPTER_MIN_PAUSE = 0.2; // seconds of 'X' (silence) that split speech
const TELEPROMPTER_TAG_WEIGHT = 8; // a [chuckle] etc. takes about as long as an 8-letter word

class Teleprompter {
	constructor(root) {
		this.root = root;
		this.viewport = root.querySelector(".teleprompter__viewport");
		this.textEl = root.querySelector(".teleprompter__text");
		this.placeholder = root.querySelector(".teleprompter__placeholder");
		this.audio = null;
		this.words = [];
		this.weights = [];
		this.cues = null;
		this.times = null;
		this.current = -1;
		this.raf = 0;
		this.onPlay = () => this.loop();
		this.onSeek = () => this.update();
		window.addEventListener("resize", () => this.scrollToCurrent());
	}

	// Show a line before its clip exists (while it's generating).
	preview(text) {
		this.detach();
		this.render(text);
		this.root.classList.add("teleprompter--preview");
	}

	// Track a card's <audio>. Called from its "play" handler, so it's playing.
	follow(audio, text, cuesUrl) {
		if (audio === this.audio) {
			return;
		}
		this.detach();
		this.render(text);
		this.audio = audio;
		audio.addEventListener("play", this.onPlay);
		audio.addEventListener("seeked", this.onSeek);
		audio.addEventListener("ended", this.onSeek);
		audio.addEventListener("loadedmetadata", this.onSeek);
		if (cuesUrl) {
			fetch(cuesUrl)
				.then((response) => (response.ok ? response.json() : null))
				.then((data) => {
					if (this.audio === audio && data && Array.isArray(data.mouthCues)) {
						this.cues = data.mouthCues;
						this.times = null;
						this.update();
					}
				})
				.catch(() => {
					// Keep the duration-only estimate.
				});
		}
		this.loop();
	}

	reset() {
		this.detach();
		this.render("");
	}

	detach() {
		cancelAnimationFrame(this.raf);
		if (this.audio) {
			this.audio.removeEventListener("play", this.onPlay);
			this.audio.removeEventListener("seeked", this.onSeek);
			this.audio.removeEventListener("ended", this.onSeek);
			this.audio.removeEventListener("loadedmetadata", this.onSeek);
			this.audio = null;
		}
		this.root.classList.remove("teleprompter--preview");
	}

	render(text) {
		this.textEl.textContent = "";
		this.words = [];
		this.weights = [];
		this.cues = null;
		this.times = null;
		this.current = -1;
		// Keep [bracketed tags] whole - "[clear throat]" is one token.
		for (const token of text.match(/\[[^\]]*\]|\S+/g) || []) {
			const isTag = token.startsWith("[") && token.endsWith("]");
			const span = document.createElement("span");
			span.className = isTag ? "teleprompter__word teleprompter__tag" : "teleprompter__word";
			span.textContent = token;
			if (this.words.length) {
				this.textEl.append(" ");
			}
			this.textEl.append(span);
			this.words.push(span);
			this.weights.push(wordWeight(token));
		}
		this.placeholder.hidden = this.words.length > 0;
		this.textEl.style.transform = "translateY(0)";
	}

	loop() {
		cancelAnimationFrame(this.raf);
		const tick = () => {
			this.update();
			if (this.audio && !this.audio.paused) {
				this.raf = requestAnimationFrame(tick);
			}
		};
		tick();
	}

	update() {
		const audio = this.audio;
		if (!audio || !this.words.length) {
			return;
		}
		if (!this.times) {
			this.times = this.computeTimes(audio.duration);
			if (!this.times) {
				return; // duration not known yet - "loadedmetadata" retries
			}
		}
		if (audio.ended) {
			this.setCurrent(this.words.length);
			return;
		}
		const t = audio.currentTime;
		let index = -1;
		while (index + 1 < this.times.length && this.times[index + 1] <= t) {
			index += 1;
		}
		this.setCurrent(index);
	}

	computeTimes(duration) {
		return estimateWordTimes(this.weights, this.cues, duration);
	}

	// index === words.length means the whole line has been read. Fires
	// "wordchange" on the root so other things (Stu's moods) can follow along.
	setCurrent(index) {
		if (index === this.current) {
			return;
		}
		this.current = index;
		this.words.forEach((word, i) => {
			word.classList.toggle("is-read", i < index);
			word.classList.toggle("is-current", i === index);
		});
		this.scrollToCurrent();
		this.root.dispatchEvent(new CustomEvent("wordchange", { detail: { index, audio: this.audio } }));
	}

	// Keep the current word on the middle line, without scrolling past either end.
	scrollToCurrent() {
		if (!this.words.length) {
			return;
		}
		const word = this.words[Math.min(Math.max(this.current, 0), this.words.length - 1)];
		const viewHeight = this.viewport.clientHeight;
		const overflow = Math.min(0, viewHeight - this.textEl.offsetHeight);
		const y = viewHeight / 2 - (word.offsetTop + word.offsetHeight / 2);
		this.textEl.style.transform = `translateY(${Math.max(overflow, Math.min(0, y))}px)`;
	}
}

// How long a token takes to say, relative to the others.
function wordWeight(token) {
	return /^\[[^\]]*\]$/.test(token) ? TELEPROMPTER_TAG_WEIGHT : token.replace(/[^\p{L}\p{N}]/gu, "").length + 1;
}

// Estimated start time (seconds) of each token. weights: from wordWeight();
// cues: Rhubarb mouthCues or null; duration: clip length. Shared with the
// video export so its captions and moods line up with the page.
function estimateWordTimes(weights, cues, duration) {
	if (!isFinite(duration) || duration <= 0) {
		return null;
	}
	const segments = speechSegments(cues, duration);
	const speechTotal = segments.reduce((sum, [start, end]) => sum + (end - start), 0);
	const weightTotal = weights.reduce((sum, w) => sum + w, 0) || 1;
	const times = [];
	let before = 0;
	for (const weight of weights) {
		times.push(speechToClipTime(segments, (before / weightTotal) * speechTotal));
		before += weight;
	}
	return times;
}

// Merge non-silent cues into [start, end] stretches of speech. Short silences
// inside a phrase don't split it.
function speechSegments(cues, duration) {
	const segments = [];
	for (const cue of cues || []) {
		if (cue.value === "X") {
			continue;
		}
		const last = segments[segments.length - 1];
		if (last && cue.start - last[1] < TELEPROMPTER_MIN_PAUSE) {
			last[1] = cue.end;
		} else {
			segments.push([cue.start, cue.end]);
		}
	}
	return segments.length ? segments : [[0, duration]];
}

function speechToClipTime(segments, speechTime) {
	let remaining = speechTime;
	for (const [start, end] of segments) {
		if (remaining <= end - start) {
			return start + remaining;
		}
		remaining -= end - start;
	}
	return segments[segments.length - 1][1];
}
