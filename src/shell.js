// ── the phone: frame, navigation, lock screen, home, shared conversation screen ──

/** Apps other full-page extensions put on the phone through window.UserPhone (see src/main.js). */
const externalApps = new Map();

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
  onclick: () => {
    if (ui.call) return; // a call stays on screen until it ends
    go(ui.app === "lock" ? "lock" : "home");
  },
});
frame.append(h("div", { class: "uphone-notch" }), statusBar, screen, toast, homeBar);
root.append(frame, launcher);
document.body.append(root);

function toggle(force) {
  ui.open = force ?? !ui.open;
  root.dataset.open = String(ui.open);
  launcher.setAttribute("aria-label", ui.open ? "휴대폰 닫기" : "휴대폰 열기");
  if (ui.open) {
    if (!ui.call) go("lock");
    // The chat may have switched character or persona while keeping its id (e.g. during chat setup).
    void refreshContext(true);
    render();
  } else {
    leaveExternalApp();
    logActivity("폰을 내려놓았다");
  }
}

const APP_FACTS = {
  aichat: () => `${josa(APP.name, "을", "를")} 열었다`,
  phone: () => "전화 앱을 열었다",
  messages: () => "문자 앱을 열었다",
  talk: () => "톡을 열었다",
  camera: () => "카메라를 켰다",
  gallery: () => "갤러리를 봤다",
  memo: () => "메모장을 열었다",
  settings: () => "설정을 열었다",
};

function go(app, sub = null) {
  if (ui.app === app && ui.sub === sub) return;
  if (ui.app !== app) {
    leaveExternalApp();
    const fact = APP_FACTS[app]?.() ?? (app.startsWith("ext:") ? `${josa(externalApps.get(app.slice(4))?.name ?? "앱", "을", "를")} 열었다` : null);
    if (fact) logActivity(fact);
  }
  ui.app = app;
  ui.sub = sub;
  ui.signup = null;
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

function buzz() {
  root.dataset.buzz = "true";
  marinara.setTimeout(() => {
    root.dataset.buzz = "";
  }, 900);
}

function renderStatus() {
  const stage = stageIndex();
  statusBar.replaceChildren(
    h("span", null, formatTime(Date.now())),
    h(
      "span",
      { class: "uphone-status-right" },
      data.settings.dnd ? h("span", { title: "방해 금지 모드" }, "🌙") : null,
      stage >= 2 ? h("span", { class: "uphone-cam-dot", title: "카메라 사용 중" }) : null,
      "LTE",
      h("span", { class: "uphone-battery" }, `${batteryLevel(stage)}%`),
    ),
  );
}

function applyStage() {
  root.dataset.stage = String(stageIndex() + 1);
  root.dataset.gate = gateLocked() ? "locked" : "open";
  root.dataset.ringing = ui.call?.state === "ringing" ? "true" : "";
  renderStatus();
}

function render() {
  applyStage();
  if (!ui.open) return;
  const views = {
    lock: renderLock,
    home: renderHome,
    aichat: renderChatApp,
    phone: renderPhoneApp,
    messages: () => renderMessenger("sms"),
    talk: () => renderMessenger("talk"),
    camera: renderCamera,
    gallery: renderGallery,
    memo: renderMemo,
    settings: renderSettings,
  };
  screen.dataset.app = ui.call ? "call" : ui.app;
  let view;
  try {
    view = ui.call ? renderCall() : ui.app.startsWith("ext:") ? renderExternalApp(ui.app.slice(4)) : (views[ui.app] ?? renderHome)();
  } catch (error) {
    marinara.log.error("render failed", error);
    view = emptyApp("오류", "화면을 그리지 못했어요.");
  }
  screen.replaceChildren(view);
  renderConvo(); // needs the list attached, so it runs after replaceChildren
}

// ── lock and home ──────────────────────────────────────

function renderLock() {
  const now = new Date();
  const cs = chatState();
  const p = partner();
  const notifs = [];
  const missed = cs.calls.filter((c) => c.dir === "missed" && !c.seen);
  if (missed.length > 0) {
    const last = missed.at(-1);
    notifs.push(
      h(
        "div",
        { class: "uphone-notif" },
        h("span", { class: "uphone-icon is-phone is-mini" }, "📞"),
        h("div", null, h("strong", null, "전화"), h("p", null, `부재중 전화 ${missed.length}통 · ${callerName(last)}`)),
      ),
    );
  }
  const last = p ? cs.threads[p.id]?.filter((m) => m.role === "assistant").at(-1) : null;
  if (last) {
    notifs.push(h("div", { class: "uphone-notif" }, avatar(p, "small"), h("div", null, h("strong", null, `${APP.name} · ${p.name}`), h("p", null, last.text))));
  } else if (gateLocked()) {
    notifs.push(
      h("div", { class: "uphone-notif is-promo" }, appIcon("is-mini"), h("div", null, h("strong", null, `${APP.name} · 광고`), h("p", null, `🎉 정식 오픈! ${promoText()}`))),
    );
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
    h("div", { class: "uphone-notifs" }, notifs),
    h("div", { class: "uphone-lock-hint" }, "눌러서 열기"),
  );
}

function appIcon(extra = "") {
  return h("span", { class: `uphone-icon is-aichat ${extra}` }, stageIndex() >= 2 ? "👁" : APP.icon);
}

function homeApp(id, icon, label, badge) {
  return h(
    "button",
    { class: "uphone-app", type: "button", onclick: () => go(id) },
    h("span", { class: "uphone-icon-wrap" }, icon, badge ? h("span", { class: "uphone-badge" }, badge) : null),
    h("span", { class: "uphone-app-label" }, label),
  );
}

function renderHome() {
  const cs = chatState();
  const missed = cs.calls.filter((c) => c.dir === "missed" && !c.seen).length;
  const icon = (cls, glyph) => h("span", { class: `uphone-icon ${cls}` }, glyph);
  const extras = [...externalApps.values()].map((app) => homeApp(`ext:${app.id}`, icon("is-ext", app.icon), app.name));
  return h(
    "div",
    { class: "uphone-home" },
    h(
      "div",
      { class: "uphone-grid" },
      homeApp("aichat", appIcon(), APP.name, joined() ? null : "N"),
      homeApp("gallery", icon("is-gallery", "🖼️"), "갤러리"),
      homeApp("memo", icon("is-memo", "📝"), "메모"),
      homeApp("settings", icon("is-settings", "⚙️"), "설정"),
      extras,
    ),
    h(
      "div",
      { class: "uphone-dock" },
      homeApp("phone", icon("is-phone", "📞"), "전화", missed > 0 ? String(missed) : null),
      homeApp("messages", icon("is-sms", "✉️"), "메시지"),
      homeApp("talk", icon("is-talk", "💬"), "톡"),
      homeApp("camera", icon("is-camera", "📷"), "카메라"),
    ),
  );
}

function appHeader(title, extra, onBack = () => go("home")) {
  return h(
    "div",
    { class: "uphone-header" },
    h("button", { class: "uphone-back", type: "button", "aria-label": "뒤로", onclick: onBack }, "‹"),
    h("div", { class: "uphone-header-title" }, title),
    extra ?? h("span"),
  );
}

function emptyApp(title, message) {
  return h("div", { class: "uphone-app-view" }, appHeader(title), h("div", { class: "uphone-empty" }, message));
}

// ── shared conversation screen (루미, 메시지, 톡, 통화) ──

let convo = null; // { key, list, thread: () => messages, emptyText }

/**
 * A scrolling conversation with a composer. `onSend(text)` handles a sent line; the screen redraws itself
 * through renderConvo() whenever the thread or the typing state changes.
 */
function conversationView({ key, header, thread, emptyText, onSend, variant, placeholder = "메시지 보내기", footer }) {
  const list = h("div", { class: "uphone-messages" });
  convo = { key, list, thread, emptyText };
  const input = h("textarea", { class: "uphone-input", rows: "1", placeholder, "aria-label": placeholder });
  const submit = () => {
    const text = input.value.trim();
    if (!text || ui.busyKey) return;
    input.value = "";
    void onSend(text);
  };
  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      submit();
    }
  });
  marinara.setTimeout(() => input.focus(), 0);
  return h(
    "div",
    { class: `uphone-convo is-${variant}` },
    header,
    list,
    h("div", { class: "uphone-composer" }, input, h("button", { class: "uphone-send", type: "button", "aria-label": "보내기", onclick: submit }, "↑")),
    footer,
  );
}

function renderConvo() {
  if (!convo?.list.isConnected) return;
  const thread = convo.thread() ?? [];
  const rows = thread.map((m) =>
    h("div", { class: `uphone-bubble-row is-${m.role}` }, h("div", { class: "uphone-bubble" }, m.text), h("time", null, formatTime(m.t))),
  );
  const typing = ui.busyKey === convo.key;
  if (thread.length === 0 && !typing && convo.emptyText) rows.push(h("div", { class: "uphone-chat-empty" }, convo.emptyText));
  if (typing) rows.push(h("div", { class: "uphone-bubble-row is-assistant" }, h("div", { class: "uphone-bubble is-typing" }, h("i"), h("i"), h("i"))));
  convo.list.replaceChildren(...rows);
  convo.list.scrollTop = convo.list.scrollHeight;
}
