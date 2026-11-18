// ── other extensions on the phone, the roleplay guard, timers, cleanup. Must be the last file. ──

// window.UserPhone lets another full-page extension put an app on the phone's home screen:
//
//   const app = window.UserPhone.registerApp({
//     id: "weather", name: "날씨", icon: "☀️",
//     render(container, phone) {          // draw into container; phone.logActivity(text), phone.close()
//       container.textContent = "맑음";
//       return () => {};                  // optional cleanup when the app is left
//     },
//   });
//   app.remove();
//
// Listen for the "userphone:ready" window event if your extension may load before this one.
// Sandboxed extensions cannot reach window, and Marinara exposes no way to open another extension's
// panel from page code, so only extensions that opt in through this API can appear on the phone.
let externalCleanup = null;

const userPhoneApi = Object.freeze({
  version: 1,
  registerApp(def) {
    const id = String(def?.id ?? "").trim();
    if (!/^[\w.-]{1,40}$/u.test(id) || typeof def.render !== "function") throw new TypeError("registerApp needs an id and a render function");
    externalApps.set(id, { id, name: String(def.name ?? id).slice(0, 12), icon: String(def.icon ?? "🧩").slice(0, 4), render: def.render });
    if (ui.app === "home") render();
    return Object.freeze({
      remove() {
        externalApps.delete(id);
        if (ui.app === `ext:${id}`) go("home");
        else if (ui.app === "home") render();
      },
    });
  },
  logActivity(text) {
    logActivity(snippet(text, 200));
  },
});

function renderExternalApp(id) {
  const app = externalApps.get(id);
  if (!app) return emptyApp("앱", "이 앱은 더 이상 설치되어 있지 않아요.");
  leaveExternalApp();
  const container = h("div", { class: "uphone-ext-body" });
  try {
    const cleanup = app.render(container, { logActivity: userPhoneApi.logActivity, close: () => go("home") });
    if (typeof cleanup === "function") externalCleanup = cleanup;
  } catch (error) {
    marinara.log.error(`phone app ${id} failed`, error);
    container.textContent = "앱을 열지 못했어요.";
  }
  return h("div", { class: "uphone-app-view" }, appHeader(app.name), container);
}

function leaveExternalApp() {
  const cleanup = externalCleanup;
  externalCleanup = null;
  try {
    cleanup?.();
  } catch (error) {
    marinara.log.warn("phone app cleanup failed", error);
  }
}

window.UserPhone = userPhoneApi;
window.dispatchEvent(new CustomEvent("userphone:ready"));

// ── keyboard ───────────────────────────────────────────

const onKey = (event) => {
  if (event.key === "Escape" && ui.open && !ui.call) toggle(false);
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
        if (!ui.open) toggle(true);
        buzz();
        showToast(`${APP.name} 알림이 와 있어요. 먼저 확인해 보세요.`);
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

// ── timers ─────────────────────────────────────────────

let ticks = 0;
marinara.setInterval(() => {
  ticks += 1;
  tickCallTimer();
  if (ticks % 2 === 0) {
    renderStatus();
    void refreshContext(); // a different chat opened
  }
  if (ticks % 10 === 0) void refreshIfCastChanged(); // same chat, new character or persona
  if (ticks % 30 === 0) maybeIncomingCall();
}, 1000);

void refreshContext();
applyStage();
marinara.log.info("User Phone loaded");

return () => {
  window.removeEventListener("keydown", onKey);
  if (window.fetch === guardedFetch) window.fetch = pageFetch;
  if (window.UserPhone === userPhoneApi) delete window.UserPhone;
  leaveExternalApp();
  root.remove();
};
