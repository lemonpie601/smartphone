// ── 메모 ───────────────────────────────────────────────

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
      const text = area.value.trim().replace(/\s+/gu, " ").slice(-80);
      if (text) logActivity(`메모장에 이렇게 적었다: "${text}"`);
    }, 2500);
  });
  return h("div", { class: "uphone-app-view" }, appHeader("메모"), area);
}
