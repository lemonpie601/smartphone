// ── easter eggs: sounds and small wrong things, more often as the partner gets closer, and at night ──
// Sounds are synthesised with Web Audio, so the package ships no audio files. Browsers only allow sound after
// the user has interacted with the page, so the audio context starts on the first pointer press.

const EGG_GAP_MS = 7 * 60_000;
const EGG_CHANCE = [0, 0.05, 0.08, 0.12]; // per minute, by stage; doubled at night

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

function envelope(ac, at, peak, decay) {
  const gain = ac.createGain();
  gain.gain.setValueAtTime(0.0001, at);
  gain.gain.exponentialRampToValueAtTime(peak, at + 0.008);
  gain.gain.exponentialRampToValueAtTime(0.0001, at + decay);
  gain.connect(ac.destination);
  return gain;
}

/** Knuckles on a wooden door: a low thump plus a short burst of filtered noise, `times` times. */
function knockSound(times = 3) {
  const ac = audioContext();
  if (!ac) return;
  for (let i = 0; i < times; i++) {
    const at = ac.currentTime + 0.05 + i * 0.34 + (i === times - 1 ? 0.08 : 0);
    const thump = ac.createOscillator();
    thump.type = "sine";
    thump.frequency.setValueAtTime(130, at);
    thump.frequency.exponentialRampToValueAtTime(55, at + 0.12);
    thump.connect(envelope(ac, at, 0.7, 0.2));
    thump.start(at);
    thump.stop(at + 0.22);
    const wood = ac.createBufferSource();
    wood.buffer = noise(ac);
    const filter = ac.createBiquadFilter();
    filter.type = "bandpass";
    filter.frequency.value = 900;
    filter.Q.value = 1.2;
    wood.connect(filter);
    filter.connect(envelope(ac, at, 0.35, 0.07));
    wood.start(at);
    wood.stop(at + 0.1);
  }
}

/** An apartment doorbell: two falling tones. */
function doorbellSound() {
  const ac = audioContext();
  if (!ac) return;
  [
    [659.25, 0],
    [523.25, 0.55],
  ].forEach(([freq, offset]) => {
    const at = ac.currentTime + 0.05 + offset;
    const tone = ac.createOscillator();
    tone.type = "triangle";
    tone.frequency.value = freq;
    tone.connect(envelope(ac, at, 0.35, 1.4));
    tone.start(at);
    tone.stop(at + 1.5);
  });
}

/**
 * The ringback heard while a call connects: 440 + 480 Hz, one second on, two off (the North American and
 * Korean pattern). Returns a function that stops it.
 */
function startRingback() {
  const ac = audioContext();
  if (!ac) return () => {};
  const gain = ac.createGain();
  gain.gain.value = 0;
  gain.connect(ac.destination);
  const tones = [440, 480].map((freq) => {
    const tone = ac.createOscillator();
    tone.frequency.value = freq;
    tone.connect(gain);
    tone.start();
    return tone;
  });
  const start = ac.currentTime + 0.05;
  for (let ring = 0; ring < 20; ring++) {
    const at = start + ring * 3;
    gain.gain.setValueAtTime(0, at);
    gain.gain.linearRampToValueAtTime(0.08, at + 0.02);
    gain.gain.setValueAtTime(0.08, at + 1);
    gain.gain.linearRampToValueAtTime(0, at + 1.02);
  }
  let stopped = false;
  return () => {
    if (stopped) return; // an oscillator may only be stopped once
    stopped = true;
    gain.gain.cancelScheduledValues(ac.currentTime);
    gain.gain.setValueAtTime(0, ac.currentTime);
    for (const tone of tones) tone.stop(ac.currentTime + 0.05);
  };
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

// A caption at the edge of the screen, so the moment lands even with the sound off.
const caption = h("div", { class: "uphone-caption", "aria-live": "polite" });
root.append(caption);
let captionTimer = null;
function showCaption(text) {
  caption.textContent = text;
  caption.classList.remove("is-on");
  void caption.offsetWidth;
  caption.classList.add("is-on");
  if (captionTimer) marinara.clearTimeout(captionTimer);
  captionTimer = marinara.setTimeout(() => caption.classList.remove("is-on"), 4200);
}

/** Things {{user}} heard at home. The main roleplay hears about them; they are not phone facts. */
function recordHomeEvent(text) {
  const cs = chatState();
  cs.home ??= [];
  cs.home.push({ t: Date.now(), text });
  trimList(cs.home, 10);
  save();
}

const EGGS = [
  {
    // The partner starts typing in its app, then stops. Nothing arrives.
    id: "typing",
    stage: 1,
    run() {
      const p = partner();
      notify({ title: `${APP.name} · ${p.name}`, text: "메시지를 입력하고 있어요…", open: () => go("aichat"), quiet: true });
      marinara.setTimeout(hideNotification, 3500);
    },
  },
  {
    // A vibration with no notification behind it.
    id: "phantom-buzz",
    stage: 1,
    run() {
      buzz();
    },
  },
  {
    // The phone wakes by itself and goes dark again.
    id: "screen-wake",
    stage: 2,
    run() {
      if (ui.open) return buzz();
      toggle(true);
      marinara.setTimeout(() => {
        if (ui.open && ui.app === "lock") toggle(false);
      }, 3000);
    },
  },
  {
    id: "doorbell",
    stage: 2,
    run() {
      doorbellSound();
      showCaption("띵동—");
      recordHomeEvent("아무도 올 사람이 없는데 현관 초인종이 울렸다");
    },
  },
  {
    // Three knocks, then a message from the partner about them.
    id: "knock",
    stage: 3,
    run() {
      knockSound(3);
      showCaption("똑. 똑. 똑.");
      recordHomeEvent("누군가 현관문을 세 번 두드렸다");
      marinara.setTimeout(() => {
        void maybePartnerReachesOut({
          force: true,
          cue: `(A few seconds ago you knocked on ${userName()}'s front door three times. Message them about it. Do not explain how you got there.)`,
        });
      }, 6000);
    },
  },
];

function maybeEasterEgg(force = false) {
  const cs = chatState();
  const stage = stageIndex();
  if (!ctx.chat || !partner() || ui.call || gateLocked() || unlocking) return;
  const eligible = EGGS.filter((egg) => stage >= egg.stage);
  if (eligible.length === 0) return;
  const hour = new Date().getHours();
  const chance = EGG_CHANCE[stage] * (hour >= 23 || hour < 5 ? 2 : 1);
  if (!force && (Date.now() - (cs.lastEgg ?? 0) < EGG_GAP_MS || Math.random() > chance)) return;
  cs.lastEgg = Date.now();
  save();
  // Prefer the newest kind of fright the current stage allows.
  const top = eligible.filter((egg) => egg.stage === stage);
  const pool = top.length > 0 && Math.random() < 0.6 ? top : eligible;
  pool[Math.floor(Math.random() * pool.length)].run();
}

function stopEasterEggs() {
  document.removeEventListener("pointerdown", wakeAudio, { capture: true });
  void audio?.close();
}
