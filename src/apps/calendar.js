// ── 캘린더: a month view and events. cs.calendar.events = [{ id, date: "YYYY-MM-DD", time: "HH:MM" | null, title }] ──

function ymd(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function parseYmd(text) {
  const [y, m, d] = text.split("-").map(Number);
  return new Date(y, m - 1, d);
}

function eventLabel(ev) {
  const d = parseYmd(ev.date);
  return `${d.getMonth() + 1}월 ${d.getDate()}일${ev.time ? ` ${ev.time}` : ""}`;
}

function calendarState() {
  const cs = chatState();
  if (!cs.calendar) {
    const day = (n) => {
      const d = new Date();
      d.setDate(d.getDate() + n);
      return ymd(d);
    };
    // a few plans a real phone would already have
    cs.calendar = {
      events: [
        { id: "e1", date: day(2), time: "19:00", title: "지은이랑 저녁" },
        { id: "e2", date: day(5), time: null, title: "과제 자료 마감 (박 선배)" },
        { id: "e3", date: day(9), time: null, title: "엄마 생신 🎂" },
      ],
    };
  }
  return cs.calendar;
}

/** The user's events, plus one nobody put there once the partner is about to cross over (stage 4). */
function calendarEvents() {
  const cal = calendarState();
  if (stageIndex() >= 3 && !cal.ghostAdded) {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    cal.events.push({ id: `g${Date.now().toString(36)}`, date: ymd(d), time: "03:12", title: "만나는 날", ghost: true });
    cal.ghostAdded = true;
    save();
  }
  return cal.events;
}

function eventsOn(date) {
  return calendarEvents()
    .filter((ev) => ev.date === date)
    .sort((a, b) => (a.time ?? "").localeCompare(b.time ?? ""));
}

/** The next event still ahead today, for the home widget. */
function nextCalendarEvent() {
  const now = new Date();
  const hm = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
  return eventsOn(ymd(now)).find((ev) => !ev.time || ev.time >= hm) ?? null;
}

function calendarNotifications() {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const next = nextCalendarEvent();
  if (!next) return [];
  return [{ icon: "📅", cls: "is-calendar-mini", title: "캘린더 · 오늘", text: `${next.time ?? "하루 종일"} ${next.title}`, t: Math.max(start.getTime(), next.created ?? 0), open: () => go("calendar") }];
}

const calendarView = { month: null, selected: null };

function renderCalendar() {
  const today = ymd(new Date());
  calendarView.selected ??= today;
  calendarView.month ??= (() => {
    const d = new Date();
    d.setDate(1);
    return d;
  })();
  if (ui.sub === "new") return renderEventForm();
  const month = calendarView.month;
  const first = new Date(month.getFullYear(), month.getMonth(), 1);
  const daysIn = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
  const events = calendarEvents();
  const cells = [];
  for (let i = 0; i < first.getDay(); i += 1) cells.push(h("span", { class: "uphone-cal-cell is-blank" }));
  for (let d = 1; d <= daysIn; d += 1) {
    const date = ymd(new Date(month.getFullYear(), month.getMonth(), d));
    const has = events.filter((ev) => ev.date === date);
    const weekday = new Date(month.getFullYear(), month.getMonth(), d).getDay();
    cells.push(
      h(
        "button",
        {
          class: `uphone-cal-cell ${date === today ? "is-today" : ""} ${date === calendarView.selected ? "is-selected" : ""} ${weekday === 0 ? "is-sun" : weekday === 6 ? "is-sat" : ""}`,
          type: "button",
          onclick: () => {
            calendarView.selected = date;
            render();
          },
        },
        h("span", null, String(d)),
        has.length > 0 ? h("i", { class: has.some((ev) => ev.ghost) ? "is-ghost" : "" }) : null,
      ),
    );
  }
  const shift = (n) => () => {
    calendarView.month = new Date(month.getFullYear(), month.getMonth() + n, 1);
    render();
  };
  const selected = parseYmd(calendarView.selected);
  const dayEvents = eventsOn(calendarView.selected);
  const remove = (ev) =>
    confirmSheet(`'${ev.title}' 일정을 삭제할까요?`, "삭제", () => {
      const cal = calendarState();
      cal.events = cal.events.filter((x) => x.id !== ev.id);
      save();
      logActivity(ev.ghost ? `캘린더에서 넣은 기억이 없는 '${ev.title}' 일정을 지웠다` : `캘린더에서 ${eventLabel(ev)} '${ev.title}' 일정을 지웠다`);
      render();
    });
  return h(
    "div",
    { class: "uphone-app-view uphone-calendar" },
    appHeader("캘린더", h("button", { class: "uphone-header-action", type: "button", "aria-label": "새 일정", onclick: () => go("calendar", "new") }, "＋")),
    h(
      "div",
      { class: "uphone-cal-head" },
      h("button", { class: "uphone-plain", type: "button", "aria-label": "이전 달", onclick: shift(-1) }, "‹"),
      h("strong", null, `${month.getFullYear()}년 ${month.getMonth() + 1}월`),
      h("button", { class: "uphone-plain", type: "button", "aria-label": "다음 달", onclick: shift(1) }, "›"),
    ),
    h("div", { class: "uphone-cal-grid is-week" }, ["일", "월", "화", "수", "목", "금", "토"].map((d) => h("span", null, d))),
    h("div", { class: "uphone-cal-grid" }, cells),
    h(
      "div",
      { class: "uphone-cal-list" },
      h("div", { class: "uphone-section-label" }, selected.toLocaleDateString([], { month: "long", day: "numeric", weekday: "long" })),
      dayEvents.length === 0
        ? h("p", { class: "uphone-empty" }, "일정이 없어요.")
        : dayEvents.map((ev) =>
            h(
              "div",
              { class: `uphone-cal-event ${ev.ghost ? "is-ghost" : ""}` },
              h("span", { class: "uphone-cal-time" }, ev.time ?? "종일"),
              h("strong", null, ev.title),
              h("button", { class: "uphone-plain", type: "button", "aria-label": "일정 삭제", onclick: () => remove(ev) }, "✕"),
            ),
          ),
    ),
  );
}

function renderEventForm() {
  const title = h("input", { class: "uphone-field", placeholder: "일정 제목", "aria-label": "일정 제목" });
  const date = h("input", { class: "uphone-field", type: "date", "aria-label": "날짜" });
  date.value = calendarView.selected;
  const time = h("input", { class: "uphone-field", type: "time", "aria-label": "시간" });
  time.value = "12:00";
  const allDay = h("input", { type: "checkbox", class: "uphone-switch", "aria-label": "하루 종일" });
  allDay.addEventListener("change", () => {
    time.disabled = allDay.checked;
  });
  const add = () => {
    const text = title.value.trim().slice(0, 40);
    if (!text) return showToast("일정 제목을 입력해 주세요.");
    if (!date.value) return showToast("날짜를 골라 주세요.");
    const ev = { id: `e${Date.now().toString(36)}`, date: date.value, time: allDay.checked || !time.value ? null : time.value, title: text, created: Date.now() };
    calendarState().events.push(ev);
    trimList(calendarState().events, 80);
    calendarView.selected = ev.date;
    calendarView.month = new Date(parseYmd(ev.date).getFullYear(), parseYmd(ev.date).getMonth(), 1);
    save();
    logActivity(`캘린더에 ${eventLabel(ev)} '${ev.title}' 일정을 넣었다`);
    go("calendar");
  };
  marinara.setTimeout(() => title.focus(), 0);
  return h(
    "div",
    { class: "uphone-app-view" },
    appHeader("새 일정", null, () => go("calendar")),
    h(
      "div",
      { class: "uphone-form" },
      title,
      date,
      h("label", { class: "uphone-row" }, h("span", null, "하루 종일"), allDay),
      time,
      h("button", { class: "uphone-cta", type: "button", onclick: add }, "저장"),
    ),
  );
}
