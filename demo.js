/* =========================================================
   당신의 친절한 이웃 — 시연 시나리오 로직 (드론 출발 위치 및 경로 정밀 보정판)
   ========================================================= */

const $ = (id) => document.getElementById(id);

let toastTimer;
function toast(msg, ms = 3000) {
  const t = $("toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("show"), ms);
}

function easeInOut(t) { return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2; }
function fmtMin(sec) {
  const m = Math.floor(sec / 60); const s = Math.round(sec % 60);
  return m > 0 ? `${m}분 ${s}초` : `${s}초`;
}

/* ---------- 0) Leaflet 지도 초기화 (원주시 신림면 성남2리) ---------- */
const map = L.map('realMap', { zoomControl: false, attributionControl: false }).setView([37.2510, 128.0930], 15);
L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png').addTo(map);

// 지도에 거리 척도(Scale) 추가
L.control.scale({ imperial: false, position: 'bottomleft' }).addTo(map);

// 실제 좌표 설정
const coordHall = [37.2555, 128.0905]; 
const coordPatient = [37.2485, 128.0970]; 
const coordMeStart = [37.2435, 128.0890]; 
const coordOthers = [[37.2480, 128.0850], [37.2540, 128.0990], [37.2430, 128.0980]]; 

function createDivIcon(html, className, iconSize, anchor) {
  return L.divIcon({ html, className, iconSize, iconAnchor: anchor });
}

// 1. 환자 댁 마커
const iconPatient = createDivIcon(
  '<div class="l-patient-dot"></div><div class="l-pulse-ring"></div><div id="callWaveContainer"></div><span class="l-marker-label bottom" style="color:#A82419;">배칠수 어르신 댁</span>',
  'l-marker', [24, 24], [12, 12]
);
L.marker(coordPatient, { icon: iconPatient }).addTo(map);

const iconHall = createDivIcon(
  '<div class="l-hall-dot"></div><span class="l-marker-label bottom" style="color:#37547E;">마을회관 (스테이션)</span>',
  'l-marker', [28, 28], [14, 14]
);
L.marker(coordHall, { icon: iconHall }).addTo(map);

const othersMarkers = coordOthers.map((coord, idx) => {
  const icon = createDivIcon(
    `<div class="l-other-dot"></div><span class="l-marker-label bottom" style="color:#5C6B62; font-weight:700; font-size:11.5px; margin-top:3px;">대기 이웃 ${idx + 1}</span>`, 
    'l-marker', [18, 18], [9, 9]
  );
  return L.marker(coord, { icon }).addTo(map);
});

// 내 위치 마커
const iconMe = createDivIcon(
  '<div class="l-me-dot"></div><span class="l-marker-label top" style="color:#1F4A38;">나 (구조대원)</span>',
  'l-marker', [24, 24], [12, 12]
);
let markerMe = L.marker(coordMeStart, { icon: iconMe, zIndexOffset: 500 }).addTo(map);

// viewBox를 실제 콘텐츠 범위(-30~30)에 맞춰 원점 대칭 정사각으로 잡고,
// width/height/iconSize/anchor를 모두 1:1 비율로 통일 → 그림의 시각적 중심이 마커 좌표에 정확히 일치
const iconDrone = createDivIcon(
  `<div class="l-drone-wrap" id="droneIcon" style="opacity:0;">
    <svg viewBox="-30 -30 60 60" width="50" height="50">
      <rect x="-12" y="-5" width="24" height="10" rx="4" fill="#2E6FB4"/>
      <path d="M-12-3l-11-8M12-3l11-8M-12 3l-11 8M12 3l11 8" stroke="#2E6FB4" stroke-width="3" stroke-linecap="round"/>
      <circle cx="-23" cy="-11" r="5" fill="#8FB3D9"/><circle cx="23" cy="-11" r="5" fill="#8FB3D9"/>
      <circle cx="-23" cy="11" r="5" fill="#8FB3D9"/><circle cx="23" cy="11" r="5" fill="#8FB3D9"/>
      <rect x="-6" y="6" width="12" height="10" rx="2" fill="#D63B2F"/>
    </svg>
  </div>`,
  'l-marker', [50, 50], [25, 25]
);
let markerDrone = L.marker(coordHall, { icon: iconDrone, zIndexOffset: 1000 }).addTo(map);

let markerAED = null; 
let routeDrone = L.polyline([], { color: '#2E6FB4', dashArray: '6 6', weight: 3 }).addTo(map);
let routeMe = L.polyline([coordMeStart, coordPatient], { color: '#1F4A38', dashArray: '4 6', weight: 3, opacity: 0 }).addTo(map);

/* ---------- 1) 시나리오 시작 분기 ---------- */
let currentScenario = 'emergency';
let acceptTimer, countLeft;

$("startEmergencyBtn").addEventListener("click", () => startScenario('emergency'));
$("startCheckinBtn").addEventListener("click", () => startScenario('checkin'));

function startScenario(type) {
  currentScenario = type;
  
  const waveHtml = '<div class="l-call-wave" style="animation-delay: 0s;"></div><div class="l-call-wave" style="animation-delay: 1s;"></div>';
  const callContainer = document.getElementById('callWaveContainer');
  if (callContainer) callContainer.innerHTML = waveHtml;
  document.getElementById('mapFrame').classList.add('is-calling');
  
  if (type === 'emergency') {
    $("pushTitle").textContent = "긴급: 심정지 의심 환자 발생";
    $("pushDesc").textContent = "반경 2km 구조대원 동시 호출 중 — 클릭해서 수락하세요.";
    toast("센서: 심박 신호 소실 감지 → 119 자동 신고 및 이웃 호출");
    $("s119Badge").textContent = "119 신고 접수";
  } else {
    $("pushTitle").textContent = "알림: 장시간 무동작 감지 (안부확인)";
    $("pushDesc").textContent = "12시간 이상 움직임이 없습니다. 가장 가까운 이웃의 확인이 필요합니다.";
    toast("센서: 장시간 무동작 감지 → 이웃 안부 확인 요청");
    $("s119Badge").textContent = "119 대기 (미신고)";
  }
  
  $("push").classList.add("show");
  setTimeout(openAlert, 3200);
}

$("push").addEventListener("click", openAlert);

function openAlert() {
  const push = $("push");
  if (!push.classList.contains("show")) return;
  push.classList.remove("show");

  $("idleBlock").hidden = true;
  $("alertBlock").hidden = false;

  if (currentScenario === 'emergency') {
    $("alertBlock").classList.add("alert-block");
    $("alertTitle").textContent = "심정지 의심 환자 발생";
    $("alertReason").innerHTML = "감지: 레이더 센서 — <b>심박 신호 소실 · 무동작</b>";
    $("alertReport").style.display = "list-item";
    $("alertAction").style.display = "list-item";
    $("acceptBtn").textContent = "출동합니다";
    $("declineBtn").textContent = "지금은 갈 수 없어요";
  } else {
    $("alertBlock").classList.remove("alert-block");
    $("alertTitle").textContent = "안부 확인 요청 (장시간 무동작)";
    $("alertReason").innerHTML = "감지: 레이더 센서 — <b>12시간 이상 움직임 없음</b> (오탐/외출 가능성)";
    $("alertReport").style.display = "none";
    $("alertAction").style.display = "none";
    $("acceptBtn").textContent = "제가 가서 확인해 볼게요";
    $("declineBtn").textContent = "지금은 바빠서 안 돼요";
  }

  countLeft = 20;
  $("acceptCount").textContent = countLeft;
  clearInterval(acceptTimer);
  acceptTimer = setInterval(() => {
    countLeft--;
    if (countLeft < 0) { countLeft = 20; toast("다음 대원에게 재요청되었습니다 (시연: 반복)"); }
    $("acceptCount").textContent = countLeft;
  }, 1000);
}

/* ---------- 2) 출동 수락 ---------- */
$("declineBtn").addEventListener("click", () => {
  clearInterval(acceptTimer);
  document.getElementById('mapFrame').classList.remove('is-calling');
  if (document.getElementById('callWaveContainer')) document.getElementById('callWaveContainer').innerHTML = '';
  toast("알겠습니다. 반경 내 다음 대원에게 요청합니다.");
  $("alertBlock").hidden = true;
  $("idleBlock").hidden = false;
});

$("acceptBtn").addEventListener("click", () => {
  clearInterval(acceptTimer);
  $("alertBlock").hidden = true;
  $("tlBlock").hidden = false;
  
  document.getElementById('mapFrame').classList.remove('is-calling');
  if (document.getElementById('callWaveContainer')) document.getElementById('callWaveContainer').innerHTML = '';
  othersMarkers.forEach(m => m.getElement().querySelector('.l-other-dot').classList.add('dim'));

  if (currentScenario === 'emergency') {
    $("s119Badge").textContent = "119 출동 중";
    toast("출동 수락 완료 · 119 상황실에 공유되었습니다");
    
    $("tlDrone").style.display = "flex";
    $("tlDrop").style.display = "flex";
    $("tlAutoReport").style.display = "flex";
    $("tlTxt1").innerHTML = "응급안전안심서비스 이상 감지<small>레이더 센서 · 심박 신호 소실</small>";
    $("tlMeDot").textContent = "5";
    
    $("etaDroneBox").style.display = "block";
    $("arriveBtn").style.display = "block";
    $("safeBtn").style.display = "none";
    
    runDispatchSim(true);
  } else {
    $("s119Badge").textContent = "이웃 출동 중";
    toast("안부 확인 출동 수락 완료");
    
    $("tlDrone").style.display = "none";
    $("tlDrop").style.display = "none";
    $("tlAutoReport").style.display = "none";
    $("tlTxt1").innerHTML = "장시간 무동작 감지<small>레이더 센서 · 12시간 이상 움직임 없음</small>";
    $("tlTitle").textContent = "안전 확인 차 현장 출동 중";
    $("tlMe").classList.add("now");
    $("tlMeDot").textContent = "2";
    
    $("etaDroneBox").style.display = "none";
    $("arriveBtn").style.display = "none";
    $("safeBtn").style.display = "block";
    
    runDispatchSim(false);
  }
});

/* ---------- 3) 지도 시뮬레이션 ---------- */
let simRunning = false;
const DRONE_REAL_SEC = 45, ME_REAL_SEC = 240, DRONE_DEMO_MS = 8000, ME_DEMO_MS = 15000; 

function getBezier(t, p0, p1, p2) {
  const lat = (1-t)*(1-t)*p0[0] + 2*(1-t)*t*p1[0] + t*t*p2[0];
  const lng = (1-t)*(1-t)*p0[1] + 2*(1-t)*t*p1[1] + t*t*p2[1];
  return [lat, lng];
}

// 🚀 제어점(CoordDroneCtrl)을 경로 선상에 가깝게 조정하여 첫 출발 시 꺾임 현상 및 30m 왜곡 방지
const coordDroneCtrl = [37.2520, 128.0935]; 

function runDispatchSim(useDrone) {
  if (simRunning) return;
  simRunning = true;

  routeMe.setStyle({ opacity: 0.8 });
  
  if (useDrone) {
    $("eta119Box").style.display = "block";
    $("eta119").innerHTML = "<span style='font-size:1.05rem;'>17분 (예상)</span>"; 
    
    const curvePoints = [];
    for(let i=0; i<=100; i++) {
      curvePoints.push(getBezier(i/100, coordHall, coordDroneCtrl, coordPatient));
    }
    routeDrone.setLatLngs(curvePoints);
    routeDrone.setStyle({ opacity: 0.8 });
    
    // 🚀 드론 시작 위치를 마을회관 좌표에 완벽하게 고정
    markerDrone.setLatLng(coordHall);
    document.getElementById('droneIcon').style.opacity = '1';
    $("droneBadge").textContent = "드론 비행 중";
  } else {
    $("eta119Box").style.display = "none"; 
    $("droneBadge").textContent = "출동 안 함 (안부 확인)";
  }

  let startTime = null; 
  let dropped = false;

  function frame(now) {
    if (!startTime) startTime = now; 
    const el = now - startTime;

    // 드론 이동 로직
    if (useDrone) {
      const dp = Math.min(el / DRONE_DEMO_MS, 1);
      const easeDp = easeInOut(dp);
      
      const dronePos = dp >= 1 ? coordPatient : getBezier(easeDp, coordHall, coordDroneCtrl, coordPatient);
      markerDrone.setLatLng(dronePos);
      
      $("etaDrone").textContent = dp < 1 ? Math.ceil(DRONE_REAL_SEC * (1 - dp)) + "초" : "도착";

      if (dp >= 1 && !dropped) {
        dropped = true;
        document.getElementById('droneIcon').style.opacity = '0';
        
        const iconAED = createDivIcon('<div class="l-aed-box">AED</div>', 'l-marker', [24, 16], [12, 8]);
        markerAED = L.marker(coordPatient, { icon: iconAED, zIndexOffset: 600 }).addTo(map);
        
        $("droneBadge").textContent = "AED 투하 완료";
        stepTimeline("tlDrone", "tlDrop");
        toast("드론이 어르신 댁 대문 앞에 AED를 내려놓았습니다");
      }
    }

    // 구조대원 이동 로직
    const mp = Math.min(el / ME_DEMO_MS, 1);
    const mLat = coordMeStart[0] + (coordPatient[0] - coordMeStart[0]) * mp;
    const mLng = coordMeStart[1] + (coordPatient[1] - coordMeStart[1]) * mp;
    
    markerMe.setLatLng(mp >= 1 ? coordPatient : [mLat, mLng]);
    $("etaMe").textContent = mp < 1 ? fmtMin(ME_REAL_SEC * (1 - mp)) : "도착";

    // 도착 완료 처리
    if (mp >= 1) {
      if (useDrone) stepTimeline("tlDrop", "tlMe");
      $("tlMe").classList.replace("now", "done");
      $("tlMe").querySelector(".tl-dot").textContent = "✓";
      
      if (useDrone) {
        $("arriveBtn").disabled = false;
        toast("어르신 댁 도착! AED 안내를 시작하세요", 4500);
      } else {
        $("safeBtn").disabled = false;
        toast("어르신 댁 도착! 안전을 확인하세요", 4500);
      }
      simRunning = false; return;
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}

function stepTimeline(doneId, nowId) {
  const d = $(doneId);
  if (d) { d.classList.replace("now", "done"); d.querySelector(".tl-dot").textContent = "✓"; }
  const n = $(nowId);
  if (n) n.classList.add("now");
}

/* ---------- 4) 상황 종료 및 통계 화면 ---------- */
$("safeBtn").addEventListener("click", () => {
  $("tlBlock").hidden = true;
  $("doneBlock").hidden = false;
  $("doneBlock").classList.replace("done-block", "alert-block");
  $("doneBlock").style.background = "#2E6FB4";
  
  $("s119Badge").textContent = "상황 종료";
  $("doneTitle").innerHTML = "어르신이 안전합니다.<br>이웃의 관심이 사고를 예방했습니다.";
  $("doneDesc").textContent = "센서 오탐으로 확인되어 119 상황실에 종결 처리되었습니다.";
  $("doneStats").style.display = "none";
  $("viewStatsBtn").style.display = "none"; 
  toast("상황이 안전하게 종료되었습니다.");
});

$("viewStatsBtn").addEventListener("click", () => {
  $("doneBlock").hidden = true;
  $("statsBlock").hidden = false;
});

/* ---------- 5) AED 단계 가이드 모달 & TTS 음성 안내 ---------- */
let gIdx = 0;
const gsteps = document.querySelectorAll("#guideBody .gstep");

function speakStep() {
  if (!window.speechSynthesis) return;
  window.speechSynthesis.cancel();
  const currentStep = document.querySelector(".gstep.on");
  if (!currentStep) return;
  const textToSpeak = currentStep.querySelector("h4").innerText;
  const utterance = new SpeechSynthesisUtterance(textToSpeak);
  utterance.lang = 'ko-KR'; utterance.rate = 1.05;
  window.speechSynthesis.speak(utterance);
}

$("arriveBtn").addEventListener("click", () => {
  gIdx = 0; renderGuide(); $("guideModal").hidden = false;
});

function renderGuide() {
  gsteps.forEach((s, i) => s.classList.toggle("on", i === gIdx));
  $("gCounter").textContent = `${gIdx + 1} / ${gsteps.length}`;
  $("gPrev").style.visibility = gIdx === 0 ? "hidden" : "visible";
  $("gNext").textContent = gIdx === gsteps.length - 1 ? "구급대 도착 · 인계 완료" : "다음 단계";
  setTimeout(speakStep, 300);
}

$("gPrev").addEventListener("click", () => { gIdx = Math.max(0, gIdx - 1); renderGuide(); });
$("gNext").addEventListener("click", () => {
  if (gIdx === gsteps.length - 1) {
    if (window.speechSynthesis) window.speechSynthesis.cancel();
    stopMetro();
    $("guideModal").hidden = true;
    $("tlBlock").hidden = true;
    $("doneBlock").hidden = false;
    $("doneBlock").style.background = "";
    $("viewStatsBtn").style.display = "block";
    
    $("s119Badge").textContent = "이송 완료";
    $("doneTitle").innerHTML = "구급대 인계 완료.<br>당신이 이웃을 살렸습니다.";
    $("doneDesc").textContent = "배칠수 어르신은 원주기독병원 권역응급센터로 이송되었습니다.";
    $("doneStats").style.display = "flex";
    toast("구급대 인계 완료 · 병원 이송");
    return;
  }
  gIdx++; renderGuide();
});

/* ---------- 6) CPR 박자기 ---------- */
let metroOn = false, metroInt = null, audioCtx = null;
$("metroBtn").addEventListener("click", () => (metroOn ? stopMetro() : startMetro()));
function startMetro() {
  metroOn = true; $("metro").classList.add("playing"); $("metroBtn").textContent = "정지";
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    metroInt = setInterval(() => {
      const o = audioCtx.createOscillator(); const g = audioCtx.createGain();
      o.frequency.value = 880; g.gain.value = 0.12;
      o.connect(g); g.connect(audioCtx.destination); o.start();
      g.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + 0.09);
      o.stop(audioCtx.currentTime + 0.1);
    }, 60000 / 110);
  } catch (e) {}
}
function stopMetro() { metroOn = false; $("metro").classList.remove("playing"); $("metroBtn").textContent = "시작"; clearInterval(metroInt); }

/* ---------- 7) 초기화 ---------- */
function resetScenario() {
  if (window.speechSynthesis) window.speechSynthesis.cancel();
  if (document.getElementById('callWaveContainer')) document.getElementById('callWaveContainer').innerHTML = '';
  document.getElementById('mapFrame').classList.remove('is-calling');
  othersMarkers.forEach(m => m.getElement().querySelector('.l-other-dot').classList.remove('dim'));

  $("statsBlock").hidden = true;
  $("doneBlock").hidden = true;
  $("tlBlock").hidden = true;
  $("alertBlock").hidden = true;
  $("idleBlock").hidden = false;
  
  markerMe.setLatLng(coordMeStart);
  markerDrone.setLatLng(coordHall);
  if (document.getElementById('droneIcon')) document.getElementById('droneIcon').style.opacity = '0';
  if (markerAED) { map.removeLayer(markerAED); markerAED = null; }
  
  routeDrone.setLatLngs([]); routeDrone.setStyle({ opacity: 0 });
  routeMe.setStyle({ opacity: 0 });
  map.setView([37.2510, 128.0930], 15);
  
  $("etaDrone").textContent = "—"; 
  $("etaMe").textContent = "—";
  
  $("eta119Box").style.display = "block";
  $("eta119").textContent = "—"; 
  
  $("droneBadge").textContent = "드론 대기 중"; $("s119Badge").textContent = "119 대기";
  $("arriveBtn").disabled = true; $("safeBtn").disabled = true;
  
  ["tlDrone", "tlDrop", "tlMe"].forEach(id => {
    const el = $(id); if(el) el.classList.remove("done", "now");
  });
  $("tlDrone").classList.add("now");
  $("tlMe").classList.remove("now");
  
  simRunning = false; stopMetro();
}

$("resetBtn1").addEventListener("click", resetScenario);
$("resetBtn2").addEventListener("click", resetScenario);
