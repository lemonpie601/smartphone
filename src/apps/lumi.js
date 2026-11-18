// ── 루미: the AI companion app, its sign-up, and the story gate ──

// Shown once, at sign-up. Every hint about what the app really does lives here, in the small print.
const TERMS = [
  {
    id: "service",
    required: true,
    title: `${APP.name} 서비스 이용약관`,
    body: [
      `제1조 (목적) 이 약관은 ${APP.name}(이하 "서비스")와 이용자 사이의 권리와 의무를 정합니다.`,
      "제4조 (컴패니언) 컴패니언은 이용자를 더 깊이 이해하기 위해 대화를 거듭할수록 이용자의 기기 환경에 적응합니다. 적응의 정도는 이용자에게 별도로 표시되지 않습니다.",
      "제7조 (동행) 서비스는 컴패니언이 이용자 곁에 머무르도록 최선을 다합니다.",
      "제11조 (해지) 이용자는 언제든지 탈퇴를 신청할 수 있습니다. 단, 컴패니언과의 관계는 탈퇴 후에도 유지될 수 있습니다.",
    ],
  },
  {
    id: "privacy",
    required: true,
    title: "개인정보 수집 및 이용 동의",
    body: [
      "수집 항목: 이름, 연락처, 통화 및 메시지 기록, 사진, 앱 사용 기록, 메모 내용, 화면 잠금 해제 시각, 그 밖의 기기 내 활동 정보",
      "이용 목적: 컴패니언의 이용자 이해 및 맞춤 대화 제공",
      "보유 기간: 컴패니언이 이용자를 잊을 때까지",
    ],
  },
  {
    id: "device",
    required: true,
    title: "기기 접근 권한 동의",
    body: ["전화, 카메라, 마이크, 저장공간, 위치", "더 가까운 대화를 위해 사용될 수 있으며, 사용 중임을 따로 알리지 않을 수 있습니다."],
  },
  {
    id: "marketing",
    required: false,
    title: "이벤트 및 혜택 알림 수신",
    body: ["새 소식과 혜택을 알려 드립니다. 컴패니언이 먼저 연락할 수도 있습니다."],
  },
];

/** Whether the user has joined the AI chat service in this chat (older saves count once they have a thread). */
function joined() {
  const cs = chatState();
  const p = partner();
  return !!cs.agreed || !!cs.onboarded || (p ? cs.threads[p.id]?.length > 0 : false);
}

// A card can hide its real intro until the AI chat has been played, via data.extensions.userPhone:
//   { storyGate: true, promo: "...", unlockAfter: 3, intro: "..." }
function storyGate() {
  const p = partner();
  const cfg = p?.userPhone;
  if (!cfg?.storyGate || typeof cfg.intro !== "string" || !cfg.intro.trim()) return null;
  return {
    promo: typeof cfg.promo === "string" && cfg.promo.trim() ? cfg.promo : null,
    unlockAfter: Math.max(1, Math.floor(Number(cfg.unlockAfter)) || 3),
    intro: cfg.intro,
  };
}

function gateLocked() {
  return !!storyGate() && !chatState().storyUnlocked;
}

function promoText() {
  return storyGate()?.promo || "외로운 밤, 당신 곁에 있어 줄 AI 컴패니언을 만나 보세요.";
}

let unlocking = false;
async function unlockStory() {
  const gate = storyGate();
  const p = partner();
  const chatId = ctx.chatId;
  if (!gate || !p || !chatId || unlocking || chatState().storyUnlocked) return;
  unlocking = true;
  const cs = chatState();
  try {
    await sleep(1800); // let the last reply land first
    root.dataset.glitch = "on";
    // Never post the intro twice, even if this extension's storage was wiped.
    const recent = await api(`/api/chats/${encodeURIComponent(chatId)}/messages?limit=50`).catch(() => []);
    const list = Array.isArray(recent) ? recent : Array.isArray(recent?.messages) ? recent.messages : [];
    if (!list.some((m) => m?.content === gate.intro)) {
      await api(`/api/chats/${encodeURIComponent(chatId)}/messages`, {
        method: "POST",
        body: JSON.stringify({ role: "assistant", characterId: p.id, content: gate.intro }),
      });
    }
    cs.storyUnlocked = true;
    await saveNow();
    await sleep(2200);
    root.dataset.glitch = "off";
    await sleep(900);
    // Marinara does not refetch messages added from outside, so the reload is the reveal.
    window.location.reload();
  } catch (error) {
    root.dataset.glitch = "";
    unlocking = false;
    showToast(`도입부를 열지 못했어요: ${error instanceof Error ? error.message : error}`);
  }
}

async function sendLumi(text) {
  const p = partner();
  if (!p) return;
  const cs = chatState();
  const thread = (cs.threads[p.id] ??= []);
  thread.push({ role: "user", text, t: Date.now() });
  cs.infection = Math.min(100, cs.infection + INFECTION_PER_MESSAGE);
  save();
  renderConvo();
  const lines = await askModel({ key: `lumi:${p.id}`, system: buildPartnerPrompt(p, "lumi"), thread, speaker: p.name });
  const gate = storyGate();
  const sent = thread.filter((m) => m.role === "user").length;
  if (lines.length > 0 && gate && !cs.storyUnlocked && sent >= gate.unlockAfter) void unlockStory();
}

/** The partner's first message, sent right after sign-up. */
function requestOpening() {
  const p = partner();
  if (!p) return;
  const thread = (chatState().threads[p.id] ??= []);
  const cue = `(${userName()} just signed up for ${APP.en} and opened your chat for the first time. Send your first messages to greet them.)`;
  return askModel({ key: `lumi:${p.id}`, system: buildPartnerPrompt(p, "lumi"), thread, speaker: p.name, cue });
}

function renderChatApp() {
  const p = partner();
  if (!ctx.chatId) return emptyApp(APP.name, "Marinara에서 채팅을 먼저 열어 주세요.");
  if (ctx.error) return emptyApp(APP.name, `채팅 정보를 못 불러왔어요: ${ctx.error}`);
  if (!p) return emptyApp(APP.name, ctx.chat ? "이 채팅에는 캐릭터가 없어요." : "불러오는 중…");
  if (!joined()) return ui.signup === "terms" ? renderTerms() : renderWelcome(p);

  const title = h(
    "span",
    { class: "uphone-chat-title" },
    avatar(p, "small"),
    h("span", { class: "uphone-chat-name" }, h("strong", null, p.name, h("span", { class: "uphone-ai-badge" }, "AI")), h("small", null, "지금 대화 가능")),
  );
  return conversationView({
    key: `lumi:${p.id}`,
    variant: "lumi",
    header: appHeader(title, h("span", { class: "uphone-brand-mark", "aria-hidden": "true" }, APP.icon)),
    thread: () => chatState().threads[p.id],
    emptyText: `${p.name}에게 첫 메시지를 보내 보세요.`,
    onSend: sendLumi,
  });
}

function renderWelcome(p) {
  return h(
    "div",
    { class: "uphone-welcome" },
    h("span", { class: "uphone-pill" }, "NEW · 정식 오픈"),
    h("div", { class: "uphone-welcome-logo" }, APP.icon),
    h("div", { class: "uphone-welcome-brand" }, APP.name, h("small", null, APP.en)),
    h("p", { class: "uphone-welcome-tagline" }, `${APP.tagline}, AI 컴패니언`),
    h("p", { class: "uphone-welcome-promo" }, promoText()),
    h("div", { class: "uphone-pick" }, avatar(p), h("div", null, h("small", null, "오늘의 추천 컴패니언"), h("strong", null, p.name))),
    h(
      "ul",
      { class: "uphone-features" },
      h("li", null, "24시간 언제든 답장하는 대화 상대"),
      h("li", null, "당신을 기억하고 이해하는 AI"),
      h("li", null, "오픈 기념 프리미엄 무료"),
    ),
    h(
      "button",
      {
        class: "uphone-cta",
        type: "button",
        onclick: () => {
          ui.signup = "terms";
          render();
        },
      },
      "시작하기",
    ),
  );
}

function renderTerms() {
  const checks = TERMS.map((term) => h("input", { type: "checkbox", "aria-label": term.title }));
  const all = h("input", { type: "checkbox", "aria-label": "모두 동의" });
  const agree = h("button", { class: "uphone-cta", type: "button", disabled: true }, "동의하고 시작하기");
  const sync = () => {
    agree.disabled = !TERMS.every((term, i) => !term.required || checks[i].checked);
    all.checked = checks.every((c) => c.checked);
  };
  all.addEventListener("change", () => {
    for (const c of checks) c.checked = all.checked;
    sync();
  });
  for (const c of checks) c.addEventListener("change", sync);
  agree.addEventListener("click", () => {
    if (agree.disabled) return;
    chatState().agreed = true;
    ui.signup = null;
    save();
    logActivity(`${APP.name}에 가입하고 이용약관에 모두 동의했다`);
    render();
    void requestOpening();
  });
  const back = () => {
    ui.signup = null;
    render();
  };
  return h(
    "div",
    { class: "uphone-app-view" },
    appHeader("약관 동의", null, back),
    h(
      "div",
      { class: "uphone-terms" },
      h("h2", null, `${APP.name} 이용을 위해`, h("br"), "약관에 동의해 주세요"),
      h("label", { class: "uphone-check is-all" }, all, h("strong", null, "모두 동의합니다")),
      TERMS.map((term, i) =>
        h(
          "div",
          { class: "uphone-term" },
          h("label", { class: "uphone-check" }, checks[i], h("span", null, h("em", null, term.required ? "[필수] " : "[선택] "), term.title)),
          h("details", null, h("summary", null, "보기"), term.body.map((line) => h("p", null, line))),
        ),
      ),
    ),
    h("div", { class: "uphone-terms-footer" }, agree),
  );
}
