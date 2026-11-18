// User Phone (유저폰) — Marinara Engine full-page personal extension.
//
// Marinara joins the files listed in manifest.json's jsPath, in order, and runs them as the body of
// `async (marinara) => { ... }`. All files share one scope; src/main.js comes last and returns the cleanup.
//
// Knowledge rule: the partner knows {{user}} only through the phone — the AI chat conversation and the
// phone facts that apps record with logActivity(). Never feed it persona details or the card scenario.
//
// Immersion rule: the stage (infection) and the phone facts are never shown. The only on-screen hint is
// the AI chat app's terms of service, which the user agrees to on first use.
//
// Layers:  [0] 메인 롤플 채팅  <-  [1] {{user}}의 폰 (this overlay)  <-  [2] AI 채팅 앱 (APP, inside the phone)

/** The AI chat service on the phone. Rename it here. */
const APP = { name: "루미", en: "Lumi", tagline: "언제나 당신 곁에", icon: "✦" };

const ACTIVE_CHAT_KEY = "marinara-active-chat-id"; // Marinara's own localStorage key for the open chat
const MAX_THREAD = 200; // messages kept per conversation
const MAX_LOG = 40; // phone facts kept per chat
const MAX_CALLS = 50; // call log entries kept per chat
const MAX_PHOTOS = 60; // gallery photos kept per chat
const PROMPT_HISTORY = 30; // conversation messages sent to the model
const PROMPT_LOG = 15; // phone facts the partner can "see"
const INFECTION_PER_MESSAGE = 4;
const STAGE_THRESHOLDS = [0, 30, 60, 90]; // normal, cracks, breach, crossing over

/** People already saved on a fresh phone. Each chat gets its own copy, so edits stay per story. */
const DEFAULT_CONTACTS = [
  { id: "mom", name: "엄마", relation: "엄마", emoji: "🌷", phone: "010-2481-7730", note: "걱정이 많고 다정하다. 밥은 먹었는지, 잠은 잘 자는지 꼭 묻는다." },
  { id: "dad", name: "아빠", relation: "아빠", emoji: "🌲", phone: "010-5523-1904", note: "말수가 적고 무뚝뚝하지만 속정이 깊다. 문자는 짧게, 맞춤법은 정확하게 쓴다." },
  { id: "jieun", name: "지은", relation: "가장 친한 친구", emoji: "🍓", phone: "010-7752-0318", note: "수다스럽고 눈치가 빠르다. 이모티콘과 ㅋㅋ를 많이 쓴다." },
  { id: "minsu", name: "민수", relation: "친구", emoji: "🎬", phone: "010-3307-6621", note: "영화를 좋아하는 착한 친구. 은근히 {{user}}를 챙긴다." },
  { id: "senior", name: "박 선배", relation: "선배", emoji: "📚", phone: "010-9140-2257", note: "깍듯하고 바쁘다. 용건만 간단히 말한다." },
];

// ── state ──────────────────────────────────────────────

const saved = await marinara.storage.get().catch(() => ({}));
const data = {
  chats: isObject(saved.chats) ? saved.chats : {},
  settings: isObject(saved.settings) ? saved.settings : {},
};
if (data.settings.devMode) data.settings.devUnlocked = true; // v0.4 kept this flag under another name

const ctx = {
  chatId: null,
  chat: null,
  characters: [],
  persona: null,
  error: null,
};

const ui = {
  open: false,
  app: "lock", // lock | home | aichat | phone | messages | talk | camera | gallery | memo | settings | ext:<id>
  sub: null, // a screen inside the current app, e.g. a conversation or the settings' developer page
  signup: null, // null (welcome) | "terms", while the AI chat app is not yet joined
  busyKey: null, // the conversation waiting for a model reply
  call: null, // the call on screen, see src/apps/phone.js
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
  cs.sms ??= {};
  cs.talk ??= {};
  cs.calls ??= [];
  cs.photos ??= [];
  cs.contacts ??= DEFAULT_CONTACTS.map((c) => ({ ...c }));
  return cs;
}

function stageIndex(infection = chatState().infection) {
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

/** Picks a Korean particle by the word's last syllable: josa("엄마", "과", "와") → "엄마와". */
function josa(word, withFinal, withoutFinal) {
  const text = String(word ?? "");
  const code = text.trim().charCodeAt(text.trim().length - 1) - 0xac00;
  const hasFinal = code >= 0 && code <= 11171 && code % 28 !== 0;
  return text + (hasFinal ? withFinal : withoutFinal);
}

function snippet(text, max = 60) {
  const flat = String(text ?? "").replace(/\s+/gu, " ").trim();
  return flat.length > max ? `${flat.slice(0, max)}…` : flat;
}

function trimList(list, max) {
  if (list.length > max) list.splice(0, list.length - max);
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

// Only the name: it is the account name on the phone. The rest of the persona is off-phone knowledge.
function personaFields(record) {
  return record ? { name: record.name || "User" } : null;
}

function activeChatId() {
  try {
    return window.localStorage.getItem(ACTIVE_CHAT_KEY) || null;
  } catch {
    return null;
  }
}

/** A cheap fingerprint of who is in the chat, to notice a character or persona change in the same chat. */
function castKey(chat) {
  return chat ? `${(chat.characterIds ?? []).join(",")}|${chat.personaId ?? ""}|${chat.connectionId ?? ""}` : "";
}

let contextLoad = null;
/**
 * Loads the open chat's characters and persona. `force` reloads even when the chat id is unchanged:
 * a chat being set up can switch its character or persona without changing its id.
 */
async function refreshContext(force = false) {
  const chatId = activeChatId();
  if (!force && chatId === ctx.chatId) return contextLoad;
  const switched = chatId !== ctx.chatId;
  ctx.chatId = chatId;
  if (switched) {
    ctx.chat = null;
    ctx.characters = [];
    ctx.persona = null;
    ui.signup = null;
    ui.sub = null;
  }
  ctx.error = null;
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

/** Reloads the context only if the open chat's cast changed since it was loaded. */
async function refreshIfCastChanged() {
  if (!ctx.chatId || !ctx.chat) return;
  const chat = await api(`/api/chats/${encodeURIComponent(ctx.chatId)}`).catch(() => null);
  if (chat && castKey(chat) !== castKey(ctx.chat)) await refreshContext(true);
}

function partner() {
  const cs = chatState();
  return ctx.characters.find((c) => c.id === cs.partnerId) ?? ctx.characters[0] ?? null;
}

function connectionId() {
  return data.settings.connectionId || ctx.chat?.connectionId || null;
}

function userName() {
  return ctx.persona?.name || "나";
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

function formatDay(t) {
  const d = new Date(t);
  const today = new Date();
  return d.toDateString() === today.toDateString()
    ? formatTime(t)
    : d.toLocaleDateString([], { month: "numeric", day: "numeric" });
}

function avatar(p, size = "") {
  const initial = (p?.name ?? "?").trim().charAt(0) || "?";
  const box = h("div", { class: `uphone-avatar ${size}` }, p?.emoji ?? initial);
  if (p?.avatar) {
    const img = h("img", { src: p.avatar, alt: "" });
    img.addEventListener("error", () => img.remove());
    box.append(img);
  }
  return box;
}
