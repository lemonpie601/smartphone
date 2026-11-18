// ── 날씨: plausible weather, the same all day for a given city and date ──

const WEATHER_CITIES = [
  { name: "서울", offset: 0 },
  { name: "인천", offset: -1 },
  { name: "부산", offset: 3 },
  { name: "대구", offset: 1 },
  { name: "대전", offset: 0 },
  { name: "광주", offset: 1 },
  { name: "강릉", offset: 0 },
  { name: "제주", offset: 5 },
];
const MONTH_HIGH = [2, 5, 11, 18, 23, 27, 29, 30, 26, 20, 12, 5]; // a rough Korean daytime high per month

function weatherState() {
  const cs = chatState();
  cs.weather ??= { city: "서울" };
  return cs.weather;
}

function weatherCity() {
  return WEATHER_CITIES.find((c) => c.name === weatherState().city) ?? WEATHER_CITIES[0];
}

/** A small deterministic random number in [0, 1) from a string. */
function seeded(text) {
  let x = 2166136261;
  for (const ch of String(text)) x = Math.imul(x ^ ch.codePointAt(0), 16777619);
  x ^= x >>> 13;
  x = Math.imul(x, 0x5bd1e995);
  return ((x ^ (x >>> 15)) >>> 0) / 4294967296;
}

function dayKey(date) {
  return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
}

function weatherDay(date, city = weatherCity()) {
  const r = seeded(`${dayKey(date)}|${city.name}`);
  const r2 = seeded(`${dayKey(date)}|${city.name}|b`);
  const high = Math.round(MONTH_HIGH[date.getMonth()] + city.offset + (r - 0.5) * 6);
  const low = high - 6 - Math.round(r2 * 4);
  const wet = r2 > 0.78;
  const kind = wet ? (high <= 3 ? "snow" : "rain") : r < 0.35 ? "clear" : r < 0.65 ? "partly" : "cloudy";
  return { high, low, kind, rainChance: wet ? 60 + Math.round(r * 35) : Math.round(r2 * 40) };
}

const WEATHER_KINDS = {
  clear: { cond: "맑음", day: "☀️", night: "🌙" },
  partly: { cond: "구름 조금", day: "🌤️", night: "☁️" },
  cloudy: { cond: "흐림", day: "☁️", night: "☁️" },
  rain: { cond: "비", day: "🌧️", night: "🌧️" },
  snow: { cond: "눈", day: "🌨️", night: "🌨️" },
};

/** Temperature through the day: lowest near 5 a.m., highest near 3 p.m. */
function weatherAt(date, city = weatherCity()) {
  const day = weatherDay(date, city);
  const hour = date.getHours() + date.getMinutes() / 60;
  const since5 = (hour - 5 + 24) % 24;
  const curve = since5 > 20 ? 0 : (1 - Math.cos((since5 / 10) * Math.PI)) / 2; // 0 at 5 a.m., 1 at 3 p.m., 0 again by 1 a.m.
  const temp = Math.round(day.low + (day.high - day.low) * curve);
  const night = hour < 6.5 || hour >= 18;
  const k = WEATHER_KINDS[day.kind];
  return { ...day, temp, cond: k.cond, icon: night ? k.night : k.day };
}

function weatherNow() {
  const now = new Date();
  const w = weatherAt(now);
  const r = seeded(`${dayKey(now)}|${weatherCity().name}|air`);
  return {
    ...w,
    feels: w.temp - (w.kind === "rain" || w.kind === "snow" ? 3 : 1),
    humidity: Math.round(35 + r * 40 + (w.kind === "rain" ? 20 : 0)),
    wind: (1 + r * 5).toFixed(1),
    dust: r < 0.45 ? "좋음" : r < 0.8 ? "보통" : "나쁨",
  };
}

function renderWeather() {
  const city = weatherCity();
  const now = new Date();
  const w = weatherNow();
  const hours = Array.from({ length: 12 }, (_, i) => {
    const t = new Date(now);
    t.setHours(now.getHours() + i, 0, 0, 0);
    return { t, w: i === 0 ? w : weatherAt(t, city) };
  });
  const days = Array.from({ length: 7 }, (_, i) => {
    const t = new Date(now);
    t.setDate(now.getDate() + i);
    t.setHours(13, 0, 0, 0);
    return { t, w: weatherAt(t, city) };
  });
  const pickCity = () => {
    phoneSheet(
      "도시 선택",
      h(
        "div",
        { class: "uphone-share-list" },
        WEATHER_CITIES.map((c) =>
          h(
            "button",
            {
              class: `uphone-secondary ${c.name === city.name ? "is-active" : ""}`,
              type: "button",
              onclick: (event) => {
                event.target.closest(".uphone-sheet")?.remove();
                weatherState().city = c.name;
                save();
                logActivity(`날씨 앱에서 ${c.name} 날씨를 찾아봤다`);
                render();
              },
            },
            `${c.name}  ${weatherAt(now, c).icon} ${weatherAt(now, c).temp}°`,
          ),
        ),
      ),
      [["닫기", null]],
    );
  };
  return h(
    "div",
    { class: `uphone-app-view uphone-weather is-${w.kind} ${w.icon === "🌙" ? "is-night" : ""}` },
    appHeader("날씨", h("button", { class: "uphone-header-action", type: "button", "aria-label": "도시 선택", onclick: pickCity }, "⌕")),
    h(
      "div",
      { class: "uphone-weather-body" },
      h(
        "div",
        { class: "uphone-weather-now" },
        h("span", { class: "uphone-weather-city" }, `📍 ${city.name}`),
        h("span", { class: "uphone-weather-icon" }, w.icon),
        h("strong", null, `${w.temp}°`),
        h("span", null, w.cond),
        h("small", null, `최고 ${w.high}° · 최저 ${w.low}° · 체감 ${w.feels}°`),
      ),
      h(
        "div",
        { class: "uphone-weather-card" },
        h("small", null, "시간별 예보"),
        h(
          "div",
          { class: "uphone-weather-hours" },
          hours.map(({ t, w: hw }, i) => h("span", null, h("small", null, i === 0 ? "지금" : `${t.getHours()}시`), h("b", null, hw.icon), `${hw.temp}°`)),
        ),
      ),
      h(
        "div",
        { class: "uphone-weather-card" },
        h("small", null, "주간 예보"),
        days.map(({ t, w: dw }, i) =>
          h(
            "div",
            { class: "uphone-weather-day" },
            h("span", null, i === 0 ? "오늘" : t.toLocaleDateString([], { weekday: "short" })),
            h("span", null, dw.icon, h("small", null, ` ${dw.rainChance}%`)),
            h("span", null, `${dw.low}° / ${dw.high}°`),
          ),
        ),
      ),
      h(
        "div",
        { class: "uphone-weather-grid" },
        h("div", { class: "uphone-weather-card" }, h("small", null, "습도"), h("strong", null, `${w.humidity}%`)),
        h("div", { class: "uphone-weather-card" }, h("small", null, "바람"), h("strong", null, `${w.wind}m/s`)),
        h("div", { class: "uphone-weather-card" }, h("small", null, "미세먼지"), h("strong", null, w.dust)),
        h("div", { class: "uphone-weather-card" }, h("small", null, "강수 확률"), h("strong", null, `${w.rainChance}%`)),
      ),
    ),
  );
}
