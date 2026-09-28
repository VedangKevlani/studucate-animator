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
 * Methods: unlock(), speak(opts) -> Promise, stop(), setPose(name)
 * Events:  'speakstart', 'speakend' (detail: { interrupted: boolean })
 */

const DEFAULT_ASSETS = new URL('./assets/', import.meta.url).href;

// Source images are 690x750 crops taken from a 1024x1024 canvas at offset (170,160).
const VB = { x: 170, y: 160, w: 690, h: 750 };
const MOUTH_BOX = { x: 445, y: 405, w: 130, h: 80 };
const MOUTHS = ['rest', 'small', 'grin', 'mid', 'open', 'wide', 'round'];
const POSES = {
  idle:  { img: 'stu-idle.webp',  mouth: true,  eyes: 'idle' },
  open:  { img: 'stu-open.webp',  mouth: true,  eyes: 'idle' },
  think: { img: 'stu-think.webp', mouth: false, eyes: 'think' },
};
// Closed-eye overlays (made from Stu's own skin) and where they sit.
const EYES = { idle: { x: 415, y: 340, w: 190, h: 90 }, think: { x: 415, y: 335, w: 195, h: 95 } };
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
    const base = this.assetsBase;
    const poseImgs = Object.entries(POSES).map(([k, p]) =>
      `<img class="pose" data-pose="${k}" src="${base}${p.img}" alt="" draggable="false">`).join('');
    const mouthImgs = MOUTHS.map(k =>
      `<img class="mouth" data-mouth="${k}" src="${base}mouth-${k}.png" alt="" draggable="false"
        style="left:${pct(MOUTH_BOX.x - VB.x, VB.w)};top:${pct(MOUTH_BOX.y - VB.y, VB.h)};width:${pct(MOUTH_BOX.w, VB.w)};height:${pct(MOUTH_BOX.h, VB.h)}">`).join('');
    const eyeImgs = Object.entries(EYES).map(([k, e]) =>
      `<img class="eyes" data-eyes="${k}" src="${base}eyes-closed-${k}.png" alt="" draggable="false"
        style="left:${pct(e.x - VB.x, VB.w)};top:${pct(e.y - VB.y, VB.h)};width:${pct(e.w, VB.w)};height:${pct(e.h, VB.h)}">`).join('');
    this.shadowRoot.innerHTML = `
      <style>
        :host{display:block;position:relative;aspect-ratio:${VB.w}/${VB.h};width:100%;max-width:100%;contain:layout paint}
        .floor{position:absolute;left:27%;width:46%;top:95.6%;height:4.2%;border-radius:50%;
               background:radial-gradient(closest-side,var(--stu-shadow,rgba(22,33,58,.28)),transparent)}
        .body{position:absolute;inset:0;transform-origin:50% 97.7%;will-change:transform}
        img{position:absolute;display:block;max-width:none;user-select:none;-webkit-user-drag:none}
        .pose{inset:0;width:100%;height:100%;opacity:0;transition:opacity .38s ease}
        .pose.on{opacity:1}
        .face{position:absolute;inset:0;transition:opacity .25s ease}
        .mouth{opacity:0;transition:opacity 45ms linear}
        .mouth.on{opacity:1}
        .eyes{opacity:0}
        @media (prefers-reduced-motion:reduce){.pose,.face{transition:none}}
      </style>
      <div class="floor" part="shadow"></div>
      <div class="body">
        ${poseImgs}
        <div class="face">${mouthImgs}</div>
        ${eyeImgs}
      </div>`;
    const $ = s => this.shadowRoot.querySelector(s);
    this._el = {
      body: $('.body'), floor: $('.floor'), face: $('.face'),
      poses: Object.fromEntries([...this.shadowRoot.querySelectorAll('.pose')].map(i => [i.dataset.pose, i])),
      mouths: Object.fromEntries([...this.shadowRoot.querySelectorAll('.mouth')].map(i => [i.dataset.mouth, i])),
      eyes: Object.fromEntries([...this.shadowRoot.querySelectorAll('.eyes')].map(i => [i.dataset.eyes, i])),
    };
    this.setAttribute('role', 'img');
    if (!this.hasAttribute('aria-label')) this.setAttribute('aria-label', 'Stu, the learning assistant');
    // Decode everything up front so pose and mouth swaps never flash blank.
    [...Object.values(this._el.poses), ...Object.values(this._el.mouths), ...Object.values(this._el.eyes)].forEach(i => i.decode && i.decode().catch(() => {}));
    this._el.mouths.rest.classList.add('on'); this._mouth = 'rest';
    this._applyPose(this._pose);
  }

  // ---------- public API ----------
  /** Call from a user click/tap so the browser allows audio later. */
  unlock() { const c = audioContext(); if (c.state === 'suspended') c.resume(); return c; }

  setPose(name) {
    if (!POSES[name]) return;
    this._pose = name;
    const img = this._el && this._el.poses[name];
    if (img && !img.complete && img.decode) img.decode().then(() => this._applyPose(name), () => this._applyPose(name));
    else this._applyPose(name);
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

  stop(silent = false) {
    this._token = Symbol();
    if (this._playing) this._finish(true, silent);
  }

  // ---------- internals ----------
  _finish(interrupted, silent) {
    clearTimeout(this._gestureTimer);
    if (this._src) { this._src.onended = null; try { this._src.stop(); } catch (e) {} this._src.disconnect(); this._src = null; }
    this._playing = false;
    if (this._pose === 'open' && this.getAttribute('gestures') !== 'off') this.setPose('idle');
    if (!silent) this.dispatchEvent(new CustomEvent('speakend', { detail: { interrupted } }));
    if (this._resolve) { const r = this._resolve; this._resolve = null; r({ interrupted }); }
  }

  _applyPose(name) {
    if (!this._el) return;
    for (const [k, img] of Object.entries(this._el.poses)) img.classList.toggle('on', k === name);
    this._el.face.style.opacity = POSES[name].mouth ? 1 : 0;
  }

  _setMouth(name, now, force) {
    if (name === this._mouth) return;
    if (!force && now - this._mouthSince < 75) return;
    this._el.mouths[this._mouth].classList.remove('on');
    this._el.mouths[name].classList.add('on');
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
      if (!this._double && Math.random() < 0.2) { this._double = true; this._nextBlink = now + 110; }
      else { this._double = false; this._nextBlink = now + 2400 + Math.random() * 3600; }
      return 0;
    }
    const x = d / dur; return x < 0.4 ? x / 0.4 : 1 - (x - 0.4) / 0.6;
  }

  _drawLids(p) {
    const active = POSES[this._pose].eyes;
    const o = clamp((p - 0.2) / 0.45);
    for (const [k, img] of Object.entries(this._el.eyes)) img.style.opacity = k === active ? o.toFixed(3) : 0;
  }

  _frame(now) {
    this._raf = requestAnimationFrame(t => this._frame(t));
    if (!this._el) return;
    if (POSES[this._pose].mouth) {
      if (this._playing && this._cues) {
        const ctx = audioContext();
        const t = ctx.currentTime - this._startedAt - (ctx.outputLatency || ctx.baseLatency || 0);
        this._setMouth(this._cueMouth(Math.max(0, t)), now, true);
      } else if (this._playing && this._analyser) {
        this._setMouth(this._liveMouth(), now, false);
      } else {
        this._setMouth('rest', now, true);
      }
    }
    this._drawLids(this._blink(now));
    const moving = this.getAttribute('motion') !== 'off' && !this._reduced;
    const t = now / 1000, m = moving ? 1 : 0;
    const breath = Math.sin(t * 1.6) * m;
    const sway = (Math.sin(t * 0.55) * 0.7 + Math.sin(t * 1.3) * 0.2) * m;
    this._el.body.style.transform = `rotate(${sway.toFixed(3)}deg) scale(${(1 + 0.004 * breath).toFixed(4)}, ${(1 + 0.009 * breath).toFixed(4)})`;
    this._el.floor.style.transform = `scaleX(${(1 - 0.02 * breath).toFixed(4)})`;
  }
}

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
