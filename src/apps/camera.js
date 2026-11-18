// ── 카메라 and 갤러리: photos are described in words ──

/** Photos nobody remembers taking. They appear once the partner is inside the phone (stage 3+). */
function ghostPhotos() {
  const name = userName();
  return [
    `어두운 방. 이불을 덮고 잠든 ${name}. 머리맡 높이에서 살짝 올려다본 각도.`,
    "현관문. 안쪽에서, 잠금장치를 가까이 찍었다.",
    `폰 화면을 내려다보는 ${name}의 얼굴. 전면 카메라로 찍혔다.`,
  ];
}

function photos() {
  const cs = chatState();
  if (stageIndex() >= 2 && !cs.ghostPhotos) {
    cs.ghostPhotos = true;
    const night = new Date();
    night.setHours(3, 12, 0, 0);
    ghostPhotos().forEach((desc, i) => cs.photos.push({ id: `g${i}${Date.now().toString(36)}`, t: night.getTime() + i * 47_000, desc, unknown: true }));
    cs.photos.sort((a, b) => a.t - b.t);
    save();
  }
  return cs.photos;
}

/** A stable tint per photo, so the gallery reads as different pictures. */
function photoTint(photo) {
  let hash = 0;
  for (const ch of photo.desc) hash = (hash * 31 + ch.codePointAt(0)) | 0;
  const hue = Math.abs(hash) % 360;
  return photo.unknown
    ? "linear-gradient(160deg, #1b1b22, #050507)"
    : `linear-gradient(160deg, hsl(${hue} 45% 42%), hsl(${(hue + 50) % 360} 40% 22%))`;
}

function renderCamera() {
  const input = h("input", { class: "uphone-camera-input", placeholder: "무엇을 찍을까요? (예: 카페 창가의 라떼)", "aria-label": "찍을 장면" });
  const flash = h("div", { class: "uphone-flash" });
  const last = photos().filter((p) => !p.unknown).at(-1);
  const thumb = h(
    "button",
    { class: "uphone-camera-thumb", type: "button", "aria-label": "갤러리", onclick: () => go("gallery") },
    last ? h("span", { style: `background:${photoTint(last)}` }) : null,
  );
  const shoot = () => {
    const desc = input.value.trim();
    if (!desc) return showToast("찍을 장면을 적어 주세요.");
    const cs = chatState();
    cs.photos.push({ id: `p${Date.now().toString(36)}`, t: Date.now(), desc: desc.slice(0, 200) });
    trimList(cs.photos, MAX_PHOTOS);
    save();
    logActivity(`사진을 찍었다: "${snippet(desc)}"`);
    input.value = "";
    flash.classList.remove("is-on");
    void flash.offsetWidth; // restart the animation
    flash.classList.add("is-on");
    thumb.replaceChildren(h("span", { style: `background:${photoTint(cs.photos.at(-1))}` }));
  };
  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.isComposing) shoot();
  });
  marinara.setTimeout(() => input.focus(), 0);
  return h(
    "div",
    { class: "uphone-camera" },
    appHeader("카메라"),
    h("div", { class: "uphone-viewfinder" }, h("div", { class: "uphone-grid-lines" }), stageIndex() >= 2 ? h("span", { class: "uphone-rec" }, "● REC") : null, flash),
    input,
    h("div", { class: "uphone-camera-bar" }, thumb, h("button", { class: "uphone-shutter", type: "button", "aria-label": "촬영", onclick: shoot }), h("span")),
  );
}

function renderGallery() {
  const list = photos();
  const open = ui.sub ? list.find((p) => p.id === ui.sub) : null;
  if (open) {
    return h(
      "div",
      { class: "uphone-app-view" },
      appHeader(formatDay(open.t), null, () => go("gallery")),
      h("div", { class: "uphone-photo-full", style: `background:${photoTint(open)}` }, h("p", null, open.desc)),
      h(
        "div",
        { class: "uphone-photo-meta" },
        h("span", null, `${new Date(open.t).toLocaleString()} · 촬영: ${open.unknown ? "알 수 없음" : "나"}`),
        h(
          "button",
          {
            class: "uphone-plain",
            type: "button",
            onclick: () => {
              const cs = chatState();
              cs.photos = cs.photos.filter((p) => p.id !== open.id);
              save();
              logActivity(open.unknown ? "찍은 기억이 없는 사진을 지웠다" : `사진을 지웠다: "${snippet(open.desc)}"`);
              go("gallery");
            },
          },
          "삭제",
        ),
      ),
    );
  }
  return h(
    "div",
    { class: "uphone-app-view" },
    appHeader("갤러리"),
    list.length === 0
      ? h("div", { class: "uphone-empty" }, "사진이 없어요. 카메라로 찍어 보세요.")
      : h(
          "div",
          { class: "uphone-gallery" },
          [...list].reverse().map((photo) =>
            h("button", { class: "uphone-tile", type: "button", style: `background:${photoTint(photo)}`, onclick: () => go("gallery", photo.id) }, h("span", null, photo.desc)),
          ),
        ),
  );
}
