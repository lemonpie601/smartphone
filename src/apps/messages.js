// ── 메시지 (SMS) and 톡 (a messenger): the same screens with different looks ──

const MESSENGERS = {
  sms: { title: "메시지", verb: "문자", store: "sms" },
  talk: { title: "톡", verb: "톡", store: "talk" },
};

function renderMessenger(kind) {
  const contactId = ui.sub;
  return contactId ? renderThread(kind, contactId) : renderInbox(kind);
}

function renderInbox(kind) {
  const m = MESSENGERS[kind];
  const threads = chatState()[m.store];
  const rows = contactList()
    .map((c) => ({ c, last: threads[c.id]?.at(-1) ?? null }))
    .sort((a, b) => (b.last?.t ?? 0) - (a.last?.t ?? 0));
  return h(
    "div",
    { class: `uphone-app-view is-${kind}` },
    appHeader(m.title),
    h(
      "div",
      { class: "uphone-list" },
      rows.map(({ c, last }) =>
        h(
          "button",
          { class: `uphone-list-row ${c.ghost ? "is-ghost" : ""}`, type: "button", onclick: () => go(kind, c.id) },
          avatar(c, "small"),
          h("span", { class: "uphone-list-main" }, h("strong", null, c.name), h("small", null, last ? snippet(last.text, 28) : "대화를 시작해 보세요")),
          h("small", null, last ? formatDay(last.t) : ""),
        ),
      ),
    ),
  );
}

function renderThread(kind, contactId) {
  const m = MESSENGERS[kind];
  const contact = findContact(contactId);
  if (!contact) return emptyApp(m.title, "연락처를 찾을 수 없어요.");
  const key = `${kind}:${contactId}`;
  const thread = () => (chatState()[m.store][contactId] ??= []);
  const send = async (text) => {
    const list = thread();
    list.push({ role: "user", text, t: Date.now() });
    trimList(list, MAX_THREAD);
    if (contact.ghost) chatState().infection = Math.min(100, chatState().infection + INFECTION_PER_MESSAGE);
    logActivity(`${contact.name}에게 ${josa(m.verb, "을", "를")} 보냈다: "${snippet(text)}"`);
    renderConvo();
    const lines = await askModel({ key, system: promptFor(contact, kind), thread: list, speaker: contact.name });
    if (lines.length > 0 && !contact.ghost) logActivity(`${contact.name}에게서 ${josa(m.verb, "이", "가")} 왔다: "${snippet(lines.join(" "))}"`);
  };
  return conversationView({
    key,
    variant: kind,
    header: appHeader(h("span", { class: "uphone-chat-title" }, avatar(contact, "small"), contact.name), null, () => go(kind)),
    thread,
    emptyText: contact.ghost ? "" : `${contact.name}에게 ${josa(m.verb, "을", "를")} 보내 보세요.`,
    onSend: send,
  });
}
