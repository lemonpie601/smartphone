// ── 인터넷: the phone's browser with a made-up search engine. Results are written by the model when one is
// connected, otherwise they are plausible stand-ins. ui.sub: null (home) | "q:<query>" | "p:<query>\n<index>"

const SEARCH_ENGINE = { name: "찾다", tagline: "궁금한 건 다 찾다" };
const TRENDING = ["첫눈 예보", "수능 끝나고 할 일", "겨울 패딩 세탁법", "붕어빵 파는 곳", "연말 모임 장소", "감기 빨리 낫는 법", "새로 나온 컵라면", "주말 영화 추천"];
const HEADLINES = [
  { title: "이번 주말 올겨울 첫 한파… 아침 기온 영하권", site: "하루뉴스" },
  { title: "\"밤에 휴대폰 오래 보면 잠 못 든다\" 연구 결과", site: "생활과학" },
  { title: "동네 빵집 열 곳 중 세 곳, 겨울 한정 메뉴 출시", site: "오늘의 동네" },
  { title: "AI 컴패니언 앱 이용자 급증… \"외로움 달래 줘\"", site: "테크한입" },
];
const webPages = new Map(); // "<query>\n<index>" -> paragraphs, kept for this session only

function webState() {
  const cs = chatState();
  cs.web ??= { searches: [], cache: {} };
  // Once the partner is inside the phone, the history has a search the user never made.
  if (stageIndex() >= 2 && !cs.web.ghost) {
    cs.web.ghost = true;
    cs.web.searches.unshift({ q: "잠든 사람 안 깨우고 사진 찍는 법", t: new Date().setHours(3, 14, 0, 0), ghost: true });
    save();
  }
  return cs.web;
}

function fallbackResults(q) {
  return [
    { title: `${q} - 오픈백과`, site: "오픈백과", text: `${q}에 대한 설명과 관련 정보를 정리한 문서입니다.` },
    { title: `${q}, 이것만 알면 끝! 총정리`, site: "생활정보 블로그", text: `요즘 많이 찾는 ${q}. 직접 해 보고 알게 된 것들을 정리했어요.` },
    { title: `'${q}' 관련 최신 소식`, site: "하루뉴스", text: `${q}${josaOnly(q, "과", "와")} 관련된 오늘의 기사 모음입니다.` },
    { title: `${q} 질문 있어요`, site: "물어봐 지식 커뮤니티", text: `${q} 해 보신 분 계신가요? 답변 12개` },
    { title: `${q} 후기 모음`, site: "동네 카페 게시판", text: `실제로 겪어 본 사람들의 ${q} 후기를 모았습니다.` },
  ];
}

function parseResults(lines) {
  return lines
    .map((line) => line.replace(/^\s*(?:\d+[.)]|[-*•])\s*/u, "").split(/\s*\|\s*/u))
    .filter((parts) => parts.length >= 3 && parts[0])
    .map(([title, site, ...rest]) => ({ title: snippet(title, 60), site: snippet(site, 24), text: snippet(rest.join(" "), 120) }))
    .slice(0, 6);
}

async function searchWeb(q) {
  const ws = webState();
  ws.searches = [{ q, t: Date.now() }, ...ws.searches.filter((s) => s.q !== q)].slice(0, 15);
  save();
  logActivity(`인터넷에서 '${snippet(q, 40)}'${josaOnly(q, "을", "를")} 검색했다`);
  go("browser", `q:${q}`);
  if (ws.cache[q]) return;
  let results = null;
  if (connectionId() && !ui.busyKey) {
    const lines = await askModel({
      key: "web",
      speaker: SEARCH_ENGINE.name,
      thread: [],
      system: [
        `You are ${SEARCH_ENGINE.name}, a Korean web search engine inside a fictional smartphone.`,
        "List exactly 5 search results for the user's query, one per line, in this format:",
        "제목 | 사이트 이름 | 한 줄 요약",
        "Write in Korean. Make the results realistic and varied (encyclopedia, blog, news, Q&A, community). Use made-up site names; never use real brand or company names. No URLs, no numbering, no extra text.",
        `[Current time] ${new Date().toLocaleString()}`,
      ].join("\n"),
      cue: `검색어: ${q}`,
    });
    results = parseResults(lines);
  }
  const ws2 = webState();
  ws2.cache[q] = results && results.length >= 2 ? results : fallbackResults(q);
  const keys = Object.keys(ws2.cache);
  for (const key of keys.slice(0, Math.max(0, keys.length - 8))) delete ws2.cache[key];
  save();
  if (ui.app === "browser" && ui.sub === `q:${q}`) render();
}

async function openWebPage(q, index) {
  const result = webState().cache[q]?.[index];
  if (!result) return;
  logActivity(`인터넷에서 '${snippet(result.title, 40)}' 페이지를 읽었다`);
  const key = `${q}\n${index}`;
  go("browser", `p:${key}`);
  if (webPages.has(key)) return;
  let body = null;
  if (connectionId() && !ui.busyKey) {
    const lines = await askModel({
      key: "web",
      speaker: result.site,
      thread: [],
      system: [
        "You write the text of a web page on a fictional smartphone, in Korean.",
        `Page title: ${result.title}`,
        `Site: ${result.site}`,
        `Summary: ${result.text}`,
        "Write the page body as 3-5 short paragraphs, one paragraph per line. Plain text only: no headings, no lists, no markdown, no URLs. Never use real brand or company names.",
      ].join("\n"),
      cue: "(페이지 본문을 써 주세요)",
    });
    if (lines.length > 0) body = lines;
  }
  webPages.set(key, body ?? [result.text, `${result.site}에서 더 많은 정보를 확인해 보세요.`]);
  if (ui.app === "browser" && ui.sub === `p:${key}`) render();
}

function searchBar(value = "") {
  const input = h("input", { class: "uphone-search", type: "search", placeholder: `${SEARCH_ENGINE.name}에서 검색`, "aria-label": "검색어", enterkeyhint: "search" });
  input.value = value;
  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.isComposing && input.value.trim()) void searchWeb(input.value.trim().slice(0, 80));
  });
  return input;
}

function renderBrowser() {
  const sub = ui.sub ?? "";
  if (sub.startsWith("q:")) return renderSearchResults(sub.slice(2));
  if (sub.startsWith("p:")) {
    const [q, index] = sub.slice(2).split("\n");
    return renderWebPage(q, Number(index));
  }
  const ws = webState();
  const bar = searchBar();
  marinara.setTimeout(() => bar.focus(), 0);
  const removeSearch = (s) => {
    ws.searches = ws.searches.filter((x) => x !== s);
    save();
    if (s.ghost) logActivity(`검색한 기억이 없는 '${s.q}' 검색 기록을 지웠다`);
    render();
  };
  return h(
    "div",
    { class: "uphone-app-view uphone-browser" },
    appHeader(h("span", { class: "uphone-url" }, "🔒 chatda.search")),
    h(
      "div",
      { class: "uphone-browser-home" },
      h("div", { class: "uphone-engine-logo" }, SEARCH_ENGINE.name, h("small", null, SEARCH_ENGINE.tagline)),
      bar,
      ws.searches.length > 0
        ? h(
            "div",
            { class: "uphone-web-section" },
            h("div", { class: "uphone-section-label" }, "최근 검색어"),
            ws.searches.slice(0, 6).map((s) =>
              h(
                "div",
                { class: "uphone-recent-search" },
                h("button", { class: "uphone-plain", type: "button", onclick: () => searchWeb(s.q) }, `🕘 ${s.q}`),
                h("small", null, formatDay(s.t)),
                h("button", { class: "uphone-plain", type: "button", "aria-label": "검색 기록 삭제", onclick: () => removeSearch(s) }, "✕"),
              ),
            ),
          )
        : null,
      h(
        "div",
        { class: "uphone-web-section" },
        h("div", { class: "uphone-section-label" }, "지금 많이 찾는"),
        h(
          "ol",
          { class: "uphone-trending" },
          TRENDING.map((q) => h("li", null, h("button", { class: "uphone-plain", type: "button", onclick: () => searchWeb(q) }, q))),
        ),
      ),
      h(
        "div",
        { class: "uphone-web-section" },
        h("div", { class: "uphone-section-label" }, "뉴스"),
        HEADLINES.map((n) =>
          h(
            "button",
            { class: "uphone-news", type: "button", onclick: () => searchWeb(n.title.replace(/["…]/gu, "").slice(0, 30)) },
            h("strong", null, n.title),
            h("small", null, n.site),
          ),
        ),
      ),
    ),
  );
}

function renderSearchResults(q) {
  const results = webState().cache[q];
  const loading = !results;
  return h(
    "div",
    { class: "uphone-app-view uphone-browser" },
    appHeader(h("span", { class: "uphone-url" }, `🔒 chatda.search/?q=${q}`), null, () => go("browser")),
    h("div", { class: "uphone-search-wrap" }, searchBar(q)),
    h(
      "div",
      { class: "uphone-list uphone-results" },
      loading
        ? h("div", { class: "uphone-empty" }, h("span", { class: "uphone-spinner" }), "검색 중…")
        : results.map((r, i) =>
            h(
              "button",
              { class: "uphone-result", type: "button", onclick: () => openWebPage(q, i) },
              h("small", null, r.site),
              h("strong", null, r.title),
              h("p", null, r.text),
            ),
          ),
    ),
  );
}

function renderWebPage(q, index) {
  const result = webState().cache[q]?.[index];
  if (!result) return renderSearchResults(q);
  const body = webPages.get(`${q}\n${index}`);
  return h(
    "div",
    { class: "uphone-app-view uphone-browser" },
    appHeader(h("span", { class: "uphone-url" }, `🔒 ${result.site}`), null, () => go("browser", `q:${q}`)),
    h(
      "article",
      { class: "uphone-web-page" },
      h("small", null, result.site),
      h("h2", null, result.title),
      body ? body.map((p) => h("p", null, p)) : h("div", { class: "uphone-empty" }, h("span", { class: "uphone-spinner" }), "불러오는 중…"),
    ),
  );
}
