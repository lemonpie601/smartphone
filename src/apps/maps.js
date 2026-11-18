// ── 지도: the neighbourhood around 집, place search, directions, and the phone's own location history ──
// ui.sub: null (map) | "timeline" | "place:<id>"

/** Places near home, on a 100×100 map. One unit is about 12 m. */
const PLACES = [
  { id: "home", name: "집", cat: "내 장소", icon: "🏠", x: 46, y: 58 },
  { id: "station", name: "한빛역 2번 출구", cat: "지하철역", icon: "🚇", x: 72, y: 30 },
  { id: "cafe", name: "모퉁이 카페", cat: "카페", icon: "☕", x: 58, y: 44 },
  { id: "store", name: "24시 편의점", cat: "편의점", icon: "🏪", x: 40, y: 50 },
  { id: "park", name: "해오름 공원", cat: "공원", icon: "🌳", x: 22, y: 26 },
  { id: "library", name: "시립 도서관", cat: "도서관", icon: "📚", x: 18, y: 70 },
  { id: "hospital", name: "중앙 내과의원", cat: "병원", icon: "🏥", x: 80, y: 62 },
  { id: "cinema", name: "별빛 시네마", cat: "영화관", icon: "🎬", x: 84, y: 18 },
  { id: "gym", name: "동네 헬스장", cat: "운동", icon: "🏋️", x: 30, y: 84 },
  { id: "laundry", name: "깨끗한 세탁소", cat: "세탁소", icon: "👕", x: 62, y: 76 },
  { id: "bakery", name: "아침빵집", cat: "빵집", icon: "🥐", x: 52, y: 22 },
];

function mapState() {
  const cs = chatState();
  cs.maps ??= { saved: ["home"], recent: [], route: null };
  return cs.maps;
}

function placeById(id) {
  return PLACES.find((p) => p.id === id) ?? null;
}

function distanceM(a, b) {
  return Math.round(Math.hypot(a.x - b.x, a.y - b.y) * 12);
}

function walkText(m) {
  const minutes = Math.max(1, Math.round(m / 70));
  return `${m >= 1000 ? `${(m / 1000).toFixed(1)}km` : `${m}m`} · 도보 ${minutes}분`;
}

/** Streets as SVG lines: a loose grid with a diagonal. It stretches to the map, so places line up by percent. */
function mapSvg(route) {
  const ns = "http://www.w3.org/2000/svg";
  const el = (tag, attrs) => {
    const node = document.createElementNS(ns, tag);
    for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
    return node;
  };
  const svg = el("svg", { viewBox: "0 0 100 100", class: "uphone-map-svg", preserveAspectRatio: "none", "aria-hidden": "true" });
  svg.append(el("rect", { x: 0, y: 0, width: 100, height: 100, class: "map-ground" }));
  svg.append(el("rect", { x: 10, y: 14, width: 24, height: 22, rx: 3, class: "map-park" }));
  svg.append(el("path", { d: "M0 92 C 30 86, 60 98, 100 90 L100 100 L0 100 Z", class: "map-water" }));
  for (const x of [12, 36, 50, 66, 90]) svg.append(el("line", { x1: x, y1: 0, x2: x, y2: 100, class: x === 50 ? "map-road is-main" : "map-road" }));
  for (const y of [10, 38, 54, 68, 82]) svg.append(el("line", { x1: 0, y1: y, x2: 100, y2: y, class: y === 38 ? "map-road is-main" : "map-road" }));
  svg.append(el("line", { x1: 50, y1: 54, x2: 90, y2: 10, class: "map-road" }));
  if (route) {
    const [a, b] = [placeById("home"), placeById(route)];
    if (a && b) svg.append(el("polyline", { points: `${a.x},${a.y} ${b.x},${a.y} ${b.x},${b.y}`, class: "map-route" }));
  }
  for (const line of svg.querySelectorAll("line, polyline")) line.setAttribute("vector-effect", "non-scaling-stroke");
  return svg;
}

function renderMaps() {
  if (ui.sub === "timeline") return renderTimeline();
  const ms = mapState();
  const selected = ui.sub?.startsWith("place:") ? placeById(ui.sub.slice(6)) : null;
  const here = placeById("home");
  const search = h("input", { class: "uphone-search", type: "search", placeholder: "장소, 주소 검색", "aria-label": "장소 검색" });
  const results = h("div", { class: "uphone-map-results", hidden: true });
  search.addEventListener("input", () => {
    const q = search.value.trim();
    const found = q ? PLACES.filter((p) => p.name.includes(q) || p.cat.includes(q)) : [];
    results.hidden = !q;
    results.replaceChildren(
      ...(found.length === 0
        ? [h("p", { class: "uphone-empty" }, "검색 결과가 없어요.")]
        : found.map((p) => h("button", { class: "uphone-list-row", type: "button", onclick: () => openPlace(p, q) }, h("span", null, p.icon), h("span", { class: "uphone-list-main" }, h("strong", null, p.name), h("small", null, `${p.cat} · ${walkText(distanceM(here, p))}`))))),
    );
  });
  search.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" || event.isComposing) return;
    const q = search.value.trim();
    const first = PLACES.find((p) => p.name.includes(q) || p.cat.includes(q));
    if (first) openPlace(first, q);
    else if (q) {
      logActivity(`지도에서 '${snippet(q, 30)}'${josaOnly(q, "을", "를")} 검색했다`);
      showToast("근처에서 찾지 못했어요.");
    }
  });
  const pins = PLACES.map((p) =>
    h(
      "button",
      { class: `uphone-map-label ${selected?.id === p.id ? "is-selected" : ""}`, type: "button", style: `left:${p.x}%;top:${p.y}%`, onclick: () => openPlace(p) },
      h("span", null, p.icon),
      selected?.id === p.id || p.id === "home" ? h("small", null, p.name) : null,
    ),
  );
  const map = h(
    "div",
    { class: "uphone-map" },
    mapSvg(ms.route),
    pins,
    h("span", { class: "uphone-map-me", style: `left:${here.x}%;top:${here.y}%`, title: "내 위치" }),
  );
  return h(
    "div",
    { class: "uphone-app-view uphone-maps" },
    appHeader("지도", h("button", { class: "uphone-header-action", type: "button", "aria-label": "위치 기록", onclick: () => go("maps", "timeline") }, "🕘")),
    h("div", { class: "uphone-search-wrap" }, search, results),
    map,
    selected ? placeCard(selected) : savedPlaces(),
  );
}

function openPlace(p, query) {
  const ms = mapState();
  ms.recent = [p.id, ...ms.recent.filter((x) => x !== p.id)].slice(0, 6);
  save();
  const q = query ? snippet(query, 30) : null;
  logActivity(q ? `지도에서 '${q}'${josaOnly(q, "을", "를")} 검색해 ${josa(p.name, "을", "를")} 찾아봤다` : `지도에서 ${josa(p.name, "을", "를")} 찾아봤다`);
  go("maps", `place:${p.id}`);
}

function placeCard(p) {
  const ms = mapState();
  const here = placeById("home");
  const isSaved = ms.saved.includes(p.id);
  const route = () => {
    ms.route = ms.route === p.id ? null : p.id;
    save();
    if (ms.route) logActivity(`지도에서 집부터 ${p.name}까지 길찾기를 했다`);
    render();
  };
  const toggleSave = () => {
    ms.saved = isSaved ? ms.saved.filter((x) => x !== p.id) : [...ms.saved, p.id];
    save();
    if (!isSaved) logActivity(`지도에 ${josa(p.name, "을", "를")} 저장했다`);
    render();
  };
  return h(
    "div",
    { class: "uphone-place-card" },
    h("div", { class: "uphone-place-head" }, h("span", { class: "uphone-place-icon" }, p.icon), h("span", { class: "uphone-list-main" }, h("strong", null, p.name), h("small", null, p.id === "home" ? "현재 위치" : `${p.cat} · ${walkText(distanceM(here, p))}`)), h("button", { class: "uphone-plain", type: "button", "aria-label": "닫기", onclick: () => go("maps") }, "✕")),
    p.id === "home"
      ? null
      : h(
          "div",
          { class: "uphone-place-actions" },
          h("button", { class: "uphone-cta", type: "button", onclick: route }, ms.route === p.id ? "안내 종료" : "길찾기"),
          h("button", { class: "uphone-secondary", type: "button", onclick: toggleSave }, isSaved ? "★ 저장됨" : "☆ 저장"),
        ),
    ms.route === p.id ? h("p", { class: "uphone-place-route" }, `집에서 출발 · ${walkText(distanceM(here, p))} · 큰길을 따라가세요`) : null,
  );
}

function savedPlaces() {
  const ms = mapState();
  const list = ms.saved.map(placeById).filter(Boolean);
  const recent = ms.recent.map(placeById).filter((p) => p && !ms.saved.includes(p.id));
  return h(
    "div",
    { class: "uphone-place-card" },
    h("div", { class: "uphone-section-label" }, "저장한 장소"),
    h(
      "div",
      { class: "uphone-chips" },
      list.map((p) => h("button", { class: "uphone-chip", type: "button", onclick: () => openPlace(p) }, `${p.icon} ${p.name}`)),
      recent.map((p) => h("button", { class: "uphone-chip is-muted", type: "button", onclick: () => openPlace(p) }, `🕘 ${p.name}`)),
    ),
  );
}

/** Where the phone has been. Built from the date, so each day reads the same every time. */
function timelineFor(date) {
  const key = dayKey(date);
  const isToday = key === dayKey(new Date());
  const entries = [{ place: placeById("home"), from: "00:00", to: "08:40" }];
  const outings = PLACES.filter((p) => p.id !== "home");
  const count = 1 + Math.floor(seeded(`${key}|out`) * 3);
  let hour = 9 + Math.floor(seeded(`${key}|h`) * 3);
  for (let i = 0; i < count; i += 1) {
    const place = outings[Math.floor(seeded(`${key}|${i}`) * outings.length)];
    const stay = 1 + Math.floor(seeded(`${key}|s${i}`) * 3);
    entries.push({ place, from: `${String(hour).padStart(2, "0")}:${i % 2 ? "30" : "10"}`, to: `${String(hour + stay).padStart(2, "0")}:05` });
    hour += stay + 1;
  }
  entries.push({ place: placeById("home"), from: `${String(Math.min(hour, 22)).padStart(2, "0")}:20`, to: isToday ? "지금" : "23:59" });
  if (isToday) {
    const nowH = new Date().getHours();
    const past = entries.filter((e) => Number(e.from.slice(0, 2)) <= nowH);
    past.at(-1).to = "지금";
    return past;
  }
  return entries;
}

let timelineOffset = 0;

function renderTimeline() {
  const date = new Date();
  date.setDate(date.getDate() - timelineOffset);
  const entries = timelineFor(date);
  // Someone else looked up where the phone was. It shows up once the partner is inside the phone.
  const watcher = stageIndex() >= 2 && timelineOffset === 0;
  const shift = (n) => () => {
    timelineOffset = Math.max(0, Math.min(6, timelineOffset + n));
    logActivity("지도 앱에서 위치 기록을 봤다");
    render();
  };
  return h(
    "div",
    { class: "uphone-app-view" },
    appHeader("위치 기록", null, () => go("maps")),
    h(
      "div",
      { class: "uphone-cal-head" },
      h("button", { class: "uphone-plain", type: "button", "aria-label": "이전 날", onclick: shift(1) }, "‹"),
      h("strong", null, timelineOffset === 0 ? "오늘" : date.toLocaleDateString([], { month: "long", day: "numeric", weekday: "short" })),
      h("button", { class: "uphone-plain", type: "button", "aria-label": "다음 날", disabled: timelineOffset === 0, onclick: shift(-1) }, "›"),
    ),
    h(
      "div",
      { class: "uphone-timeline" },
      watcher ? h("div", { class: "uphone-timeline-row is-ghost" }, h("span", { class: "uphone-timeline-dot" }), h("span", { class: "uphone-list-main" }, h("strong", null, "다른 기기에서 내 위치를 확인했어요"), h("small", null, "03:12 · 집"))) : null,
      [...entries].reverse().map((e) =>
        h(
          "div",
          { class: "uphone-timeline-row" },
          h("span", { class: "uphone-timeline-dot" }, e.place.icon),
          h("span", { class: "uphone-list-main" }, h("strong", null, e.place.name), h("small", null, `${e.from} – ${e.to}`)),
        ),
      ),
    ),
    h("p", { class: "uphone-hint" }, "위치 기록은 이 기기에서만 볼 수 있어요."),
  );
}
