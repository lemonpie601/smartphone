// ── 설정 ───────────────────────────────────────────────
// Looks like an ordinary phone. The stage and the phone facts are never shown. Tapping the build number
// 7 times unlocks a "개발자 옵션" entry, which then stays in the list like on a real phone.

let buildTaps = 0;

function settingsRow(label, value, attrs) {
  return h("div", { class: "uphone-row", ...attrs }, h("span", null, label), h("span", { class: "uphone-row-value" }, value));
}

function toggleRow(label, checked, onChange) {
  const input = h("input", { type: "checkbox", class: "uphone-switch", "aria-label": label });
  input.checked = checked;
  input.addEventListener("change", () => onChange(input.checked));
  return h("label", { class: "uphone-row" }, h("span", null, label), input);
}

function renderSettings() {
  return ui.sub === "dev" ? renderDeveloperOptions() : renderSettingsHome();
}

function renderSettingsHome() {
  const name = userName();
  const stage = stageIndex();
  const body = h("div", { class: "uphone-settings" });
  body.append(
    h("div", { class: "uphone-profile" }, h("div", { class: "uphone-avatar" }, name.charAt(0)), h("strong", null, name)),
    h(
      "div",
      { class: "uphone-group" },
      settingsRow("Wi-Fi", "연결됨"),
      settingsRow("배터리", `${batteryLevel(stage)}%`),
      settingsRow("저장공간", stage >= 2 ? "알 수 없음" : "64GB 중 41GB 사용"),
    ),
    h(
      "div",
      { class: "uphone-group" },
      toggleRow("방해 금지 모드", !!data.settings.dnd, (on) => {
        data.settings.dnd = on;
        save();
        logActivity(on ? "방해 금지 모드를 켰다" : "방해 금지 모드를 껐다");
        renderStatus();
      }),
    ),
    h(
      "div",
      { class: "uphone-group" },
      settingsRow("휴대폰 이름", `${name}의 폰`),
      settingsRow("소프트웨어 버전", "14.2"),
      settingsRow("빌드 번호", "UP1.024.1118", {
        role: "button",
        tabindex: "0",
        onclick: () => {
          if (data.settings.devUnlocked) return showToast("이미 개발자 모드예요.");
          buildTaps += 1;
          if (buildTaps < 7) {
            if (buildTaps >= 4) showToast(`개발자가 되기까지 ${7 - buildTaps}단계 남았어요.`);
            return;
          }
          buildTaps = 0;
          data.settings.devUnlocked = true;
          save();
          showToast("개발자 모드를 켰어요.");
          render();
        },
      }),
    ),
    data.settings.devUnlocked
      ? h("div", { class: "uphone-group" }, settingsRow("개발자 옵션", "›", { role: "button", tabindex: "0", onclick: () => go("settings", "dev") }))
      : null,
  );
  return h("div", { class: "uphone-app-view" }, appHeader("설정"), body);
}

function renderDeveloperOptions() {
  const cs = chatState();
  const body = h("div", { class: "uphone-settings" });

  if (ctx.characters.length > 1) {
    const select = h("select", { "aria-label": `${APP.name} 상대` });
    for (const c of ctx.characters) {
      const option = h("option", { value: c.id }, c.name);
      option.selected = c.id === partner()?.id;
      select.append(option);
    }
    select.addEventListener("change", () => {
      cs.partnerId = select.value;
      save();
    });
    body.append(h("label", null, `${APP.name} 상대`, select));
  }

  const connSelect = h("select", { "aria-label": "모델" }, h("option", { value: "" }, "이 채팅의 연결 따라가기"));
  api("/api/connections")
    .then((list) => {
      for (const conn of Array.isArray(list) ? list : []) {
        const option = h("option", { value: conn.id }, conn.name || conn.model || conn.id);
        option.selected = conn.id === data.settings.connectionId;
        connSelect.append(option);
      }
    })
    .catch(() => {});
  connSelect.addEventListener("change", () => {
    data.settings.connectionId = connSelect.value || null;
    save();
  });
  body.append(h("label", null, "폰 안의 모델 (루미, 문자, 톡, 전화)", connSelect));

  body.append(
    h(
      "button",
      {
        class: "uphone-secondary",
        type: "button",
        onclick: () => {
          if (!ctx.chat) return showToast("Marinara에서 채팅을 먼저 열어 주세요.");
          maybeIncomingCall(true);
        },
      },
      "지금 전화 걸려오게 하기",
    ),
    h(
      "button",
      {
        class: "uphone-danger",
        type: "button",
        onclick: () => {
          if (!window.confirm("이 채팅의 폰 데이터(대화, 통화, 사진, 메모, 연락처)를 모두 지울까요?")) return;
          const id = ctx.chatId ?? "__none__";
          const unlocked = data.chats[id]?.storyUnlocked;
          delete data.chats[id];
          if (unlocked) data.chats[id] = { storyUnlocked: true }; // the intro is already in the chat
          save();
          go("home");
        },
      },
      "이 채팅의 폰 초기화",
    ),
  );
  return h("div", { class: "uphone-app-view" }, appHeader("개발자 옵션", null, () => go("settings")), body);
}
