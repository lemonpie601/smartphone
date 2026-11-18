// ── sounds: every sound on the phone, synthesised with Web Audio so the package ships no audio files ──
// Browsers allow sound only after the user has pressed something on the page, so the audio context starts on
// the first pointer press. 설정 → 소리 turns everything off; 설정 → 터치음 turns off taps and keypad tones.

let audio = null;
let noiseBuffer = null;

function audioContext() {
  if (data.settings.sound === false) return null;
  try {
    audio ??= new (window.AudioContext || window.webkitAudioContext)();
    if (audio.state === "suspended") void audio.resume();
    return audio;
  } catch {
    return null;
  }
}

const wakeAudio = () => audioContext();
document.addEventListener("pointerdown", wakeAudio, { capture: true });

function noise(ac) {
  if (noiseBuffer) return noiseBuffer;
  noiseBuffer = ac.createBuffer(1, ac.sampleRate * 0.3, ac.sampleRate);
  const samples = noiseBuffer.getChannelData(0);
  for (let i = 0; i < samples.length; i++) samples[i] = Math.random() * 2 - 1;
  return noiseBuffer;
}

function envelope(ac, at, peak, decay, out = ac.destination) {
  const gain = ac.createGain();
  gain.gain.setValueAtTime(0.0001, at);
  gain.gain.exponentialRampToValueAtTime(peak, at + 0.008);
  gain.gain.exponentialRampToValueAtTime(0.0001, at + decay);
  gain.connect(out);
  return gain;
}

/** One plucked or beeped note. `glide` slides the pitch to that frequency over the note. */
function note(ac, { freq, at, decay, peak, type = "sine", glide, out = ac.destination }) {
  const osc = ac.createOscillator();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, at);
  if (glide) osc.frequency.exponentialRampToValueAtTime(glide, at + decay * 0.8);
  osc.connect(envelope(ac, at, peak, decay, out));
  osc.start(at);
  osc.stop(at + decay + 0.02);
}

/** A short burst of filtered noise: clicks, shutters, knocks. */
function burst(ac, { at, decay, peak, filter = "bandpass", freq = 1200, q = 1, out = ac.destination }) {
  const src = ac.createBufferSource();
  src.buffer = noise(ac);
  const f = ac.createBiquadFilter();
  f.type = filter;
  f.frequency.value = freq;
  f.Q.value = q;
  src.connect(f);
  f.connect(envelope(ac, at, peak, decay, out));
  src.start(at);
  src.stop(at + decay + 0.02);
}

/**
 * Plays `pattern(ac, at, out)` every `period` seconds, `times` times, through one master gain.
 * Returns a function that silences the rest at once; safe to call more than once.
 */
function soundLoop(pattern, period, times) {
  const ac = audioContext();
  if (!ac) return () => {};
  const master = ac.createGain();
  master.connect(ac.destination);
  const start = ac.currentTime + 0.05;
  for (let i = 0; i < times; i++) pattern(ac, start + i * period, master);
  let stopped = false;
  return () => {
    if (stopped) return;
    stopped = true;
    master.gain.setValueAtTime(0, ac.currentTime);
    master.disconnect();
  };
}

// ── calls ──

/** The ringback heard while a call connects: 440 + 480 Hz, one second on, two off. */
function startRingback() {
  return soundLoop(
    (ac, at, out) => {
      for (const freq of [440, 480]) {
        const osc = ac.createOscillator();
        osc.frequency.value = freq;
        const gain = ac.createGain();
        gain.gain.setValueAtTime(0, at);
        gain.gain.linearRampToValueAtTime(0.06, at + 0.02);
        gain.gain.setValueAtTime(0.06, at + 1);
        gain.gain.linearRampToValueAtTime(0, at + 1.02);
        osc.connect(gain);
        gain.connect(out);
        osc.start(at);
        osc.stop(at + 1.05);
      }
    },
    3,
    20,
  );
}

/**
 * The incoming-call ringtone: a bright marimba phrase. An `eerie` call (a hidden number) plays it low,
 * slow and slightly out of tune.
 */
function startRingtone({ eerie = false } = {}) {
  const phrase = eerie ? [261.6, 311.1, 370, 311.1, 233.1] : [659.3, 830.6, 987.8, 1318.5, 987.8, 830.6];
  const step = eerie ? 0.32 : 0.14;
  return soundLoop(
    (ac, at, out) =>
      phrase.forEach((freq, i) => {
        note(ac, { freq: eerie ? freq * (1 + (i % 2 ? 0.012 : -0.008)) : freq, at: at + i * step, decay: eerie ? 0.7 : 0.35, peak: 0.12, type: eerie ? "triangle" : "sine", out });
        if (!eerie) note(ac, { freq: freq * 4, at: at + i * step, decay: 0.08, peak: 0.02, out }); // the mallet's click
      }),
    eerie ? 3.2 : 2.2,
    12,
  );
}

/** Three short beeps when a call ends. */
function hangupSound() {
  const ac = audioContext();
  if (!ac) return;
  for (let i = 0; i < 3; i++) {
    const at = ac.currentTime + 0.05 + i * 0.25;
    const tone = ac.createOscillator();
    tone.frequency.value = 480;
    const gain = ac.createGain();
    gain.gain.setValueAtTime(0, at);
    gain.gain.linearRampToValueAtTime(0.07, at + 0.01);
    gain.gain.setValueAtTime(0.07, at + 0.14);
    gain.gain.linearRampToValueAtTime(0, at + 0.15);
    tone.connect(gain);
    gain.connect(ac.destination);
    tone.start(at);
    tone.stop(at + 0.16);
  }
}

// ── touches and keys ──

const DTMF = {
  1: [697, 1209], 2: [697, 1336], 3: [697, 1477],
  4: [770, 1209], 5: [770, 1336], 6: [770, 1477],
  7: [852, 1209], 8: [852, 1336], 9: [852, 1477],
  "*": [941, 1209], 0: [941, 1336], "#": [941, 1477],
};

function touchSoundsOn() {
  return data.settings.touchSound !== false;
}

/** A soft tick for a button press. */
function tapSound() {
  const ac = touchSoundsOn() && audioContext();
  if (!ac) return;
  burst(ac, { at: ac.currentTime + 0.005, decay: 0.03, peak: 0.05, filter: "highpass", freq: 3200 });
}

/** The two-tone sound of a phone keypad key. */
function dtmfSound(key) {
  const ac = touchSoundsOn() && audioContext();
  const pair = DTMF[key];
  if (!ac || !pair) return;
  const at = ac.currentTime + 0.005;
  for (const freq of pair) note(ac, { freq, at, decay: 0.16, peak: 0.05 });
}

// Every press inside the phone ticks; keypad keys play their tone instead.
const onPhoneTouch = (event) => {
  const target = event.target instanceof Element ? event.target : null;
  if (!target) return;
  const key = target.closest(".uphone-key");
  if (key) return dtmfSound(key.querySelector("b")?.textContent?.trim());
  if (target.closest("button, [role='button'], label, input[type='checkbox'], .uphone-lock")) tapSound();
};
frame.addEventListener("pointerdown", onPhoneTouch, { capture: true });

// ── everyday sounds ──

/** Camera shutter: two quick mechanical clicks. */
function shutterSound() {
  const ac = audioContext();
  if (!ac) return;
  const at = ac.currentTime + 0.01;
  burst(ac, { at, decay: 0.045, peak: 0.35, filter: "bandpass", freq: 2600, q: 0.8 });
  burst(ac, { at: at + 0.085, decay: 0.06, peak: 0.28, filter: "bandpass", freq: 1700, q: 0.8 });
}

/** A message going out: a quick upward swoosh. */
function sentSound() {
  const ac = audioContext();
  if (!ac) return;
  note(ac, { freq: 520, glide: 1250, at: ac.currentTime + 0.01, decay: 0.14, peak: 0.06 });
}

/** A message arriving in the conversation on screen. */
function receivedSound() {
  const ac = audioContext();
  if (!ac) return;
  const at = ac.currentTime + 0.01;
  note(ac, { freq: 988, at, decay: 0.12, peak: 0.06 });
  note(ac, { freq: 1319, at: at + 0.07, decay: 0.18, peak: 0.06 });
}

/** A soft notification ping. */
function chime() {
  const ac = audioContext();
  if (!ac) return;
  const at = ac.currentTime + 0.02;
  const tone = ac.createOscillator();
  tone.type = "sine";
  tone.frequency.setValueAtTime(1046.5, at);
  tone.frequency.setValueAtTime(1318.5, at + 0.09);
  tone.connect(envelope(ac, at, 0.12, 0.35));
  tone.start(at);
  tone.stop(at + 0.4);
}

/** The click of the screen locking or unlocking. */
function lockSound(unlock = false) {
  const ac = audioContext();
  if (!ac) return;
  const at = ac.currentTime + 0.01;
  burst(ac, { at, decay: 0.03, peak: 0.12, filter: "lowpass", freq: unlock ? 2400 : 1400 });
  note(ac, { freq: unlock ? 900 : 500, glide: unlock ? 1400 : 320, at, decay: 0.06, peak: 0.04 });
}

/** An alarm clock: four quick beeps, then a pause, until stopped. */
function startAlarmTone() {
  return soundLoop(
    (ac, at, out) => {
      for (let i = 0; i < 4; i++) note(ac, { freq: 1046.5, at: at + i * 0.16, decay: 0.11, peak: 0.1, type: "square", out });
    },
    1.2,
    60,
  );
}

/** The countdown timer is done: three bright beeps. */
function timerDoneSound() {
  const ac = audioContext();
  if (!ac) return;
  for (let i = 0; i < 3; i++) note(ac, { freq: 1568, at: ac.currentTime + 0.02 + i * 0.22, decay: 0.15, peak: 0.08 });
}

// ── story sounds ──

/** Knuckles on a wooden door: a low thump plus a short burst of filtered noise, `times` times. */
function knockSound(times = 3) {
  const ac = audioContext();
  if (!ac) return;
  for (let i = 0; i < times; i++) {
    const at = ac.currentTime + 0.05 + i * 0.34 + (i === times - 1 ? 0.08 : 0);
    note(ac, { freq: 130, glide: 55, at, decay: 0.2, peak: 0.7 });
    burst(ac, { at, decay: 0.07, peak: 0.35, freq: 900, q: 1.2 });
  }
}

/** An apartment doorbell: two falling tones. */
function doorbellSound() {
  const ac = audioContext();
  if (!ac) return;
  const at = ac.currentTime + 0.05;
  note(ac, { freq: 659.25, at, decay: 1.4, peak: 0.35, type: "triangle" });
  note(ac, { freq: 523.25, at: at + 0.55, decay: 1.4, peak: 0.35, type: "triangle" });
}

function stopSounds() {
  document.removeEventListener("pointerdown", wakeAudio, { capture: true });
  frame.removeEventListener("pointerdown", onPhoneTouch, { capture: true });
  void audio?.close();
}
