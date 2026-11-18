// ── 시계: alarms, world clock, stopwatch, timer. Alarms ring even while the phone is closed. ──
// ui.sub: "alarm" (default) | "world" | "stopwatch" | "timer" | "new-alarm" | "ringing:<id>"

function hhmm(date = new Date()) {
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

function alarms() {
  const cs = chatState();
  cs.alarms ??= [
    { id: "a1", time: "07:30", on: false, label: "기상" },
    { id: "a2", time: "08:00", on: false, label: "" },
  ];
  // Once the partner is inside the phone, an alarm nobody set appears. It is on.
  if (stageIndex() >= 2 && !cs.alarms.some((a) => a.ghost) && !cs.ghostAlarmGone) {
    cs.alarms.push({ id: `ag${Date.now().toString(36)}`, time: "03:12", on: true, label: "", ghost: true });
    save();
  }
  return cs.alarms;
}

function nextAlarm() {
  if (!ctx.chatId) return null;
  const now = hhmm();
  const on = alarms()
    .filter((a) => a.on)
    .sort((a, b) => a.time.localeCompare(b.time));
  return on.find((a) => a.time > now) ?? on[0] ?? null;
}

function alarmLabel(a) {
  return a.ghost ? "일어나" : a.label || "알람";
}

const stopwatch = { running: false, start: 0, elapsed: 0, laps: [] };
const countdown = { running: false, endAt: 0, total: 0, left: 0 };

function stopwatchMs() {
  return stopwatch.elapsed + (stopwatch.running ? Date.now() - stopwatch.start : 0);
}

function formatClockMs(ms) {
  const tenths = Math.floor(Math.max(0, ms) / 100);
  const m = Math.floor(tenths / 600);
  const s = (tenths % 600) / 10;
  return `${String(m).padStart(2, "0")}:${s.toFixed(1).padStart(4, "0")}`;
}

function formatCountdown(ms) {
  const total = Math.ceil(Math.max(0, ms) / 1000);
  const hours = Math.floor(total / 3600);
  const mins = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  return `${hours > 0 ? `${hours}:` : ""}${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
}

// ── the ticker: alarms, the timer, and live numbers on screen ──

let lastAlarmMinute = "";
let alarmTone = null; // stops the ringing alarm's sound
marinara.setInterval(() => {
  if (!ctx.chatId) return;
  const minute = hhmm();
  if (minute !== lastAlarmMinute) {
    lastAlarmMinute = minute;
    const today = ymd(new Date());
    for (const a of alarms()) {
      const due = (a.on && a.time === minute && a.firedOn !== today) || (a.snoozeUntil && Date.now() >= a.snoozeUntil);
      if (!due) continue;
      a.firedOn = today;
      delete a.snoozeUntil;
      save();
      ringAlarm(a);
      break;
    }
  }
  // The alarm sound stops once its ringing screen is gone (dismissed, snoozed, or left).
  if (alarmTone && !(ui.open && ui.app === "clock" && String(ui.sub ?? "").startsWith("ringing:"))) {
    alarmTone();
    alarmTone = null;
  }
  if (countdown.running && Date.now() >= countdown.endAt) {
    countdown.running = false;
    countdown.left = 0;
    logActivity(`${formatCountdown(countdown.total)} 타이머가 끝났다`);
    buzz();
    timerDoneSound();
    showToast("⏱ 타이머가 끝났어요.");
    if (ui.app === "clock") render();
  }
  updateLiveNumbers();
}, 500);

function updateLiveNumbers() {
  if (!ui.open) return;
  const sw = screen.querySelector(".uphone-stopwatch-time");
  if (sw) sw.textContent = formatClockMs(stopwatchMs());
  const tm = screen.querySelector(".uphone-timer-time");
  if (tm && countdown.running) tm.textContent = formatCountdown(countdown.endAt - Date.now());
  for (const el of screen.querySelectorAll("[data-tz]")) el.textContent = zoneTime(el.dataset.tz);
  updateMusicProgress();
}

function ringAlarm(a) {
  if (ui.call) {
    showToast(`⏰ ${a.time} ${alarmLabel(a)}`);
    return;
  }
  if (!ui.open) toggle(true);
  closeShade();
  ui.app = "clock";
  ui.sub = `ringing:${a.id}`;
  render();
  buzz();
  alarmTone?.();
  alarmTone = startAlarmTone();
}

// ── screens ──

function renderClock() {
  const sub = ui.sub ?? "alarm";
  if (sub.startsWith("ringing:")) return renderAlarmRinging(sub.slice(8));
  if (sub === "new-alarm") return renderAlarmForm();
  const titles = { alarm: "알람", world: "세계 시각", stopwatch: "스톱워치", timer: "타이머" };
  const tab = titles[sub] ? sub : "alarm";
  const body = { alarm: renderAlarms, world: renderWorldClock, stopwatch: renderStopwatch, timer: renderTimer }[tab]();
  const tabButton = (id) => h("button", { class: `uphone-tab ${tab === id ? "is-active" : ""}`, type: "button", onclick: () => go("clock", id) }, titles[id]);
  const add = tab === "alarm" ? h("button", { class: "uphone-header-action", type: "button", "aria-label": "알람 추가", onclick: () => go("clock", "new-alarm") }, "＋") : null;
  return h(
    "div",
    { class: "uphone-app-view uphone-clock" },
    appHeader(titles[tab], add),
    body,
    h("div", { class: "uphone-tabs is-four" }, tabButton("alarm"), tabButton("world"), tabButton("stopwatch"), tabButton("timer")),
  );
}

function renderAlarms() {
  const list = [...alarms()].sort((a, b) => a.time.localeCompare(b.time));
  if (list.length === 0) return h("div", { class: "uphone-empty" }, "알람이 없어요.");
  return h(
    "div",
    { class: "uphone-list" },
    list.map((a) => {
      const sw = h("input", { type: "checkbox", class: "uphone-switch", "aria-label": `${a.time} 알람` });
      sw.checked = a.on;
      sw.addEventListener("change", () => {
        a.on = sw.checked;
        save();
        logActivity(a.on ? `${a.time} 알람을 켰다` : `${a.time} 알람을 껐다`);
        renderStatus();
        render();
      });
      const remove = () =>
        confirmSheet(`${a.time} 알람을 삭제할까요?`, "삭제", () => {
          const cs = chatState();
          cs.alarms = cs.alarms.filter((x) => x.id !== a.id);
          if (a.ghost) cs.ghostAlarmGone = true;
          save();
          logActivity(a.ghost ? `맞춘 기억이 없는 ${a.time} 알람을 지웠다` : `${a.time} 알람을 지웠다`);
          render();
        });
      return h(
        "div",
        { class: `uphone-list-row uphone-alarm-row ${a.on ? "" : "is-off"} ${a.ghost ? "is-ghost" : ""}` },
        h(
          "button",
          { class: "uphone-row-main", type: "button", "aria-label": "알람 삭제", onclick: remove },
          h("span", { class: "uphone-list-main" }, h("strong", { class: "uphone-alarm-time" }, a.time), h("small", null, a.label || (a.ghost ? " " : "매일"))),
        ),
        sw,
      );
    }),
    h("p", { class: "uphone-hint" }, "알람을 누르면 삭제할 수 있어요."),
  );
}

function renderAlarmForm() {
  const time = h("input", { class: "uphone-field uphone-big-time", type: "time", "aria-label": "알람 시각" });
  time.value = "07:00";
  const label = h("input", { class: "uphone-field", placeholder: "알람 이름 (선택)", "aria-label": "알람 이름" });
  const add = () => {
    if (!time.value) return showToast("시각을 골라 주세요.");
    const a = { id: `a${Date.now().toString(36)}`, time: time.value, on: true, label: label.value.trim().slice(0, 20) };
    alarms().push(a);
    trimList(alarms(), 20);
    save();
    logActivity(`${a.time}에 알람을 맞췄다${a.label ? ` (${a.label})` : ""}`);
    go("clock", "alarm");
  };
  return h(
    "div",
    { class: "uphone-app-view" },
    appHeader("알람 추가", null, () => go("clock", "alarm")),
    h("div", { class: "uphone-form" }, time, label, h("button", { class: "uphone-cta", type: "button", onclick: add }, "저장")),
  );
}

function renderAlarmRinging(id) {
  const a = alarms().find((x) => x.id === id);
  if (!a) {
    ui.sub = "alarm";
    return renderClock();
  }
  const stop = () => {
    logActivity(a.ghost ? `새벽 ${a.time}에 울린 알람을 껐다` : `${a.time} 알람을 끄고 일어났다`);
    go("clock", "alarm");
  };
  const snooze = () => {
    a.snoozeUntil = Date.now() + 5 * 60_000;
    save();
    logActivity(`${a.time} 알람을 5분 뒤로 미뤘다`);
    go("home");
  };
  return h(
    "div",
    { class: `uphone-alarm-ring ${a.ghost ? "is-ghost" : ""}` },
    h("span", { class: "uphone-alarm-ring-icon" }, "⏰"),
    h("strong", null, hhmm()),
    h("span", null, alarmLabel(a)),
    h(
      "div",
      { class: "uphone-alarm-ring-actions" },
      h("button", { class: "uphone-secondary", type: "button", onclick: snooze }, "5분 뒤 다시 알림"),
      h("button", { class: "uphone-cta", type: "button", onclick: stop }, "해제"),
    ),
  );
}

const WORLD_ZONES = [
  ["서울", "Asia/Seoul"],
  ["도쿄", "Asia/Tokyo"],
  ["런던", "Europe/London"],
  ["파리", "Europe/Paris"],
  ["뉴욕", "America/New_York"],
  ["시드니", "Australia/Sydney"],
];

function zoneTime(tz) {
  try {
    return new Date().toLocaleTimeString("ko-KR", { timeZone: tz, hour: "2-digit", minute: "2-digit" });
  } catch {
    return "--:--";
  }
}

function zoneDiff(tz) {
  try {
    const now = new Date();
    const there = new Date(now.toLocaleString("en-US", { timeZone: tz }));
    const here = new Date(now.toLocaleString("en-US"));
    const hours = Math.round((there - here) / 3_600_000);
    return hours === 0 ? "같은 시간대" : `${hours > 0 ? "+" : ""}${hours}시간`;
  } catch {
    return "";
  }
}

function renderWorldClock() {
  return h(
    "div",
    { class: "uphone-list" },
    WORLD_ZONES.map(([name, tz]) =>
      h(
        "div",
        { class: "uphone-list-row" },
        h("span", { class: "uphone-list-main" }, h("strong", null, name), h("small", null, zoneDiff(tz))),
        h("strong", { class: "uphone-world-time", "data-tz": tz }, zoneTime(tz)),
      ),
    ),
  );
}

function renderStopwatch() {
  const toggleRun = () => {
    if (stopwatch.running) {
      stopwatch.elapsed = stopwatchMs();
      stopwatch.running = false;
      logActivity(`스톱워치를 ${formatClockMs(stopwatch.elapsed)}에서 멈췄다`);
    } else {
      stopwatch.start = Date.now();
      stopwatch.running = true;
    }
    render();
  };
  const lapOrReset = () => {
    if (stopwatch.running) stopwatch.laps.unshift(stopwatchMs());
    else Object.assign(stopwatch, { elapsed: 0, laps: [] });
    render();
  };
  return h(
    "div",
    { class: "uphone-stopwatch" },
    h("div", { class: "uphone-stopwatch-time" }, formatClockMs(stopwatchMs())),
    h(
      "div",
      { class: "uphone-clock-buttons" },
      h("button", { class: "uphone-secondary", type: "button", onclick: lapOrReset }, stopwatch.running ? "구간 기록" : "초기화"),
      h("button", { class: `uphone-cta ${stopwatch.running ? "is-stop" : ""}`, type: "button", onclick: toggleRun }, stopwatch.running ? "중지" : "시작"),
    ),
    h(
      "div",
      { class: "uphone-list" },
      stopwatch.laps.map((ms, i) => h("div", { class: "uphone-list-row" }, h("span", { class: "uphone-list-main" }, `구간 ${stopwatch.laps.length - i}`), h("strong", null, formatClockMs(ms)))),
    ),
  );
}

function renderTimer() {
  const presets = [1, 3, 5, 10, 15, 30];
  const start = (minutes) => {
    countdown.total = minutes * 60_000;
    countdown.endAt = Date.now() + countdown.total;
    countdown.running = true;
    logActivity(`${minutes}분 타이머를 맞췄다`);
    render();
  };
  const cancel = () => {
    countdown.running = false;
    countdown.left = 0;
    render();
  };
  return h(
    "div",
    { class: "uphone-stopwatch" },
    h("div", { class: "uphone-timer-time uphone-stopwatch-like" }, countdown.running ? formatCountdown(countdown.endAt - Date.now()) : "00:00"),
    countdown.running
      ? h("div", { class: "uphone-clock-buttons" }, h("button", { class: "uphone-cta is-stop", type: "button", onclick: cancel }, "취소"))
      : h(
          "div",
          { class: "uphone-timer-presets" },
          presets.map((m) => h("button", { class: "uphone-secondary", type: "button", onclick: () => start(m) }, `${m}분`)),
        ),
  );
}
