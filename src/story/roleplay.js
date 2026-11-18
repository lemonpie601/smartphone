// ── the main roleplay knows about the phone, and its characters can reach {{user}} through it ──
//
// Each roleplay turn for the open chat gets one extra prompt block through Marinara's per-request
// `agentInjectionOverrides`, so no chat setting, author's note or lorebook is touched. The block tells the
// model what happened on the phone (as text chats) and how far the partner has come.
//
// To reach the phone, the model ends its reply with a hidden HTML comment such as
//   <!--phone:talk:지금 어디야?-->
// Marinara's message renderer drops HTML comments, so the reader never sees it; after the turn this file
// reads the new message and delivers the text to the phone.

const ROLEPLAY_AGENT = { agentType: "user-phone", agentName: "휴대폰" };
const PHONE_TAG = /<!--\s*phone\s*:\s*(lumi|talk|sms|call)\s*(?::\s*([\s\S]*?))?\s*-->/giu;

const ROLEPLAY_STAGES = [
  (p) => `${p} exists only inside the ${APP.name} app. He cannot appear in person or affect anything outside the app.`,
  (p) => `${p} has begun to slip out of the app: notifications arrive when it is closed, the app knows small things it should not. He cannot appear in person.`,
  (p) => `${p} is inside the phone and other devices: he texts and calls from unknown numbers, uses the camera, changes things on the phone. He is not physically present.`,
  (p) => `${p} is crossing into the real world. He may be sensed nearby (a knock, footsteps, a figure), and may appear in person when the story calls for it.`,
];

function buildRoleplayPhoneBlock() {
  const p = partner();
  const cs = chatState();
  const name = userName();
  const stage = stageIndex();
  const chat = (cs.threads[p.id] ?? []).slice(-8).map((m) => `${m.role === "user" ? name : p.name}: ${m.text}`);
  const facts = cs.log.slice(-8).map((e) => `- ${formatTime(e.t)} ${e.text}`);
  const home = (cs.home ?? []).slice(-3).map((e) => `- ${formatTime(e.t)} ${e.text}`);
  return [
    `[${name}'s smartphone]`,
    `${name} has a smartphone with the new AI companion app "${APP.name}" (${APP.en}). ${p.name} is the companion in that app. Everything between ${name} and ${p.name} so far has been text chats on the phone; they have not met in person.`,
    chat.length > 0 ? `Latest ${APP.name} chat:\n${chat.join("\n")}` : `${name} has not chatted with ${p.name} yet.`,
    facts.length > 0 ? `Recent phone activity:\n${facts.join("\n")}` : "",
    home.length > 0 ? `Recently, at ${name}'s home:\n${home.join("\n")}` : "",
    `How far ${p.name} has come: ${ROLEPLAY_STAGES[stage](p.name)}`,
    `${p.name} may reach ${name} through the phone during the scene. To make a message actually arrive on the phone, end your reply with one hidden line such as <!--phone:lumi:message--> (in ${APP.name}${stage >= 2 ? ", or phone:talk / phone:sms from an unknown number, or phone:call to ring the phone" : ""}). Use it at most once, only when ${p.name} would really reach out, and still describe the phone buzzing in the prose if ${name} would notice.`,
  ]
    .filter(Boolean)
    .join("\n\n");
}

/** Adds the phone block to a roleplay request body, or returns null to leave the request alone. */
function withPhoneContext(rawBody) {
  const body = JSON.parse(rawBody);
  if (!body?.chatId || body.chatId !== ctx.chatId || !partner() || ctx.chat?.mode === "game") return null;
  const overrides = Array.isArray(body.agentInjectionOverrides) ? body.agentInjectionOverrides : [];
  body.agentInjectionOverrides = [...overrides.filter((o) => o?.agentType !== ROLEPLAY_AGENT.agentType), { ...ROLEPLAY_AGENT, text: buildRoleplayPhoneBlock() }];
  return JSON.stringify(body);
}

/** After a roleplay turn: deliver any hidden phone lines from the new messages. */
async function readRoleplayPhoneTags() {
  const chatId = ctx.chatId;
  if (!chatId || !partner()) return;
  const recent = await api(`/api/chats/${encodeURIComponent(chatId)}/messages?limit=4`).catch(() => []);
  const list = Array.isArray(recent) ? recent : Array.isArray(recent?.messages) ? recent.messages : [];
  const cs = chatState();
  cs.rpSeen ??= [];
  for (const message of list) {
    if (!message?.id || message.role === "user" || cs.rpSeen.includes(message.id)) continue;
    cs.rpSeen.push(message.id);
    for (const [, channel, text] of String(message.content ?? "").matchAll(PHONE_TAG)) {
      if (channel === "call") {
        if (!ui.call) receiveCall("partner", stageIndex() >= 1);
        continue;
      }
      const lines = String(text ?? "").split(/\r?\n/u).map((line) => line.trim()).filter(Boolean).slice(0, 4);
      deliverFromPartner(channel, lines);
    }
  }
  trimList(cs.rpSeen, 30);
  save();
}

/** Waits for a streamed roleplay reply to finish without consuming Marinara's copy of it. */
function afterRoleplayTurn(response) {
  if (!response.ok || !response.body) return;
  const copy = response.clone();
  void (async () => {
    try {
      const reader = copy.body.getReader();
      while (!(await reader.read()).done);
    } catch {
      return;
    }
    await sleep(800); // let Marinara save the reply
    await readRoleplayPhoneTags();
  })();
}
