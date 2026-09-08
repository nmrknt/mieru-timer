(() => {
  'use strict';

  const TOTAL_SECONDS = 60 * 60;
  const TOTAL_MS = TOTAL_SECONDS * 1000;
  const TIMER_STORAGE_KEY = 'mieruTimerState';
  const TIMER_STORAGE_VERSION = 1;
  const PUBLIC_URL = 'https://nmrknt.github.io/mieru-timer/';
  const VALID_STATES = new Set(['idle', 'running', 'paused', 'finished']);
  const dial = document.querySelector('#dial');
  const sector = document.querySelector('#redSector');
  const redTip = document.querySelector('#redTip');
  const zeroLine = document.querySelector('#zeroLine');
  const ticks = document.querySelector('#ticks');
  const numbers = document.querySelector('#numbers');
  const timeText = document.querySelector('#timeText');
  const stateText = document.querySelector('#stateText');
  const minutesText = document.querySelector('#minutesText');
  const minus = document.querySelector('#minus');
  const plus = document.querySelector('#plus');
  const startPause = document.querySelector('#startPause');
  const reset = document.querySelector('#reset');
  const alarmRepeat = document.querySelector('#alarmRepeat');
  const previewAlarm = document.querySelector('#previewAlarm');
  const pwaGuide = document.querySelector('#pwaGuide');
  const shareTools = document.querySelector('#shareTools');
  const shareButton = document.querySelector('#shareButton');
  const shareFeedback = document.querySelector('#shareFeedback');

  let selectedMinutes = 0;
  let remainingMs = selectedMinutes * 60_000;
  let running = false;
  let timerState = 'idle';
  let endAt = 0;
  let endAtEpochMs = 0;
  let frame = 0;
  let audioContext = null;
  let audioKeepAlive = null;
  let wakeLock = null;
  let dragging = false;
  let hasStarted = false;
  let previewTimeout = 0;
  let shareFeedbackTimeout = 0;

  const point = (angle, radius) => {
    const radians = (angle - 90) * Math.PI / 180;
    return { x: 200 + radius * Math.cos(radians), y: 200 + radius * Math.sin(radians) };
  };

  function drawFace() {
    for (let minute = 0; minute < 60; minute++) {
      const major = minute % 5 === 0;
      const outer = point(minute * 6, 116);
      const inner = point(minute * 6, major ? 87 : 100);
      const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      line.setAttribute('x1', inner.x); line.setAttribute('y1', inner.y);
      line.setAttribute('x2', outer.x); line.setAttribute('y2', outer.y);
      line.setAttribute('class', `tick ${major ? 'major' : 'minor'}`);
      ticks.append(line);
    }

    for (let minute = 0; minute < 60; minute += 5) {
      const p = point(minute * 6, 143);
      const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      text.setAttribute('x', p.x); text.setAttribute('y', p.y);
      text.setAttribute('class', `number ${minute === 0 ? 'zero' : ''}`);
      text.textContent = minute;
      numbers.append(text);
    }
  }

  function sectorPath(seconds) {
    if (seconds <= 0) return '';
    if (seconds >= TOTAL_SECONDS - .001) {
      return 'M 200 200 L 200 84 A 116 116 0 1 1 199.99 84 Z';
    }
    const angle = (seconds / TOTAL_SECONDS) * 360;
    const end = point(angle, 116);
    return `M 200 200 L 200 84 A 116 116 0 ${angle > 180 ? 1 : 0} 1 ${end.x} ${end.y} Z`;
  }

  function saveTimerState() {
    const now = Date.now();
    const savedRemainingMs = running ? Math.max(0, endAt - performance.now()) : remainingMs;
    if (running) endAtEpochMs = now + savedRemainingMs;
    const data = {
      version: TIMER_STORAGE_VERSION,
      state: timerState,
      selectedMinutes,
      remainingMs: savedRemainingMs,
      endAtEpochMs: running ? endAtEpochMs : null,
      savedAtEpochMs: now
    };
    try { localStorage.setItem(TIMER_STORAGE_KEY, JSON.stringify(data)); } catch (_) {}
  }

  function readSavedTimerState() {
    try {
      const data = JSON.parse(localStorage.getItem(TIMER_STORAGE_KEY));
      if (!data || data.version !== TIMER_STORAGE_VERSION || !VALID_STATES.has(data.state)) return null;
      if (!Number.isInteger(data.selectedMinutes) || data.selectedMinutes < 0 || data.selectedMinutes > 60) return null;
      if (!Number.isFinite(data.remainingMs) || data.remainingMs < 0 || data.remainingMs > TOTAL_MS) return null;
      if (!Number.isFinite(data.savedAtEpochMs) || data.savedAtEpochMs <= 0 || data.savedAtEpochMs > Date.now() + 300_000) return null;
      if (data.state === 'idle' && data.remainingMs !== data.selectedMinutes * 60_000) return null;
      if ((data.state === 'running' || data.state === 'paused' || data.state === 'finished') && data.selectedMinutes === 0) return null;
      if (data.state === 'paused' && data.remainingMs <= 0) return null;
      if (data.state === 'finished' && data.remainingMs !== 0) return null;
      if (data.state === 'running') {
        if (!Number.isFinite(data.endAtEpochMs) || data.endAtEpochMs <= 0) return null;
        if (data.endAtEpochMs < data.savedAtEpochMs) return null;
        if (data.endAtEpochMs - data.savedAtEpochMs > TOTAL_MS + 1000) return null;
      }
      return data;
    } catch (_) {
      return null;
    }
  }

  function render() {
    const seconds = Math.max(0, remainingMs / 1000);
    sector.setAttribute('d', sectorPath(seconds));
    const tip = point((seconds / TOTAL_SECONDS) * 360, 116);
    redTip.setAttribute('cx', tip.x);
    redTip.setAttribute('cy', tip.y);
    redTip.style.visibility = 'visible';
    zeroLine.style.visibility = seconds <= 0 ? 'visible' : 'hidden';
    const displaySeconds = Math.ceil(seconds);
    const mins = Math.floor(displaySeconds / 60);
    const secs = displaySeconds % 60;
    timeText.textContent = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
    minutesText.textContent = `${Math.ceil(seconds / 60)}分`;
    dial.setAttribute('aria-valuenow', selectedMinutes);
    dial.setAttribute('aria-valuetext', `${selectedMinutes}分`);
    minus.disabled = remainingMs <= 0;
    plus.disabled = remainingMs >= TOTAL_SECONDS * 1000;
    startPause.textContent = running ? '一時停止' : (timerState === 'paused' ? '再開' : 'スタート');
    startPause.classList.toggle('running', running);
    startPause.disabled = selectedMinutes === 0;
    stateText.textContent = running ? '残り時間' : (timerState === 'paused' ? '一時停止' : (timerState === 'finished' ? 'おしまい' : `${selectedMinutes}分`));
  }

  function setMinutes(value) {
    if (running) return;
    hasStarted = false;
    timerState = 'idle';
    selectedMinutes = Math.min(60, Math.max(0, Math.round(value)));
    remainingMs = selectedMinutes * 60_000;
    render();
    saveTimerState();
  }

  function finishTimer({ notify = true } = {}) {
    running = false;
    timerState = 'finished';
    remainingMs = 0;
    endAt = 0;
    endAtEpochMs = 0;
    cancelAnimationFrame(frame);
    stopAudioKeepAlive();
    releaseWakeLock();
    render();
    saveTimerState();
    if (notify) playAlarm({ vibrate: true });
  }

  function adjustMinutes(delta) {
    const currentMs = running ? Math.max(0, endAt - performance.now()) : remainingMs;
    const adjustedMs = Math.min(TOTAL_SECONDS * 1000, Math.max(0, currentMs + delta * 60_000));

    if (adjustedMs <= 0) {
      if (!hasStarted) {
        selectedMinutes = 0;
        remainingMs = 0;
        timerState = 'idle';
        render();
        saveTimerState();
        return;
      }
      finishTimer();
      return;
    }

    if (currentMs <= 0 && delta > 0) {
      hasStarted = false;
      timerState = 'idle';
    }
    remainingMs = adjustedMs;
    selectedMinutes = Math.ceil(remainingMs / 60_000);
    if (running) {
      endAt = performance.now() + remainingMs;
      endAtEpochMs = Date.now() + remainingMs;
    }
    render();
    saveTimerState();
  }

  function minuteFromPointer(event) {
    const rect = dial.getBoundingClientRect();
    const x = event.clientX - (rect.left + rect.width / 2);
    const y = event.clientY - (rect.top + rect.height / 2);
    let degrees = Math.atan2(y, x) * 180 / Math.PI + 90;
    if (degrees < 0) degrees += 360;
    const minute = Math.round(degrees / 6);
    return minute === 0 ? (y < 0 && x < 0 ? 60 : 1) : minute;
  }

  function tick() {
    if (!running) return;
    remainingMs = Math.max(0, endAt - performance.now());
    render();
    if (remainingMs <= 0) {
      finishTimer();
      return;
    }
    frame = requestAnimationFrame(tick);
  }

  async function primeAudio() {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return false;
    try {
      audioContext ||= new AudioCtx();
      if (audioContext.state !== 'running') await audioContext.resume();

      // iOSのホーム画面版では、長時間無音だとAudioContextが再び休止する
      // ことがあるため、ユーザー操作中に短い無音を再生して確実に解除する。
      const oscillator = audioContext.createOscillator();
      const gain = audioContext.createGain();
      gain.gain.value = 0.0001;
      oscillator.connect(gain).connect(audioContext.destination);
      oscillator.start();
      oscillator.stop(audioContext.currentTime + .02);
      return true;
    } catch (_) {
      return false;
    }
  }

  function startAudioKeepAlive() {
    if (!audioContext || audioContext.state !== 'running' || audioKeepAlive) return;
    const oscillator = audioContext.createOscillator();
    const gain = audioContext.createGain();
    gain.gain.value = 0.0001;
    oscillator.connect(gain).connect(audioContext.destination);
    oscillator.start();
    audioKeepAlive = { oscillator, gain };
  }

  function stopAudioKeepAlive() {
    if (!audioKeepAlive) return;
    try { audioKeepAlive.oscillator.stop(); } catch (_) {}
    audioKeepAlive.oscillator.disconnect();
    audioKeepAlive.gain.disconnect();
    audioKeepAlive = null;
  }

  function beep(start, frequency = 1240) {
    if (!audioContext) return;
    const oscillator = audioContext.createOscillator();
    const gain = audioContext.createGain();
    oscillator.type = 'square';
    oscillator.frequency.value = frequency;
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(0.18, start + .012);
    gain.gain.setValueAtTime(0.18, start + .075);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + .11);
    oscillator.connect(gain).connect(audioContext.destination);
    oscillator.start(start); oscillator.stop(start + .12);
  }

  async function playAlarm({ vibrate = false } = {}) {
    const repeatCount = Number(alarmRepeat.value);
    const vibrationPattern = [];
    const vibrationRepeats = repeatCount === 0 ? 1 : repeatCount;
    for (let repeat = 0; repeat < vibrationRepeats; repeat++) {
      if (repeat > 0) vibrationPattern.push(400);
      vibrationPattern.push(90, 70, 90, 70, 90);
    }
    if (vibrate && navigator.vibrate) navigator.vibrate(vibrationPattern);
    if (repeatCount === 0 || !audioContext) return;
    try {
      if (audioContext.state !== 'running') await audioContext.resume();
    } catch (_) {}
    if (audioContext.state !== 'running') return;
    const now = audioContext.currentTime + .04;
    for (let repeat = 0; repeat < repeatCount; repeat++) {
      const groupStart = repeat * .82;
      beep(now + groupStart);
      beep(now + groupStart + .16);
      beep(now + groupStart + .32);
    }
  }

  async function previewCurrentAlarm() {
    const repeatCount = Number(alarmRepeat.value);
    if (repeatCount === 0 || previewAlarm.disabled) return;
    previewAlarm.disabled = true;
    try {
      await primeAudio();
      await playAlarm();
    } finally {
      clearTimeout(previewTimeout);
      previewTimeout = window.setTimeout(() => { previewAlarm.disabled = false; }, ((repeatCount - 1) * 820) + 500);
    }
  }

  async function acquireWakeLock() {
    try { if ('wakeLock' in navigator) wakeLock = await navigator.wakeLock.request('screen'); }
    catch (_) { wakeLock = null; }
  }

  async function releaseWakeLock() {
    try { await wakeLock?.release(); } catch (_) {}
    wakeLock = null;
  }

  async function toggleTimer() {
    await primeAudio();
    if (selectedMinutes === 0) return;
    if (remainingMs <= 0) remainingMs = selectedMinutes * 60_000;
    running = !running;
    cancelAnimationFrame(frame);
    if (running) {
      hasStarted = true;
      timerState = 'running';
      endAt = performance.now() + remainingMs;
      endAtEpochMs = Date.now() + remainingMs;
      startAudioKeepAlive();
      acquireWakeLock();
      saveTimerState();
      tick();
    } else {
      remainingMs = Math.max(0, endAt - performance.now());
      timerState = 'paused';
      endAt = 0;
      endAtEpochMs = 0;
      stopAudioKeepAlive();
      releaseWakeLock();
      render();
      saveTimerState();
    }
  }

  function doReset() {
    running = false;
    timerState = 'idle';
    cancelAnimationFrame(frame);
    stopAudioKeepAlive();
    releaseWakeLock();
    selectedMinutes = 0;
    remainingMs = 0;
    endAt = 0;
    endAtEpochMs = 0;
    hasStarted = false;
    render();
    saveTimerState();
  }

  function restoreTimerState() {
    const saved = readSavedTimerState();
    if (!saved) return false;
    selectedMinutes = saved.selectedMinutes;
    remainingMs = saved.remainingMs;
    timerState = saved.state;
    hasStarted = timerState !== 'idle';

    if (timerState === 'running') {
      const restoredRemainingMs = Math.min(TOTAL_MS, Math.max(0, saved.endAtEpochMs - Date.now()));
      if (restoredRemainingMs <= 0) {
        running = false;
        timerState = 'finished';
        remainingMs = 0;
        endAtEpochMs = 0;
        render();
        saveTimerState();
        return true;
      }
      running = true;
      remainingMs = restoredRemainingMs;
      endAtEpochMs = saved.endAtEpochMs;
      endAt = performance.now() + remainingMs;
      acquireWakeLock();
      tick();
      return true;
    }

    running = false;
    endAt = 0;
    endAtEpochMs = 0;
    render();
    return true;
  }

  function configureAuxiliaryUi() {
    const standalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
    const appleMobile = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    const safari = /Safari/.test(navigator.userAgent) && !/CriOS|FxiOS|EdgiOS|OPiOS/.test(navigator.userAgent);
    const iphoneSafari = appleMobile && safari;
    pwaGuide.hidden = standalone || !iphoneSafari;
    shareTools.hidden = false;
  }

  function showShareFeedback(message) {
    clearTimeout(shareFeedbackTimeout);
    shareFeedback.textContent = message;
    shareFeedbackTimeout = window.setTimeout(() => { shareFeedback.textContent = ''; }, 2500);
  }

  async function copyPublicUrl() {
    try {
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard API unavailable');
      await navigator.clipboard.writeText(PUBLIC_URL);
      showShareFeedback('URLをコピーしました');
    } catch (_) {
      showShareFeedback('URLをコピーできませんでした');
    }
  }

  async function shareApp() {
    if (navigator.share) {
      try {
        await navigator.share({ title: 'みえるタイマー', url: PUBLIC_URL });
        return;
      } catch (error) {
        if (error?.name === 'AbortError') return;
      }
    }
    await copyPublicUrl();
  }

  dial.addEventListener('pointerdown', event => {
    if (running) return;
    dragging = true;
    dial.setPointerCapture(event.pointerId);
    setMinutes(minuteFromPointer(event));
  });
  dial.addEventListener('pointermove', event => { if (dragging) setMinutes(minuteFromPointer(event)); });
  dial.addEventListener('pointerup', () => { dragging = false; });
  dial.addEventListener('pointercancel', () => { dragging = false; });
  dial.addEventListener('keydown', event => {
    if (event.key === 'ArrowUp' || event.key === 'ArrowRight') { event.preventDefault(); setMinutes(selectedMinutes + 1); }
    if (event.key === 'ArrowDown' || event.key === 'ArrowLeft') { event.preventDefault(); setMinutes(selectedMinutes - 1); }
  });
  minus.addEventListener('click', () => adjustMinutes(-1));
  plus.addEventListener('click', () => adjustMinutes(1));
  startPause.addEventListener('click', toggleTimer);
  reset.addEventListener('click', doReset);
  previewAlarm.addEventListener('click', previewCurrentAlarm);
  shareButton.addEventListener('click', shareApp);
  alarmRepeat.addEventListener('change', () => {
    try { localStorage.setItem('alarmRepeat', alarmRepeat.value); } catch (_) {}
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      saveTimerState();
      return;
    }
    if (running) {
      remainingMs = Math.max(0, endAtEpochMs - Date.now());
      if (remainingMs > 0) {
        endAt = performance.now() + remainingMs;
        acquireWakeLock();
        render();
      } else {
        finishTimer();
      }
    }
  });
  window.addEventListener('pagehide', saveTimerState);

  drawFace();
  try {
    const savedRepeat = localStorage.getItem('alarmRepeat');
    if (savedRepeat && alarmRepeat.querySelector(`option[value="${savedRepeat}"]`)) alarmRepeat.value = savedRepeat;
  } catch (_) {}
  configureAuxiliaryUi();
  if (!restoreTimerState()) render();
  if ('serviceWorker' in navigator) window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js'));
})();
