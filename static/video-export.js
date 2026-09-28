// Video export: renders Stu saying a clip - lip sync, per-sentence moods and
// gestures, optional captions - into a video, then has the server add the
// voice and package it as an MP4.
//
// Frames are drawn offline on a canvas (StuPlayer replays the same animation
// as the live <stu-avatar>) and compressed with the browser's WebCodecs
// encoder, so rendering runs faster than real time and doesn't depend on the
// tab staying visible. The server muxes the encoded video with the clip's mp3.
//
// Uses globals from the page's classic scripts: moodTokens / analyzeMoods
// (mood.js) and wordWeight / estimateWordTimes (teleprompter.js), so the
// video's timing matches the teleprompter and Stu's moods on the page.

import { StuPlayer, RIG_SIZE, RIG_FEET } from "./stu-avatar/stu-avatar.js";
import { DEFAULT_SCENE, FORMATS, SCENES } from "./scenes.js";

const FPS = 30;

export { FORMATS };

export function videoExportSupported() {
	return typeof VideoEncoder !== "undefined" && typeof VideoFrame !== "undefined";
}

/**
 * Render a clip to an MP4 Blob.
 * onProgress(fraction 0..1, label) is called as it goes.
 * codec: "auto" picks H.264 when the browser can encode it, else VP9; "h264"
 * or "vp9" forces one (for testing the fallback).
 */
export async function exportVideo({ audioUrl, cuesUrl, text, format = "square", captions = false, scene: sceneId = DEFAULT_SCENE, codec = "auto", onProgress = () => {} }) {
	if (!videoExportSupported()) {
		throw new Error("This browser can't render video. Use a recent Chrome, Edge or Safari.");
	}
	const size = FORMATS[format];
	const scene = SCENES[sceneId];
	if (!size || !scene) {
		throw new Error("Unknown video format or scene.");
	}
	onProgress(0, "Preparing...");
	await scene.load();
	const layout = scene.layout(format, { captions });

	const audioBuffer = await decodeAudio(audioUrl);
	const duration = audioBuffer.duration;
	const cues = cuesUrl ? await fetchCues(cuesUrl) : null;
	const player = await StuPlayer.create({ cues, audioBuffer, duration });

	// The same timeline the page uses: word times -> sentence moods and captions.
	const tokens = moodTokens(text);
	const times = estimateWordTimes(tokens.map(wordWeight), cues, duration) || tokens.map(() => 0);
	const moods = analyzeMoods(text).map((m) => ({ ...m, time: times[m.startToken] ?? 0 }));
	const sentences = captions ? captionSentences(tokens, times, moods) : null;

	const canvas = document.createElement("canvas");
	canvas.width = size.w;
	canvas.height = size.h;
	const ctx = canvas.getContext("2d");
	const encoder = await createEncoder(size.w, size.h, codec);
	const captionLayout = new Map(); // sentence -> pages of lines, measured once

	try {
		const total = Math.max(1, Math.ceil(duration * FPS));
		let nextMood = 0;
		for (let i = 0; i < total; i++) {
			const t = i / FPS;
			while (nextMood < moods.length && moods[nextMood].time <= t) {
				player.setMood(moods[nextMood].mood, moods[nextMood].intensity);
				nextMood += 1;
			}
			player.advance(t);

			const frame = { w: size.w, h: size.h, t, format, layout };
			ctx.setTransform(1, 0, 0, 1, 0, 0);
			ctx.globalAlpha = 1;
			scene.drawBack(ctx, frame);
			drawStu(ctx, player, frame, scene);
			if (scene.drawFront) {
				scene.drawFront(ctx, frame);
			}
			if (sentences) {
				drawCaptions(ctx, sentences, frame, scene.captionStyle, captionLayout);
			}

			await encoder.addFrame(canvas, i);
			if (i % 6 === 0) {
				onProgress((i / total) * 0.9, "Rendering...");
				await new Promise((resolve) => setTimeout(resolve, 0)); // let the page repaint
			}
		}
		const video = await encoder.finish();

		onProgress(0.92, "Adding voice...");
		const clip = new URL(audioUrl, location.href).pathname.split("/").pop();
		const response = await fetch(`/api/video?clip=${encodeURIComponent(clip)}&codec=${encoder.codec}&fps=${FPS}`, {
			method: "POST",
			headers: { "Content-Type": "application/octet-stream" },
			body: video,
		});
		if (!response.ok) {
			const data = await response.json().catch(() => ({}));
			throw new Error(data.error || "Couldn't build the video.");
		}
		const mp4 = await response.blob();
		onProgress(1, "Done");
		return mp4;
	} finally {
		encoder.close();
	}
}

async function decodeAudio(url) {
	const response = await fetch(url);
	if (!response.ok) {
		throw new Error("Couldn't load this clip's audio.");
	}
	const bytes = await response.arrayBuffer();
	const Offline = window.OfflineAudioContext || window.webkitOfflineAudioContext;
	const ctx = new Offline(1, 1, 44100);
	return new Promise((resolve, reject) => {
		const p = ctx.decodeAudioData(bytes, resolve, reject);
		if (p && p.then) {
			p.then(resolve, reject);
		}
	});
}

async function fetchCues(url) {
	try {
		const response = await fetch(url);
		if (!response.ok) {
			return null;
		}
		const data = await response.json();
		return Array.isArray(data.mouthCues) && data.mouthCues.length ? data.mouthCues : null;
	} catch (err) {
		return null; // no lip-sync file: Stu's mouth follows loudness instead
	}
}

function drawStu(ctx, player, { w, h, layout }, scene) {
	const place = layout.stu;
	const scale = (place.height * h) / RIG_SIZE.h;
	ctx.save();
	ctx.translate(place.cx * w - RIG_FEET.x * scale, place.footY * h - RIG_FEET.y * scale);
	ctx.scale(scale, scale);
	player.paint(ctx, { shadow: scene.stuShadow });
	ctx.restore();
}

// ---------- captions ----------

// Sentences as caption units: their spoken words (tags like [chuckle] are
// left out) with each word's start time.
function captionSentences(tokens, times, moods) {
	const sentences = [];
	moods.forEach((m, i) => {
		const end = i + 1 < moods.length ? moods[i + 1].startToken : tokens.length;
		const words = [];
		for (let k = m.startToken; k < end; k++) {
			if (!/^\[[^\]]*\]$/.test(tokens[k])) {
				words.push({ text: tokens[k], start: times[k] ?? 0 });
			}
		}
		if (words.length) {
			sentences.push({ start: words[0].start, words });
		}
	});
	return sentences;
}

function drawCaptions(ctx, sentences, { w, h, t, layout, format }, style, cache) {
	const spec = layout.captions;
	if (!spec || !sentences.length) {
		return;
	}
	// The latest sentence that has started (the first one before anything is said).
	let sentence = sentences[0];
	for (const s of sentences) {
		if (s.start <= t) {
			sentence = s;
		}
	}
	let current = -1;
	sentence.words.forEach((word, i) => {
		if (word.start <= t) {
			current = i;
		}
	});

	const fontSize = spec.fontSize;
	ctx.font = `600 ${fontSize}px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`;
	const maxLines = format === "vertical" ? 3 : 2;
	if (!cache.has(sentence)) {
		cache.set(sentence, paginate(ctx, sentence.words, spec.maxWidth * w, maxLines));
	}
	const pages = cache.get(sentence);
	// Show the page holding the current word.
	const page = pages.find((p) => current <= p.lastWord) || pages[pages.length - 1];

	const lineHeight = fontSize * 1.3;
	const padX = fontSize * 0.7;
	const padY = fontSize * 0.45;
	const blockW = Math.max(...page.lines.map((line) => line.width)) + padX * 2;
	const blockH = page.lines.length * lineHeight + padY * 2;
	const cx = w / 2;
	const top = spec.y * h - blockH / 2;

	ctx.fillStyle = style.panel;
	roundRect(ctx, cx - blockW / 2, top, blockW, blockH, fontSize * 0.45);
	ctx.fill();

	ctx.textBaseline = "middle";
	const space = ctx.measureText(" ").width;
	page.lines.forEach((line, row) => {
		let x = cx - line.width / 2;
		const y = top + padY + lineHeight * (row + 0.5);
		for (const word of line.words) {
			ctx.fillStyle = word.index === current ? style.current : word.index < current ? style.text : style.upcoming;
			ctx.fillText(word.text, x, y);
			x += word.width + space;
		}
	});
}

// Wrap words into lines no wider than maxWidth, grouped into pages of maxLines.
function paginate(ctx, words, maxWidth, maxLines) {
	const space = ctx.measureText(" ").width;
	const lines = [];
	let line = { words: [], width: 0 };
	words.forEach((word, index) => {
		const width = ctx.measureText(word.text).width;
		const next = line.words.length ? line.width + space + width : width;
		if (line.words.length && next > maxWidth) {
			lines.push(line);
			line = { words: [], width: 0 };
		}
		line.width = line.words.length ? line.width + space + width : width;
		line.words.push({ text: word.text, width, index });
	});
	if (line.words.length) {
		lines.push(line);
	}
	const pages = [];
	for (let i = 0; i < lines.length; i += maxLines) {
		const pageLines = lines.slice(i, i + maxLines);
		const lastLine = pageLines[pageLines.length - 1];
		pages.push({ lines: pageLines, lastWord: lastLine.words[lastLine.words.length - 1].index });
	}
	return pages;
}

function roundRect(ctx, x, y, w, h, r) {
	ctx.beginPath();
	ctx.moveTo(x + r, y);
	ctx.arcTo(x + w, y, x + w, y + h, r);
	ctx.arcTo(x + w, y + h, x, y + h, r);
	ctx.arcTo(x, y + h, x, y, r);
	ctx.arcTo(x, y, x + w, y, r);
	ctx.closePath();
}

// ---------- encoding ----------

// H.264 (Annex B, so the server can read the raw stream) where the browser can
// encode it, otherwise VP9 in a minimal IVF container.
const CODECS = [
	{ codec: "h264", config: { codec: "avc1.640028", avc: { format: "annexb" } } },
	{ codec: "h264", config: { codec: "avc1.4d0028", avc: { format: "annexb" } } },
	{ codec: "h264", config: { codec: "avc1.42e028", avc: { format: "annexb" } } },
	{ codec: "vp9", config: { codec: "vp09.00.40.08" } },
];

async function createEncoder(width, height, want = "auto") {
	const base = { width, height, framerate: FPS, bitrate: width * height * FPS * 0.1 };
	let chosen = null;
	for (const candidate of CODECS.filter((c) => want === "auto" || c.codec === want)) {
		const config = { ...base, ...candidate.config };
		try {
			const { supported } = await VideoEncoder.isConfigSupported(config);
			if (supported) {
				chosen = { codec: candidate.codec, config };
				break;
			}
		} catch (err) {
			// Unsupported option on this browser - try the next codec.
		}
	}
	if (!chosen) {
		throw new Error("This browser can't encode video. Use a recent Chrome, Edge or Safari.");
	}

	const chunks = [];
	let failure = null;
	const encoder = new VideoEncoder({
		output: (chunk) => {
			const bytes = new Uint8Array(chunk.byteLength);
			chunk.copyTo(bytes);
			chunks.push(bytes);
		},
		error: (err) => {
			failure = err;
		},
	});
	encoder.configure(chosen.config);

	return {
		codec: chosen.codec,
		async addFrame(canvas, index) {
			if (failure) {
				throw failure;
			}
			const frame = new VideoFrame(canvas, { timestamp: Math.round((index * 1e6) / FPS), duration: Math.round(1e6 / FPS) });
			encoder.encode(frame, { keyFrame: index % (FPS * 2) === 0 });
			frame.close();
			// Backpressure: don't queue up hundreds of uncompressed frames.
			while (encoder.encodeQueueSize > 6) {
				await new Promise((resolve) => setTimeout(resolve, 2));
			}
		},
		async finish() {
			await encoder.flush();
			if (failure) {
				throw failure;
			}
			return chosen.codec === "vp9" ? ivf(chunks, width, height) : new Blob(chunks);
		},
		close() {
			if (encoder.state !== "closed") {
				encoder.close();
			}
		},
	};
}

// IVF: 32-byte file header, then a 12-byte header before each frame.
function ivf(frames, width, height) {
	const header = new DataView(new ArrayBuffer(32));
	[..."DKIF"].forEach((c, i) => header.setUint8(i, c.charCodeAt(0)));
	header.setUint16(4, 0, true);
	header.setUint16(6, 32, true);
	[..."VP90"].forEach((c, i) => header.setUint8(8 + i, c.charCodeAt(0)));
	header.setUint16(12, width, true);
	header.setUint16(14, height, true);
	header.setUint32(16, FPS, true);
	header.setUint32(20, 1, true);
	header.setUint32(24, frames.length, true);
	const parts = [header.buffer];
	frames.forEach((bytes, i) => {
		const frameHeader = new DataView(new ArrayBuffer(12));
		frameHeader.setUint32(0, bytes.byteLength, true);
		frameHeader.setUint32(4, i, true);
		frameHeader.setUint32(8, 0, true);
		parts.push(frameHeader.buffer, bytes);
	});
	return new Blob(parts);
}
