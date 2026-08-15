function formatTime(seconds) {
  if (!isFinite(seconds)) return "0:00";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60).toString().padStart(2, "0");
  return `${m}:${s}`;
}

document.querySelectorAll("[data-audio-player]").forEach((player) => {
  const audio = player.querySelector("audio");
  const toggle = player.querySelector(".audio-player-toggle");
  const seek = player.querySelector(".audio-player-seek");
  const time = player.querySelector(".audio-player-time");

  function updateTime() {
    time.textContent = `${formatTime(audio.currentTime)} / ${formatTime(audio.duration)}`;
    if (audio.duration) seek.value = (audio.currentTime / audio.duration) * 100;
  }

  toggle.addEventListener("click", () => {
    if (audio.paused) audio.play();
    else audio.pause();
  });

  audio.addEventListener("play", () => {
    toggle.classList.add("is-playing");
    toggle.setAttribute("aria-label", "Pause");
  });
  ["pause", "ended"].forEach((event) => {
    audio.addEventListener(event, () => {
      toggle.classList.remove("is-playing");
      toggle.setAttribute("aria-label", "Play");
    });
  });
  audio.addEventListener("timeupdate", updateTime);
  audio.addEventListener("loadedmetadata", updateTime);

  seek.addEventListener("input", () => {
    if (audio.duration) audio.currentTime = (seek.value / 100) * audio.duration;
  });
});
