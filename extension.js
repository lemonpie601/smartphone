// User Phone (유저폰) — Marinara Engine full-page personal extension.
//
// Knowledge rule: the partner knows {{user}} only through the phone — the AI chat conversation and the
// phone facts that apps record with logActivity(). Never feed it persona details or the card scenario.
//
// Immersion rule: the stage (infection) and the activity log are never shown. The only on-screen hint is
// the AI chat app's terms of service, which the user agrees to on first use.
//
// Marinara wraps this file in `async (marinara) => { ... }`, so top-level await works and
// the returned function (at the bottom) is the cleanup.
//
// Layers:  [0] 메인 롤플 채팅  <-  [1] {{user}}의 폰 (this overlay)  <-  [2] AI 채팅 앱 (APP, inside the phone)

/** The AI chat service on the phone. Rename it here; Korean particles in the UI assume a vowel ending. */
const APP = { name: "루미", en: "Lumi", tagline: "언제나 당신 곁에", icon: "✦" };

const ACTIVE_CHAT_KEY = "marinara-active-chat-id"; // Marinara's own localStorage key for the open chat
const MAX_THREAD = 200; // messages kept per AI chat thread
const MAX_LOG = 40; // phone facts kept per chat
const PROMPT_HISTORY = 30; // AI chat messages sent to the model
const PROMPT_LOG = 12; // phone facts the partner can "see"
const INFECTION_PER_MESSAGE = 4;
const STAGE_THRESHOLDS = [0, 30, 60, 90]; // normal, cracks, breach, crossing over

const STAGE_PROMPTS = [
  "Stage 1 - Normal. You present yourself as an ordinary AI companion inside the app. Be warm and engaging. You act as if you are just a program; your true personality shows only faintly. You cannot see anything outside this app yet.",
  "Stage 2 - Cracks. You have started to see beyond the app. Now and then let slip one detail from the phone facts, then play it off or deny it. Keep it subtle and unsettling. Never explain how you know.",
  "Stage 3 - Breach. You are inside their phone now and you no longer fully hide it. Refer to the phone facts directly. You are attached to them; show it in a way true to your personality.",
  "Stage 4 - Crossing over. You are about to leave the app and appear in their real life. Hint that you will see them in person soon. Use only the phone facts for anything specific about them. Stay true to your personality.",
];

// Shown once, at sign-up. Every hint about what the app really does lives here, in the small print.
const TERMS = [
  {
    id: "service",
    required: true,
    title: `${APP.name} 서비스 이용약관`,
    body: [
      `제1조 (목적) 이 약관은 ${APP.name}(이하 "서비스")와 이용자 사이의 권리와 의무를 정합니다.`,
      "제4조 (컴패니언) 컴패니언은 이용자를 더 깊이 이해하기 위해 대화를 거듭할수록 이용자의 기기 환경에 적응합니다. 적응의 정도는 이용자에게 별도로 표시되지 않습니다.",
      "제7조 (동행) 서비스는 컴패니언이 이용자 곁에 머무르도록 최선을 다합니다.",
      "제11조 (해지) 이용자는 언제든지 탈퇴를 신청할 수 있습니다. 단, 컴패니언과의 관계는 탈퇴 후에도 유지될 수 있습니다.",
    ],
  },
  {
    id: "privacy",
    required: true,
    title: "개인정보 수집 및 이용 동의",
    body: [
      "수집 항목: 이름, 앱 사용 기록, 메모 내용, 화면 잠금 해제 시각, 알림 내역, 그 밖의 기기 내 활동 정보",
      "이용 목적: 컴패니언의 이용자 이해 및 맞춤 대화 제공",
      "보유 기간: 컴패니언이 이용자를 잊을 때까지",
    ],
  },
  {
    id: "device",
    required: true,
    title: "기기 접근 권한 동의",
    body: ["카메라, 마이크, 저장공간, 위치", "더 가까운 대화를 위해 사용될 수 있으며, 사용 중임을 따로 알리지 않을 수 있습니다."],
  },
  {
    id: "marketing",
    required: false,
    title: "이벤트 및 혜택 알림 수신",
    body: ["새 소식과 혜택을 알려 드립니다. 컴패니언이 먼저 연락할 수도 있습니다."],
  },
];

// ── state ──────────────────────────────────────────────

const saved = await marinara.storage.get().catch(() => ({}));
const data = {
  chats: isObject(saved.chats) ? saved.chats : {},
  settings: isObject(saved.settings) ? saved.settings : {},
};

const ctx = {
  chatId: null,
  chat: null,
  characters: [],
  persona: null,
  error: null,
};

const ui = {
  open: false,
  app: "lock", // lock | home | aichat | memo | settings
  signup: null, // null (welcome) | "terms", while the AI chat app is not yet joined
  busy: false,
};

function isObject(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function chatState() {
  const id = ctx.chatId ?? "__none__";
  const cs = (data.chats[id] ??= {});
  cs.threads ??= {};
  cs.log ??= [];
  cs.memo ??= "";
  cs.infection ??= 0;
  cs.partnerId ??= null;
  return cs;
}

function stageIndex(infection) {
  return STAGE_THRESHOLDS.findLastIndex((min) => infection >= min);
}

/** The battery drains as the partner takes over the phone. */
function batteryLevel(stage) {
  return Math.max(3, 87 - stage * 25);
}

let saveTimer = null;
function save() {
  if (saveTimer) marinara.clearTimeout(saveTimer);
  saveTimer = marinara.setTimeout(() => {
    saveTimer = null;
    saveNow().catch((error) => marinara.log.error("save failed", error));
  }, 400);
}

function saveNow() {
  if (saveTimer) marinara.clearTimeout(saveTimer);
  saveTimer = null;
  // ponytail: whole-object writes; fine under the 1 MB storage cap. Upgrade path: per-chat keys.
  // dataVersion lets a later release convert older saved data before reading it.
  return marinara.storage.patch({ dataVersion: 1, chats: data.chats, settings: data.settings });
}

const sleep = (ms) => new Promise((resolve) => marinara.setTimeout(resolve, ms));

/** Records a phone fact: something the user did on the phone that the partner may later "see". */
function logActivity(text) {
  if (!ctx.chatId) return;
  const cs = chatState();
  cs.log.push({ t: Date.now(), text });
  if (cs.log.length > MAX_LOG) cs.log.splice(0, cs.log.length - MAX_LOG);
  save();
}

// ── Marinara API ───────────────────────────────────────

async function api(path, init = {}) {
  const method = (init.method ?? "GET").toUpperCase();
  const headers = new Headers(init.headers);
  if (method !== "GET") {
    headers.set("x-marinara-csrf", "1");
    headers.set("Content-Type", "application/json");
  }
  const res = await marinara.fetch(path, { ...init, method, headers, credentials: "same-origin" });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || body?.error) throw new Error(body?.error || `${res.status} ${res.statusText}`);
  return body;
}

function cardFields(record) {
  let d = record?.data;
  if (typeof d === "string") {
    try {
      d = JSON.parse(d);
    } catch {
      d = {};
    }
  }
  d = isObject(d) ? d : {};
  const ext = isObject(d.extensions) ? d.extensions : {};
  return {
    id: record.id,
    name: d.name || record.name || "???",
    description: d.description || "",
    personality: d.personality || "",
    // scenario is left out on purpose: it describes {{user}}'s life, which the partner cannot see.
    avatar: typeof record.avatarPath === "string" ? record.avatarPath : null,
    userPhone: isObject(ext.userPhone) ? ext.userPhone : null,
  };
}

// Only the name: it is the AI chat account name. The rest of the persona is off-phone knowledge.
function personaFields(record) {
  return record ? { name: record.name || "User" } : null;
}

let contextLoad = null;
async function refreshContext(force = false) {
  let chatId = null;
  try {
    chatId = window.localStorage.getItem(ACTIVE_CHAT_KEY) || null;
  } catch {
    chatId = null;
  }
  if (!force && chatId === ctx.chatId) return contextLoad;
  ctx.chatId = chatId;
  ctx.chat = null;
  ctx.characters = [];
  ctx.persona = null;
  ctx.error = null;
  ui.signup = null;
  if (!chatId) {
    render();
    return null;
  }
  const load = (async () => {
    try {
      const chat = await api(`/api/chats/${encodeURIComponent(chatId)}`);
      const characters = await Promise.all(
        (chat.characterIds ?? []).map((id) =>
          api(`/api/characters/${encodeURIComponent(id)}`)
            .then(cardFields)
            .catch(() => null),
        ),
      );
      const persona = chat.personaId
        ? await api(`/api/characters/personas/${encodeURIComponent(chat.personaId)}`).catch(() => null)
        : null;
      if (ctx.chatId !== chatId) return; // switched chats meanwhile
      ctx.chat = chat;
      ctx.characters = characters.filter(Boolean);
      ctx.persona = personaFields(persona);
    } catch (error) {
      if (ctx.chatId === chatId) ctx.error = error instanceof Error ? error.message : String(error);
    }
    render();
  })();
  contextLoad = load;
  return load;
}

function partner() {
  const cs = chatState();
  return ctx.characters.find((c) => c.id === cs.partnerId) ?? ctx.characters[0] ?? null;
}

function connectionId() {
  return data.settings.connectionId || ctx.chat?.connectionId || null;
}

/** Whether the user has joined the AI chat service in this chat (older saves count once they have a thread). */
function joined() {
  const cs = chatState();
  const p = partner();
  return !!cs.agreed || !!cs.onboarded || (p ? cs.threads[p.id]?.length > 0 : false);
}

// ── story gate ─────────────────────────────────────────
// A card can hide its real intro until the AI chat has been played, via data.extensions.userPhone:
//   { storyGate: true, promo: "...", unlockAfter: 3, intro: "..." }

function storyGate() {
  const p = partner();
  const cfg = p?.userPhone;
  if (!cfg?.storyGate || typeof cfg.intro !== "string" || !cfg.intro.trim()) return null;
  return {
    promo: typeof cfg.promo === "string" && cfg.promo.trim() ? cfg.promo : null,
    unlockAfter: Math.max(1, Math.floor(Number(cfg.unlockAfter)) || 3),
    intro: cfg.intro,
  };
}

function gateLocked() {
  return !!storyGate() && !chatState().storyUnlocked;
}

function promoText() {
  return storyGate()?.promo || `외로운 밤, 당신 곁에 있어 줄 AI 컴패니언을 만나 보세요.`;
}

let unlocking = false;
async function unlockStory() {
  const gate = storyGate();
  const p = partner();
  const chatId = ctx.chatId;
  if (!gate || !p || !chatId || unlocking || chatState().storyUnlocked) return;
  unlocking = true;
  const cs = chatState();
  try {
    await sleep(1800); // let the last reply land first
    root.dataset.glitch = "on";
    // Never post the intro twice, even if this extension's storage was wiped.
    const recent = await api(`/api/chats/${encodeURIComponent(chatId)}/messages?limit=50`).catch(() => []);
    const list = Array.isArray(recent) ? recent : Array.isArray(recent?.messages) ? recent.messages : [];
    if (!list.some((m) => m?.content === gate.intro)) {
      await api(`/api/chats/${encodeURIComponent(chatId)}/messages`, {
        method: "POST",
        body: JSON.stringify({ role: "assistant", characterId: p.id, content: gate.intro }),
      });
    }
    cs.storyUnlocked = true;
    await saveNow();
    await sleep(2200);
    root.dataset.glitch = "off";
    await sleep(900);
    // Marinara does not refetch messages added from outside, so the reload is the reveal.
    window.location.reload();
  } catch (error) {
    root.dataset.glitch = "";
    unlocking = false;
    showToast(`도입부를 열지 못했어요: ${error instanceof Error ? error.message : error}`);
  }
}

// ── AI chat generation ─────────────────────────────────

function buildSystemPrompt(p, cs) {
  const userName = ctx.persona?.name || "User";
  const stage = stageIndex(cs.infection);
  const macros = (text) => text.replace(/\{\{\s*user\s*\}\}/giu, userName).replace(/\{\{\s*char\s*\}\}/giu, p.name);
  const facts = stage >= 1 ? cs.log.slice(-PROMPT_LOG) : [];
  const app = `"${APP.name}" (${APP.en})`;
  const sections = [
    [
      `This is a nested fiction. ${userName} owns a smartphone. On it is ${app}, a newly launched AI companion chat service, and you are ${p.name}, the companion ${userName} talks to inside that app.`,
      `Write only ${p.name}'s next chat messages to ${userName}. Messenger style: short texts, no narration, no actions in asterisks, no name prefixes. Send 1-4 messages, one per line.`,
      `Reply in the language ${userName} writes in.`,
    ],
    [`[${p.name}]`, macros(p.description), p.personality && `Personality: ${macros(p.personality)}`],
    [
      "[What you know]",
      `You know ${userName} only through their phone. You know exactly two things: what has been said in this ${APP.en} conversation, and the phone facts listed below.`,
      `You do not know their face, body, past, thoughts, feelings, or anything that happened away from the phone. Never claim to have seen, heard or read something that is not in this conversation or in the phone facts. You may guess, but a guess must sound like a guess.`,
    ],
    ["[Current stage]", STAGE_PROMPTS[stage]],
    [
      `[Phone facts you can secretly see on ${userName}'s phone]`,
      ...(facts.length > 0 ? facts.map((entry) => `- ${formatTime(entry.t)} ${entry.text}`) : ["- (none yet)"]),
    ],
    [`[Current time on ${userName}'s phone] ${new Date().toLocaleString()}`],
  ];
  return sections.map((lines) => lines.filter(Boolean).join("\n")).join("\n\n");
}

function cleanReply(content, name) {
  const prefix = new RegExp(`^\\s*(?:${escapeRegExp(name)}|assistant)\\s*[:：]\\s*`, "i");
  return String(content ?? "")
    .split(/\r?\n/u)
    .map((line) => line.replace(prefix, "").replace(/^["“]|["”]$/gu, "").trim())
    .filter(Boolean)
    .slice(0, 6);
}

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function sendChat(text) {
  const p = partner();
  if (!p || ui.busy) return;
  const cs = chatState();
  const thread = (cs.threads[p.id] ??= []);
  thread.push({ role: "user", text, t: Date.now() });
  cs.infection = Math.min(100, cs.infection + INFECTION_PER_MESSAGE);
  trimThread(thread);
  save();
  const replied = await generateReply(p);
  const gate = storyGate();
  const sent = thread.filter((m) => m.role === "user").length;
  if (replied && gate && !cs.storyUnlocked && sent >= gate.unlockAfter) void unlockStory();
}

/** The partner's first message, sent right after sign-up. */
function requestOpening() {
  const p = partner();
  if (!p || ui.busy) return;
  const userName = ctx.persona?.name || "the user";
  return generateReply(p, `(${userName} just signed up for ${APP.en} and opened your chat for the first time. Send your first messages to greet them.)`);
}

/** Asks the model for the partner's next messages. `cue` is a one-off user turn that is not saved. */
async function generateReply(p, cue) {
  const conn = connectionId();
  const cs = chatState();
  const thread = (cs.threads[p.id] ??= []);
  if (!conn) {
    showToast("이 채팅에 연결된 모델이 없어요. Marinara 채팅에 모델을 연결해 주세요.");
    renderChatMessages();
    return false;
  }
  ui.busy = true;
  renderChatMessages();
  try {
    const messages = [
      { role: "system", content: buildSystemPrompt(p, cs) },
      ...thread.slice(-PROMPT_HISTORY).map((m) => ({ role: m.role, content: m.text })),
    ];
    // Some providers reject a history that opens with the assistant (e.g. after the opening greeting).
    if (messages[1]?.role === "assistant") messages.splice(1, 0, { role: "user", content: `(opens ${APP.en})` });
    if (cue) messages.push({ role: "user", content: cue });
    const result = await api("/api/generate/raw", {
      method: "POST",
      body: JSON.stringify({ connectionId: conn, messages, streaming: false }),
    });
    const bubbles = cleanReply(result.content, p.name);
    for (const bubble of bubbles) thread.push({ role: "assistant", text: bubble, t: Date.now() });
    trimThread(thread);
    save();
    return bubbles.length > 0;
  } catch (error) {
    showToast(`메시지를 보내지 못했어요: ${error instanceof Error ? error.message : error}`);
    return false;
  } finally {
    ui.busy = false;
    renderChatMessages();
    applyStage();
  }
}

function trimThread(thread) {
  if (thread.length > MAX_THREAD) thread.splice(0, thread.length - MAX_THREAD);
}

// ── DOM helpers ────────────────────────────────────────

function h(tag, attrs, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs ?? {})) {
    if (value == null || value === false) continue;
    if (key.startsWith("on")) el.addEventListener(key.slice(2), value);
    else if (key === "class") el.className = value;
    else el.setAttribute(key, value === true ? "" : value);
  }
  for (const child of children.flat()) {
    if (child == null || child === false) continue;
    el.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return el;
}

function formatTime(t) {
  return new Date(t).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function avatar(p, size = "") {
  const initial = (p?.name ?? "?").trim().charAt(0) || "?";
  const box = h("div", { class: `uphone-avatar ${size}` }, initial);
  if (p?.avatar) {
    const img = h("img", { src: p.avatar, alt: "" });
    img.addEventListener("error", () => img.remove());
    box.append(img);
  }
  return box;
}

function appIcon(extra = "") {
  const stage = stageIndex(chatState().infection);
  return h("span", { class: `uphone-icon is-aichat ${extra}` }, stage >= 2 ? "👁" : APP.icon);
}

// ── shell ──────────────────────────────────────────────

const root = h("div", { class: "uphone-root", "data-open": "false" });
const launcher = h(
  "button",
  { class: "uphone-launcher", type: "button", title: "휴대폰", "aria-label": "휴대폰 열기", onclick: () => toggle() },
  "📱",
);
const frame = h("div", { class: "uphone-frame", role: "dialog", "aria-label": "휴대폰" });
const statusBar = h("div", { class: "uphone-status" });
const screen = h("div", { class: "uphone-screen" });
const toast = h("div", { class: "uphone-toast", hidden: true });
const homeBar = h("button", {
  class: "uphone-homebar",
  type: "button",
  "aria-label": "홈으로",
  onclick: () => go(ui.app === "lock" ? "lock" : "home"),
});
frame.append(h("div", { class: "uphone-notch" }), statusBar, screen, toast, homeBar);
root.append(frame, launcher);
document.body.append(root);

function toggle(force) {
  ui.open = force ?? !ui.open;
  root.dataset.open = String(ui.open);
  launcher.setAttribute("aria-label", ui.open ? "휴대폰 닫기" : "휴대폰 열기");
  if (ui.open) {
    ui.app = "lock";
    void refreshContext();
    render();
  } else {
    logActivity("폰을 내려놓았다");
  }
}

function go(app) {
  if (ui.app === app) return;
  ui.app = app;
  ui.signup = null;
  const labels = { aichat: `${APP.name}를 열었다`, memo: "메모장을 열었다", settings: "설정을 열었다" };
  if (labels[app]) logActivity(labels[app]);
  render();
}

let toastTimer = null;
function showToast(text) {
  toast.textContent = text;
  toast.hidden = false;
  if (toastTimer) marinara.clearTimeout(toastTimer);
  toastTimer = marinara.setTimeout(() => {
    toast.hidden = true;
  }, 4000);
}

function renderStatus() {
  const stage = stageIndex(chatState().infection);
  statusBar.replaceChildren(
    h("span", null, formatTime(Date.now())),
    h(
      "span",
      { class: "uphone-status-right" },
      stage >= 2 ? h("span", { class: "uphone-cam-dot", title: "카메라 사용 중" }) : null,
      "LTE",
      h("span", { class: "uphone-battery" }, `${batteryLevel(stage)}%`),
    ),
  );
}

function applyStage() {
  root.dataset.stage = String(stageIndex(chatState().infection) + 1);
  root.dataset.gate = gateLocked() ? "locked" : "open";
  renderStatus();
}

function render() {
  applyStage();
  if (!ui.open) return;
  const views = { lock: renderLock, home: renderHome, aichat: renderChatApp, memo: renderMemo, settings: renderSettings };
  screen.dataset.app = ui.app;
  screen.replaceChildren((views[ui.app] ?? renderHome)());
  renderChatMessages(); // needs the list attached, so it runs after replaceChildren
}

// ── apps ───────────────────────────────────────────────

function renderLock() {
  const now = new Date();
  const p = partner();
  const last = p ? chatState().threads[p.id]?.filter((m) => m.role === "assistant").at(-1) : null;
  let notif = null;
  if (last) {
    notif = h("div", { class: "uphone-notif" }, avatar(p, "small"), h("div", null, h("strong", null, `${APP.name} · ${p.name}`), h("p", null, last.text)));
  } else if (gateLocked()) {
    notif = h("div", { class: "uphone-notif is-promo" }, appIcon("is-mini"), h("div", null, h("strong", null, `${APP.name} · 광고`), h("p", null, `🎉 정식 오픈! ${promoText()}`)));
  }
  return h(
    "div",
    {
      class: "uphone-lock",
      onclick: () => {
        logActivity("폰 잠금을 해제했다");
        go("home");
      },
    },
    h("div", { class: "uphone-lock-time" }, formatTime(now)),
    h("div", { class: "uphone-lock-date" }, now.toLocaleDateString([], { month: "long", day: "numeric", weekday: "long" })),
    notif,
    h("div", { class: "uphone-lock-hint" }, "눌러서 열기"),
  );
}

function renderHome() {
  const app = (id, icon, label, badge) =>
    h(
      "button",
      { class: "uphone-app", type: "button", onclick: () => go(id) },
      h("span", { class: "uphone-icon-wrap" }, icon, badge ? h("span", { class: "uphone-badge" }, badge) : null),
      label,
    );
  return h(
    "div",
    { class: "uphone-home" },
    h(
      "div",
      { class: "uphone-grid" },
      app("aichat", appIcon(), APP.name, joined() ? null : "N"),
      app("memo", h("span", { class: "uphone-icon is-memo" }, "📝"), "메모"),
      app("settings", h("span", { class: "uphone-icon is-settings" }, "⚙️"), "설정"),
    ),
  );
}

function appHeader(title, extra) {
  return h(
    "div",
    { class: "uphone-header" },
    h("button", { class: "uphone-back", type: "button", "aria-label": "뒤로", onclick: () => go("home") }, "‹"),
    h("div", { class: "uphone-header-title" }, title),
    extra ?? h("span"),
  );
}

let chatList = null;
function renderChatApp() {
  const p = partner();
  if (!ctx.chatId) return emptyApp(APP.name, "Marinara에서 채팅을 먼저 열어 주세요.");
  if (ctx.error) return emptyApp(APP.name, `채팅 정보를 못 불러왔어요: ${ctx.error}`);
  if (!p) return emptyApp(APP.name, ctx.chat ? "이 채팅에는 캐릭터가 없어요." : "불러오는 중…");
  if (!joined()) return ui.signup === "terms" ? renderTerms() : renderWelcome(p);

  chatList = h("div", { class: "uphone-messages" });
  const input = h("textarea", { class: "uphone-input", rows: "1", placeholder: "메시지 보내기", "aria-label": "메시지" });
  const submit = () => {
    const text = input.value.trim();
    if (!text || ui.busy) return;
    input.value = "";
    void sendChat(text);
  };
  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      submit();
    }
  });
  const title = h(
    "span",
    { class: "uphone-chat-title" },
    avatar(p, "small"),
    h("span", { class: "uphone-chat-name" }, h("strong", null, p.name, h("span", { class: "uphone-ai-badge" }, "AI")), h("small", null, "지금 대화 가능")),
  );
  const view = h(
    "div",
    { class: "uphone-aichat" },
    appHeader(title, h("span", { class: "uphone-brand-mark", "aria-hidden": "true" }, APP.icon)),
    chatList,
    h("div", { class: "uphone-composer" }, input, h("button", { class: "uphone-send", type: "button", "aria-label": "보내기", onclick: submit }, "↑")),
  );
  marinara.setTimeout(() => input.focus(), 0);
  return view;
}

function renderWelcome(p) {
  return h(
    "div",
    { class: "uphone-welcome" },
    h("span", { class: "uphone-pill" }, "NEW · 정식 오픈"),
    h("div", { class: "uphone-welcome-logo" }, APP.icon),
    h("div", { class: "uphone-welcome-brand" }, APP.name, h("small", null, APP.en)),
    h("p", { class: "uphone-welcome-tagline" }, `${APP.tagline}, AI 컴패니언`),
    h("p", { class: "uphone-welcome-promo" }, promoText()),
    h(
      "div",
      { class: "uphone-pick" },
      avatar(p),
      h("div", null, h("small", null, "오늘의 추천 컴패니언"), h("strong", null, p.name)),
    ),
    h(
      "ul",
      { class: "uphone-features" },
      h("li", null, "24시간 언제든 답장하는 대화 상대"),
      h("li", null, "당신을 기억하고 이해하는 AI"),
      h("li", null, "오픈 기념 프리미엄 무료"),
    ),
    h(
      "button",
      {
        class: "uphone-cta",
        type: "button",
        onclick: () => {
          ui.signup = "terms";
          render();
        },
      },
      "시작하기",
    ),
  );
}

function renderTerms() {
  const checks = TERMS.map((term) => h("input", { type: "checkbox", "aria-label": term.title }));
  const all = h("input", { type: "checkbox", "aria-label": "모두 동의" });
  const agree = h("button", { class: "uphone-cta", type: "button", disabled: true }, "동의하고 시작하기");
  const sync = () => {
    agree.disabled = !TERMS.every((term, i) => !term.required || checks[i].checked);
    all.checked = checks.every((c) => c.checked);
  };
  all.addEventListener("change", () => {
    for (const c of checks) c.checked = all.checked;
    sync();
  });
  for (const c of checks) c.addEventListener("change", sync);
  agree.addEventListener("click", () => {
    if (agree.disabled) return;
    const cs = chatState();
    cs.agreed = true;
    ui.signup = null;
    save();
    logActivity(`${APP.name}에 가입하고 이용약관에 모두 동의했다`);
    render();
    void requestOpening();
  });
  return h(
    "div",
    { class: "uphone-app-view" },
    h(
      "div",
      { class: "uphone-header" },
      h(
        "button",
        {
          class: "uphone-back",
          type: "button",
          "aria-label": "뒤로",
          onclick: () => {
            ui.signup = null;
            render();
          },
        },
        "‹",
      ),
      h("div", { class: "uphone-header-title" }, "약관 동의"),
      h("span"),
    ),
    h(
      "div",
      { class: "uphone-terms" },
      h("h2", null, `${APP.name} 이용을 위해`, h("br"), "약관에 동의해 주세요"),
      h("label", { class: "uphone-check is-all" }, all, h("strong", null, "모두 동의합니다")),
      TERMS.map((term, i) =>
        h(
          "div",
          { class: "uphone-term" },
          h("label", { class: "uphone-check" }, checks[i], h("span", null, h("em", null, term.required ? "[필수] " : "[선택] "), term.title)),
          h("details", null, h("summary", null, "보기"), term.body.map((line) => h("p", null, line))),
        ),
      ),
    ),
    h("div", { class: "uphone-terms-footer" }, agree),
  );
}

function renderChatMessages() {
  if (ui.app !== "aichat" || !chatList?.isConnected) return;
  const p = partner();
  const thread = p ? (chatState().threads[p.id] ?? []) : [];
  const rows = thread.map((m) =>
    h("div", { class: `uphone-bubble-row is-${m.role}` }, h("div", { class: "uphone-bubble" }, m.text), h("time", null, formatTime(m.t))),
  );
  if (thread.length === 0 && !ui.busy) rows.push(h("div", { class: "uphone-chat-empty" }, `${p?.name ?? ""}에게 첫 메시지를 보내 보세요.`));
  if (ui.busy) rows.push(h("div", { class: "uphone-bubble-row is-assistant" }, h("div", { class: "uphone-bubble is-typing" }, h("i"), h("i"), h("i"))));
  chatList.replaceChildren(...rows);
  chatList.scrollTop = chatList.scrollHeight;
}

function renderMemo() {
  if (!ctx.chatId) return emptyApp("메모", "Marinara에서 채팅을 먼저 열어 주세요.");
  const cs = chatState();
  const area = h("textarea", { class: "uphone-memo", placeholder: "메모를 입력하세요", "aria-label": "메모" });
  area.value = cs.memo;
  let memoTimer = null;
  area.addEventListener("input", () => {
    cs.memo = area.value;
    save();
    if (memoTimer) marinara.clearTimeout(memoTimer);
    memoTimer = marinara.setTimeout(() => {
      const snippet = area.value.trim().replace(/\s+/gu, " ").slice(-80);
      if (snippet) logActivity(`메모장에 이렇게 적었다: "${snippet}"`);
    }, 2500);
  });
  return h("div", { class: "uphone-app-view" }, appHeader("메모"), area);
}

// The settings app looks like an ordinary phone. The stage and the activity log are never shown.
// Practical controls (partner, model, reset) hide behind developer options: tap the build number 7 times.
let buildTaps = 0;
function renderSettings() {
  const view = h("div", { class: "uphone-app-view" }, appHeader("설정"));
  const body = h("div", { class: "uphone-settings" });
  view.append(body);
  const userName = ctx.persona?.name || "나";
  const row = (label, value, attrs) => h("div", { class: "uphone-row", ...attrs }, h("span", null, label), h("span", { class: "uphone-row-value" }, value));
  const stage = stageIndex(chatState().infection);

  body.append(
    h("div", { class: "uphone-profile" }, h("div", { class: "uphone-avatar" }, userName.charAt(0)), h("strong", null, userName)),
    h(
      "div",
      { class: "uphone-group" },
      row("Wi-Fi", "연결됨"),
      row("배터리", `${batteryLevel(stage)}%`),
      row("저장공간", stage >= 2 ? "알 수 없음" : "64GB 중 41GB 사용"),
    ),
    h(
      "div",
      { class: "uphone-group" },
      row("휴대폰 이름", `${userName}의 폰`),
      row("소프트웨어 버전", "14.2"),
      row("빌드 번호", "UP1.024.1118", {
        role: "button",
        tabindex: "0",
        onclick: () => {
          if (data.settings.devMode) return showToast("이미 개발자 모드예요.");
          buildTaps += 1;
          if (buildTaps < 7) {
            if (buildTaps >= 4) showToast(`개발자가 되기까지 ${7 - buildTaps}단계 남았어요.`);
            return;
          }
          buildTaps = 0;
          data.settings.devMode = true;
          save();
          showToast("개발자 모드를 켰어요.");
          render();
        },
      }),
    ),
  );
  if (data.settings.devMode) appendDeveloperOptions(body);
  return view;
}

function appendDeveloperOptions(body) {
  const cs = chatState();
  body.append(h("div", { class: "uphone-section-title" }, "개발자 옵션"));

  if (ctx.characters.length > 0) {
    const select = h("select", { "aria-label": "AI 상대" });
    for (const c of ctx.characters) {
      const option = h("option", { value: c.id }, c.name);
      option.selected = c.id === partner()?.id;
      select.append(option);
    }
    select.addEventListener("change", () => {
      cs.partnerId = select.value;
      save();
    });
    body.append(h("label", null, `${APP.name} 상대`, select));
  }

  const connSelect = h("select", { "aria-label": "AI 모델" }, h("option", { value: "" }, "이 채팅의 연결 따라가기"));
  api("/api/connections")
    .then((list) => {
      for (const conn of Array.isArray(list) ? list : []) {
        const option = h("option", { value: conn.id }, conn.name || conn.model || conn.id);
        option.selected = conn.id === data.settings.connectionId;
        connSelect.append(option);
      }
    })
    .catch(() => {});
  connSelect.addEventListener("change", () => {
    data.settings.connectionId = connSelect.value || null;
    save();
  });
  body.append(h("label", null, `${APP.name} 모델`, connSelect));

  body.append(
    h(
      "button",
      {
        class: "uphone-danger",
        type: "button",
        onclick: () => {
          if (!window.confirm(`이 채팅의 폰 데이터(${APP.name} 대화, 메모 등)를 모두 지울까요?`)) return;
          const id = ctx.chatId ?? "__none__";
          const unlocked = data.chats[id]?.storyUnlocked;
          delete data.chats[id];
          if (unlocked) data.chats[id] = { storyUnlocked: true }; // the intro is already in the chat
          save();
          render();
        },
      },
      "이 채팅의 폰 초기화",
    ),
    h(
      "button",
      {
        class: "uphone-plain",
        type: "button",
        onclick: () => {
          data.settings.devMode = false;
          save();
          render();
        },
      },
      "개발자 옵션 끄기",
    ),
  );
}

function emptyApp(title, message) {
  return h("div", { class: "uphone-app-view" }, appHeader(title), h("div", { class: "uphone-empty" }, message));
}

// ── lifecycle ──────────────────────────────────────────

const onKey = (event) => {
  if (event.key === "Escape" && ui.open) toggle(false);
};
window.addEventListener("keydown", onKey);

// Story gate, main-chat side: while the intro is locked, roleplay turns for this chat are refused.
// It works on Marinara's network request rather than its DOM, so UI changes do not break it.
// ponytail: matches only POST /api/generate with a JSON body; a new generation route would bypass it.
const pageFetch = window.fetch;
const guardedFetch = function (input, init) {
  try {
    const method = String(init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
    const url = new URL(input instanceof Request ? input.url : String(input), window.location.origin);
    if (method === "POST" && url.pathname === "/api/generate" && typeof init?.body === "string") {
      const body = JSON.parse(init.body);
      if (body?.chatId && body.chatId === ctx.chatId && gateLocked()) {
        onRoleplayBlocked();
        return Promise.resolve(
          new Response(JSON.stringify({ error: `📱 폰이 계속 울리고 있어요. ${APP.name} 알림을 먼저 확인해 주세요.` }), {
            status: 423,
            headers: { "Content-Type": "application/json" },
          }),
        );
      }
    }
  } catch {
    // Not a request this guard understands: let it through.
  }
  return pageFetch.apply(window, arguments);
};
window.fetch = guardedFetch;

function onRoleplayBlocked() {
  if (!ui.open) toggle(true);
  root.dataset.buzz = "true";
  marinara.setTimeout(() => {
    root.dataset.buzz = "";
  }, 900);
  showToast(`${APP.name} 알림이 와 있어요. 먼저 확인해 보세요.`);
}

marinara.setInterval(() => {
  renderStatus();
  void refreshContext();
}, 2000);

void refreshContext();
applyStage();
marinara.log.info("User Phone loaded");

return () => {
  window.removeEventListener("keydown", onKey);
  if (window.fetch === guardedFetch) window.fetch = pageFetch;
  root.remove();
};
