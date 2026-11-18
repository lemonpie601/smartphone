// ── the partner reaches out first ──

/** Minutes between unprompted messages, by stage: the closer it gets, the more often it writes. */
const REACH_OUT_GAP_MIN = [15, 10, 6, 4];
const REACH_OUT_CHANCE = 0.4; // at each check, once the gap has passed
const QUIET_BEFORE_REACH_OUT_MIN = 2; // never interrupt while the user is busy on the phone

/** The last time the user did anything on the phone. */
function lastPhoneActivityAt() {
  return chatState().log.at(-1)?.t ?? 0;
}

/**
 * Sometimes the partner writes first: in its app at first, later from an unknown number in 메시지 or 톡.
 * `cue` overrides the reason given to the model, e.g. right after it knocked on the door.
 */
async function maybePartnerReachesOut({ force = false, cue = null } = {}) {
  const p = partner();
  const cs = chatState();
  if (!p || !ctx.chat || !joined() || gateLocked() || unlocking || ui.busyKey || ui.call || !connectionId()) return;
  const stage = stageIndex();
  const now = Date.now();
  if (!force) {
    if (now - (cs.lastReachOut ?? 0) < REACH_OUT_GAP_MIN[stage] * 60_000) return;
    if (now - lastPhoneActivityAt() < QUIET_BEFORE_REACH_OUT_MIN * 60_000) return;
    if (Math.random() > REACH_OUT_CHANCE) return;
  }
  cs.lastReachOut = now;
  const channels = stage >= 2 ? ["lumi", "talk", "sms"] : ["lumi"];
  const target = partnerChannel(channels[Math.floor(Math.random() * channels.length)]);
  const quietMin = Math.max(1, Math.round((now - lastPhoneActivityAt()) / 60_000));
  const reason =
    cue ??
    `(${userName()} has not touched the phone for about ${quietMin} minutes. You message them first, unprompted, the way you would at this stage. Use the phone facts if it fits.)`;
  const channel = target.app === "aichat" ? "lumi" : target.app === "messages" ? "sms" : "talk";
  const viewing = isViewing(target);
  const lines = await askModel({ key: target.key, system: buildPartnerPrompt(p, channel), thread: target.thread, speaker: p.name, cue: reason, unread: !viewing });
  if (lines.length > 0 && !viewing) announcePartner(target, lines.at(-1));
}
