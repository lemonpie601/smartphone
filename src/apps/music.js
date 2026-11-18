// ── 음악: a library of made-up songs and a musicPlayer (silent: the phone shows the song, nothing plays) ──

const TRACKS = [
  { id: "t1", title: "새벽 세 시의 편의점", artist: "오후의 소음", dur: 222, tags: ["night"] },
  { id: "t2", title: "우산을 두고 왔어", artist: "하늘색 자전거", dur: 198, tags: ["commute"] },
  { id: "t3", title: "너의 이름을 부르면", artist: "윤슬", dur: 245, tags: ["night"] },
  { id: "t4", title: "주말엔 바다로", artist: "파도타기 클럽", dur: 207, tags: ["commute"] },
  { id: "t5", title: "형광등", artist: "낮잠", dur: 178, tags: ["night"] },
  { id: "t6", title: "Midnight Bus", artist: "Paper Moon", dur: 231, tags: ["night", "commute"] },
  { id: "t7", title: "고양이 산책", artist: "모래시계", dur: 164, tags: ["commute"] },
  { id: "t8", title: "겨울잠", artist: "윤슬", dur: 260, tags: ["night"] },
  { id: "t9", title: "오늘의 운세", artist: "하늘색 자전거", dur: 189, tags: ["commute"] },
  { id: "t10", title: "Rewind", artist: "Neon Garden", dur: 213, tags: [] },
  { id: "t11", title: "빨래 개는 일요일", artist: "낮잠", dur: 201, tags: [] },
  { id: "t12", title: "정류장", artist: "오후의 소음", dur: 236, tags: ["commute"] },
];
// A song that shows up in the library once the partner is inside the phone. Nobody added it.
const GHOST_TRACK = { id: "tg", title: "계속 보고 있어", artist: "알 수 없는 아티스트", dur: 312, tags: [], ghost: true };

const PLAYLISTS = [
  { id: "all", name: "전체" },
  { id: "recent", name: "최근 재생" },
  { id: "liked", name: "좋아요" },
  { id: "night", name: "잔잔한 밤" },
  { id: "commute", name: "출근길" },
];

const musicPlayer = { trackId: null, playing: false, startedAt: 0, offset: 0, list: "all" };
let musicFilter = "all";

function musicState() {
  const cs = chatState();
  cs.music ??= { recent: [], liked: [] };
  return cs.music;
}

function musicLibrary() {
  return stageIndex() >= 2 ? [GHOST_TRACK, ...TRACKS] : TRACKS;
}

function trackById(id) {
  return musicLibrary().find((t) => t.id === id) ?? null;
}

function tracksIn(listId) {
  const m = musicState();
  if (listId === "recent") return m.recent.map(trackById).filter(Boolean);
  if (listId === "liked") return m.liked.map(trackById).filter(Boolean);
  if (listId === "all") return musicLibrary();
  return musicLibrary().filter((t) => t.tags.includes(listId));
}

function josaOnly(word, withFinal, withoutFinal) {
  return josa(word, withFinal, withoutFinal).slice(String(word).length);
}

function trackFact(t) {
  return `${t.artist}의 '${t.title}'${josaOnly(t.title, "을", "를")}`;
}

/** Where the song is, in seconds. Moves on to the next song in the list when one ends. */
function musicPosition() {
  let t = trackById(musicPlayer.trackId);
  if (!t) return 0;
  let pos = musicPlayer.offset + (musicPlayer.playing ? (Date.now() - musicPlayer.startedAt) / 1000 : 0);
  let guard = 0;
  while (musicPlayer.playing && pos >= t.dur && guard < 50) {
    guard += 1;
    pos -= t.dur;
    const list = tracksIn(musicPlayer.list).length > 0 ? tracksIn(musicPlayer.list) : musicLibrary();
    const next = list[(list.findIndex((x) => x.id === t.id) + 1) % list.length] ?? list[0];
    musicPlayer.trackId = next.id;
    musicPlayer.startedAt = Date.now() - pos * 1000;
    musicPlayer.offset = 0;
    noteRecent(next.id);
    t = next;
  }
  return pos;
}

function musicPlaying() {
  if (!musicPlayer.playing) return null;
  musicPosition();
  return trackById(musicPlayer.trackId);
}

function noteRecent(id) {
  const m = musicState();
  m.recent = [id, ...m.recent.filter((x) => x !== id)].slice(0, 12);
  save();
}

function playTrack(id, listId = musicFilter) {
  const t = trackById(id);
  if (!t) return;
  Object.assign(musicPlayer, { trackId: id, playing: true, startedAt: Date.now(), offset: 0, list: listId });
  noteRecent(id);
  logActivity(`음악 앱에서 ${trackFact(t)} 틀었다`);
  renderStatus();
  render();
}

function togglePlay() {
  if (!musicPlayer.trackId) return playTrack(musicLibrary()[0].id);
  if (musicPlayer.playing) {
    musicPlayer.offset = musicPosition();
    musicPlayer.playing = false;
  } else {
    musicPlayer.startedAt = Date.now();
    musicPlayer.playing = true;
  }
  renderStatus();
  render();
}

function skipTrack(step) {
  const list = tracksIn(musicPlayer.list).length > 0 ? tracksIn(musicPlayer.list) : musicLibrary();
  const i = list.findIndex((x) => x.id === musicPlayer.trackId);
  const next = list[(i + step + list.length) % list.length];
  if (next) playTrack(next.id, musicPlayer.list);
}

function toggleLike(t) {
  const m = musicState();
  const liked = m.liked.includes(t.id);
  m.liked = liked ? m.liked.filter((x) => x !== t.id) : [t.id, ...m.liked];
  save();
  if (!liked) logActivity(`음악 앱에서 ${trackFact(t)} 좋아요 목록에 넣었다`);
  render();
}

function formatSongTime(sec) {
  const s = Math.max(0, Math.floor(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

function coverArt(t, cls = "") {
  const hue = Math.floor(seeded(t.title) * 360);
  const style = t.ghost ? "background:#050507" : `background:linear-gradient(135deg, hsl(${hue} 60% 55%), hsl(${(hue + 70) % 360} 55% 30%))`;
  return h("span", { class: `uphone-cover ${cls}`, style }, t.ghost ? "👁" : t.title.charAt(0));
}

/** Keeps the progress bar moving while the musicPlayer is on screen (called by the clock ticker). */
function updateMusicProgress() {
  const bar = screen.querySelector(".uphone-progress i");
  if (!bar) return;
  const t = trackById(musicPlayer.trackId);
  if (!t) return;
  const pos = musicPosition();
  if (bar.dataset.track !== t.id) return render(); // the song changed
  bar.style.width = `${Math.min(100, (pos / t.dur) * 100)}%`;
  const now = screen.querySelector(".uphone-progress-now");
  if (now) now.textContent = formatSongTime(pos);
}

function playerControls(small = false) {
  return h(
    "span",
    { class: `uphone-player-controls ${small ? "is-small" : ""}` },
    h("button", { type: "button", "aria-label": "이전 곡", onclick: () => skipTrack(-1) }, "⏮"),
    h("button", { class: "is-main", type: "button", "aria-label": musicPlayer.playing ? "일시정지" : "재생", onclick: togglePlay }, musicPlayer.playing ? "⏸" : "▶"),
    h("button", { type: "button", "aria-label": "다음 곡", onclick: () => skipTrack(1) }, "⏭"),
  );
}

/** The musicPlayer card in the notification centre, while a song is loaded. */
function musicMiniPlayer() {
  const t = trackById(musicPlayer.trackId);
  if (!t) return null;
  return h(
    "div",
    { class: "uphone-mini-player" },
    coverArt(t, "is-small"),
    h("span", { class: "uphone-list-main" }, h("strong", null, t.title), h("small", null, t.artist)),
    playerControls(true),
  );
}

function renderMusic() {
  const t = trackById(musicPlayer.trackId);
  const pos = t ? musicPosition() : 0;
  const current = trackById(musicPlayer.trackId);
  const m = musicState();
  const nowPlaying = current
    ? h(
        "div",
        { class: "uphone-now-playing" },
        coverArt(current, "is-large"),
        h(
          "div",
          { class: "uphone-now-info" },
          h("strong", null, current.title),
          h("small", null, current.artist),
          h("div", { class: "uphone-progress" }, h("i", { "data-track": current.id, style: `width:${Math.min(100, (pos / current.dur) * 100)}%` })),
          h("div", { class: "uphone-progress-times" }, h("span", { class: "uphone-progress-now" }, formatSongTime(pos)), h("span", null, formatSongTime(current.dur))),
          h(
            "div",
            { class: "uphone-now-row" },
            playerControls(),
            h("button", { class: "uphone-plain uphone-like", type: "button", "aria-label": "좋아요", onclick: () => toggleLike(current) }, m.liked.includes(current.id) ? "♥" : "♡"),
          ),
        ),
      )
    : h("div", { class: "uphone-now-playing is-empty" }, h("span", null, "🎧"), h("small", null, "듣고 싶은 곡을 골라 보세요"));
  const list = tracksIn(musicFilter);
  return h(
    "div",
    { class: "uphone-app-view uphone-music" },
    appHeader("음악"),
    nowPlaying,
    h(
      "div",
      { class: "uphone-chips" },
      PLAYLISTS.map((pl) =>
        h(
          "button",
          {
            class: `uphone-chip ${musicFilter === pl.id ? "is-active" : ""}`,
            type: "button",
            onclick: () => {
              musicFilter = pl.id;
              render();
            },
          },
          pl.name,
        ),
      ),
    ),
    h(
      "div",
      { class: "uphone-list" },
      list.length === 0
        ? h("div", { class: "uphone-empty" }, musicFilter === "liked" ? "좋아요한 곡이 없어요." : "아직 들은 곡이 없어요.")
        : list.map((track) =>
            h(
              "button",
              { class: `uphone-list-row ${track.id === musicPlayer.trackId ? "is-current" : ""} ${track.ghost ? "is-ghost" : ""}`, type: "button", onclick: () => playTrack(track.id) },
              coverArt(track, "is-small"),
              h("span", { class: "uphone-list-main" }, h("strong", null, track.title), h("small", null, track.artist)),
              h("small", null, track.id === musicPlayer.trackId && musicPlayer.playing ? "♪" : formatSongTime(track.dur)),
            ),
          ),
    ),
  );
}
