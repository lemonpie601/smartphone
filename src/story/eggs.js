// ── easter eggs: small wrong things and sounds at home, more often as the partner gets closer, and at night ──
// The sounds themselves live in src/sound.js.

const EGG_GAP_MS = 7 * 60_000;
const EGG_CHANCE = [0, 0.05, 0.08, 0.12]; // per minute, by stage; doubled at night

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
