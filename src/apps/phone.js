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
  return findContact(call.contactId)?.name ?? call.number ?? "알 수 없음";
}

function digitsOf(phone) {
  return String(phone ?? "").replace(/\D/gu, "");
}

function formatPhone(digits) {
  const d = digitsOf(digits);
  if (d.length === 11) return `${d.slice(0, 3)}-${d.slice(3, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}`;
  return d;
}

/** Which calls belong together in the call log: one person, the hidden caller, or one unsaved number. */
function callGroup(call) {
  return call.hidden ? "hidden" : call.contactId ? `c:${call.contactId}` : `n:${digitsOf(call.number)}`;
}

/** The prompt for whoever is on the other end. The partner keeps its knowledge rule everywhere. */
function promptFor(contact, channel) {
  return contact.ghost ? buildPartnerPrompt(partner(), channel) : buildContactPrompt(contact, channel);
}

// ── phone app ──────────────────────────────────────────
// ui.sub: "keypad" | "recents" | "contacts" | "new-contact" | "contact:<id>" | "edit:<id>" | "calls:<group>"

function renderPhoneApp() {
  const cs = chatState();
  const unseen = cs.calls.filter((call) => call.dir === "missed" && !call.seen);
  for (const call of unseen) call.seen = true;
  if (unseen.length > 0) save();
  const sub = ui.sub ?? (cs.calls.length > 0 ? "recents" : "contacts");
  if (sub.startsWith("contact:")) return renderContactDetail(sub.slice(8));
  if (sub.startsWith("edit:")) return renderContactForm(findContact(sub.slice(5)));
  if (sub.startsWith("calls:")) return renderCallDetail(sub.slice(6));
  if (sub === "new-contact") return renderContactForm(null);
  const titles = { keypad: "키패드", recents: "최근 기록", contacts: "연락처" };
  const tab = titles[sub] ? sub : "contacts";
  const body = tab === "keypad" ? renderKeypad() : tab === "recents" ? renderRecents() : renderContacts();
  const tabButton = (id) => h("button", { class: `uphone-tab ${tab === id ? "is-active" : ""}`, type: "button", onclick: () => go("phone", id) }, titles[id]);
  const add = tab === "contacts" ? h("button", { class: "uphone-header-action", type: "button", "aria-label": "새 연락처", onclick: () => go("phone", "new-contact") }, "＋") : null;
  return h(
    "div",
    { class: "uphone-app-view" },
    appHeader(titles[tab], add),
    body,
    h("div", { class: "uphone-tabs is-three" }, tabButton("keypad"), tabButton("recents"), tabButton("contacts")),
  );
}

const CALL_LABEL = { in: "수신", out: "발신", missed: "부재중", declined: "거절", failed: "연결 안 됨" };

function callDirGlyph(call) {
  return call.dir === "out" || call.dir === "failed" ? "↗" : call.dir === "in" ? "↙" : "✕";
}

function callBack(call) {
  if (call.hidden) return showToast("발신자 정보가 없는 번호예요.");
  if (call.contactId && findContact(call.contactId)) return startCall(call.contactId);
  dialNumber(call.number);
}

function renderRecents() {
  const calls = [...chatState().calls].reverse();
  if (calls.length === 0) return h("div", { class: "uphone-empty" }, "통화 기록이 없어요.");
  return h(
    "div",
    { class: "uphone-list" },
    calls.map((call) =>
      h(
        "div",
        { class: `uphone-list-row ${call.dir === "missed" ? "is-missed" : ""}` },
        h(
          "button",
          { class: "uphone-row-main", type: "button", "aria-label": `${callerName(call)}에게 다시 걸기`, onclick: () => callBack(call) },
          h("span", { class: "uphone-call-dir" }, callDirGlyph(call)),
          h("span", { class: "uphone-list-main" }, h("strong", null, callerName(call)), h("small", null, `${CALL_LABEL[call.dir] ?? ""}${call.dur ? ` · ${formatDuration(call.dur)}` : ""}`)),
          h("small", { class: "uphone-row-time" }, formatDay(call.t)),
        ),
        h("button", { class: "uphone-info", type: "button", "aria-label": "통화 기록 자세히", onclick: () => go("phone", `calls:${callGroup(call)}`) }, "ⓘ"),
      ),
    ),
  );
}

function renderCallDetail(group) {
  const calls = chatState().calls.filter((call) => callGroup(call) === group).reverse();
  const first = calls[0];
  const contact = group.startsWith("c:") ? findContact(group.slice(2)) : null;
  const name = first ? callerName(first) : (contact?.name ?? "알 수 없음");
  const total = calls.reduce((s, c) => s + (c.dur ?? 0), 0);
  const actions = first?.hidden
    ? null
    : h(
        "div",
        { class: "uphone-detail-actions" },
        detailAction("📞", "전화", () => (first ? callBack(first) : contact && startCall(contact.id))),
        contact ? detailAction("✉️", "문자", () => go("messages", contact.id)) : null,
        contact ? detailAction("💬", "톡", () => go("talk", contact.id)) : null,
        contact ? detailAction("👤", "연락처", () => go("phone", `contact:${contact.id}`)) : null,
      );
  return h(
    "div",
    { class: "uphone-app-view" },
    appHeader("통화 기록", null, () => go("phone", "recents")),
    h(
      "div",
      { class: "uphone-detail" },
      first?.hidden ? h("div", { class: "uphone-avatar large" }, "?") : avatar(contact ?? { name, emoji: "👤" }, "large"),
      h("strong", { class: "uphone-detail-name" }, name),
      h("span", { class: "uphone-detail-sub" }, first?.hidden ? "번호를 알 수 없어요" : (contact?.phone ?? formatPhone(first?.number))),
      actions,
      h("div", { class: "uphone-section-label" }, `통화 ${calls.length}건 · 총 ${formatDuration(total)}`),
      h(
        "div",
        { class: "uphone-group" },
        calls.map((call) =>
          h(
            "div",
            { class: `uphone-row ${call.dir === "missed" ? "is-missed" : ""}` },
            h("span", null, `${callDirGlyph(call)} ${CALL_LABEL[call.dir] ?? ""}`),
            h("span", { class: "uphone-row-value" }, `${new Date(call.t).toLocaleString([], { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}${call.dur ? ` · ${formatDuration(call.dur)}` : ""}`),
          ),
        ),
      ),
    ),
  );
}

function detailAction(icon, label, onClick) {
  return h("button", { class: "uphone-detail-btn", type: "button", onclick: onClick }, h("span", null, icon), h("small", null, label));
}

function sortedContacts() {
  return contactList().sort((a, b) => (a.ghost ? 1 : 0) - (b.ghost ? 1 : 0) || a.name.localeCompare(b.name, "ko"));
}

function renderContacts() {
  const list = sortedContacts();
  const favs = list.filter((c) => c.fav);
  const row = (c) =>
    h(
      "div",
      { class: `uphone-list-row ${c.ghost ? "is-ghost" : ""}` },
      h(
        "button",
        { class: "uphone-row-main", type: "button", onclick: () => go("phone", `contact:${c.id}`) },
        avatar(c, "small"),
        h("span", { class: "uphone-list-main" }, h("strong", null, c.name, c.fav ? h("span", { class: "uphone-star" }, " ★") : null), h("small", null, c.relation || c.phone)),
      ),
      h(
        "span",
        { class: "uphone-row-actions" },
        h("button", { type: "button", "aria-label": `${c.name}에게 전화`, onclick: () => startCall(c.id) }, "📞"),
        h("button", { type: "button", "aria-label": `${c.name}에게 문자`, onclick: () => go("messages", c.id) }, "✉️"),
      ),
    );
  return h(
    "div",
    { class: "uphone-list" },
    h("div", { class: "uphone-list-row uphone-my-profile" }, h("div", { class: "uphone-avatar" }, userName().charAt(0)), h("span", { class: "uphone-list-main" }, h("strong", null, userName()), h("small", null, "내 번호 · 010-6074-1123"))),
    favs.length > 0 ? h("div", { class: "uphone-section-label" }, "즐겨찾기") : null,
    favs.map(row),
    h("div", { class: "uphone-section-label" }, `연락처 ${list.length}개`),
    list.map(row),
  );
}

function renderContactDetail(id) {
  const c = findContact(id);
  if (!c) return emptyApp("연락처", "연락처를 찾을 수 없어요.");
  const back = () => go("phone", "contacts");
  const calls = chatState().calls.filter((call) => call.contactId === id && !call.hidden);
  const toggleFav = () => {
    if (c.ghost) return showToast("이 연락처는 수정할 수 없어요.");
    const saved = chatState().contacts.find((x) => x.id === id);
    saved.fav = !saved.fav;
    save();
    logActivity(saved.fav ? `${josa(c.name, "을", "를")} 즐겨찾기에 추가했다` : `${josa(c.name, "을", "를")} 즐겨찾기에서 뺐다`);
    render();
  };
  const remove = () => {
    if (c.ghost) {
      // it is not that easy to get rid of
      buzz();
      logActivity(`연락처에서 ${c.name}의 번호를 지우려 했지만 지워지지 않았다`);
      return showToast("이 연락처는 삭제할 수 없어요.");
    }
    confirmSheet(`${josa(c.name, "을", "를")} 연락처에서 삭제할까요? 대화 기록은 남아 있어요.`, "삭제", () => {
      const cs = chatState();
      cs.contacts = cs.contacts.filter((x) => x.id !== id);
      save();
      logActivity(`연락처에서 ${josa(c.name, "을", "를")} 삭제했다`);
      back();
    });
  };
  return h(
    "div",
    { class: "uphone-app-view" },
    appHeader("", c.ghost ? null : h("button", { class: "uphone-header-action is-text", type: "button", onclick: () => go("phone", `edit:${id}`) }, "편집"), back),
    h(
      "div",
      { class: `uphone-detail ${c.ghost ? "is-ghost" : ""}` },
      avatar(c, "large"),
      h("strong", { class: "uphone-detail-name" }, c.name),
      h("span", { class: "uphone-detail-sub" }, c.relation || ""),
      h(
        "div",
        { class: "uphone-detail-actions" },
        detailAction("📞", "전화", () => startCall(c.id)),
        detailAction("✉️", "문자", () => go("messages", c.id)),
        detailAction("💬", "톡", () => go("talk", c.id)),
        detailAction(c.fav ? "★" : "☆", "즐겨찾기", toggleFav),
      ),
      h(
        "div",
        { class: "uphone-group" },
        settingsRow("휴대전화", c.phone || "-"),
        c.note && !c.ghost ? h("div", { class: "uphone-row is-note" }, h("span", null, "메모"), h("p", null, macros(c.note))) : null,
      ),
      calls.length > 0
        ? h("div", { class: "uphone-group" }, settingsRow("최근 통화", `${calls.length}건 ›`, { role: "button", tabindex: "0", onclick: () => go("phone", `calls:c:${id}`) }))
        : null,
      h("button", { class: "uphone-danger", type: "button", onclick: remove }, "연락처 삭제"),
    ),
  );
}

function randomPhone() {
  const four = () => String(Math.floor(1000 + Math.random() * 9000));
  return `010-${four()}-${four()}`;
}

/** New contact when `contact` is null, otherwise edits it. */
function renderContactForm(contact) {
  if (contact?.ghost) return renderContactDetail(contact.id);
  const editing = !!contact;
  const name = h("input", { class: "uphone-field", placeholder: "이름", "aria-label": "이름" });
  const relation = h("input", { class: "uphone-field", placeholder: "관계 (예: 친구, 동생)", "aria-label": "관계" });
  const phone = h("input", { class: "uphone-field", placeholder: "전화번호 (비우면 자동)", inputmode: "tel", "aria-label": "전화번호" });
  const note = h("textarea", { class: "uphone-field", rows: "3", placeholder: "어떤 사람인지 (말투, 성격)", "aria-label": "메모" });
  if (editing) {
    name.value = contact.name;
    relation.value = contact.relation ?? "";
    phone.value = contact.phone ?? "";
    note.value = contact.note ?? "";
  }
  const saveContact = () => {
    if (!name.value.trim()) return showToast("이름을 입력해 주세요.");
    const fields = {
      name: name.value.trim().slice(0, 30),
      relation: relation.value.trim().slice(0, 30) || "지인",
      note: note.value.trim().slice(0, 300),
      phone: formatPhone(phone.value) || randomPhone(),
    };
    const cs = chatState();
    if (editing) {
      const saved = cs.contacts.find((x) => x.id === contact.id);
      Object.assign(saved, fields);
      save();
      logActivity(contact.name === fields.name ? `연락처에서 ${fields.name}의 정보를 고쳤다` : `연락처의 ${josa(contact.name, "을", "를")} ${josa(fields.name, "으로", "로")} 바꿔 저장했다`);
      return go("phone", `contact:${contact.id}`);
    }
    const created = { id: `c${Date.now().toString(36)}`, ...fields };
    cs.contacts.push(created);
    save();
    const particle = josa(created.relation, "을", "를").slice(created.relation.length);
    logActivity(`연락처에 ${created.name}(${created.relation})${particle} 저장했다`);
    go("phone", `contact:${created.id}`);
  };
  const back = () => go("phone", editing ? `contact:${contact.id}` : "contacts");
  return h(
    "div",
    { class: "uphone-app-view" },
    appHeader(editing ? "연락처 편집" : "새 연락처", null, back),
    h("div", { class: "uphone-form" }, name, relation, phone, note, h("button", { class: "uphone-cta", type: "button", onclick: saveContact }, "저장")),
  );
}

// ── keypad ─────────────────────────────────────────────

let dialed = "";

function renderKeypad() {
  const display = h("div", { class: "uphone-dial-number" }, formatPhone(dialed) || " ");
  const match = h("div", { class: "uphone-dial-match" });
  const update = () => {
    display.textContent = formatPhone(dialed) || " ";
    const c = dialed.length >= 4 ? contactList().find((x) => digitsOf(x.phone).includes(dialed)) : null;
    match.textContent = c ? c.name : "";
  };
  update();
  const keys = [
    ["1", ""],
    ["2", "ABC"],
    ["3", "DEF"],
    ["4", "GHI"],
    ["5", "JKL"],
    ["6", "MNO"],
    ["7", "PQRS"],
    ["8", "TUV"],
    ["9", "WXYZ"],
    ["*", ""],
    ["0", "+"],
    ["#", ""],
  ];
  return h(
    "div",
    { class: "uphone-keypad" },
    display,
    match,
    h(
      "div",
      { class: "uphone-keys" },
      keys.map(([k, letters]) =>
        h(
          "button",
          {
            class: "uphone-key",
            type: "button",
            onclick: () => {
              if (dialed.length < 15) dialed += k;
              update();
            },
          },
          h("b", null, k),
          h("small", null, letters),
        ),
      ),
    ),
    h(
      "div",
      { class: "uphone-keypad-bar" },
      h("span"),
      h("button", { class: "uphone-call-btn is-accept", type: "button", "aria-label": "전화 걸기", onclick: () => dialNumber(dialed) }, "📞"),
      h(
        "button",
        {
          class: "uphone-plain uphone-key-del",
          type: "button",
          "aria-label": "지우기",
          onclick: () => {
            dialed = dialed.slice(0, -1);
            update();
          },
        },
        "←",
      ),
    ),
  );
}

/** Calls a typed number: a saved contact's number rings them; any other number goes nowhere. */
function dialNumber(number) {
  const digits = digitsOf(number);
  if (digits.length < 3) return showToast("번호를 입력해 주세요.");
  const contact = contactList().find((c) => digitsOf(c.phone) === digits);
  dialed = "";
  if (contact) return startCall(contact.id);
  const cs = chatState();
  cs.calls.push({ contactId: null, number: formatPhone(digits), hidden: false, dir: "failed", t: Date.now(), dur: 0, seen: true });
  trimList(cs.calls, MAX_CALLS);
  save();
  logActivity(`${formatPhone(digits)}로 전화를 걸었지만 연결되지 않았다`);
  showToast("지금 거신 번호는 없는 번호입니다. 다시 확인하고 걸어 주세요.");
  render();
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
