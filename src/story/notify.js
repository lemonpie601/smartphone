// ── notifications: a banner on the open phone, a peek bubble by the launcher when it is closed ──

const banner = h("button", { class: "uphone-banner", type: "button", hidden: true });
frame.append(banner);
const peek = h("button", { class: "uphone-peek", type: "button", hidden: true });
root.append(peek);
let bannerTimer = null;

/**
 * Shows a notification. `open` runs when it is tapped (the phone opens first if needed).
 * `quiet` skips the vibration, for things that should feel like they slipped past.
 */
function notify({ title, text, icon = APP.icon, open, quiet = false }) {
  const content = [h("span", { class: "uphone-banner-icon" }, icon), h("span", { class: "uphone-banner-text" }, h("strong", null, title), h("span", null, text))];
  const tap = () => {
    hideNotification();
    if (!ui.open) toggle(true);
    open?.();
  };
  banner.replaceChildren(...content);
  peek.replaceChildren(...content.map((node) => node.cloneNode(true)));
  banner.onclick = tap;
  peek.onclick = tap;
  banner.hidden = !ui.open;
  peek.hidden = ui.open;
  if (!quiet) {
    buzz();
    chime();
  }
  if (bannerTimer) marinara.clearTimeout(bannerTimer);
  bannerTimer = marinara.setTimeout(hideNotification, ui.open ? 5000 : 12000);
}

function hideNotification() {
  banner.hidden = true;
  peek.hidden = true;
}

/** The partner's thread and screen for a channel. */
function partnerChannel(channel) {
  const p = partner();
  const cs = chatState();
  if (channel === "lumi") {
    return { key: `lumi:${p.id}`, thread: (cs.threads[p.id] ??= []), app: "aichat", sub: null, label: APP.name };
  }
  const store = channel === "sms" ? "sms" : "talk";
  return { key: `${store}:partner`, thread: (cs[store].partner ??= []), app: store === "sms" ? "messages" : "talk", sub: "partner", label: store === "sms" ? "메시지" : "톡" };
}

function isViewing(target) {
  return ui.open && !ui.call && ui.app === target.app && (ui.sub ?? null) === target.sub;
}

/** Puts words from the partner on the phone, unread unless that conversation is on screen, and tells the user. */
function deliverFromPartner(channel, lines) {
  const p = partner();
  if (!p || lines.length === 0) return;
  // Before the partner has slipped into the phone (stage 3), it can only speak through its app.
  const target = partnerChannel(stageIndex() >= 2 ? channel : "lumi");
  const viewing = isViewing(target);
  const now = Date.now();
  for (const text of lines) target.thread.push({ role: "assistant", text, t: now, ...(viewing ? {} : { unread: true }) });
  trimList(target.thread, MAX_THREAD);
  save();
  if (viewing) return renderConvo();
  announcePartner(target, lines.at(-1));
}

function announcePartner(target, text) {
  const p = partner();
  const hidden = target.app !== "aichat";
  notify({
    title: hidden ? `${target.label} · 알 수 없는 번호` : `${APP.name} · ${p.name}`,
    text,
    icon: hidden ? (target.app === "messages" ? "✉️" : "💬") : APP.icon,
    open: () => go(target.app, target.sub),
  });
  render();
}

/** Clears unread marks on a thread being looked at. */
function markRead(thread) {
  let changed = false;
  for (const m of thread ?? []) {
    if (m.unread) {
      delete m.unread;
      changed = true;
    }
  }
  if (changed) save();
}
