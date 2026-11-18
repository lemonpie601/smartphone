// ── 메시지 (SMS) and 톡 (a messenger): the same screens with different looks ──

const MESSENGERS = {
  sms: { title: "메시지", verb: "문자", store: "sms", app: "messages", delay: [500, 900] },
  talk: { title: "톡", verb: "톡", store: "talk", app: "talk", delay: [1200, 3200] },
};

/** What friends show under their names in 톡. Contacts the user adds have none until they set one. */
const TALK_STATUS = {
  mom: "항상 건강하게 💐",
  dad: "",
  jieun: "오늘도 열심히 놀자 🍓",
  minsu: "이번 주 개봉작 다 볼 예정",
  senior: "업무 연락은 메일로 부탁드립니다",
};

function renderMessenger(kind) {
  const sub = ui.sub;
  if (kind === "talk" && sub === "friends") return renderTalkFriends();
  return sub ? renderThread(kind, sub) : renderInbox(kind);
}

function messengerTabs(kind, active) {
  if (kind !== "talk") return null;
  const tab = (id, label, sub) =>
    h("button", { class: `uphone-tab ${active === id ? "is-active" : ""}`, type: "button", onclick: () => go("talk", sub) }, label);
  return h("div", { class: "uphone-tabs" }, tab("friends", "친구", "friends"), tab("chats", `채팅${unreadInStore("talk") ? ` ${unreadInStore("talk")}` : ""}`, null));
}

function lastLine(m) {
  if (!m) return null;
  return m.photo ? "사진을 보냈습니다." : m.text;
}

function renderInbox(kind) {
  const m = MESSENGERS[kind];
  const threads = chatState()[m.store];
  const rows = contactList()
    .map((c) => ({ c, last: threads[c.id]?.at(-1) ?? null, unread: unreadIn(threads[c.id]) }))
    .sort((a, b) => (b.last?.t ?? 0) - (a.last?.t ?? 0));
  const started = rows.filter((r) => r.last);
  const fresh = rows.filter((r) => !r.last);
  const row = ({ c, last, unread }) =>
    h(
      "button",
      { class: `uphone-list-row ${c.ghost ? "is-ghost" : ""} ${unread ? "is-unread" : ""}`, type: "button", onclick: () => go(m.app, c.id) },
      avatar(c, "small"),
      h("span", { class: "uphone-list-main" }, h("strong", null, c.name), h("small", null, last ? snippet(lastLine(last), 28) : "대화를 시작해 보세요")),
      h("span", { class: "uphone-list-side" }, h("small", null, last ? formatDay(last.t) : ""), unread ? h("span", { class: "uphone-count" }, badgeText(unread)) : null),
    );
  return h(
    "div",
    { class: `uphone-app-view is-${kind}` },
    appHeader(m.title),
    h(
      "div",
      { class: "uphone-list" },
      started.map(row),
      fresh.length > 0 ? h("div", { class: "uphone-section-label" }, started.length > 0 ? "다른 연락처" : "연락처") : null,
      fresh.map(row),
    ),
    messengerTabs(kind, "chats"),
  );
}

function renderTalkFriends() {
  const name = userName();
  const friends = contactList().filter((c) => !c.ghost);
  const favs = friends.filter((c) => c.fav);
  const row = (c) =>
    h(
      "button",
      { class: "uphone-list-row", type: "button", onclick: () => go("talk", c.id) },
      avatar(c, "small"),
      h("span", { class: "uphone-list-main" }, h("strong", null, c.name), (c.status ?? TALK_STATUS[c.id]) ? h("small", null, c.status ?? TALK_STATUS[c.id]) : null),
    );
  return h(
    "div",
    { class: "uphone-app-view is-talk" },
    appHeader("친구"),
    h(
      "div",
      { class: "uphone-list" },
      h("div", { class: "uphone-list-row uphone-my-profile" }, h("div", { class: "uphone-avatar" }, name.charAt(0)), h("span", { class: "uphone-list-main" }, h("strong", null, name), h("small", null, "내 프로필"))),
      favs.length > 0 ? h("div", { class: "uphone-section-label" }, "즐겨찾기") : null,
      favs.map(row),
      h("div", { class: "uphone-section-label" }, `친구 ${friends.length}`),
      friends.map(row),
    ),
    messengerTabs("talk", "friends"),
  );
}

// Replies wait a moment, as a person would, and a burst of messages gets one reply.
const messengerReplies = new Map(); // key -> timer

function queueMessengerReply(kind, contact) {
  const m = MESSENGERS[kind];
  const key = `${kind}:${contact.id}`;
  const thread = (chatState()[m.store][contact.id] ??= []);
  if (messengerReplies.has(key)) marinara.clearTimeout(messengerReplies.get(key));
  const [min, max] = m.delay;
  const run = async () => {
    if (ui.busyKey) {
      // another conversation is waiting on the model; try again shortly
      messengerReplies.set(key, marinara.setTimeout(run, 1500));
      return;
    }
    messengerReplies.delete(key);
    for (const msg of thread) if (msg.role === "user" && msg.read === false) msg.read = true;
    renderConvo();
    const before = thread.length;
    const lines = await askModel({ key, system: promptFor(contact, kind), thread, speaker: contact.name });
    if (lines.length === 0) return;
    if (!contact.ghost) logActivity(`${contact.name}에게서 ${josa(m.verb, "이", "가")} 왔다: "${snippet(lines.join(" "))}"`);
    const viewing = ui.open && !ui.call && ui.app === m.app && ui.sub === contact.id;
    if (!viewing) {
      for (const msg of thread.slice(before)) msg.unread = true;
      save();
      announceMessage(kind, contact, lines.at(-1));
    }
  };
  messengerReplies.set(key, marinara.setTimeout(run, min + Math.random() * (max - min)));
}

/** Tells the user a reply came in while they were elsewhere. */
function announceMessage(kind, contact, text) {
  const m = MESSENGERS[kind];
  const who = contact.ghost ? "알 수 없는 번호" : contact.name;
  if (typeof notify === "function") {
    notify({ title: `${m.title} · ${who}`, text, icon: kind === "sms" ? "✉️" : "💬", open: () => go(m.app, contact.id) });
  } else {
    showToast(`${m.title} · ${who}: ${snippet(text, 40)}`);
    if (!data.settings.silent) buzz();
  }
  render();
}

/** Adds the user's message to a 문자/톡 thread, records it, and lets the other side answer. */
function postToThread(kind, contact, msg) {
  const m = MESSENGERS[kind];
  const list = (chatState()[m.store][contact.id] ??= []);
  if (!msg.photo) logActivity(`${contact.name}에게 ${josa(m.verb, "을", "를")} 보냈다: "${snippet(msg.text)}"`);
  list.push(kind === "talk" ? { ...msg, read: false } : msg);
  trimList(list, MAX_THREAD);
  save();
  renderConvo();
  queueMessengerReply(kind, contact);
}

function sendPhotoTo(kind, contact, photo) {
  logActivity(`${contact.name}에게 ${kind === "talk" ? "톡으로" : "문자로"} 사진을 보냈다: "${snippet(photo.desc)}"`);
  postToThread(kind, contact, { role: "user", text: `[사진: ${photo.desc}]`, t: Date.now(), photo: { id: photo.id, desc: photo.desc, unknown: !!photo.unknown } });
}

function renderThread(kind, contactId) {
  const m = MESSENGERS[kind];
  const contact = findContact(contactId);
  if (!contact) return emptyApp(m.title, "연락처를 찾을 수 없어요.");
  const key = `${kind}:${contactId}`;
  const thread = () => (chatState()[m.store][contactId] ??= []);
  const send = (text) => postToThread(kind, contact, { role: "user", text, t: Date.now() });
  const sendPhoto = (photo) => sendPhotoTo(kind, contact, photo);
  const call = h("button", { class: "uphone-header-action", type: "button", "aria-label": `${contact.name}에게 전화`, onclick: () => startCall(contact.id) }, "📞");
  const sub = kind === "talk" ? (contact.status ?? TALK_STATUS[contact.id]) : contact.ghost ? "" : contact.phone;
  return conversationView({
    key,
    variant: kind,
    header: appHeader(
      h("span", { class: "uphone-chat-title" }, avatar(contact, "small"), h("span", { class: "uphone-chat-name" }, h("strong", null, contact.name), sub ? h("small", null, sub) : null)),
      call,
      () => go(m.app),
    ),
    thread,
    emptyText: contact.ghost ? "" : `${contact.name}에게 ${josa(m.verb, "을", "를")} 보내 보세요.`,
    onSend: send,
    onAttach: sendPhoto,
    receipts: kind === "talk",
  });
}
