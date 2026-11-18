// ── contacts, the phone app, and calls (text in place of voice) ──

const RING_MS = 20_000; // an unanswered call becomes a missed call
const CALL_GAP_MS = 6 * 60_000; // the least time between two surprise calls
const CALL_CHANCE = 0.12; // chance of a surprise call at each check (every 30 s)

/** Saved contacts, plus the partner once it has crept into the phone (stage 3+). */
function contactList() {
  const list = [...chatState().contacts];
  const p = partner();
  if (p && stageIndex() >= 2) list.push({ id: "partner", name: p.name, relation: "", phone: "저장한 적 없는 번호", avatar: p.avatar, ghost: true });
  return list;
}

function findContact(id) {
  return contactList().find((c) => c.id === id) ?? null;
}

function callerName(call) {
  if (call.hidden) return "발신자 정보 없음";
  return findContact(call.contactId)?.name ?? "알 수 없음";
}

/** The prompt for whoever is on the other end. The partner keeps its knowledge rule everywhere. */
function promptFor(contact, channel) {
  return contact.ghost ? buildPartnerPrompt(partner(), channel) : buildContactPrompt(contact, channel);
}

// ── phone app ──────────────────────────────────────────

function renderPhoneApp() {
  const cs = chatState();
  const unseen = cs.calls.filter((call) => call.dir === "missed" && !call.seen);
  for (const call of unseen) call.seen = true;
  if (unseen.length > 0) save();
  const tab = ui.sub === "new-contact" ? "contacts" : (ui.sub ?? (cs.calls.length > 0 ? "recents" : "contacts"));
  const body = ui.sub === "new-contact" ? renderNewContact() : tab === "recents" ? renderRecents() : renderContacts();
  const tabButton = (id, label) =>
    h("button", { class: `uphone-tab ${tab === id ? "is-active" : ""}`, type: "button", onclick: () => go("phone", id) }, label);
  return h(
    "div",
    { class: "uphone-app-view" },
    appHeader(tab === "recents" ? "최근 기록" : "연락처", tab === "contacts" && ui.sub !== "new-contact" ? h("button", { class: "uphone-header-action", type: "button", "aria-label": "새 연락처", onclick: () => go("phone", "new-contact") }, "＋") : null),
    body,
    h("div", { class: "uphone-tabs" }, tabButton("recents", "최근 기록"), tabButton("contacts", "연락처")),
  );
}

function renderRecents() {
  const calls = [...chatState().calls].reverse();
  if (calls.length === 0) return h("div", { class: "uphone-empty" }, "통화 기록이 없어요.");
  const label = { in: "수신", out: "발신", missed: "부재중", declined: "거절" };
  return h(
    "div",
    { class: "uphone-list" },
    calls.map((call) =>
      h(
        "button",
        {
          class: `uphone-list-row ${call.dir === "missed" ? "is-missed" : ""}`,
          type: "button",
          onclick: () => (call.hidden ? showToast("발신자 정보가 없는 번호예요.") : startCall(call.contactId)),
        },
        h("span", { class: "uphone-call-dir" }, call.dir === "out" ? "↗" : call.dir === "in" ? "↙" : "✕"),
        h("span", { class: "uphone-list-main" }, h("strong", null, callerName(call)), h("small", null, `${label[call.dir]}${call.dur ? ` · ${formatDuration(call.dur)}` : ""}`)),
        h("small", null, formatDay(call.t)),
      ),
    ),
  );
}

function renderContacts() {
  return h(
    "div",
    { class: "uphone-list" },
    contactList().map((c) =>
      h(
        "div",
        { class: `uphone-list-row ${c.ghost ? "is-ghost" : ""}` },
        avatar(c, "small"),
        h("span", { class: "uphone-list-main" }, h("strong", null, c.name), h("small", null, c.relation || c.phone)),
        h(
          "span",
          { class: "uphone-row-actions" },
          h("button", { type: "button", "aria-label": `${c.name}에게 전화`, onclick: () => startCall(c.id) }, "📞"),
          h("button", { type: "button", "aria-label": `${c.name}에게 문자`, onclick: () => go("messages", c.id) }, "✉️"),
          h("button", { type: "button", "aria-label": `${c.name}에게 톡`, onclick: () => go("talk", c.id) }, "💬"),
        ),
      ),
    ),
  );
}

function renderNewContact() {
  const name = h("input", { class: "uphone-field", placeholder: "이름", "aria-label": "이름" });
  const relation = h("input", { class: "uphone-field", placeholder: "관계 (예: 친구, 동생)", "aria-label": "관계" });
  const note = h("textarea", { class: "uphone-field", rows: "3", placeholder: "어떤 사람인지 (말투, 성격)", "aria-label": "메모" });
  const saveContact = () => {
    if (!name.value.trim()) return showToast("이름을 입력해 주세요.");
    const contact = {
      id: `c${Date.now().toString(36)}`,
      name: name.value.trim().slice(0, 30),
      relation: relation.value.trim().slice(0, 30) || "지인",
      note: note.value.trim().slice(0, 300),
      phone: `010-${String(Math.floor(1000 + Math.random() * 9000))}-${String(Math.floor(1000 + Math.random() * 9000))}`,
    };
    chatState().contacts.push(contact);
    save();
    const particle = josa(contact.relation, "을", "를").slice(contact.relation.length);
    logActivity(`연락처에 ${contact.name}(${contact.relation})${particle} 저장했다`);
    go("phone", "contacts");
  };
  return h(
    "div",
    { class: "uphone-form" },
    name,
    relation,
    note,
    h("button", { class: "uphone-cta", type: "button", onclick: saveContact }, "저장"),
  );
}

function formatDuration(seconds) {
  const s = Math.max(0, Math.round(seconds));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

// ── calls ──────────────────────────────────────────────

function callerFor(call) {
  return call.contactId === "partner" ? { ...partner(), id: "partner", ghost: true } : findContact(call.contactId);
}

function startCall(contactId) {
  const contact = findContact(contactId);
  if (!contact || ui.call) return;
  ui.call = { contactId, hidden: false, dir: "out", state: "dialing", lines: [], started: 0 };
  if (!ui.open) toggle(true);
  render();
  marinara.setTimeout(() => {
    if (ui.call?.state !== "dialing") return;
    ui.call.state = "active";
    ui.call.started = Date.now();
    render();
    void callerSpeaks(`(${userName()} is calling you and you just picked up. Answer the phone.)`);
  }, 1800);
}

function receiveCall(contactId, hidden = false) {
  if (ui.call) return;
  const call = { contactId, hidden, dir: "in", state: "ringing", lines: [], started: 0 };
  ui.call = call;
  chatState().lastCallAt = Date.now();
  if (!ui.open) toggle(true);
  buzz();
  render();
  call.ringTimer = marinara.setTimeout(() => {
    if (ui.call !== call || call.state !== "ringing") return;
    finishCall("missed");
  }, RING_MS);
}

function answerCall() {
  const call = ui.call;
  if (!call || call.state !== "ringing") return;
  marinara.clearTimeout(call.ringTimer);
  call.state = "active";
  call.started = Date.now();
  render();
  const cue = call.contactId === "partner"
    ? `(You are calling ${userName()} from an unknown number and they just picked up. Speak first.)`
    : `(You called ${userName()} and they just picked up. Say why you called.)`;
  void callerSpeaks(cue);
}

async function callerSpeaks(cue) {
  const call = ui.call;
  const caller = call && callerFor(call);
  if (!caller) return;
  await askModel({ key: "call", system: promptFor(caller, "call"), thread: call.lines, speaker: caller.name, cue });
}

async function sayInCall(text) {
  const call = ui.call;
  if (!call || call.state !== "active") return;
  call.lines.push({ role: "user", text, t: Date.now() });
  renderConvo();
  await callerSpeaks();
}

/** Ends the call on screen and records it. `outcome` is "missed" or "declined" for an unanswered call. */
function finishCall(outcome) {
  const call = ui.call;
  if (!call) return;
  marinara.clearTimeout(call.ringTimer);
  const cs = chatState();
  const name = call.hidden ? "발신자 정보 없는 번호" : callerName(call);
  const dur = call.state === "active" ? (Date.now() - call.started) / 1000 : 0;
  const dir = outcome ?? call.dir;
  cs.calls.push({ contactId: call.contactId, hidden: call.hidden, dir, t: Date.now(), dur, seen: dir !== "missed" });
  trimList(cs.calls, MAX_CALLS);
  if (dir === "missed") logActivity(`${name}의 전화를 받지 않았다`);
  else if (dir === "declined") logActivity(`${name}의 전화를 거절했다`);
  else {
    const minutes = Math.max(1, Math.round(dur / 60));
    logActivity(dir === "in" ? `${name}의 전화를 받아 ${minutes}분 통화했다` : `${name}에게 전화를 걸어 ${minutes}분 통화했다`);
    const said = call.lines.filter((m) => m.role === "user").at(-1);
    if (said) logActivity(`${josa(name, "과", "와")}의 통화에서 이렇게 말했다: "${snippet(said.text)}"`);
  }
  ui.call = null;
  if (ui.busyKey === "call") ui.busyKey = null;
  save();
  render();
}

function renderCall() {
  const call = ui.call;
  const caller = callerFor(call) ?? { name: "알 수 없음" };
  const name = callerName(call);
  const face = call.hidden ? h("div", { class: "uphone-avatar large" }, "?") : avatar(caller, "large");
  const status =
    call.state === "ringing" ? (call.hidden ? "수신 전화" : "휴대전화 · 수신 전화") : call.state === "dialing" ? "전화 거는 중…" : formatDuration((Date.now() - call.started) / 1000);
  const top = h(
    "div",
    { class: "uphone-call-top" },
    face,
    h("strong", { class: "uphone-call-name" }, name),
    h("span", { class: "uphone-call-status" }, status),
  );
  if (call.state === "ringing") {
    return h(
      "div",
      { class: "uphone-call is-ringing" },
      top,
      h(
        "div",
        { class: "uphone-call-actions" },
        h("button", { class: "uphone-call-btn is-decline", type: "button", "aria-label": "거절", onclick: () => finishCall("declined") }, "✕"),
        h("button", { class: "uphone-call-btn is-accept", type: "button", "aria-label": "받기", onclick: answerCall }, "📞"),
      ),
    );
  }
  return conversationView({
    key: "call",
    variant: "call",
    header: top,
    thread: () => ui.call?.lines,
    emptyText: call.state === "dialing" ? "" : "…",
    placeholder: "말하기",
    onSend: sayInCall,
    footer: h(
      "div",
      { class: "uphone-call-actions" },
      h("button", { class: "uphone-call-btn is-decline", type: "button", "aria-label": "통화 종료", onclick: () => finishCall() }, "✕"),
    ),
  });
}

/** Keeps the call timer moving without redrawing the transcript. */
function tickCallTimer() {
  if (ui.call?.state !== "active") return;
  const el = screen.querySelector(".uphone-call-status");
  if (el) el.textContent = formatDuration((Date.now() - ui.call.started) / 1000);
}

/** Now and then someone calls. Once the partner has slipped out of its app, sometimes it is the partner. */
function maybeIncomingCall(force = false) {
  const cs = chatState();
  if (ui.call || ui.busyKey || unlocking || !ctx.chat || !connectionId()) return;
  if (!force) {
    if (data.settings.dnd || gateLocked()) return;
    if (Date.now() - (cs.lastCallAt ?? 0) < CALL_GAP_MS || Math.random() > CALL_CHANCE) return;
  }
  const stage = stageIndex();
  if (partner() && stage >= 1 && Math.random() < 0.2 + stage * 0.15) return receiveCall("partner", true);
  const contacts = cs.contacts;
  if (contacts.length > 0) receiveCall(contacts[Math.floor(Math.random() * contacts.length)].id);
}
