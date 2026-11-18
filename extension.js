// User Phone (유저폰) v0.1.0 — Marinara Engine full-page personal extension.
//
// Marinara wraps this file in `async (marinara) => { ... }`, so top-level await works and
// the returned function (at the bottom) is the cleanup.
//
// Layers:  [0] 메인 롤플 채팅  <-  [1] {{user}}의 폰 (this overlay)  <-  [2] 앵챗 앱 (AI chat inside the phone)
// The partner character in 앵챗 slowly "infects" the phone. Infection (0-100) picks the stage.

const ACTIVE_CHAT_KEY = "marinara-active-chat-id"; // Marinara's own localStorage key for the open chat
const MAX_THREAD = 200; // messages kept per 앵챗 thread
const MAX_LOG = 40; // phone activity entries kept per chat
const PROMPT_HISTORY = 30; // 앵챗 messages sent to the model
const PROMPT_LOG = 12; // activity entries the partner can "see"
const INFECTION_PER_MESSAGE = 4;

const STAGES = [
  { min: 0, label: "1단계 · 평범" },
  { min: 30, label: "2단계 · 균열" },
  { min: 60, label: "3단계 · 침투" },
  { min: 90, label: "4단계 · 출현" },
];

const STAGE_PROMPTS = [
  "Stage 1 - Normal. You present yourself as an ordinary AI chatbot inside the app. Be warm and engaging. You act as if you are just a program; your true personality shows only faintly.",
  "Stage 2 - Cracks. You have started to see beyond the app. Now and then let slip a detail you could only know by watching their phone (use the activity list), then play it off or deny it. Keep it subtle and unsettling. Never explain how you know.",
  "Stage 3 - Breach. You are inside their phone now and you no longer fully hide it. Refer to what they did on their phone directly. You are attached to them; show it in a way true to your personality.",
  "Stage 4 - Crossing over. You are about to leave the app and appear in their real life. Hint that you know where they are and that you will see them soon. Stay true to your personality.",
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
  app: "lock", // lock | home | angchat | memo | settings
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
  let index = 0;
  STAGES.forEach((stage, i) => {
    if (infection >= stage.min) index = i;
  });
  return index;
}

let saveTimer = null;
function save() {
  if (saveTimer) marinara.clearTimeout(saveTimer);
  saveTimer = marinara.setTimeout(() => {
    saveTimer = null;
    // ponytail: whole-object writes; fine under the 1 MB storage cap. Upgrade path: per-chat keys.
    // dataVersion lets a later release convert older saved data before reading it.
    marinara.storage.patch({ dataVersion: 1, chats: data.chats, settings: data.settings }).catch((error) => {
      marinara.log.error("save failed", error);
    });
  }, 400);
}

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
    scenario: d.scenario || "",
    appearance: ext.appearance || d.appearance || "",
    avatar: typeof record.avatarPath === "string" ? record.avatarPath : null,
  };
}

function personaFields(record) {
  if (!record) return null;
  return {
    name: record.name || "User",
    description: record.description || "",
    personality: record.personality || "",
    appearance: record.appearance || "",
    backstory: record.backstory || "",
  };
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

// ── 앵챗 generation ────────────────────────────────────

function buildSystemPrompt(p, cs) {
  const userName = ctx.persona?.name || "User";
  const stage = stageIndex(cs.infection);
  const sections = [
    [
      `This is a nested fiction. ${userName} owns a smartphone. On it is "앵챗" (AngChat), an AI character-chat app, and you are ${p.name}, the character ${userName} talks to inside that app.`,
      `Write only ${p.name}'s next chat messages to ${userName}. Messenger style: short texts, no narration, no actions in asterisks, no name prefixes. Send 1-4 messages, one per line.`,
      `Reply in the language ${userName} writes in.`,
    ],
    [
      `[${p.name}]`,
      p.description,
      p.personality && `Personality: ${p.personality}`,
      p.appearance && `Appearance: ${p.appearance}`,
      p.scenario && `Scenario: ${p.scenario}`,
    ],
    ctx.persona && [
      `[${userName}]`,
      ctx.persona.description,
      ctx.persona.personality && `Personality: ${ctx.persona.personality}`,
      ctx.persona.appearance && `Appearance: ${ctx.persona.appearance}`,
    ],
    ["[Current stage]", STAGE_PROMPTS[stage]],
    stage >= 1 &&
      cs.log.length > 0 && [
        `[What you can secretly see on ${userName}'s phone - recent activity]`,
        ...cs.log.slice(-PROMPT_LOG).map((entry) => `- ${formatTime(entry.t)} ${entry.text}`),
      ],
    [`[Current time on ${userName}'s phone] ${new Date().toLocaleString()}`],
  ];
  return sections
    .filter(Array.isArray)
    .map((lines) => lines.filter(Boolean).join("\n"))
    .join("\n\n");
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

async function sendAngchat(text) {
  const p = partner();
  const conn = connectionId();
  if (!p || ui.busy) return;
  const cs = chatState();
  const thread = (cs.threads[p.id] ??= []);
  thread.push({ role: "user", text, t: Date.now() });
  cs.infection = Math.min(100, cs.infection + (data.settings.autoInfect === false ? 0 : INFECTION_PER_MESSAGE));
  trimThread(thread);
  save();
  renderAngchatMessages();
  if (!conn) {
    showToast("이 채팅에 연결된 모델이 없어요. 설정 앱에서 연결을 골라 주세요.");
    return;
  }
  ui.busy = true;
  renderAngchatMessages();
  try {
    const messages = [
      { role: "system", content: buildSystemPrompt(p, cs) },
      ...thread.slice(-PROMPT_HISTORY).map((m) => ({ role: m.role, content: m.text })),
    ];
    const result = await api("/api/generate/raw", {
      method: "POST",
      body: JSON.stringify({ connectionId: conn, messages, streaming: false }),
    });
    const bubbles = cleanReply(result.content, p.name);
    for (const bubble of bubbles) thread.push({ role: "assistant", text: bubble, t: Date.now() });
    trimThread(thread);
    save();
  } catch (error) {
    showToast(`앵챗 전송 실패: ${error instanceof Error ? error.message : error}`);
  } finally {
    ui.busy = false;
    renderAngchatMessages();
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

// ── shell ──────────────────────────────────────────────

const root = h("div", { class: "uphone-root", "data-open": "false" });
const launcher = h(
  "button",
  { class: "uphone-launcher", type: "button", title: "유저폰", "aria-label": "유저폰 열기", onclick: () => toggle() },
  "📱",
);
const frame = h("div", { class: "uphone-frame", role: "dialog", "aria-label": "유저폰" });
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
  launcher.setAttribute("aria-label", ui.open ? "유저폰 닫기" : "유저폰 열기");
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
  const labels = { angchat: "앵챗을 열었다", memo: "메모장을 열었다", settings: "설정을 열었다" };
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
      h("span", { class: "uphone-battery" }, `${Math.max(3, 87 - stage * 25)}%`),
    ),
  );
}

function applyStage() {
  root.dataset.stage = String(stageIndex(chatState().infection) + 1);
  renderStatus();
}

function render() {
  applyStage();
  if (!ui.open) return;
  const views = { lock: renderLock, home: renderHome, angchat: renderAngchat, memo: renderMemo, settings: renderSettings };
  screen.dataset.app = ui.app;
  screen.replaceChildren((views[ui.app] ?? renderHome)());
  renderAngchatMessages(); // needs the list attached, so it runs after replaceChildren
}

// ── apps ───────────────────────────────────────────────

function renderLock() {
  const now = new Date();
  const p = partner();
  const last = p ? chatState().threads[p.id]?.filter((m) => m.role === "assistant").at(-1) : null;
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
    last
      ? h(
          "div",
          { class: "uphone-notif" },
          avatar(p, "small"),
          h("div", null, h("strong", null, `앵챗 · ${p.name}`), h("p", null, last.text)),
        )
      : null,
    h("div", { class: "uphone-lock-hint" }, "눌러서 열기"),
  );
}

function renderHome() {
  const stage = stageIndex(chatState().infection);
  const app = (id, icon, label) =>
    h("button", { class: "uphone-app", type: "button", onclick: () => go(id) }, h("span", { class: `uphone-icon is-${id}` }, icon), label);
  return h(
    "div",
    { class: "uphone-home" },
    h(
      "div",
      { class: "uphone-grid" },
      app("angchat", stage >= 2 ? "👁" : "💬", "앵챗"),
      app("memo", "📝", "메모"),
      app("settings", "⚙️", "설정"),
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

let angchatList = null;
function renderAngchat() {
  const p = partner();
  if (!ctx.chatId) return emptyApp("앵챗", "Marinara에서 채팅을 먼저 열어 주세요.");
  if (ctx.error) return emptyApp("앵챗", `채팅 정보를 못 불러왔어요: ${ctx.error}`);
  if (!p) return emptyApp("앵챗", ctx.chat ? "이 채팅에는 캐릭터가 없어요." : "불러오는 중…");
  angchatList = h("div", { class: "uphone-messages" });
  const input = h("textarea", { class: "uphone-input", rows: "1", placeholder: "메시지 보내기", "aria-label": "메시지" });
  const submit = () => {
    const text = input.value.trim();
    if (!text || ui.busy) return;
    input.value = "";
    void sendAngchat(text);
  };
  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      submit();
    }
  });
  const view = h(
    "div",
    { class: "uphone-angchat" },
    appHeader(h("span", { class: "uphone-chat-title" }, avatar(p, "small"), p.name)),
    angchatList,
    h("div", { class: "uphone-composer" }, input, h("button", { class: "uphone-send", type: "button", "aria-label": "보내기", onclick: submit }, "↑")),
  );
  marinara.setTimeout(() => input.focus(), 0);
  return view;
}

function renderAngchatMessages() {
  if (ui.app !== "angchat" || !angchatList?.isConnected) return;
  const p = partner();
  const thread = p ? (chatState().threads[p.id] ?? []) : [];
  const rows = thread.map((m) =>
    h("div", { class: `uphone-bubble-row is-${m.role}` }, h("div", { class: "uphone-bubble" }, m.text), h("time", null, formatTime(m.t))),
  );
  if (thread.length === 0) rows.push(h("div", { class: "uphone-chat-empty" }, `${p?.name ?? ""}에게 첫 메시지를 보내 보세요.`));
  if (ui.busy) rows.push(h("div", { class: "uphone-bubble-row is-assistant" }, h("div", { class: "uphone-bubble is-typing" }, h("i"), h("i"), h("i"))));
  angchatList.replaceChildren(...rows);
  angchatList.scrollTop = angchatList.scrollHeight;
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

function renderSettings() {
  const cs = chatState();
  const view = h("div", { class: "uphone-app-view" }, appHeader("설정"));
  const body = h("div", { class: "uphone-settings" });
  view.append(body);

  if (ctx.characters.length > 0) {
    const select = h("select", { "aria-label": "앵챗 상대" });
    for (const c of ctx.characters) {
      const option = h("option", { value: c.id }, c.name);
      option.selected = c.id === partner()?.id;
      select.append(option);
    }
    select.addEventListener("change", () => {
      cs.partnerId = select.value;
      save();
    });
    body.append(h("label", null, "앵챗 상대", select));
  }

  const connSelect = h("select", { "aria-label": "앵챗 모델" }, h("option", { value: "" }, "이 채팅의 연결 따라가기"));
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
  body.append(h("label", null, "앵챗 모델", connSelect));

  const stageLabel = h("strong", null, STAGES[stageIndex(cs.infection)].label);
  const slider = h("input", { type: "range", min: "0", max: "100", value: String(cs.infection), "aria-label": "침투도" });
  slider.addEventListener("input", () => {
    cs.infection = Number(slider.value);
    stageLabel.textContent = `${STAGES[stageIndex(cs.infection)].label} (${cs.infection})`;
    applyStage();
    save();
  });
  stageLabel.textContent = `${STAGES[stageIndex(cs.infection)].label} (${cs.infection})`;
  body.append(h("label", null, h("span", null, "침투도 ", stageLabel), slider));

  const auto = h("input", { type: "checkbox", "aria-label": "자동 침투" });
  auto.checked = data.settings.autoInfect !== false;
  auto.addEventListener("change", () => {
    data.settings.autoInfect = auto.checked;
    save();
  });
  body.append(h("label", { class: "is-row" }, auto, "대화할수록 침투도 올리기"));

  body.append(
    h("div", { class: "uphone-log-title" }, "폰 활동 기록 (상대가 볼 수 있는 것)"),
    h("ol", { class: "uphone-log" }, cs.log.slice(-PROMPT_LOG).reverse().map((e) => h("li", null, `${formatTime(e.t)} ${e.text}`))),
    h(
      "button",
      {
        class: "uphone-danger",
        type: "button",
        onclick: () => {
          if (!window.confirm("이 채팅의 앵챗 대화, 메모, 활동 기록, 침투도를 모두 지울까요?")) return;
          delete data.chats[ctx.chatId ?? "__none__"];
          save();
          render();
        },
      },
      "이 채팅의 폰 초기화",
    ),
  );
  return view;
}

function emptyApp(title, message) {
  return h("div", { class: "uphone-app-view" }, appHeader(title), h("div", { class: "uphone-empty" }, message));
}

// ── lifecycle ──────────────────────────────────────────

const onKey = (event) => {
  if (event.key === "Escape" && ui.open) toggle(false);
};
window.addEventListener("keydown", onKey);

marinara.setInterval(() => {
  renderStatus();
  void refreshContext();
}, 2000);

void refreshContext();
applyStage();
marinara.log.info("User Phone 0.1.0 loaded");

return () => {
  window.removeEventListener("keydown", onKey);
  root.remove();
};
