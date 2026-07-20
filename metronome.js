/* AED 설명서 페이지 — CPR 박자기 (110 BPM) */
(function () {
  const metro = document.getElementById("metro");
  const btn = document.getElementById("metroBtn");
  if (!metro || !btn) return;

  let on = false, interval = null, audioCtx = null;

  btn.addEventListener("click", () => (on ? stop() : start()));

  function start() {
    on = true;
    metro.classList.add("playing");
    btn.textContent = "정지";
    try {
      audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
      interval = setInterval(() => {
        const o = audioCtx.createOscillator();
        const g = audioCtx.createGain();
        o.frequency.value = 880;
        g.gain.value = 0.12;
        o.connect(g);
        g.connect(audioCtx.destination);
        o.start();
        g.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + 0.09);
        o.stop(audioCtx.currentTime + 0.1);
      }, 60000 / 110);
    } catch (e) {
      /* 오디오 미지원: 시각 박자만 */
    }
  }
  function stop() {
    on = false;
    metro.classList.remove("playing");
    btn.textContent = "시작";
    clearInterval(interval);
  }
})();
