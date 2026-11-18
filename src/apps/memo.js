// ── 메모: several notes. cs.notes = [{ id, text, t, pinned }] ──
// Older saves kept one note in cs.memo; it becomes the first note. cs.memo keeps mirroring the most recently
// edited note, so code that reads cs.memo still sees what the user last wrote.

function notesList() {
  const cs = chatState();
  if (!Array.isArray(cs.notes)) {
    cs.notes = cs.memo && cs.memo.trim() ? [{ id: `n${Date.now().toString(36)}`, text: cs.memo, t: Date.now() }] : [];
  }
  return cs.notes;
}

function noteTitle(note) {
  return snippet(note.text.split(/\r?\n/u).find((line) => line.trim()) ?? "", 30) || "새 메모";
}

function noteBody(note) {
  const lines = note.text.split(/\r?\n/u).filter((line) => line.trim());
  return snippet(lines.slice(1).join(" "), 40) || "추가 텍스트 없음";
}

function renderMemo() {
  if (!ctx.chatId) return emptyApp("메모", "Marinara에서 채팅을 먼저 열어 주세요.");
  const cs = chatState();
  if (ui.sub) {
    const note = notesList().find((n) => n.id === ui.sub);
    if (note) return renderNoteEditor(note);
  }
  cs.notes = notesList().filter((n) => n.text.trim()); // a note left empty (e.g. via the home bar) is not kept
  const notes = cs.notes;
  const query = h("input", { class: "uphone-search", type: "search", placeholder: "메모 검색", "aria-label": "메모 검색" });
  const list = h("div", { class: "uphone-list" });
  const draw = () => {
    const q = query.value.trim();
    const shown = [...notes]
      .filter((n) => !q || n.text.includes(q))
      .sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0) || b.t - a.t);
    list.replaceChildren(
      ...(shown.length === 0
        ? [h("div", { class: "uphone-empty" }, q ? "검색 결과가 없어요." : "메모가 없어요. ✎를 눌러 새 메모를 써 보세요.")]
        : shown.map((n) =>
            h(
              "button",
              { class: "uphone-list-row uphone-note-row", type: "button", onclick: () => go("memo", n.id) },
              h(
                "span",
                { class: "uphone-list-main" },
                h("strong", null, n.pinned ? "📌 " : "", noteTitle(n)),
                h("small", null, `${formatDay(n.t)}  ${noteBody(n)}`),
              ),
            ),
          )),
    );
  };
  query.addEventListener("input", draw);
  draw();
  const create = () => {
    const note = { id: `n${Date.now().toString(36)}`, text: "", t: Date.now() };
    notes.push(note);
    save();
    go("memo", note.id);
  };
  return h(
    "div",
    { class: "uphone-app-view is-memo" },
    appHeader(`메모 ${notes.length > 0 ? notes.length : ""}`.trim(), h("button", { class: "uphone-header-action", type: "button", "aria-label": "새 메모", onclick: create }, "✎")),
    h("div", { class: "uphone-search-wrap" }, query),
    list,
  );
}

function renderNoteEditor(note) {
  const cs = chatState();
  const area = h("textarea", { class: "uphone-memo", placeholder: "메모를 입력하세요", "aria-label": "메모" });
  area.value = note.text;
  let memoTimer = null;
  const flushFact = () => {
    if (memoTimer) marinara.clearTimeout(memoTimer);
    memoTimer = null;
    const text = note.text.trim().replace(/\s+/gu, " ").slice(-80);
    if (text && text !== note.logged) {
      note.logged = text;
      logActivity(`메모장에 이렇게 적었다: "${text}"`);
    }
  };
  area.addEventListener("input", () => {
    note.text = area.value;
    note.t = Date.now();
    cs.memo = note.text;
    save();
    if (memoTimer) marinara.clearTimeout(memoTimer);
    memoTimer = marinara.setTimeout(flushFact, 2500);
  });
  const leave = () => {
    flushFact();
    if (!note.text.trim()) {
      cs.notes = cs.notes.filter((n) => n.id !== note.id); // an empty note is not kept
      save();
    }
    go("memo");
  };
  const pin = () => {
    note.pinned = !note.pinned;
    save();
    showToast(note.pinned ? "메모를 고정했어요." : "고정을 풀었어요.");
  };
  const remove = () =>
    confirmSheet("이 메모를 삭제할까요?", "삭제", () => {
      if (memoTimer) marinara.clearTimeout(memoTimer);
      cs.notes = cs.notes.filter((n) => n.id !== note.id);
      if (note.text.trim()) logActivity(`메모를 지웠다: "${snippet(note.text, 40)}"`);
      save();
      go("memo");
    });
  marinara.setTimeout(() => area.focus(), 0);
  return h(
    "div",
    { class: "uphone-app-view is-memo" },
    appHeader(
      new Date(note.t).toLocaleString([], { month: "long", day: "numeric", hour: "2-digit", minute: "2-digit" }),
      h(
        "span",
        { class: "uphone-header-tools" },
        h("button", { class: "uphone-header-action is-small", type: "button", "aria-label": "고정", onclick: pin }, "📌"),
        h("button", { class: "uphone-header-action is-small", type: "button", "aria-label": "삭제", onclick: remove }, "🗑"),
      ),
      leave,
    ),
    area,
  );
}
