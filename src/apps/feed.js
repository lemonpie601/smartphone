// ── 하루: a small social feed where the people in the contacts post their days ──
// cs.feed = { posts: [{ id, by, text, photo?, t, likes, liked, comments: [{ by, text, t }] }], notes: [...], refreshedAt }
// `by` is a contact id, "me", or one of the pages below. ui.sub: null (feed) | "new" | "post:<id>" | "profile:<by>"

const FEED = { name: "하루", icon: "🫧" };
const FEED_PAGES = {
  town: { name: "우리동네 소식", emoji: "📣" },
  cats: { name: "오늘의 고양이", emoji: "🐈" },
};
const MAX_POSTS = 60;

/** Posts already on a fresh phone, `ago` minutes before the feed was first opened. */
const SEED_POSTS = [
  { by: "jieun", ago: 35, text: "드디어 찾았다 인생 딸기케이크 🍓🍓 다음엔 같이 가자ㅋㅋ", photo: "하얀 접시 위 딸기 케이크 한 조각, 창가 햇빛", likes: 24 },
  { by: "cats", ago: 80, text: "오늘의 고양이: 상자에 들어간 치즈냥. 상자가 작아 보이는 건 기분 탓입니다.", photo: "작은 택배 상자에 꽉 낀 노란 고양이", likes: 312 },
  { by: "minsu", ago: 190, text: "심야 영화 보고 나왔는데 여운이 너무 길다… 이번 주 안에 한 번 더 볼 예정", likes: 9 },
  { by: "town", ago: 300, text: "[안내] 이번 주 토요일 해오름 공원에서 플리마켓이 열립니다. 오전 10시부터!", likes: 41 },
  { by: "mom", ago: 1440, text: "베란다 화분에 꽃이 폈어요 🌷 다들 보러 와요", photo: "베란다 화분에 핀 분홍 꽃", likes: 6 },
  { by: "senior", ago: 2880, text: "발표 끝. 다들 수고 많았습니다.", likes: 15 },
];

/** Stand-ins when no model is connected. */
const FALLBACK_POSTS = {
  mom: ["오늘 김장 준비했어요. 다들 밥 잘 챙겨 먹어요", "날이 추워졌네요. 감기 조심하세요 🧣"],
  dad: ["등산 다녀왔다.", "오늘 날씨 좋음."],
  jieun: ["오늘 머리 잘랐는데 어때?? 솔직하게 말해 줘ㅋㅋ", "퇴근길 붕어빵 발견 🐟 행복은 가까이에"],
  minsu: ["이번 주 개봉작 리뷰 올릴게요. 스포 없음!", "비 오는 날엔 역시 옛날 영화"],
  senior: ["주간 회의 자료 공유 완료.", "오랜만에 칼퇴."],
};
const FALLBACK_COMMENTS = ["ㅋㅋㅋ 좋다", "오 대박", "나도 가고 싶다!", "좋아요 누르고 감", "요즘 잘 지내?"];

function feedState() {
  const cs = chatState();
  if (!cs.feed) {
    const now = Date.now();
    cs.feed = {
      posts: SEED_POSTS.map((p, i) => ({ id: `s${i}`, by: p.by, text: p.text, photo: p.photo ? { desc: p.photo } : null, t: now - p.ago * 60_000, likes: p.likes, liked: false, comments: [] })),
      notes: [],
      refreshedAt: now,
    };
  }
  return cs.feed;
}

function feedAuthor(by) {
  if (by === "me") return { name: userName(), emoji: null, me: true };
  if (FEED_PAGES[by]) return { ...FEED_PAGES[by], page: true };
  if (by === "partner") {
    const p = partner();
    return p ? { name: p.name, avatar: p.avatar, ghost: true } : { name: "알 수 없음" };
  }
  return findContact(by) ?? { name: "알 수 없음" };
}

/** Likes and comments on the user's posts the user has not seen yet. */
function feedNotifications() {
  if (!ctx.chatId) return [];
  return feedState()
    .notes.filter((n) => !n.seen)
    .map((n) => ({ icon: FEED.icon, cls: "is-feed", title: FEED.name, text: n.text, t: n.t, open: () => go("feed", n.postId ? `post:${n.postId}` : null) }));
}

function feedAgo(t) {
  const minutes = Math.max(0, Math.round((Date.now() - t) / 60_000));
  if (minutes < 1) return "방금";
  if (minutes < 60) return `${minutes}분 전`;
  if (minutes < 1440) return `${Math.floor(minutes / 60)}시간 전`;
  return `${Math.floor(minutes / 1440)}일 전`;
}

function feedAvatar(by) {
  const a = feedAuthor(by);
  return avatar({ name: a.name, emoji: a.emoji, avatar: a.avatar }, "small");
}

function postCard(post, { full = false } = {}) {
  const author = feedAuthor(post.by);
  const p = partner();
  // Once the partner is inside the phone, it likes everything the user posts.
  const watcherLike = post.by === "me" && stageIndex() >= 2 && p;
  const like = () => {
    post.liked = !post.liked;
    post.likes += post.liked ? 1 : -1;
    save();
    if (post.liked && post.by !== "me") logActivity(`${FEED.name}에서 ${author.name}의 게시물에 좋아요를 눌렀다: "${snippet(post.text, 30)}"`);
    render();
  };
  const likers = watcherLike ? `♥ ${p.name}님 외 ${post.likes}명` : `♥ ${post.likes}`;
  return h(
    "article",
    { class: `uphone-post ${author.ghost ? "is-ghost" : ""}` },
    h(
      "button",
      {
        class: "uphone-post-head",
        type: "button",
        onclick: () => {
          if (post.by !== "me") logActivity(`${FEED.name}에서 ${author.name}의 프로필을 봤다`);
          go("feed", `profile:${post.by}`);
        },
      },
      feedAvatar(post.by),
      h("span", { class: "uphone-list-main" }, h("strong", null, author.name), h("small", null, feedAgo(post.t))),
    ),
    post.photo ? h("div", { class: "uphone-post-photo", style: `background:${photoTint(post.photo)}` }, h("span", null, post.photo.desc)) : null,
    h("p", { class: "uphone-post-text" }, post.text),
    h(
      "div",
      { class: "uphone-post-actions" },
      h("button", { class: `uphone-plain ${post.liked ? "is-liked" : ""}`, type: "button", "aria-label": "좋아요", onclick: like }, post.liked ? "♥" : "♡"),
      h("button", { class: "uphone-plain", type: "button", "aria-label": "댓글", onclick: () => go("feed", `post:${post.id}`) }, `💬 ${post.comments.length}`),
      h("small", { class: "uphone-post-likes" }, likers),
    ),
    full
      ? null
      : post.comments.length > 0
        ? h("button", { class: "uphone-post-more", type: "button", onclick: () => go("feed", `post:${post.id}`) }, `${feedAuthor(post.comments.at(-1).by).name}: ${snippet(post.comments.at(-1).text, 30)}`)
        : null,
  );
}

/** Someone in the contacts writes a new post, in their own voice. */
async function contactPosts() {
  const fs = feedState();
  const people = chatState().contacts.filter((c) => c.id !== "senior" || Math.random() < 0.3);
  const c = people[Math.floor(Math.random() * people.length)];
  if (!c) return;
  let text = null;
  if (connectionId() && !ui.busyKey) {
    const lines = await askModel({
      key: "feed",
      system: buildContactPrompt(c, "talk"),
      thread: [],
      speaker: c.name,
      cue: `(Write one short post you are uploading to your social media feed "${FEED.name}" right now: what you did or saw today. 1-2 sentences, casual, in Korean. Only the post text.)`,
    });
    text = lines.join(" ").trim() || null;
  }
  const pool = FALLBACK_POSTS[c.id] ?? ["오늘 하루도 끝!", "요즘 날씨 너무 좋다"];
  fs.posts.push({ id: `f${Date.now().toString(36)}`, by: c.id, text: snippet(text ?? pool[Math.floor(Math.random() * pool.length)], 200), photo: null, t: Date.now(), likes: Math.floor(Math.random() * 20), liked: false, comments: [] });
  trimList(fs.posts, MAX_POSTS);
  save();
}

/** After the user posts, a friend comes by. */
async function friendReacts(post) {
  const fs = feedState();
  const people = chatState().contacts;
  if (people.length === 0) return;
  const c = people[Math.floor(Math.random() * people.length)];
  await sleep(4000 + Math.random() * 6000);
  post.likes += 1 + Math.floor(Math.random() * 3);
  fs.notes.push({ t: Date.now(), postId: post.id, text: `${c.name}님 외 여러 명이 회원님의 게시물을 좋아해요` });
  let text = null;
  if (connectionId() && !ui.busyKey) {
    const lines = await askModel({
      key: "feed",
      system: buildContactPrompt(c, "talk"),
      thread: [],
      speaker: c.name,
      cue: `(${userName()} just posted this on the social media feed "${FEED.name}": "${post.text}"${post.photo ? ` with a photo: ${post.photo.desc}` : ""}. Write one short comment on it, in Korean. Only the comment text.)`,
    });
    text = lines.join(" ").trim() || null;
  }
  const comment = { by: c.id, text: snippet(text ?? FALLBACK_COMMENTS[Math.floor(Math.random() * FALLBACK_COMMENTS.length)], 120), t: Date.now() };
  post.comments.push(comment);
  fs.notes.push({ t: Date.now(), postId: post.id, text: `${c.name}님이 댓글을 남겼어요: ${comment.text}` });
  trimList(fs.notes, 30);
  save();
  logActivity(`${FEED.name}에 올린 글에 ${c.name}${josaOnly(c.name, "이", "가")} 댓글을 달았다: "${snippet(comment.text, 40)}"`);
  render();
}

function renderFeed() {
  const fs = feedState();
  const sub = ui.sub ?? "";
  if (sub === "new") return renderNewPost();
  if (sub.startsWith("post:")) return renderPostDetail(sub.slice(5));
  if (sub.startsWith("profile:")) return renderFeedProfile(sub.slice(8));
  if (fs.notes.some((n) => !n.seen)) {
    for (const n of fs.notes) n.seen = true;
    save();
  }
  const refresh = async () => {
    logActivity(`${FEED.name} 피드를 새로고침했다`);
    fs.refreshedAt = Date.now();
    showToast("새 게시물을 불러오는 중…");
    await contactPosts();
    if (ui.app === "feed") render();
  };
  // a new post now and then, as if the world kept going
  if (Date.now() - (fs.refreshedAt ?? 0) > 40 * 60_000) {
    fs.refreshedAt = Date.now();
    void contactPosts().then(() => ui.app === "feed" && !ui.sub && render());
  }
  const posts = [...fs.posts].sort((a, b) => b.t - a.t);
  return h(
    "div",
    { class: "uphone-app-view uphone-feed" },
    appHeader(
      h("span", { class: "uphone-feed-logo" }, FEED.name),
      h(
        "span",
        { class: "uphone-header-tools" },
        h("button", { class: "uphone-header-action is-small", type: "button", "aria-label": "새로고침", onclick: refresh }, "↻"),
        h("button", { class: "uphone-header-action is-small", type: "button", "aria-label": "글쓰기", onclick: () => go("feed", "new") }, "✎"),
      ),
    ),
    h("div", { class: "uphone-feed-list" }, posts.map((post) => postCard(post))),
  );
}

function renderPostDetail(id) {
  const fs = feedState();
  const post = fs.posts.find((p) => p.id === id);
  if (!post) return emptyApp(FEED.name, "게시물이 삭제되었어요.");
  for (const n of fs.notes) if (n.postId === id) n.seen = true;
  const author = feedAuthor(post.by);
  const input = h("input", { class: "uphone-field", placeholder: "댓글 달기…", "aria-label": "댓글" });
  const send = () => {
    const text = input.value.trim().slice(0, 120);
    if (!text) return;
    post.comments.push({ by: "me", text, t: Date.now() });
    save();
    logActivity(`${FEED.name}에서 ${author.name}의 게시물에 댓글을 달았다: "${snippet(text, 40)}"`);
    render();
  };
  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.isComposing) send();
  });
  const remove =
    post.by === "me"
      ? () =>
          confirmSheet("이 게시물을 삭제할까요?", "삭제", () => {
            fs.posts = fs.posts.filter((p) => p.id !== id);
            save();
            logActivity(`${FEED.name}에 올렸던 글을 지웠다: "${snippet(post.text, 30)}"`);
            go("feed");
          })
      : null;
  return h(
    "div",
    { class: "uphone-app-view uphone-feed" },
    appHeader("게시물", remove ? h("button", { class: "uphone-header-action is-small", type: "button", "aria-label": "삭제", onclick: remove }, "🗑") : null, () => go("feed")),
    h(
      "div",
      { class: "uphone-feed-list" },
      postCard(post, { full: true }),
      h(
        "div",
        { class: "uphone-comments" },
        post.comments.length === 0
          ? h("p", { class: "uphone-hint" }, "첫 댓글을 남겨 보세요.")
          : post.comments.map((c) => h("div", { class: "uphone-comment" }, feedAvatar(c.by), h("span", null, h("strong", null, feedAuthor(c.by).name), " ", c.text, h("small", null, ` ${feedAgo(c.t)}`)))),
      ),
    ),
    h("div", { class: "uphone-composer" }, input, h("button", { class: "uphone-send", type: "button", "aria-label": "댓글 달기", onclick: send }, "↑")),
  );
}

function renderFeedProfile(by) {
  const author = feedAuthor(by);
  const posts = feedState()
    .posts.filter((p) => p.by === by)
    .sort((a, b) => b.t - a.t);
  return h(
    "div",
    { class: "uphone-app-view uphone-feed" },
    appHeader(author.name, null, () => go("feed")),
    h(
      "div",
      { class: "uphone-feed-list" },
      h(
        "div",
        { class: "uphone-detail" },
        by === "me" ? h("div", { class: "uphone-avatar large" }, userName().charAt(0)) : avatar({ name: author.name, emoji: author.emoji, avatar: author.avatar }, "large"),
        h("strong", { class: "uphone-detail-name" }, author.name),
        h("span", { class: "uphone-detail-sub" }, `게시물 ${posts.length} · 친구 ${chatState().contacts.length}`),
      ),
      posts.length === 0 ? h("div", { class: "uphone-empty" }, "아직 게시물이 없어요.") : posts.map((post) => postCard(post)),
    ),
  );
}

function renderNewPost() {
  const text = h("textarea", { class: "uphone-field", rows: "5", placeholder: "오늘 하루는 어땠나요?", "aria-label": "글 내용" });
  let photo = null;
  const preview = h("div", { class: "uphone-post-attach" });
  const drawPreview = () => {
    preview.replaceChildren(
      photo
        ? h("div", { class: "uphone-post-photo is-small", style: `background:${photoTint(photo)}` }, h("span", null, photo.desc))
        : h("button", { class: "uphone-secondary", type: "button", onclick: () => photoPicker(view, (picked) => ((photo = picked), drawPreview())) }, "🖼️ 사진 추가"),
    );
  };
  drawPreview();
  const publish = () => {
    const body = text.value.trim().slice(0, 300);
    if (!body && !photo) return showToast("내용을 입력해 주세요.");
    const fs = feedState();
    const post = { id: `m${Date.now().toString(36)}`, by: "me", text: body, photo: photo ? { desc: photo.desc, unknown: !!photo.unknown } : null, t: Date.now(), likes: 0, liked: false, comments: [] };
    fs.posts.push(post);
    trimList(fs.posts, MAX_POSTS);
    save();
    logActivity(`${FEED.name}에 글을 올렸다: "${snippet(body || photo.desc, 50)}"${photo ? " (사진 포함)" : ""}`);
    go("feed");
    void friendReacts(post);
  };
  marinara.setTimeout(() => text.focus(), 0);
  const view = h(
    "div",
    { class: "uphone-app-view uphone-feed" },
    appHeader("새 게시물", h("button", { class: "uphone-header-action is-text", type: "button", onclick: publish }, "올리기"), () => go("feed")),
    h("div", { class: "uphone-form" }, h("div", { class: "uphone-post-head" }, h("div", { class: "uphone-avatar small" }, userName().charAt(0)), h("strong", null, userName())), text, preview),
  );
  return view;
}
