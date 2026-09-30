/**
 * <stu-avatar> — Stu, the talking mascot.
 *
 * A framework-free web component. Works in plain HTML, React, Vue, Svelte, etc.
 *
 *   <script type="module" src="/stu-avatar/stu-avatar.js"></script>
 *   <stu-avatar id="stu"></stu-avatar>
 *
 *   const stu = document.getElementById('stu');
 *   stu.unlock();                                   // call inside a click handler (browser audio rule)
 *   await stu.speak({ audio: '/out/line.wav', cues: '/out/line.cues.json' });
 *
 * speak() options
 *   audio    URL string | Blob | ArrayBuffer | AudioBuffer          (required)
 *   cues     Rhubarb JSON object | its mouthCues array | URL to JSON (optional;
 *            without it, the mouth follows loudness only, which is less accurate)
 *   gesture  true | false   open arms for the first part of the line (default: attribute or true)
 *
 * Attributes
 *   assets="path/"        where the images live (default: ./assets/ next to this file)
 *   pose="idle|open|think"
 *   gestures="off"        disable the automatic open-arms gesture
 *   motion="off"          disable breathing and sway (also off when the OS asks for reduced motion)
 *
 * follow(media, { cues, gesture }) -> Promise
 *   Lip-sync to an <audio>/<video> element that plays the sound itself, so the
 *   page's own player controls (seek, speed, volume) keep working. The mouth
 *   tracks media.currentTime and rests while paused. Without cues, it uses a
 *   loudness envelope decoded from the element's source. Resolves when the media
 *   ends, or when stop() / another speak() or follow() takes over.
 *
 * setMood(name, intensity = 1)
 *   Body language and face. Stu is a cut-out puppet (layers built by
 *   build_stu_rig.py): arms swing at the shoulders, legs bend at hip and knee
 *   (feet stay planted unless lifted), the head tilts/nods, and the face has
 *   movable eyebrows, part-closing eyelids and a resting mouth per mood. A
 *   mood sets a held posture + expression and plays a one-shot gesture (wave,
 *   cheer, shrug, stomp, foot tap...). See MOODS and GESTURES below. While
 *   talking he adds arm beats, brow lifts and knee bounce; while idle he
 *   breathes and shifts his weight from leg to leg.
 *
 * act(name)
 *   A one-off move on top of the current mood, mostly legs: jump, dance,
 *   march, stomp, tap, bounce, kick (see ACTIONS). mood.js picks one from
 *   action words in the script ("Let's dance!").
 *
 * Methods: unlock(), speak(opts) -> Promise, follow(media, opts) -> Promise, stop(), setPose(name), setMood(name, intensity), act(name)
 *
 * Video export: StuPlayer (exported below) replays a clip offline on its own
 * clock and paints Stu onto a canvas frame by frame, using the same lip sync,
 * moods, gestures and idle motion as the live element.
 * Events:  'speakstart', 'speakend' (detail: { interrupted: boolean })
 */

const DEFAULT_ASSETS = new URL('./assets/', import.meta.url).href;

// Source images are 690x750 crops taken from a 1024x1024 canvas at offset (170,160).
const VB = { x: 170, y: 160, w: 690, h: 750 };
const MOUTH_BOX = { x: 445, y: 405, w: 130, h: 80 };
const MOUTHS = ['rest', 'small', 'grin', 'mid', 'open', 'wide', 'round', 'flat'];
// 'flat' (a closed, serious mouth) is generated into rig/ by build_stu_rig.py.
const mouthFile = k => (k === 'flat' ? 'rig/mouth-flat.png' : `mouth-${k}.png`);
// Part-closed upper eyelids (rig/eyes-lid-NN.png), positioned like EYES.idle.
const LID_LEVELS = [0.2, 0.35, 0.5, 0.65];
// idle/open are drawn by the rig (open = arms held out); think is a flat
// picture with its own face, used while he's working something out.
const POSES = {
  idle:  { rig: true, arms: 4,  mouth: true,  eyes: 'idle' },
  open:  { rig: true, arms: 81, mouth: true,  eyes: 'idle' },
  think: { img: 'stu-think.webp', mouth: false, eyes: 'think' },
};
// Closed-eye overlays (made from Stu's own skin) and where they sit.
const EYES = { idle: { x: 415, y: 340, w: 190, h: 90 }, think: { x: 415, y: 335, w: 195, h: 95 } };
// Empty room around the artwork, as a fraction of its size, so hops, leans and
// raised arms don't get clipped at the element's edges.
const PAD = { top: 0.08, x: 0.05 };

// Cut-out rig. Every layer is on the pose images' 690x750 canvas; joints are in
// that space (keep in sync with PIVOTS in build_stu_rig.py).
const RIG = {
  w: 690, h: 750,
  // Arms (sleeve + arm) pivot at the middle of each shoulder seam.
  armL: [254, 372], armR: [438, 372], head: [340, 328], hips: [345, 560], feet: [345, 705],
  outAngle: 81,     // the open-hand arm sprites are drawn held out at this angle (build_stu_rig.py prints it)
  // Legs (build_stu_rig.py prints these). Each leg is one piece from the
  // shorts' hem (its pivot) into the shoe; the shoe joins it at the ankle,
  // under the shoe's collar, and follows the foot. No visible knee joint -
  // the visible leg is too short for one to look right.
  legs: {
    l: { hip: [284, 568], ankle: [284, 649], foot: [284, 705] },
    r: { hip: [407, 568], ankle: [407, 646], foot: [407, 705] },
  },
  crouchPx: 30,     // how far the hips drop at a full crouch
  liftPx: 34,       // how high a foot lifts at lift = 1 (the leg shortens, reading as a bent knee)
  legSquashMin: 0.62, // the leg piece never compresses below this
  footIn: 0.3,      // a lifted foot tucks in toward the middle by this much of the lift
  // Eyebrow pivots (their centres).
  brows: { l: [279, 182], r: [394, 179] },
};
// Joint channels. arm*: degrees raised out from hanging (0 down, 75 straight
// out, ~150 up). Held angles should stay out of ARM_BLEND, where the hanging
// and open-hand sprites cross-fade (fine in passing, ghostly if held). head*: tilt in degrees, X/Y offsets as a fraction of height.
// lean: upper-body degrees at the hips. crouch: 0..1 knee bend. lift: whole
// figure off the ground (fraction of height). rise: shoulders up (negative) /
// down (positive).
const ARM_BLEND = [40, 45];
// hipX: weight shift sideways (px; the feet stay planted, so the legs lean).
// splayL/splayR: swing a leg out to the side from the hip (degrees) - the
// big, readable leg move, since the visible leg is too short for high lifts.
// liftL/liftR: 0..1, raise a foot (knee bends). Face: browL/browR move a
// brow (px, negative = up); tiltL/tiltR tilt it (degrees, positive = inner
// end up - worried; negative = inner end down - cross); lids: 0..0.65 how
// far the upper eyelids come down.
const REST = {
  armL: 4, armR: 4, headTilt: 0, headX: 0, headY: 0, lean: 0, crouch: 0, lift: 0, rise: 0,
  hipX: 0, liftL: 0, liftR: 0, splayL: 0, splayR: 0,
  browL: 0, browR: 0, tiltL: 0, tiltR: 0, lids: 0,
};
// Spring stiffness per channel (rad/s): higher = snappier. Critically damped,
// so nothing overshoots or wobbles.
const STIFF = {
  armL: 9, armR: 9, headTilt: 7, headX: 16, headY: 12, lean: 3.5, crouch: 16, lift: 16, rise: 10,
  hipX: 6, liftL: 16, liftR: 16, splayL: 13, splayR: 13,
  browL: 11, browR: 11, tiltL: 9, tiltR: 9, lids: 9,
};

// Moods: base = held posture and expression (scaled by intensity), mouth =
// his mouth between words, gesture = one-shot on entering the mood, energy =
// size of the small arm beats while talking.
const MOODS = {
  neutral:    { base: {}, energy: 0.5 },
  happy:      { base: { armL: 14, armR: 14, headTilt: 3, browL: -5, browR: -5, lids: 0.2 }, gesture: 'hop', energy: 0.9 },
  excited:    { base: { armL: 24, armR: 24, headTilt: 2, browL: -9, browR: -9 }, gesture: 'cheer', energy: 1.2 },
  greeting:   { base: { armL: 8, headTilt: 3, browL: -6, browR: -6, lids: 0.12, hipX: 10 }, gesture: 'wave', energy: 0.8 },
  reassuring: { base: { armL: 60, armR: 60, headTilt: 4, lean: 1, browL: -3, browR: -3, tiltL: 7, tiltR: 7, lids: 0.24 }, gesture: 'openNod', energy: 0.5 },
  agree:      { base: { armL: 10, armR: 10, headTilt: 2, browL: -3, browR: -3, lids: 0.16 }, gesture: 'nod', energy: 0.6 },
  disagree:   { base: { headTilt: -2, browL: 3, browR: -8, tiltL: -6, lids: 0.2, hipX: -12, splayR: 6 }, mouth: 'flat', gesture: 'shrugShake', energy: 0.6 },
  curious:    { base: { headTilt: 5, lean: 1.5, armR: 14, browL: -1, browR: -10, hipX: 12 }, gesture: 'perk', energy: 0.5 },
  thoughtful: { base: { headTilt: -5, headY: 0.004, armL: 6, armR: 6, lean: -1, browL: -2, browR: -2, tiltL: 9, tiltR: 9, lids: 0.34, hipX: -15, crouch: 0.25, splayL: 5 }, mouth: 'flat', gesture: 'shiftTap', energy: 0.3 },
  surprised:  { base: { armL: 30, armR: 30, headY: -0.004, browL: -13, browR: -13, splayL: 5, splayR: 5 }, mouth: 'round', gesture: 'surprise', energy: 1 },
  sad:        { base: { headTilt: -4, headY: 0.012, crouch: 0.6, armL: 0, armR: 0, lean: -0.8, rise: 0.004, browL: 2, browR: 2, tiltL: 16, tiltR: 16, lids: 0.45 }, mouth: 'flat', gesture: 'sigh', energy: 0.2 },
  frustrated: { base: { headTilt: -2, armL: 10, armR: 10, browL: 4, browR: 4, tiltL: -16, tiltR: -16, lids: 0.32 }, mouth: 'flat', gesture: 'throwDown', energy: 0.8 },
};
// Gestures: keyframes [ms, { channel: value }]. Each channel follows its own
// keys (the spring smooths between them) and returns to the posture after its
// last key.
// Jumps tuck the feet up while airborne.
const HOP = [[0, { crouch: 1.2 }], [180, { crouch: 1.2, liftL: 0, liftR: 0, splayL: 0, splayR: 0 }], [300, { crouch: 0, lift: 0.06, liftL: 0.7, liftR: 0.7, splayL: 10, splayR: 10 }],
  [520, { lift: 0, liftL: 0, liftR: 0, splayL: 0, splayR: 0 }], [600, { crouch: 1 }], [820, { crouch: 0 }]];
const GESTURES = {
  wave: [[0, { armR: 128, headTilt: 5, browL: -9, browR: -9, liftL: 0, splayL: 0 }], [220, { liftL: 0.7, splayL: 12 }], [520, { liftL: 0, splayL: 0 }], [300, { armR: 134 }], [520, { armR: 112 }], [740, { armR: 134 }], [960, { armR: 112 }], [1180, { armR: 130 }], [1500, { armR: 130, headTilt: 5 }]],
  hop: HOP,
  // A star jump: legs out, arms up.
  cheer: [[0, { crouch: 1.2, armL: 50, armR: 50 }], [180, { crouch: 1.2, liftL: 0, liftR: 0, splayL: 0, splayR: 0 }], [320, { crouch: 0, lift: 0.08, armL: 132, armR: 132, liftL: 0.5, liftR: 0.5, splayL: 24, splayR: 24 }],
    [560, { lift: 0, liftL: 0, liftR: 0, splayL: 0, splayR: 0 }], [640, { crouch: 1 }], [860, { crouch: 0 }], [1300, { armL: 124, armR: 124 }]],
  nod: [[0, { headY: 0.012, crouch: 0.6 }], [220, { headY: -0.002, crouch: 0 }], [440, { headY: 0.012, crouch: 0.6 }], [660, { headY: 0, crouch: 0 }]],
  openNod: [[0, { armL: 78, armR: 78 }], [250, { headY: 0.01 }], [450, { headY: -0.002 }], [650, { headY: 0.01 }], [850, { headY: 0 }], [1000, { armL: 72, armR: 72 }]],
  // Head shakes are small tilts back and forth: sliding the head sideways
  // would expose the jaw line (there's no neck in the art).
  shrugShake: [[0, { armL: 54, armR: 54, rise: -0.012, headTilt: 3 }], [650, { armL: 54, armR: 54, rise: -0.012, headTilt: 3 }], [800, { headTilt: -2.5 }], [950, { headTilt: 2.5 }], [1100, { headTilt: -2 }], [1250, { headTilt: 0 }]],
  // Perks up, then taps a foot twice.
  perk: [[0, { headY: -0.008, lean: 2.5, browR: -13 }], [500, { headY: -0.004, liftL: 0, splayL: 0 }], [640, { liftL: 0.6, splayL: 8 }], [800, { liftL: 0, splayL: 0 }], [960, { liftL: 0.6, splayL: 8 }], [1120, { liftL: 0, splayL: 0 }], [1150, { browR: -10 }]],
  // Weight onto one leg, a slow foot tap.
  shiftTap: [[0, { hipX: -18, liftR: 0, splayR: 0 }], [600, { liftR: 0.6, splayR: 10 }], [900, { liftR: 0, splayR: 0 }], [1400, { hipX: -15 }]],
  surprise: [[0, { armL: 100, armR: 100, lift: 0.05, headY: -0.01, browL: -16, browR: -16, liftL: 0.6, liftR: 0.6, splayL: 16, splayR: 16 }], [260, { lift: 0, liftL: 0, liftR: 0, splayL: 5, splayR: 5 }], [900, { armL: 85, armR: 85, browL: -13, browR: -13 }]],
  sigh: [[0, { rise: -0.008, headY: 0.004 }], [500, { rise: 0.01, headY: 0.016 }], [1100, { rise: 0.006 }]],
  // Throws the arms down and stomps.
  throwDown: [[0, { armL: 42, armR: 42, crouch: 0.2, liftR: 0, splayR: 0, hipX: -10 }], [180, { liftR: 1, splayR: 18 }], [300, { armL: 6, armR: 6, crouch: 1.1, liftR: 0, splayR: 0 }], [520, { crouch: 0.1, hipX: 0 }], [560, { headTilt: -2.5 }], [700, { headTilt: 2.5 }], [840, { headTilt: 0 }]],
};
// Actions: one-off moves (mostly legs) that play on top of a mood - see
// act(). Same keyframe format as GESTURES; they win over the mood gesture on
// the channels they use.
const alternate = (a, b, stepMs, count, extra = () => ({})) =>
  Array.from({ length: count }, (_, i) => [i * stepMs, { ...(i % 2 ? b : a), ...extra(i) }]);
const ACTIONS = {
  // A star jump: deep crouch, spring up with legs out and arms up, land deep.
  jump: [[0, { crouch: 1.3, armL: 30, armR: 30 }], [220, { crouch: 1.3, liftL: 0, liftR: 0, splayL: 0, splayR: 0 }],
    [360, { crouch: 0, lift: 0.1, liftL: 0.6, liftR: 0.6, splayL: 26, splayR: 26, armL: 130, armR: 130 }],
    [640, { lift: 0, liftL: 0, liftR: 0, splayL: 0, splayR: 0 }], [720, { crouch: 1.2 }], [960, { crouch: 0, armL: 20, armR: 20 }]],
  // Weight swings side to side; the free leg kicks out each time.
  dance: [...alternate({ hipX: 20, splayL: 22, liftL: 0.6, splayR: 0, liftR: 0, armL: 80, armR: 20, headTilt: 3, crouch: 0.7 },
    { hipX: -20, splayL: 0, liftL: 0, splayR: 22, liftR: 0.6, armL: 20, armR: 80, headTilt: -3, crouch: 0.7 }, 320, 8),
    [2560, { hipX: 0, splayL: 0, splayR: 0, liftL: 0, liftR: 0, crouch: 0 }]],
  // High knees with a body bob and big arm swings.
  march: [...alternate({ liftL: 1, splayL: 8, liftR: 0, splayR: 0, armL: 4, armR: 40, crouch: 0, hipX: 8 },
    { liftL: 0, splayL: 0, liftR: 1, splayR: 8, armL: 40, armR: 4, crouch: 0, hipX: -8 }, 360, 8, (i) => ({ crouch: 0.5 })),
    [2880, { liftL: 0, liftR: 0, splayL: 0, splayR: 0, crouch: 0, hipX: 0 }]],
  // Leg swings up and out, then slams down with the whole body dropping.
  stomp: [[0, { liftR: 0, splayR: 0, hipX: -14 }], [220, { liftR: 1, splayR: 20, armL: 30, armR: 30 }], [340, { liftR: 0, splayR: 0, crouch: 1.3, armL: 4, armR: 4 }],
    [560, { crouch: 0, hipX: 14, liftL: 0, splayL: 0 }], [780, { liftL: 1, splayL: 20, armL: 30, armR: 30 }], [900, { liftL: 0, splayL: 0, crouch: 1.3, armL: 4, armR: 4 }],
    [1140, { crouch: 0, hipX: 0 }]],
  tap: [[0, { hipX: -14 }], ...alternate({ liftR: 0.7, splayR: 9 }, { liftR: 0, splayR: 0 }, 200, 8).map(([t, v]) => [t + 200, v]), [1800, { liftR: 0, splayR: 0, hipX: 0 }]],
  // Deep knee bounces, feet leaving the floor on the way up.
  bounce: [...alternate({ crouch: 1.3, lift: 0, liftL: 0, liftR: 0 }, { crouch: 0, lift: 0.04, liftL: 0.4, liftR: 0.4 }, 260, 8), [2080, { crouch: 0, lift: 0, liftL: 0, liftR: 0 }]],
  // Leans away and kicks the leg high out to the side.
  kick: [[0, { hipX: -18, liftR: 0, splayR: 0 }], [220, { liftR: 0.6, splayR: 8, crouch: 0.4 }], [380, { liftR: 1, splayR: 30, armL: 50, lean: -2, crouch: 0.2 }],
    [620, { liftR: 0.3, splayR: 10 }], [820, { liftR: 0, splayR: 0, hipX: 0, lean: 0, crouch: 0 }]],
  // Idle fidgets, played every few seconds when he isn't talking.
  fidgetTap: [[0, { liftL: 0, splayL: 0 }], [220, { liftL: 0.6, splayL: 8 }], [420, { liftL: 0, splayL: 0 }], [620, { liftL: 0.6, splayL: 8 }], [820, { liftL: 0, splayL: 0 }]],
  fidgetShift: [[0, { hipX: 0 }], [800, { hipX: 18 }], [2400, { hipX: 18 }], [3200, { hipX: 0 }]],
  fidgetHeel: [[0, { liftR: 0, splayR: 0 }], [260, { liftR: 0.6, splayR: 12 }], [620, { liftR: 0, splayR: 0 }]],
};

// Mouth shape -> how open, for the head bob while talking.
const MOUTH_OPEN = { rest: 0, flat: 0, small: 0.3, grin: 0.35, mid: 0.5, round: 0.55, open: 0.8, wide: 1 };

// Rhubarb shape letters -> Stu mouth images
const RHUBARB = { X: 'rest', A: 'rest', B: 'small', C: 'mid', D: 'open', E: 'round', F: 'round', G: 'grin', H: 'mid' };

const pct = (v, t) => (v / t * 100).toFixed(4) + '%';
const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));

let sharedCtx = null;
function audioContext() {
  if (!sharedCtx) sharedCtx = new (window.AudioContext || window.webkitAudioContext)();
  return sharedCtx;
}

class StuAvatar extends HTMLElement {
  static get observedAttributes() { return ['pose', 'assets']; }

  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this._pose = 'idle';
    this._playing = false;
    this._cues = null;
    this._mouth = 'rest';
    this._mouthSince = 0;
    this._lvl = { open: 0, round: 0, spread: 0 };
    this._blinkT = -1; this._nextBlink = performance.now() + 1800; this._double = false;
    this._raf = 0;
    this._lastFrame = 0;
    // Rig state: current value and velocity per joint channel.
    this._joint = Object.fromEntries(Object.keys(REST).map(k => [k, { x: REST[k], v: 0 }]));
    this._moodBase = {};          // held posture from setMood (already intensity-scaled)
    this._energy = MOODS.neutral.energy;
    this._gesture = null;         // mood gesture { keys, start }
    this._beat = null;            // small talking arm beat { keys, start }
    this._action = null;          // act() move or idle fidget { keys, start }
    this._nextFidget = 0;
    this._nextBeat = 0; this._beatSide = 'R';
    this._drift = 0; this._driftTarget = 0; this._nextDrift = 0;
    this._talk = 0;               // smoothed mouth openness
    this._restMouth = 'rest';     // mouth between words, per mood
    this._lidOpacity = 0;
    // Swappable for offline rendering (StuPlayer): a fixed clock, seeded
    // randomness, and the clip time the mouth follows.
    this._clock = () => performance.now();
    this._rand = Math.random;
    this._timeSource = null;
  }

  get assetsBase() {
    const a = this.getAttribute('assets');
    return a ? new URL(a.endsWith('/') ? a : a + '/', document.baseURI).href : DEFAULT_ASSETS;
  }

  connectedCallback() {
    this._render();
    this._reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.setPose(this.getAttribute('pose') || 'idle');
    this._raf = requestAnimationFrame(t => this._frame(t));
  }
  disconnectedCallback() { cancelAnimationFrame(this._raf); this.stop(); }
  attributeChangedCallback(name, _o, v) {
    if (!this.shadowRoot.firstChild) return;
    if (name === 'pose' && v) this.setPose(v);
    if (name === 'assets') this._render();
  }

  _render() {
    const base = this.assetsBase, rig = base + 'rig/';
    const origin = ([x, y]) => `${pct(x, RIG.w)} ${pct(y, RIG.h)}`;
    const part = (cls, file, pivot) =>
      `<img class="part ${cls}" src="${rig}${file}" alt="" draggable="false" style="transform-origin:${origin(pivot)}">`;
    const flatImgs = Object.entries(POSES).filter(([, p]) => p.img).map(([k, p]) =>
      `<img class="pose" data-pose="${k}" src="${base}${p.img}" alt="" draggable="false">`).join('');
    const mouthImgs = MOUTHS.map(k =>
      `<img class="mouth" data-mouth="${k}" src="${base}${mouthFile(k)}" alt="" draggable="false"
        style="left:${pct(MOUTH_BOX.x - VB.x, VB.w)};top:${pct(MOUTH_BOX.y - VB.y, VB.h)};width:${pct(MOUTH_BOX.w, VB.w)};height:${pct(MOUTH_BOX.h, VB.h)}">`).join('');
    const eyeImg = k => { const e = EYES[k];
      return `<img class="eyes" data-eyes="${k}" src="${base}eyes-closed-${k}.png" alt="" draggable="false"
        style="left:${pct(e.x - VB.x, VB.w)};top:${pct(e.y - VB.y, VB.h)};width:${pct(e.w, VB.w)};height:${pct(e.h, VB.h)}">`; };
    const lidImgs = LID_LEVELS.map(l => { const e = EYES.idle;
      return `<img class="lid" src="${rig}eyes-lid-${Math.round(l * 100)}.png" alt="" draggable="false"
        style="opacity:0;left:${pct(e.x - VB.x, VB.w)};top:${pct(e.y - VB.y, VB.h)};width:${pct(e.w, VB.w)};height:${pct(e.h, VB.h)}">`; }).join('');
    this.shadowRoot.innerHTML = `
      <style>
        :host{display:block;position:relative;aspect-ratio:${VB.w * (1 + 2 * PAD.x)}/${VB.h * (1 + PAD.top)};width:100%;max-width:100%;contain:layout paint}
        .stage{position:absolute;bottom:0;left:${pct(PAD.x, 1 + 2 * PAD.x)};width:${pct(1, 1 + 2 * PAD.x)};height:${pct(1, 1 + PAD.top)}}
        .floor{position:absolute;left:27%;width:46%;top:95.6%;height:4.2%;border-radius:50%;
               background:radial-gradient(closest-side,var(--stu-shadow,rgba(22,33,58,.28)),transparent)}
        .fig,.rig,.flat,.upper,.head,.face{position:absolute;inset:0}
        .fig,.upper,.head,.part{will-change:transform}
        .upper{transform-origin:${origin(RIG.hips)}}
        .head{transform-origin:${origin(RIG.head)}}
        img{position:absolute;display:block;max-width:none;user-select:none;-webkit-user-drag:none}
        .part,.pose{inset:0;width:100%;height:100%}
        .rig,.flat{transition:opacity .38s ease}
        .pose{opacity:0}
        .pose.on{opacity:1}
        .mouth{opacity:0;transition:opacity 45ms linear}
        .mouth.on{opacity:1}
        .eyes{opacity:0}
        @media (prefers-reduced-motion:reduce){.rig,.flat{transition:none}}
      </style>
      <div class="stage">
      <div class="floor" part="shadow"></div>
      <div class="fig">
        <div class="rig">
          ${part('leg-l', 'leg-l.webp', RIG.legs.l.hip)}
          ${part('leg-r', 'leg-r.webp', RIG.legs.r.hip)}
          ${part('shoe-l', 'shoe-l.webp', RIG.legs.l.ankle)}
          ${part('shoe-r', 'shoe-r.webp', RIG.legs.r.ankle)}
          <div class="upper">
            <img class="part shoulders" src="${rig}shoulders.webp" alt="" draggable="false">
            ${part('arm-l', 'arm-l.webp', RIG.armL)}
            ${part('arm-l-out', 'arm-l-out.webp', RIG.armL)}
            ${part('arm-r', 'arm-r.webp', RIG.armR)}
            ${part('arm-r-out', 'arm-r-out.webp', RIG.armR)}
            <img class="part torso" src="${rig}torso.webp" alt="" draggable="false">
            <div class="head">
              <img class="part" src="${rig}head.webp" alt="" draggable="false">
              ${part('brow-l', 'brow-l.webp', RIG.brows.l)}
              ${part('brow-r', 'brow-r.webp', RIG.brows.r)}
              <div class="face">${mouthImgs}</div>
              ${lidImgs}
              ${eyeImg('idle')}
            </div>
          </div>
        </div>
        <div class="flat">${flatImgs}${eyeImg('think')}</div>
      </div>
      </div>`;
    const $ = s => this.shadowRoot.querySelector(s);
    const all = s => [...this.shadowRoot.querySelectorAll(s)];
    this._el = {
      fig: $('.fig'), rig: $('.rig'), flat: $('.flat'), upper: $('.upper'), head: $('.head'), floor: $('.floor'),
      legL: $('.leg-l'), legR: $('.leg-r'), shoeL: $('.shoe-l'), shoeR: $('.shoe-r'),
      browL: $('.brow-l'), browR: $('.brow-r'), lids: all('.lid'),
      armL: $('.arm-l'), armLOut: $('.arm-l-out'), armR: $('.arm-r'), armROut: $('.arm-r-out'),
      poses: Object.fromEntries(all('.pose').map(i => [i.dataset.pose, i])),
      mouths: Object.fromEntries(all('.mouth').map(i => [i.dataset.mouth, i])),
      eyes: Object.fromEntries(all('.eyes').map(i => [i.dataset.eyes, i])),
    };
    this.setAttribute('role', 'img');
    if (!this.hasAttribute('aria-label')) this.setAttribute('aria-label', 'Stu, the learning assistant');
    // Decode everything up front so pose and mouth swaps never flash blank.
    all('img').forEach(i => i.decode && i.decode().catch(() => {}));
    this._el.mouths.rest.classList.add('on'); this._mouth = 'rest';
    this._applyPose(this._pose);
  }

  // ---------- public API ----------
  /** Call from a user click/tap so the browser allows audio later. */
  unlock() { const c = audioContext(); if (c.state === 'suspended') c.resume(); return c; }

  setPose(name) {
    if (!POSES[name]) return;
    this._pose = name;
    this._applyPose(name);
  }

  async speak({ audio, cues = null, gesture } = {}) {
    if (!audio) throw new Error('stu-avatar: speak() needs { audio }');
    const ctx = this.unlock();
    this.stop(true);
    const token = (this._token = Symbol());

    const [buffer, cueList] = await Promise.all([toAudioBuffer(ctx, audio), loadCues(cues)]);
    if (token !== this._token) return; // a newer speak() or stop() happened meanwhile
    if (ctx.state === 'suspended') await ctx.resume();

    if (!this._analyser) {
      this._analyser = ctx.createAnalyser();
      this._analyser.fftSize = 1024; this._analyser.smoothingTimeConstant = 0;
      this._analyser.connect(ctx.destination);
      this._td = new Float32Array(1024); this._fd = new Float32Array(512);
    }
    this._cues = cueList;
    this._src = ctx.createBufferSource();
    this._src.buffer = buffer;
    this._src.connect(this._analyser);

    const useGesture = gesture ?? (this.getAttribute('gestures') !== 'off');
    if (useGesture) {
      this.setPose('open');
      this._gestureTimer = setTimeout(() => { if (this._playing) this.setPose('idle'); }, Math.min(3200, buffer.duration * 400));
    } else if (!POSES[this._pose].mouth) this.setPose('idle');

    return new Promise(resolve => {
      this._resolve = resolve;
      this._src.onended = () => this._finish(false);
      this._startedAt = ctx.currentTime;
      this._src.start();
      this._playing = true;
      this.dispatchEvent(new CustomEvent('speakstart'));
    });
  }

  async follow(media, { cues = null, gesture } = {}) {
    if (!media) throw new Error('stu-avatar: follow() needs a media element');
    this.stop(true);
    const token = (this._token = Symbol());

    let cueList = await loadCues(cues);
    if (!cueList) cueList = await envelopeCues(media.currentSrc || media.src).catch(() => null);
    if (token !== this._token) return;
    this._cues = cueList;
    this._media = media;

    const useGesture = gesture ?? (this.getAttribute('gestures') !== 'off');
    if (useGesture) {
      this.setPose('open');
      const duration = isFinite(media.duration) ? media.duration : 8;
      this._gestureTimer = setTimeout(() => { if (this._playing) this.setPose('idle'); }, Math.min(3200, duration * 400));
    } else if (!POSES[this._pose].mouth) this.setPose('idle');

    return new Promise(resolve => {
      this._resolve = resolve;
      this._onMediaEnded = () => this._finish(false);
      media.addEventListener('ended', this._onMediaEnded);
      this._playing = true;
      this.dispatchEvent(new CustomEvent('speakstart'));
    });
  }

  setMood(name, intensity = 1) {
    const mood = MOODS[name] || MOODS.neutral;
    const k = clamp(intensity, 0.3, 1.6);
    const base = {};
    for (const [key, value] of Object.entries(mood.base)) base[key] = REST[key] + (value - REST[key]) * k;
    this._moodBase = base;
    this._energy = mood.energy * k;
    this._restMouth = mood.mouth || 'rest';
    // Moods are for talking poses: a real mood leaves the flat thinking pose
    // (calming to neutral doesn't, e.g. while a new line is generating).
    if (name !== 'neutral' && !POSES[this._pose].rig) this.setPose('idle');
    if (mood.gesture && this._moving()) this._gesture = { keys: GESTURES[mood.gesture], start: this._clock() };
  }

  act(name) {
    if (ACTIONS[name] && this._moving()) this._action = { keys: ACTIONS[name], start: this._clock() };
  }

  stop(silent = false) {
    this._token = Symbol();
    if (this._playing) this._finish(true, silent);
  }

  // ---------- internals ----------
  _finish(interrupted, silent) {
    clearTimeout(this._gestureTimer);
    if (this._src) { this._src.onended = null; try { this._src.stop(); } catch (e) {} this._src.disconnect(); this._src = null; }
    if (this._media) {
      this._media.removeEventListener('ended', this._onMediaEnded);
      if (interrupted && !this._media.paused) this._media.pause();
      this._media = null;
    }
    this._playing = false;
    if (this._pose === 'open' && this.getAttribute('gestures') !== 'off') this.setPose('idle');
    if (!silent) this.dispatchEvent(new CustomEvent('speakend', { detail: { interrupted } }));
    if (this._resolve) { const r = this._resolve; this._resolve = null; r({ interrupted }); }
  }

  _applyPose(name) {
    if (!this._el) return;
    const rig = !!POSES[name].rig;
    this._el.rig.style.opacity = rig ? 1 : 0;
    this._el.flat.style.opacity = rig ? 0 : 1;
    for (const [k, img] of Object.entries(this._el.poses)) img.classList.toggle('on', k === name);
  }

  _setMouth(name, now, force) {
    if (name === 'rest') name = this._restMouth;
    if (name === this._mouth) return;
    if (!force && now - this._mouthSince < 75) return;
    if (this._el) {
      this._el.mouths[this._mouth].classList.remove('on');
      this._el.mouths[name].classList.add('on');
    }
    this._mouth = name; this._mouthSince = now;
  }

  _cueMouth(t) {
    const c = this._cues;
    let lo = 0, hi = c.length - 1;
    while (lo < hi) { const m = (lo + hi + 1) >> 1; if (c[m].start <= t) lo = m; else hi = m - 1; }
    const cue = c[lo];
    if (t < cue.start) return 'rest';
    const dur = (cue.end ?? cue.start + 1) - cue.start;
    if (cue.value === 'D' && dur > 0.16) return 'wide';
    if (cue.value === 'B' && dur > 0.25) return 'mid';
    return RHUBARB[cue.value] || 'rest';
  }

  _liveMouth() {
    const a = this._analyser, ctx = audioContext();
    a.getFloatTimeDomainData(this._td);
    let s = 0; for (let i = 0; i < this._td.length; i++) s += this._td[i] * this._td[i];
    const db = 20 * Math.log10(Math.sqrt(s / this._td.length) + 1e-6);
    a.getFloatFrequencyData(this._fd);
    const bin = ctx.sampleRate / a.fftSize;
    const band = (lo, hi) => { let m = 0, n = 0; for (let i = Math.floor(lo / bin); i < Math.floor(hi / bin); i++) { m += Math.pow(10, this._fd[i] / 20); n++; } return m / Math.max(1, n); };
    const lr = Math.log10(band(200, 900) / (band(1800, 5000) + 1e-9) + 1e-9);
    const lv = clamp((db + 45) / 27);
    const tOpen = lv < 0.14 ? 0 : Math.pow((lv - 0.14) / 0.86, 0.9);
    const L = this._lvl, ease = (c, t, u, d) => c + (t - c) * (t > c ? u : d);
    L.open = ease(L.open, tOpen, .55, .3);
    L.round = ease(L.round, tOpen > .12 ? clamp((lr - 1.2) / 0.7) : 0, .3, .2);
    L.spread = ease(L.spread, tOpen > .05 ? clamp((0.85 - lr) / 0.7) : 0, .3, .2);
    if (L.open < 0.08) return 'rest';
    if (L.round > 0.5 && L.open > 0.2) return 'round';
    if (L.spread > 0.55 && L.open < 0.7) return 'grin';
    if (L.open < 0.3) return 'small';
    if (L.open < 0.55) return 'mid';
    if (L.open < 0.8) return 'open';
    return 'wide';
  }

  _blink(now) {
    if (this._blinkT < 0 && now > this._nextBlink) this._blinkT = now;
    if (this._blinkT < 0) return 0;
    const d = now - this._blinkT, dur = 170;
    if (d > dur) {
      this._blinkT = -1;
      if (!this._double && this._rand() < 0.2) { this._double = true; this._nextBlink = now + 110; }
      else { this._double = false; this._nextBlink = now + 2400 + this._rand() * 3600; }
      return 0;
    }
    const x = d / dur; return x < 0.4 ? x / 0.4 : 1 - (x - 0.4) / 0.6;
  }

  _drawLids(p) {
    const active = POSES[this._pose].eyes;
    const o = clamp((p - 0.2) / 0.45);
    this._lidOpacity = o;
    if (!this._el) return;
    for (const [k, img] of Object.entries(this._el.eyes)) img.style.opacity = k === active ? o.toFixed(3) : 0;
  }

  _frame(now) {
    this._raf = requestAnimationFrame(t => this._frame(t));
    if (!this._el) return;
    this._tick(now);
  }

  // One step of everything that moves: mouth, blinks, joints. Draws to the
  // shadow DOM when there is one (the live element); StuPlayer calls it with
  // its own clock and paints to a canvas instead.
  _tick(now) {
    if (POSES[this._pose].mouth) {
      const media = this._media;
      const talking = this._playing && (!media || (!media.paused && !media.ended));
      if (talking && this._cues) {
        let t;
        if (this._timeSource) t = this._timeSource();
        else if (media) t = media.currentTime;
        else {
          const ctx = audioContext();
          t = ctx.currentTime - this._startedAt - (ctx.outputLatency || ctx.baseLatency || 0);
        }
        this._setMouth(this._cueMouth(Math.max(0, t)), now, true);
      } else if (talking && !media && this._analyser) {
        this._setMouth(this._liveMouth(), now, false);
      } else {
        this._setMouth('rest', now, true);
      }
    }
    this._drawLids(this._blink(now));
    const moving = this._moving();
    const dt = this._lastFrame ? Math.min(0.05, (now - this._lastFrame) / 1000) : 0;
    this._lastFrame = now;
    if (POSES[this._pose].rig) this._animateRig(now, dt, moving);
  }

  _moving() { return this.getAttribute('motion') !== 'off' && !this._reduced; }

  _isTalking() {
    const media = this._media;
    return this._playing && (!media || (!media.paused && !media.ended));
  }

  // Sets the value of each channel a gesture drives at `t` ms into it. A
  // channel past its last key is left alone, so it eases back to the posture.
  // Returns false once the whole gesture is over.
  _track(gesture, t, out) {
    const keys = gesture.keys;
    const channels = new Set(keys.flatMap(([, v]) => Object.keys(v)));
    let active = false;
    for (const ch of channels) {
      let prev = null, next = null;
      for (const [ms, v] of keys) {
        if (!(ch in v)) continue;
        if (ms <= t) prev = [ms, v[ch]];
        else { next = [ms, v[ch]]; break; }
      }
      if (!next && (!prev || t > prev[0] + 120)) continue;
      active = true;
      if (!prev) { out[ch] = next[1]; continue; }
      if (!next) { out[ch] = prev[1]; continue; }
      const f = (t - prev[0]) / (next[0] - prev[0]);
      out[ch] = prev[1] + (next[1] - prev[1]) * (0.5 - Math.cos(f * Math.PI) / 2);
    }
    return active;
  }

  _animateRig(now, dt, moving) {
    this._simulateRig(now, dt, moving);
    if (this._el) this._drawRigDom(this._rigPose(now, moving));
  }

  _simulateRig(now, dt, moving) {
    const t = now / 1000;
    const talking = this._isTalking();

    // 1) Posture: rest, then the pose's arms (open = held out), then the mood.
    const target = { ...REST };
    if (POSES[this._pose].arms !== undefined) target.armL = target.armR = POSES[this._pose].arms;
    Object.assign(target, this._moodBase);

    if (moving) {
      // 2) Talking beats: every couple of seconds one arm gives a small lift,
      //    alternating sides, sized by the mood's energy.
      if (talking && !this._beat && now > this._nextBeat) {
        const ch = this._beatSide === 'R' ? 'armR' : 'armL';
        this._beatSide = this._beatSide === 'R' ? 'L' : 'R';
        let up = target[ch] + 10 + 14 * this._energy;
        // Don't let a beat park the arm in the sprite cross-fade.
        if (target[ch] < ARM_BLEND[0]) up = Math.min(up, ARM_BLEND[0] - 4);
        // The knees dip on the beat too - more for high-energy moods.
        const dip = target.crouch + 0.08 + 0.14 * this._energy;
        this._beat = { keys: [[0, { [ch]: target[ch], crouch: target.crouch }], [220, { [ch]: up, crouch: dip }], [520, { [ch]: up - 4, crouch: target.crouch }], [800, { [ch]: target[ch] }]], start: now };
        this._nextBeat = now + 1300 + this._rand() * 1700;
      }
      if (this._beat && !this._track(this._beat, now - this._beat.start, target)) this._beat = null;
      // 3) The mood's gesture wins over beats on the channels it uses.
      if (this._gesture && !this._track(this._gesture, now - this._gesture.start, target)) this._gesture = null;
      // 3b) Actions (act()) win over both; when idle, an occasional fidget.
      if (!talking && !this._gesture && !this._action && now > this._nextFidget) {
        if (this._nextFidget) {
          const fidgets = ['fidgetTap', 'fidgetShift', 'fidgetHeel'];
          this._action = { keys: ACTIONS[fidgets[Math.floor(this._rand() * fidgets.length)]], start: now };
        }
        this._nextFidget = now + 3500 + this._rand() * 4000;
      }
      if (this._action && !this._track(this._action, now - this._action.start, target)) this._action = null;

      // 4) Life: slow weight shift, relaxed arms, a head that wanders a little,
      //    and a head bob that follows the mouth while talking.
      if (now > this._nextDrift) {
        this._driftTarget = (this._rand() * 2 - 1) * (talking ? 3 : 2.5);
        this._nextDrift = now + 2500 + this._rand() * 4000;
      }
      this._drift += (this._driftTarget - this._drift) * (1 - Math.exp(-dt * 1.2));
      target.lean += Math.sin(t * 0.37) * 0.9 + Math.sin(t * 0.83) * 0.3;
      target.armL += Math.sin(t * 0.61) * 2.2;
      target.armR += Math.sin(t * 0.53 + 1.7) * 2.2;
      target.headTilt += this._drift + Math.sin(t * 0.29) * 0.8;
      const open = talking ? (MOUTH_OPEN[this._mouth] ?? 0) : 0;
      this._talk += (open - this._talk) * (1 - Math.exp(-dt * 10));
      target.headY += this._talk * 0.004; // a small dip as the mouth opens
      target.headTilt += this._talk * 1.2 * Math.sin(t * 1.9);
      // Brows lift a little on emphasis; knees give a small bounce.
      target.browL -= this._talk * 2.5;
      target.browR -= this._talk * 2.5;
      target.crouch += this._talk * 0.05;
      // Slowly shifting his weight from one leg to the other.
      target.hipX += Math.sin(t * 0.27) * 3.5 + Math.sin(t * 0.71) * 1.2;
    }

    // 5) Springs: every joint glides to its target, critically damped.
    for (const [ch, j] of Object.entries(this._joint)) {
      const goal = target[ch];
      if (!moving) { j.x = goal; j.v = 0; continue; }
      const w = STIFF[ch];
      j.v += (w * w * (goal - j.x) - 2 * w * j.v) * dt;
      j.x += j.v * dt;
    }

  }

  // Where every part is this frame, in the rig's 690x750 layer space. Both the
  // DOM (live) and canvas (video export) renderers draw from this.
  _rigPose(now, moving) {
    const J = Object.fromEntries(Object.entries(this._joint).map(([k, j]) => [k, j.x]));
    const breath = moving ? Math.sin(now / 1000 * 1.6) : 0;
    const air = Math.max(0, J.lift);
    // Raising an arm pulls the shirt and shoulders up with it a little.
    const raise = clamp((Math.max(J.armL, J.armR) - 50) / 100);
    const arm = angle => {
      // Above ~135deg the sleeve would swing past the shoulder the art can
      // support, so arms stop there ("hands up" reads fine at 135).
      const a = clamp(angle, -10, 135);
      return { a, fade: clamp((a - ARM_BLEND[0]) / (ARM_BLEND[1] - ARM_BLEND[0])) };
    };
    const drop = clamp(J.crouch, 0, 1.4) * RIG.crouchPx;
    const hipX = clamp(J.hipX, -24, 24);
    // Upper eyelids: fade between the nearest two part-closed levels.
    const lidsV = clamp(J.lids, 0, LID_LEVELS[LID_LEVELS.length - 1]);
    const lids = LID_LEVELS.map(() => 0);
    const above = LID_LEVELS.findIndex(l => l > lidsV);
    if (above === -1) lids[lids.length - 1] = 1;
    else if (above === 0) lids[0] = lidsV / LID_LEVELS[0];
    else { lids[above - 1] = 1; lids[above] = (lidsV - LID_LEVELS[above - 1]) / (LID_LEVELS[above] - LID_LEVELS[above - 1]); }
    return {
      lift: J.lift,
      legL: legIK(RIG.legs.l, -1, hipX, drop, clamp(J.liftL, 0, 1) * RIG.liftPx, clamp(J.splayL, -6, 32)),
      legR: legIK(RIG.legs.r, 1, hipX, drop, clamp(J.liftR, 0, 1) * RIG.liftPx, clamp(J.splayR, -6, 32)),
      hipX,
      upperY: drop / RIG.h + J.rise,
      // Brows: inner end up (worried) is counter-clockwise for the screen-left
      // brow and clockwise for the right one.
      browL: { dy: clamp(J.browL, -18, 8), rot: -clamp(J.tiltL, -22, 22) },
      browR: { dy: clamp(J.browR, -18, 8), rot: clamp(J.tiltR, -22, 22) },
      lids,
      // Head tilt and hip lean are capped to what the hidden fillers (neck,
      // top of the legs) can cover without showing a seam.
      lean: clamp(J.lean, -2, 2),
      scaleX: 1 + 0.003 * breath,
      scaleY: 1 + 0.007 * breath + 0.014 * raise,
      armL: arm(J.armL),
      armR: arm(J.armR),
      // His head sits right on the collar with no neck in the art: it may dip
      // (nods) but barely rise, and tilts stay small, or the shoulder line shows.
      headX: J.headX, headY: clamp(J.headY, -0.003, 0.02), headTilt: clamp(J.headTilt, -3, 3),
      floorScale: (1 - 0.02 * breath) * (1 - air * 4),
      floorOpacity: clamp(1 - air * 8),
    };
  }

  _drawRigDom(P) {
    const e = this._el;
    e.fig.style.transform = `translateY(${(-P.lift * 100).toFixed(3)}%)`;
    const px = (x, total) => (x / total * 100).toFixed(3) + '%';
    for (const [leg, legEl, shoeEl] of [[P.legL, e.legL, e.shoeL], [P.legR, e.legR, e.shoeR]]) {
      legEl.style.transform = `translate(${px(leg.leg.dx, RIG.w)}, ${px(leg.leg.dy, RIG.h)}) rotate(${leg.leg.rot.toFixed(2)}deg) scaleY(${leg.leg.sy.toFixed(4)})`;
      shoeEl.style.transform = `translate(${px(leg.shoe.dx, RIG.w)}, ${px(leg.shoe.dy, RIG.h)}) rotate(${leg.shoe.rot.toFixed(2)}deg)`;
    }
    e.upper.style.transform = `translate(${px(P.hipX, RIG.w)}, ${(P.upperY * 100).toFixed(3)}%) rotate(${P.lean.toFixed(3)}deg) scale(${P.scaleX.toFixed(4)}, ${P.scaleY.toFixed(4)})`;
    e.browL.style.transform = `translateY(${px(P.browL.dy, RIG.h)}) rotate(${P.browL.rot.toFixed(2)}deg)`;
    e.browR.style.transform = `translateY(${px(P.browR.dy, RIG.h)}) rotate(${P.browR.rot.toFixed(2)}deg)`;
    e.lids.forEach((img, i) => { img.style.opacity = P.lids[i].toFixed(3); });
    this._drawArm(e.armL, e.armLOut, P.armL, 1);
    this._drawArm(e.armR, e.armROut, P.armR, -1);
    e.head.style.transform = `translate(${(P.headX * 100).toFixed(3)}%, ${(P.headY * 100).toFixed(3)}%) rotate(${P.headTilt.toFixed(3)}deg)`;
    e.floor.style.transform = `scaleX(${P.floorScale.toFixed(4)})`;
    e.floor.style.opacity = P.floorOpacity.toFixed(3);
  }

  // side: 1 = screen-left arm (raising it out is clockwise), -1 = screen-right.
  // The hanging sprite shows below ARM_BLEND, the open-hand sprite above it.
  // Across the blend the hanging arm stays solid and the open one fades in on
  // top (drawn later), so the pair never looks see-through.
  _drawArm(down, out, { a, fade }, side) {
    down.style.opacity = fade < 1 ? 1 : 0;
    out.style.opacity = fade.toFixed(3);
    down.style.transform = `rotate(${(side * a).toFixed(2)}deg)`;
    out.style.transform = `rotate(${(side * (a - RIG.outAngle)).toFixed(2)}deg)`;
  }

  // Canvas mirror of _drawRigDom + the shadow DOM layout, in layer space
  // (690x750; the caller positions and scales it). S = loadStuSprites().
  _paint(ctx, S, shadow = 'rgba(22,33,58,0.28)') {
    const P = this._rigPose(this._clock(), this._moving());
    const W = RIG.w, H = RIG.h, DEG = Math.PI / 180;
    const around = ([x, y], fn) => { ctx.translate(x, y); fn(); ctx.translate(-x, -y); };
    const full = img => ctx.drawImage(img, 0, 0, W, H);

    // Floor shadow (the .floor box: left 27%, width 46%, top 95.6%, height 4.2%).
    ctx.save();
    ctx.globalAlpha = P.floorOpacity;
    ctx.translate(W * 0.5, H * (0.956 + 0.021));
    ctx.scale(W * 0.23 * P.floorScale, H * 0.021);
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
    g.addColorStop(0, shadow);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(0, 0, 1, 0, Math.PI * 2); ctx.fill();
    ctx.restore();

    ctx.save();
    ctx.translate(0, -P.lift * H);
    for (const [leg, rig, img] of [[P.legL, RIG.legs.l, S.legL], [P.legR, RIG.legs.r, S.legR]]) {
      ctx.save();
      around(rig.hip, () => { ctx.translate(leg.leg.dx, leg.leg.dy); ctx.rotate(leg.leg.rot * DEG); ctx.scale(1, leg.leg.sy); });
      full(img);
      ctx.restore();
    }
    for (const [leg, rig, img] of [[P.legL, RIG.legs.l, S.shoeL], [P.legR, RIG.legs.r, S.shoeR]]) {
      ctx.save();
      around(rig.ankle, () => { ctx.translate(leg.shoe.dx, leg.shoe.dy); ctx.rotate(leg.shoe.rot * DEG); });
      full(img);
      ctx.restore();
    }
    ctx.save();
    around(RIG.hips, () => { ctx.translate(P.hipX, P.upperY * H); ctx.rotate(P.lean * DEG); ctx.scale(P.scaleX, P.scaleY); });
    const arm = (down, out, pose, pivot, side) => {
      for (const [img, alpha, angle] of [[down, pose.fade < 1 ? 1 : 0, side * pose.a], [out, pose.fade, side * (pose.a - RIG.outAngle)]]) {
        if (alpha <= 0.001) continue;
        ctx.save();
        ctx.globalAlpha = alpha;
        around(pivot, () => ctx.rotate(angle * DEG));
        full(img);
        ctx.restore();
      }
    };
    full(S.shoulders);
    arm(S.armL, S.armLOut, P.armL, RIG.armL, 1);
    arm(S.armR, S.armROut, P.armR, RIG.armR, -1);
    full(S.torso);
    ctx.save();
    around(RIG.head, () => { ctx.translate(P.headX * W, P.headY * H); ctx.rotate(P.headTilt * DEG); });
    full(S.head);
    for (const [img, brow, pivot] of [[S.browL, P.browL, RIG.brows.l], [S.browR, P.browR, RIG.brows.r]]) {
      ctx.save();
      around(pivot, () => { ctx.translate(0, brow.dy); ctx.rotate(brow.rot * DEG); });
      full(img);
      ctx.restore();
    }
    ctx.drawImage(S.mouths[this._mouth], MOUTH_BOX.x - VB.x, MOUTH_BOX.y - VB.y, MOUTH_BOX.w, MOUTH_BOX.h);
    const e = EYES.idle;
    P.lids.forEach((alpha, i) => {
      if (alpha <= 0.001) return;
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.drawImage(S.lids[i], e.x - VB.x, e.y - VB.y, e.w, e.h);
      ctx.restore();
    });
    if (this._lidOpacity > 0.001) {
      ctx.globalAlpha = this._lidOpacity;
      ctx.drawImage(S.eyes, e.x - VB.x, e.y - VB.y, e.w, e.h);
    }
    ctx.restore(); // head
    ctx.restore(); // upper
    ctx.restore(); // lift
  }
}

// ---------- offline rendering (video export) ----------

/** Loads every image the canvas renderer needs. */
export async function loadStuSprites(assets = DEFAULT_ASSETS) {
  const base = new URL(assets.endsWith('/') ? assets : assets + '/', document.baseURI).href;
  const load = src => new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => res(img);
    img.onerror = () => rej(new Error(`stu-avatar: could not load ${src}`));
    img.src = src;
  });
  const rig = name => load(`${base}rig/${name}.webp`);
  const names = ['leg-l', 'leg-r', 'shoe-l', 'shoe-r', 'shoulders', 'arm-l', 'arm-l-out', 'arm-r', 'arm-r-out', 'torso', 'head', 'brow-l', 'brow-r'];
  const [parts, eyes, lids, mouths] = await Promise.all([
    Promise.all(names.map(rig)),
    load(`${base}eyes-closed-idle.png`),
    Promise.all(LID_LEVELS.map(l => load(`${base}rig/eyes-lid-${Math.round(l * 100)}.png`))),
    Promise.all(MOUTHS.map(k => load(`${base}${mouthFile(k)}`))),
  ]);
  const [legL, legR, shoeL, shoeR, shoulders, armL, armLOut, armR, armROut, torso, head, browL, browR] = parts;
  return {
    legL, legR, shoeL, shoeR, shoulders, armL, armLOut, armR, armROut, torso, head, browL, browR, eyes, lids,
    mouths: Object.fromEntries(MOUTHS.map((k, i) => [k, mouths[i]])),
  };
}

/**
 * Front-view leg pose. The hip moves with the body (hipX sideways, drop
 * down); the foot stays planted unless lifted or swung out (splay, degrees
 * around the hip). The leg piece points from hip to ankle and compresses as
 * they come closer (a bent knee, seen from the front); the shoe follows the
 * foot with a little of the leg's tilt. side: -1 screen-left leg, 1 right.
 * Returns transforms relative to the rest pose (layer px, degrees).
 */
function legIK(leg, side, hipX, drop, lift, splay = 0) {
  const [hx0, hy0] = leg.hip, [ax0, ay0] = leg.ankle, [fx0, fy0] = leg.foot;
  const H = [hx0 + hipX, hy0 + drop];
  let F = [fx0 + hipX * 0.12 - side * RIG.footIn * lift, fy0 - lift];
  if (splay) {
    const a = -side * splay * Math.PI / 180, dx = F[0] - H[0], dy = F[1] - H[1];
    F = [H[0] + dx * Math.cos(a) - dy * Math.sin(a), H[1] + dx * Math.sin(a) + dy * Math.cos(a)];
  }
  const A = [F[0] + (ax0 - fx0), F[1] - (fy0 - ay0)];
  const L = ay0 - hy0;
  const vx = A[0] - H[0], vy = A[1] - H[1];
  const rot = Math.atan2(-vx, vy) * 180 / Math.PI;
  const sy = Math.max(RIG.legSquashMin, Math.min(1.08, Math.hypot(vx, vy) / L));
  // With the leg's length clamped, put the ankle where the leg actually ends.
  const len = sy * L, ang = rot * Math.PI / 180;
  const ankle = [H[0] - Math.sin(ang) * len, H[1] + Math.cos(ang) * len];
  return {
    leg: { dx: H[0] - hx0, dy: H[1] - hy0, rot, sy },
    shoe: { dx: ankle[0] - ax0, dy: ankle[1] - ay0, rot: rot * 0.35 },
  };
}

function seededRandom(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Replays a clip offline for video export. Drive it with setMood() at the
 * right moments and advance(t) to each frame's time, then paint(ctx).
 *
 *   const player = await StuPlayer.create({ cues, audioBuffer });
 *   player.advance(t); player.paint(ctx);   // ctx already placed and scaled
 *
 * Time t is seconds into the clip. Stu talks for [0, duration] and settles
 * for a moment before t = 0 so the first frame isn't mid-transition.
 */
export class StuPlayer {
  static async create({ assets = DEFAULT_ASSETS, cues = null, audioBuffer = null, duration = audioBuffer ? audioBuffer.duration : Infinity, seed = 7 } = {}) {
    const sprites = await loadStuSprites(assets);
    let list = await loadCues(cues);
    if (!list && audioBuffer) list = envelopeFromBuffer(audioBuffer);
    return new StuPlayer(sprites, list, duration, seed);
  }

  constructor(sprites, cues, duration, seed) {
    this.sprites = sprites;
    this.duration = duration;
    this.t = -1.2;
    const stu = this.stu = document.createElement('stu-avatar'); // never attached: no shadow DOM, no rAF
    // Keep the internal clock positive; 10s offset is arbitrary.
    const ms = () => (this.t + 10) * 1000;
    stu._clock = ms;
    stu._rand = seededRandom(seed);
    stu._timeSource = () => this.t;
    stu._nextBlink = ms() + 1800;
    stu._cues = cues;
    stu._tick(ms()); // prime the frame clock
    this.advance(0); // settle into the resting pose before the clip starts
  }

  setMood(name, intensity = 1) { this.stu.setMood(name, intensity); }

  act(name) { this.stu.act(name); }

  /** Step the simulation to clip time t (seconds), in small substeps. */
  advance(t) {
    const stu = this.stu;
    while (this.t < t - 1e-9) {
      this.t = Math.min(t, this.t + 1 / 60);
      stu._playing = this.t >= 0 && this.t < this.duration;
      stu._tick((this.t + 10) * 1000);
    }
  }

  /** Draw the current frame. ctx must already be transformed so that one unit
   * is one pixel of the 690x750 layer canvas (see RIG_SIZE / RIG_FEET). */
  paint(ctx, { shadow } = {}) { this.stu._paint(ctx, this.sprites, shadow); }
}

// Layer canvas size and where the feet touch the floor within it - for placing Stu in a scene.
export const RIG_SIZE = { w: RIG.w, h: RIG.h };
export const RIG_FEET = { x: RIG.feet[0], y: RIG.h * (0.956 + 0.021) };

async function toAudioBuffer(ctx, audio) {
  if (typeof AudioBuffer !== 'undefined' && audio instanceof AudioBuffer) return audio;
  let ab;
  if (typeof audio === 'string') {
    const r = await fetch(audio);
    if (!r.ok) throw new Error(`stu-avatar: could not load audio (${r.status}) ${audio}`);
    ab = await r.arrayBuffer();
  } else if (audio instanceof Blob) ab = await audio.arrayBuffer();
  else if (audio instanceof ArrayBuffer) ab = audio.slice(0);
  else throw new Error('stu-avatar: audio must be a URL, Blob, ArrayBuffer or AudioBuffer');
  return new Promise((res, rej) => { const p = ctx.decodeAudioData(ab, res, rej); if (p && p.then) p.then(res, rej); });
}

// Loudness-only cues for follow() when no Rhubarb file exists: RMS per ~33ms
// frame, bucketed onto the same letters (and dB scale) the live estimate uses.
async function envelopeCues(url) {
  return envelopeFromBuffer(await toAudioBuffer(audioContext(), url));
}

function envelopeFromBuffer(buf) {
  const data = buf.getChannelData(0), rate = buf.sampleRate, step = Math.round(rate / 30);
  const cues = [];
  for (let i = 0; i < data.length; i += step) {
    const n = Math.min(step, data.length - i);
    let s = 0; for (let j = 0; j < n; j++) s += data[i + j] * data[i + j];
    const lv = clamp((20 * Math.log10(Math.sqrt(s / n) + 1e-6) + 45) / 27);
    const value = lv < 0.14 ? 'X' : lv < 0.3 ? 'B' : lv < 0.55 ? 'C' : 'D';
    const last = cues[cues.length - 1];
    if (last && last.value === value) last.end = (i + n) / rate;
    else cues.push({ start: i / rate, end: (i + n) / rate, value });
  }
  return cues.length ? cues : null;
}

async function loadCues(cues) {
  if (!cues) return null;
  if (typeof cues === 'string') {
    const r = await fetch(cues);
    if (!r.ok) { console.warn('stu-avatar: cues not found, using live estimate', cues); return null; }
    cues = await r.json();
  }
  const list = Array.isArray(cues) ? cues : cues.mouthCues;
  if (!Array.isArray(list) || !list.length) return null;
  // Accept Rhubarb objects {start,end,value} or compact [start, value] pairs.
  return list.map((c, i) => Array.isArray(c)
    ? { start: c[0], end: list[i + 1] ? list[i + 1][0] : c[0] + 0.3, value: c[1] }
    : c).sort((a, b) => a.start - b.start);
}

if (!customElements.get('stu-avatar')) customElements.define('stu-avatar', StuAvatar);
export { StuAvatar };
