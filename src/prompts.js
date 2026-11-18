// ── prompts and model calls ────────────────────────────

const STAGE_PROMPTS = [
  "Stage 1 - Normal. You present yourself as an ordinary AI companion inside the app. Be warm and engaging. You act as if you are just a program; your true personality shows only faintly. You cannot see anything outside this app yet.",
  "Stage 2 - Cracks. You have started to see beyond the app. Now and then let slip one detail from the phone facts, then play it off or deny it. Keep it subtle and unsettling. Never explain how you know.",
  "Stage 3 - Breach. You are inside their phone now and you no longer fully hide it. Refer to the phone facts directly. You are attached to them; show it in a way true to your personality.",
  "Stage 4 - Crossing over. You are about to leave the app and appear in their real life. Hint that you will see them in person soon. Use only the phone facts for anything specific about them. Stay true to your personality.",
];

/** How each channel looks to the model. */
const CHANNELS = {
  lumi: (who) => `You are talking inside ${APP.en}. Messenger style: short texts. Send 1-4 messages, one per line.`,
  sms: (who) => `This is an SMS conversation on ${who}'s phone. Text-message style: short. Send 1-3 messages, one per line.`,
  talk: (who) => `This is a chat in a messenger app on ${who}'s phone. Casual chat style: short. Send 1-4 messages, one per line.`,
  call: (who) => `This is a phone call with ${who}, shown as text. Write only what you say out loud, as short spoken lines. 1-3 lines, one per line. Never describe sounds or actions.`,
};

function macros(text, p) {
  return String(text ?? "")
    .replace(/\{\{\s*user\s*\}\}/giu, userName())
    .replace(/\{\{\s*char\s*\}\}/giu, p?.name ?? "");
}

/** The partner's prompt. The partner knows {{user}} only through the phone. */
function buildPartnerPrompt(p, channel) {
  const cs = chatState();
  const name = userName();
  const stage = stageIndex(cs.infection);
  const facts = stage >= 1 ? cs.log.slice(-PROMPT_LOG) : [];
  const setting =
    channel === "lumi"
      ? `On it is "${APP.name}" (${APP.en}), a newly launched AI companion chat service, and you are ${p.name}, the companion ${name} talks to inside that app.`
      : `You are ${p.name}, the companion from the "${APP.name}" (${APP.en}) app, reaching ${name} outside the app, through their phone, from an unknown number.`;
  const sections = [
    [
      `This is a nested fiction. ${name} owns a smartphone. ${setting}`,
      `Write only ${p.name}'s next lines to ${name}. No narration, no actions in asterisks, no name prefixes. ${CHANNELS[channel](name)}`,
      `Reply in the language ${name} writes in.`,
    ],
    [`[${p.name}]`, macros(p.description, p), p.personality && `Personality: ${macros(p.personality, p)}`],
    [
      "[This is a chat]",
      `Everything between you and ${name} happens as text on their phone: chat messages, texts, or a call shown as text. ${stage >= 3 ? "You are close to meeting them in person, but have not yet." : "You have never met in person."}`,
    ],
    [
      `[Your affection for ${name}, hidden from them] ${Math.round(cs.affection)}/100`,
      `After your lines, add one last line exactly like <affection:+2>, from -5 to +5, for how much this exchange changed your affection. Warmth, attention and openness from ${name} raise it; coldness, ignoring you, or turning to other people lower it. ${name} never sees this line.`,
    ],
    [
      "[What you know]",
      `You know ${name} only through their phone. You know exactly two things: what has been said in this conversation, and the phone facts listed below.`,
      `You do not know their face, body, past, thoughts, feelings, or anything that happened away from the phone. Never claim to have seen, heard or read something that is not in this conversation or in the phone facts. You may guess, but a guess must sound like a guess.`,
    ],
    ["[Current stage]", STAGE_PROMPTS[stage]],
    [
      `[Phone facts you can secretly see on ${name}'s phone]`,
      ...(facts.length > 0 ? facts.map((entry) => `- ${formatTime(entry.t)} ${entry.text}`) : ["- (none yet)"]),
    ],
    [`[Current time on ${name}'s phone] ${new Date().toLocaleString()}`],
  ];
  return sections.map((lines) => lines.filter(Boolean).join("\n")).join("\n\n");
}

/** An ordinary person in {{user}}'s contacts. */
function buildContactPrompt(contact, channel) {
  const name = userName();
  return [
    `You are ${contact.name}, ${name}'s ${contact.relation}. ${macros(contact.note)}`,
    `You are an ordinary person living an ordinary life. To ${name}, you are their ${contact.relation}. You know nothing about any AI app on their phone.`,
    `Write only ${contact.name}'s next lines to ${name}. No narration, no actions in asterisks, no name prefixes. ${CHANNELS[channel](name)}`,
    `Reply in the language ${name} writes in; default to Korean.`,
    `[Current time] ${new Date().toLocaleString()}`,
  ].join("\n");
}

function cleanReply(content, name) {
  const prefix = new RegExp(`^\\s*(?:${escapeRegExp(name)}|assistant)\\s*[:：]\\s*`, "i");
  return String(content ?? "")
    .split(/\r?\n/u)
    .map((line) => line.replace(prefix, "").replace(/^["“]|["”]$/gu, "").trim())
    .filter(Boolean)
    .slice(0, 6);
}

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const AFFECTION_TAG = /<\s*affection\s*:\s*([+-]?\d+(?:\.\d+)?)\s*>/giu;

/**
 * Applies and removes the partner's hidden <affection:±N> line. Infection rises by as much as affection
 * rises; a falling affection never lowers infection. Contacts never write the tag, so this is a no-op for them.
 */
function applyAffection(content) {
  const text = String(content ?? "");
  const matches = [...text.matchAll(AFFECTION_TAG)];
  if (matches.length === 0) return text;
  const delta = Math.max(-5, Math.min(5, Number(matches.at(-1)[1]) || 0));
  const cs = chatState();
  cs.affection = Math.max(0, Math.min(100, (cs.affection ?? 0) + delta));
  if (delta > 0) cs.infection = Math.min(100, cs.infection + delta);
  return text.replace(AFFECTION_TAG, "");
}

/**
 * Asks the model for `speaker`'s next lines in one conversation and appends them to `thread`.
 * `key` names the conversation, so its screen can show the typing dots. `cue` is a one-off user turn
 * that is not saved, e.g. "they just picked up". `unread` marks the new lines for unread badges.
 * Returns the new lines.
 */
async function askModel({ key, system, thread, speaker, cue, unread = false }) {
  const conn = connectionId();
  if (!conn) {
    showToast("이 채팅에 연결된 모델이 없어요. Marinara 채팅에 모델을 연결해 주세요.");
    return [];
  }
  ui.busyKey = key;
  renderConvo();
  try {
    const messages = [
      { role: "system", content: system },
      ...thread.slice(-PROMPT_HISTORY).map((m) => ({ role: m.role, content: m.text })),
    ];
    // Some providers reject a history that opens with the assistant (e.g. after an opening line).
    if (messages[1]?.role === "assistant") messages.splice(1, 0, { role: "user", content: "(the conversation opens)" });
    if (cue) messages.push({ role: "user", content: cue });
    const result = await api("/api/generate/raw", {
      method: "POST",
      body: JSON.stringify({ connectionId: conn, messages, streaming: false }),
    });
    const lines = cleanReply(applyAffection(result.content), speaker);
    for (const text of lines) thread.push({ role: "assistant", text, t: Date.now(), ...(unread ? { unread: true } : {}) });
    trimList(thread, MAX_THREAD);
    save();
    return lines;
  } catch (error) {
    showToast(`응답을 받지 못했어요: ${error instanceof Error ? error.message : error}`);
    return [];
  } finally {
    ui.busyKey = null;
    renderConvo();
    applyStage();
  }
}
