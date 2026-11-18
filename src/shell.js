// ── the phone: frame, navigation, lock screen, home, notification centre, shared conversation screen ──

/** Apps other full-page extensions put on the phone through window.UserPhone (see src/main.js). */
const externalApps = new Map();

const root = h("div", { class: "uphone-root", "data-open": "false" });
const launcher = h(
  "button",
  { class: "uphone-launcher", type: "button", title: "휴대폰", "aria-label": "휴대폰 열기", onclick: () => toggle() },
  "📱",
);
const frame = h("div", { class: "uphone-frame", role: "dialog", "aria-label": "휴대폰" });
const statusBar = h("div", { class: "uphone-status", title: "아래로 끌어 알림 보기" });
const screen = h("div", { class: "uphone-screen" });
const toast = h("div", { class: "uphone-toast", hidden: true });
const shade = h("div", { class: "uphone-shade", hidden: true });
const dimmer = h("div", { class: "uphone-dimmer", "aria-hidden": "true" });
const homeBar = h("button", {
  class: "uphone-homebar",
  type: "button",
  "aria-label": "홈으로",
  onclick: () => {
    if (ui.call) return; // a call stays on screen until it ends
    closeShade();
    go(ui.app === "lock" ? "lock" : "home");
  },
});
frame.append(h("div", { class: "uphone-notch" }), statusBar, screen, shade, toast, dimmer, homeBar);
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
    lockSound();
    closeShade();
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
  browser: () => "인터넷을 열었다",
  calendar: () => "캘린더를 열었다",
  maps: () => "지도를 열었다",
  music: () => "음악 앱을 열었다",
  weather: () => `날씨 앱에서 ${weatherCity().name} 날씨를 확인했다`,
  clock: () => "시계 앱을 열었다",
  feed: () => `${josa(FEED.name, "을", "를")} 열었다`,
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
      nextAlarm() ? h("span", { title: "알람" }, "⏰") : null,
      musicPlaying() ? h("span", { title: "재생 중" }, "♪") : null,
      stage >= 2 ? h("span", { class: "uphone-cam-dot", title: "카메라 사용 중" }) : null,
      data.settings.wifiOff ? "LTE" : "Wi-Fi",
      h("span", { class: "uphone-battery" }, `${batteryLevel(stage)}%`),
    ),
  );
  dimmer.style.opacity = String((1 - (data.settings.brightness ?? 1)) * 0.7);
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
    browser: renderBrowser,
    calendar: renderCalendar,
    maps: renderMaps,
    music: renderMusic,
    weather: renderWeather,
    clock: renderClock,
    feed: renderFeed,
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
  if (!shade.hidden) renderShade();
}

// ── unread marks (set by whoever delivers a message, cleared when the thread is on screen) ──

function unreadIn(thread) {
  let n = 0;
  for (const m of thread ?? []) if (m.unread) n += 1;
  return n;
}

/** Unread messages in 문자 or 톡, counted over the contacts the user can see. */
function unreadInStore(store) {
  const threads = chatState()[store];
  return contactList().reduce((n, c) => n + unreadIn(threads[c.id]), 0);
}

function clearUnreadMarks(thread) {
  let changed = false;
  for (const m of thread ?? []) {
    if (m.unread) {
      delete m.unread;
      changed = true;
    }
  }
  if (changed) save();
}

function badgeText(n) {
  return n > 0 ? (n > 99 ? "99+" : String(n)) : null;
}

// ── notifications: one list for the lock screen and the notification centre ──

/**
 * What the phone has to tell the user, newest first. Each item opens its app when tapped.
 * Missed calls and unread messages stay until seen; the rest can be cleared from the notification centre.
 */
function phoneNotifications() {
  const cs = chatState();
  const cleared = cs.notifClearedAt ?? 0;
  const items = [];
  const missed = cs.calls.filter((c) => c.dir === "missed" && !c.seen);
  if (missed.length > 0) {
    const last = missed.at(-1);
    items.push({ icon: "📞", cls: "is-phone", title: "전화", text: `부재중 전화 ${missed.length}통 · ${callerName(last)}`, t: last.t, open: () => go("phone", "recents") });
  }
  for (const [store, app, label, icon, cls] of [
    ["sms", "messages", "메시지", "✉️", "is-sms"],
    ["talk", "talk", "톡", "💬", "is-talk"],
  ]) {
    for (const c of contactList()) {
      const thread = cs[store][c.id];
      const n = unreadIn(thread);
      if (n === 0) continue;
      const last = thread.filter((m) => m.unread).at(-1);
      const who = c.ghost ? "알 수 없는 번호" : c.name;
      items.push({ icon, cls, title: `${label} · ${who}${n > 1 ? ` (${n})` : ""}`, text: last.photo ? "사진" : last.text, t: last.t, open: () => go(app, c.id) });
    }
  }
  const p = partner();
  const lumiThread = p ? cs.threads[p.id] : null;
  const lumiUnread = unreadIn(lumiThread);
  if (p && lumiUnread > 0) {
    const last = lumiThread.filter((m) => m.unread).at(-1);
    items.push({ node: appIcon("is-mini"), title: `${APP.name} · ${p.name}${lumiUnread > 1 ? ` (${lumiUnread})` : ""}`, text: last.text, t: last.t, open: () => go("aichat") });
  }
  for (const item of calendarNotifications()) if (item.t > cleared) items.push(item);
  for (const item of feedNotifications()) if (item.t > cleared) items.push(item);
  return items.sort((a, b) => b.t - a.t);
}

function notifCard(item, onOpen) {
  const icon = item.node ?? h("span", { class: `uphone-icon ${item.cls ?? ""} is-mini` }, item.icon);
  return h(
    "button",
    {
      class: `uphone-notif ${item.promo ? "is-promo" : ""}`,
      type: "button",
      onclick: (event) => {
        event.stopPropagation();
        onOpen(item);
      },
    },
    icon,
    h("div", null, h("strong", null, item.title, item.t ? h("time", null, formatDay(item.t)) : null), h("p", null, item.text)),
  );
}

// ── notification centre: pull the status bar down ──

let shadeDrag = null;
statusBar.addEventListener("pointerdown", (event) => {
  if (!ui.open || ui.app === "lock" || ui.call) return;
  shadeDrag = { y: event.clientY };
});
statusBar.addEventListener("pointermove", (event) => {
  if (shadeDrag && event.clientY - shadeDrag.y > 18) {
    shadeDrag = null;
    openShade();
  }
});
statusBar.addEventListener("pointerup", () => {
  if (shadeDrag) openShade(); // a tap works too
  shadeDrag = null;
});
statusBar.addEventListener("pointerleave", () => {
  shadeDrag = null;
});

function openShade() {
  if (!ui.open || ui.app === "lock" || ui.call) return;
  shade.hidden = false;
  renderShade();
  // next frame, so the slide-in transition runs
  marinara.setTimeout(() => shade.classList.add("is-open"), 10);
}

function closeShade() {
  shade.classList.remove("is-open");
  shade.hidden = true;
}

function quickTile(label, icon, on, onClick) {
  return h("button", { class: `uphone-qs ${on ? "is-on" : ""}`, type: "button", "aria-pressed": String(on), onclick: onClick }, h("span", null, icon), h("small", null, label));
}

function renderShade() {
  const now = new Date();
  const s = data.settings;
  const flip = (key, onFact, offFact) => () => {
    s[key] = !s[key];
    save();
    logActivity(s[key] ? onFact : offFact);
    renderStatus();
    renderShade();
  };
  const brightness = h("input", { type: "range", min: "20", max: "100", class: "uphone-brightness", "aria-label": "밝기" });
  brightness.value = String(Math.round((s.brightness ?? 1) * 100));
  brightness.addEventListener("input", () => {
    s.brightness = Number(brightness.value) / 100;
    renderStatus();
  });
  brightness.addEventListener("change", () => save());
  const items = phoneNotifications();
  const openItem = (item) => {
    closeShade();
    item.open();
  };
  const clearAll = () => {
    const cs = chatState();
    cs.notifClearedAt = Date.now();
    for (const call of cs.calls) if (call.dir === "missed") call.seen = true;
    save();
    render();
  };
  shade.replaceChildren(
    h(
      "div",
      { class: "uphone-shade-panel" },
      h(
        "div",
        { class: "uphone-shade-top" },
        h("strong", null, formatTime(now.getTime())),
        h("span", null, now.toLocaleDateString([], { month: "long", day: "numeric", weekday: "short" })),
        h("button", { class: "uphone-plain", type: "button", onclick: () => (closeShade(), go("settings")) }, "⚙️"),
      ),
      h(
        "div",
        { class: "uphone-qs-grid" },
        quickTile("Wi-Fi", "📶", !s.wifiOff, flip("wifiOff", "Wi-Fi를 껐다", "Wi-Fi를 켰다")),
        quickTile("방해 금지", "🌙", !!s.dnd, flip("dnd", "방해 금지 모드를 켰다", "방해 금지 모드를 껐다")),
        quickTile("손전등", "🔦", !!s.flashlight, flip("flashlight", "손전등을 켰다", "손전등을 껐다")),
        quickTile("진동", "📳", !s.silent, flip("silent", "폰을 무음으로 바꿨다", "폰을 진동으로 바꿨다")),
      ),
      h("label", { class: "uphone-brightness-row" }, h("span", { "aria-hidden": "true" }, "☀"), brightness),
      musicMiniPlayer(),
      h(
        "div",
        { class: "uphone-shade-list" },
        items.length === 0 ? h("p", { class: "uphone-shade-empty" }, "새 알림이 없어요") : items.map((item) => notifCard(item, openItem)),
      ),
      items.length > 0 ? h("button", { class: "uphone-shade-clear", type: "button", onclick: clearAll }, "모두 지우기") : null,
      h("button", { class: "uphone-shade-handle", type: "button", "aria-label": "알림 센터 닫기", onclick: closeShade }),
    ),
  );
  shade.onclick = (event) => {
    if (event.target === shade) closeShade();
  };
}

// ── lock and home ──────────────────────────────────────

function renderLock() {
  const now = new Date();
  const cs = chatState();
  const p = partner();
  const unlock = (then) => {
    logActivity("폰 잠금을 해제했다");
    lockSound(true);
    if (then) then.open();
    else go("home");
  };
  const items = phoneNotifications().slice(0, 4);
  const notifs = items.map((item) => notifCard(item, unlock));
  const last = p ? cs.threads[p.id]?.filter((m) => m.role === "assistant").at(-1) : null;
  if (last && !last.unread) {
    notifs.push(
      notifCard({ node: avatar(p, "small"), title: `${APP.name} · ${p.name}`, text: last.text, open: () => go("aichat") }, unlock),
    );
  } else if (!last && gateLocked()) {
    notifs.push(notifCard({ node: appIcon("is-mini"), promo: true, title: `${APP.name} · 광고`, text: `🎉 정식 오픈! ${promoText()}`, open: () => go("aichat") }, unlock));
  }
  const playing = musicPlaying();
  return h(
    "div",
    { class: "uphone-lock", onclick: () => unlock() },
    h("div", { class: "uphone-lock-date" }, now.toLocaleDateString([], { month: "long", day: "numeric", weekday: "long" })),
    h("div", { class: "uphone-lock-time" }, formatTime(now)),
    h("div", { class: "uphone-lock-weather" }, `${weatherNow().icon} ${weatherNow().temp}° ${weatherCity().name}`),
    playing ? h("div", { class: "uphone-lock-music" }, "♪ ", `${playing.title} · ${playing.artist}`) : null,
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

/** The calendar icon shows today, like a real phone's. */
function calendarIcon() {
  const now = new Date();
  return h(
    "span",
    { class: "uphone-icon is-calendar" },
    h("small", null, now.toLocaleDateString([], { weekday: "short" })),
    h("b", null, String(now.getDate())),
  );
}

function homeWidget() {
  const now = new Date();
  const w = weatherNow();
  const next = nextCalendarEvent();
  return h(
    "button",
    { class: "uphone-widget", type: "button", onclick: () => go(next ? "calendar" : "weather") },
    h(
      "span",
      { class: "uphone-widget-left" },
      h("strong", null, now.toLocaleDateString([], { month: "long", day: "numeric" })),
      h("small", null, now.toLocaleDateString([], { weekday: "long" })),
      h("span", { class: "uphone-widget-next" }, next ? `${next.time ?? "하루 종일"} · ${next.title}` : "오늘 남은 일정 없음"),
    ),
    h(
      "span",
      { class: "uphone-widget-right" },
      h("span", { class: "uphone-widget-icon" }, w.icon),
      h("strong", null, `${w.temp}°`),
      h("small", null, `${weatherCity().name} · ${w.cond}`),
    ),
  );
}

function renderHome() {
  const cs = chatState();
  const missed = cs.calls.filter((c) => c.dir === "missed" && !c.seen).length;
  const icon = (cls, glyph) => h("span", { class: `uphone-icon ${cls}` }, glyph);
  const p = partner();
  const lumiBadge = joined() ? badgeText(p ? unreadIn(cs.threads[p.id]) : 0) : "N";
  const extras = [...externalApps.values()].map((app) => homeApp(`ext:${app.id}`, icon("is-ext", app.icon), app.name));
  return h(
    "div",
    { class: "uphone-home" },
    homeWidget(),
    h(
      "div",
      { class: "uphone-grid" },
      homeApp("aichat", appIcon(), APP.name, lumiBadge),
      homeApp("browser", icon("is-browser", "🔎"), "인터넷"),
      homeApp("feed", icon("is-feed", FEED.icon), FEED.name, badgeText(feedNotifications().filter((n) => n.t > (cs.notifClearedAt ?? 0)).length)),
      homeApp("calendar", calendarIcon(), "캘린더"),
      homeApp("maps", icon("is-maps", "🗺️"), "지도"),
      homeApp("music", icon("is-music", "🎵"), "음악"),
      homeApp("weather", icon("is-weather", weatherNow().icon), "날씨"),
      homeApp("clock", icon("is-clock", "⏰"), "시계"),
      homeApp("gallery", icon("is-gallery", "🖼️"), "갤러리"),
      homeApp("memo", icon("is-memo", "📝"), "메모"),
      homeApp("settings", icon("is-settings", "⚙️"), "설정"),
      extras,
    ),
    h(
      "div",
      { class: "uphone-dock" },
      homeApp("phone", icon("is-phone", "📞"), "전화", badgeText(missed)),
      homeApp("messages", icon("is-sms", "✉️"), "메시지", badgeText(unreadInStore("sms"))),
      homeApp("talk", icon("is-talk", "💬"), "톡", badgeText(unreadInStore("talk"))),
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

/** An in-phone dialog over the current screen. `actions` are [label, onClick, cls]. */
function phoneSheet(title, body, actions) {
  const sheet = h("div", { class: "uphone-sheet" });
  const close = () => sheet.remove();
  sheet.addEventListener("click", (event) => {
    if (event.target === sheet) close();
  });
  sheet.append(
    h(
      "div",
      { class: "uphone-sheet-card" },
      title ? h("strong", { class: "uphone-sheet-title" }, title) : null,
      body,
      h(
        "div",
        { class: "uphone-sheet-actions" },
        actions.map(([label, onClick, cls]) =>
          h(
            "button",
            {
              class: cls ?? "uphone-secondary",
              type: "button",
              onclick: () => {
                close();
                onClick?.();
              },
            },
            label,
          ),
        ),
      ),
    ),
  );
  screen.append(sheet);
  return close;
}

/** Asks before something that cannot be undone. */
function confirmSheet(text, confirmLabel, onConfirm) {
  return phoneSheet(null, h("p", { class: "uphone-sheet-text" }, text), [
    ["취소", null],
    [confirmLabel, onConfirm, "uphone-danger"],
  ]);
}

// ── shared conversation screen (루미, 메시지, 톡, 통화) ──

let convo = null; // { key, list, thread: () => messages, emptyText, receipts }

/**
 * A scrolling conversation with a composer. `onSend(text)` handles a sent line; the screen redraws itself
 * through renderConvo() whenever the thread or the typing state changes. `onAttach(photo)`, when given,
 * adds a button that sends a gallery photo. `receipts` shows 읽음 / 안 읽음 under the user's messages.
 */
function conversationView({ key, header, thread, emptyText, onSend, variant, placeholder = "메시지 보내기", footer, onAttach, receipts = false }) {
  const list = h("div", { class: "uphone-messages" });
  convo = { key, list, thread, emptyText, receipts };
  const input = h("textarea", { class: "uphone-input", rows: "1", placeholder, "aria-label": placeholder });
  const submit = () => {
    const text = input.value.trim();
    if (!text || ui.busyKey) return;
    input.value = "";
    if (variant !== "call") sentSound();
    void onSend(text);
  };
  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      submit();
    }
  });
  marinara.setTimeout(() => input.focus(), 0);
  const view = h("div", { class: `uphone-convo is-${variant}` });
  const attach = onAttach
    ? h("button", { class: "uphone-attach", type: "button", "aria-label": "사진 보내기", onclick: () => photoPicker(view, onAttach) }, "＋")
    : null;
  const composer = h("div", { class: "uphone-composer" }, attach, input, h("button", { class: "uphone-send", type: "button", "aria-label": "보내기", onclick: submit }, "↑"));
  view.append(...[header, list, composer, footer].filter(Boolean));
  return view;
}

/** A sheet of gallery photos to send in a conversation. */
function photoPicker(view, onPick) {
  const list = photos();
  const sheet = h("div", { class: "uphone-picker" });
  const close = () => sheet.remove();
  sheet.append(
    h("div", { class: "uphone-picker-head" }, h("strong", null, "사진 보내기"), h("button", { class: "uphone-plain", type: "button", onclick: close }, "닫기")),
    list.length === 0
      ? h("p", { class: "uphone-empty" }, "갤러리에 사진이 없어요.")
      : h(
          "div",
          { class: "uphone-gallery" },
          [...list].reverse().map((photo) =>
            h(
              "button",
              {
                class: "uphone-tile",
                type: "button",
                style: `background:${photoTint(photo)}`,
                onclick: () => {
                  close();
                  onPick(photo);
                },
              },
              h("span", null, photo.desc),
            ),
          ),
        ),
  );
  view.append(sheet);
}

function dayLabel(t) {
  return new Date(t).toLocaleDateString([], { year: "numeric", month: "long", day: "numeric", weekday: "long" });
}

function renderConvo() {
  if (!convo?.list.isConnected) return;
  const thread = convo.thread() ?? [];
  if (ui.open) clearUnreadMarks(thread); // the user is looking at it
  let lastRead = -1;
  if (convo.receipts) thread.forEach((m, i) => m.role === "user" && m.read !== false && (lastRead = i));
  const rows = [];
  thread.forEach((m, i) => {
    const prev = thread[i - 1];
    const next = thread[i + 1];
    if (!prev || new Date(prev.t).toDateString() !== new Date(m.t).toDateString()) {
      rows.push(h("div", { class: "uphone-day-sep" }, h("span", null, dayLabel(m.t))));
    }
    // like most messengers, the time shows once per run of messages sent in the same minute
    const showTime = !next || next.role !== m.role || formatTime(next.t) !== formatTime(m.t);
    const bubble = m.photo
      ? h("div", { class: "uphone-bubble is-photo", style: `background:${photoTint(m.photo)}` }, h("span", null, m.photo.desc))
      : h("div", { class: "uphone-bubble" }, m.text);
    let receipt = null;
    if (convo.receipts && m.role === "user") {
      if (m.read === false) receipt = h("span", { class: "uphone-receipt is-unread" }, "안 읽음");
      else if (i === lastRead) receipt = h("span", { class: "uphone-receipt" }, "읽음");
    }
    rows.push(
      h(
        "div",
        { class: `uphone-bubble-row is-${m.role} ${showTime ? "" : "is-grouped"}` },
        bubble,
        h("span", { class: "uphone-bubble-meta" }, receipt, showTime ? h("time", null, formatTime(m.t)) : null),
      ),
    );
  });
  const typing = ui.busyKey === convo.key;
  if (thread.length === 0 && !typing && convo.emptyText) rows.push(h("div", { class: "uphone-chat-empty" }, convo.emptyText));
  if (typing) rows.push(h("div", { class: "uphone-bubble-row is-assistant" }, h("div", { class: "uphone-bubble is-typing" }, h("i"), h("i"), h("i"))));
  convo.list.replaceChildren(...rows);
  convo.list.scrollTop = convo.list.scrollHeight;
}
