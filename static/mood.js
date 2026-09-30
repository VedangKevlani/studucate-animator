// Reads the mood, emotion and intent of each sentence with local rules, so
// Stu's body language can follow the line as he says it. Moods map to
// <stu-avatar>.setMood() names (see MOODS in stu-avatar.js).
//
// Sentences are split on the same tokens the teleprompter shows (text words
// and [tags]), so a sentence's startToken lines up with the teleprompter's
// word index and inherits its timing.

// Paralinguistic tags are their own moment in the clip.
const MOOD_TAGS = {
	laugh: "happy",
	chuckle: "happy",
	sigh: "sad",
	sniff: "sad",
	gasp: "surprised",
	groan: "frustrated",
	"clear throat": "thoughtful",
	cough: "neutral",
	shush: "disagree",
};

// Phrases (weight 2) beat single words (weight 1): "never think of yourself
// as a burden" is reassurance even though "burden" alone reads as sad.
const MOOD_PHRASES = {
	reassuring: [
		"don't worry", "dont worry", "no worries", "it's okay", "its okay", "it's ok", "that's okay",
		"it's alright", "it's fine", "that's fine", "you're not", "youre not", "here to help", "here for you",
		"i'm here", "im here", "you can do", "you got this", "you've got this", "take your time", "no problem",
		"all good", "that's my job", "never think", "you're doing great", "proud of you", "it happens",
		"not your fault", "we'll figure", "we can figure", "one step at a time", "trust me", "come to me",
		"let me help", "let me fix", "i've got you", "i got you",
	],
	excited: ["let's go", "lets go", "let's get started", "can't wait", "cant wait", "so excited", "here we go"],
	greeting: ["good morning", "good afternoon", "good evening", "nice to meet", "see you", "welcome back"],
	surprised: ["no way", "oh my", "oh wow", "i can't believe", "who knew"],
	curious: ["i wonder", "tell me", "what if", "how about", "have you ever", "do you know"],
	thoughtful: ["let me think", "let's see", "i guess", "i suppose", "i think", "kind of", "sort of"],
	sad: ["i'm sorry", "im sorry", "so sorry", "i miss", "too bad", "not good"],
	disagree: ["not really", "i don't think so", "no no", "not at all", "of course not"],
	agree: ["of course", "you're right", "that's right", "good point", "makes sense", "sounds good"],
	frustrated: ["come on", "not again", "give me a break"],
};

const MOOD_WORDS = {
	happy: [
		"glad", "happy", "great", "good", "nice", "love", "awesome", "amazing", "wonderful", "fantastic",
		"yay", "fun", "enjoy", "smile", "excellent", "perfect", "cool", "proud", "congrats", "congratulations",
		"thanks", "thank", "haha", "hehe", "lol", "beautiful", "brilliant", "delighted", "hooray", "sweet",
	],
	excited: ["excited", "thrilled", "woohoo", "woo", "yippee", "incredible", "epic", "ready"],
	greeting: ["hi", "hey", "hello", "welcome", "greetings", "howdy", "bye", "goodbye"],
	surprised: ["wow", "whoa", "woah", "omg", "oh", "really", "unbelievable", "gosh", "huh", "surprise"],
	curious: ["why", "how", "what", "wonder", "curious", "interesting", "which", "where", "when", "who"],
	thoughtful: ["hmm", "hm", "um", "uh", "well", "maybe", "perhaps", "probably", "guess", "suppose", "actually"],
	sad: [
		"sad", "sorry", "unfortunately", "miss", "lonely", "alone", "cry", "crying", "tears", "hurt",
		"lost", "tired", "upset", "disappointed", "heartbroken", "awful", "worried", "afraid", "scared", "burden",
	],
	disagree: ["no", "nah", "nope", "wrong", "disagree", "never"],
	agree: ["yes", "yeah", "yep", "sure", "right", "exactly", "absolutely", "definitely", "correct", "indeed", "okay", "ok", "alright"],
	frustrated: ["ugh", "argh", "annoying", "annoyed", "hate", "angry", "mad", "frustrating", "frustrated", "seriously", "ridiculous", "stupid"],
	reassuring: ["always", "safe", "together", "gently", "breathe", "reassure", "reassuring", "promise"],
};

// Action words: a leg move Stu does on top of the sentence's mood ("Let's
// jump!" is excited AND a jump). The first action word in a sentence wins.
const MOOD_ACTIONS = {
	jump: ["jump", "jumps", "jumping", "hop", "hops", "hopping", "leap", "leaping"],
	dance: ["dance", "dances", "dancing", "party", "groove", "grooving", "boogie", "celebrate", "celebrating"],
	march: ["march", "marching", "walk", "walking", "stroll", "parade"],
	stomp: ["stomp", "stomps", "stomping"],
	tap: ["tap", "taps", "tapping", "impatient", "tick"],
	bounce: ["bounce", "bouncing", "bouncy", "wiggle", "wiggling"],
	kick: ["kick", "kicks", "kicking", "goal", "soccer", "football"],
};

// Words that flip a following positive word ("not happy", "never good").
const MOOD_NEGATIONS = new Set(["not", "never", "no", "don't", "dont", "isn't", "isnt", "wasn't", "wasnt", "can't", "cant"]);
const MOOD_POSITIVE = new Set(["happy", "excited"]);

function moodTokens(text) {
	return text.match(/\[[^\]]*\]|\S+/g) || [];
}

// Collapse stretched words ("naaah", "sooo") so they match the lexicon, and
// report the stretch - it's a sign of emphasis.
function normalizeWord(token) {
	const lower = token.toLowerCase().replace(/[‘’]/g, "'");
	const bare = lower.replace(/^[^\p{L}\p{N}']+|[^\p{L}\p{N}']+$/gu, "");
	const collapsed = bare.replace(/(\p{L})\1{2,}/gu, "$1");
	return { word: collapsed, stretched: collapsed !== bare };
}

function endsSentence(token) {
	return /[.!?…]["')\]]*$/.test(token);
}

// Split tokens into sentences. Each [tag] is a sentence of its own.
function splitSentences(tokens) {
	const sentences = [];
	let current = null;
	tokens.forEach((token, i) => {
		if (/^\[[^\]]*\]$/.test(token)) {
			if (current) {
				sentences.push(current);
				current = null;
			}
			sentences.push({ startToken: i, tokens: [token], tag: token.slice(1, -1).trim().toLowerCase() });
			return;
		}
		if (!current) {
			current = { startToken: i, tokens: [] };
		}
		current.tokens.push(token);
		if (endsSentence(token)) {
			sentences.push(current);
			current = null;
		}
	});
	if (current) {
		sentences.push(current);
	}
	return sentences;
}

function readSentence(sentence) {
	if (sentence.tag !== undefined) {
		const mood = MOOD_TAGS[sentence.tag] || "neutral";
		return { mood, intensity: 1, action: null, reason: `[${sentence.tag}]` };
	}

	const raw = sentence.tokens.join(" ");
	const words = sentence.tokens.map(normalizeWord);
	const text = ` ${words.map((w) => w.word).join(" ")} `;
	const scores = {};
	const add = (mood, points) => {
		scores[mood] = (scores[mood] || 0) + points;
	};

	for (const [mood, phrases] of Object.entries(MOOD_PHRASES)) {
		for (const phrase of phrases) {
			if (text.includes(` ${phrase} `)) {
				add(mood, 2);
			}
		}
	}
	words.forEach(({ word }, i) => {
		for (const [mood, list] of Object.entries(MOOD_WORDS)) {
			if (!list.includes(word)) {
				continue;
			}
			// Greetings only count at the start of a sentence ("hey, ..." not "they said hey").
			if (mood === "greeting" && i > 1) {
				continue;
			}
			// Question words mean curiosity only in a question.
			if (mood === "curious" && !raw.includes("?")) {
				continue;
			}
			const negated = i > 0 && MOOD_NEGATIONS.has(words[i - 1].word);
			if (negated && MOOD_POSITIVE.has(mood)) {
				add("sad", 1);
			} else {
				add(mood, 1);
			}
		}
	});

	// Punctuation carries intent as much as words do.
	const trimmed = raw.trim();
	const exclaims = (trimmed.match(/!/g) || []).length;
	if (/\?!|!\?/.test(trimmed)) {
		add("surprised", 2);
	} else if (trimmed.endsWith("?")) {
		// A lone "okay?" / "right?" at the end is a check-in, not a question.
		if (/^(okay|ok|alright|right|yeah|deal)\?$/i.test(trimmed)) {
			add("reassuring", 2);
		} else {
			add("curious", 1.5);
		}
	}
	if (exclaims && (scores.happy || scores.greeting)) {
		add("happy", 0.5);
	}
	if (/(\.\.\.|…)$/.test(trimmed) && !Object.keys(scores).length) {
		add("thoughtful", 1);
	}

	// Emphasis: exclamation marks, SHOUTED words, stretched words.
	let intensity = 1 + Math.min(exclaims, 3) * 0.2;
	if (sentence.tokens.some((t) => t.length > 1 && /\p{L}/u.test(t) && t === t.toUpperCase() && t !== "I")) {
		intensity += 0.3;
	}
	if (words.some((w) => w.stretched)) {
		intensity += 0.2;
	}
	if (/(\.\.\.|…)$/.test(trimmed)) {
		intensity -= 0.15;
	}

	let best = "neutral";
	let bestScore = 0;
	for (const [mood, score] of Object.entries(scores)) {
		if (score > bestScore) {
			best = mood;
			bestScore = score;
		}
	}
	if (best === "neutral" && exclaims) {
		best = "happy";
	}
	// Big, loud happiness is excitement.
	if (best === "happy" && intensity >= 1.4) {
		best = "excited";
	}
	let action = null;
	for (const { word } of words) {
		action = Object.keys(MOOD_ACTIONS).find((a) => MOOD_ACTIONS[a].includes(word)) || null;
		if (action) {
			break;
		}
	}
	return { mood: best, intensity: Math.max(0.6, Math.min(1.6, intensity)), action, reason: bestScore ? `score ${bestScore}` : "punctuation" };
}

// -> [{ startToken, mood, intensity, action, text }]
function analyzeMoods(text) {
	return splitSentences(moodTokens(text)).map((sentence) => ({
		startToken: sentence.startToken,
		text: sentence.tokens.join(" "),
		...readSentence(sentence),
	}));
}
