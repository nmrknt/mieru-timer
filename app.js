(() => {
  'use strict';

  const TOTAL_SECONDS = 60 * 60;
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

  let selectedMinutes = 0;
  let remainingMs = selectedMinutes * 60_000;
  let running = false;
  let endAt = 0;
  let frame = 0;
  let audioContext = null;
  let audioKeepAlive = null;
  let wakeLock = null;
  let dragging = false;
  let hasStarted = false;

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
    startPause.textContent = running ? '一時停止' : (remainingMs < selectedMinutes * 60_000 && remainingMs > 0 ? '再開' : 'スタート');
    startPause.classList.toggle('running', running);
    startPause.disabled = selectedMinutes === 0;
    stateText.textContent = running ? '残り時間' : (selectedMinutes === 0 ? '0分' : (remainingMs === 0 ? 'おしまい' : `${selectedMinutes}分`));
  }

  function setMinutes(value) {
    if (running) return;
    hasStarted = false;
    selectedMinutes = Math.min(60, Math.max(0, Math.round(value)));
    remainingMs = selectedMinutes * 60_000;
    render();
  }

  function finishTimer() {
    running = false;
    remainingMs = 0;
    cancelAnimationFrame(frame);
    releaseWakeLock();
    render();
    beepRepeated();
  }

  function adjustMinutes(delta) {
    const currentMs = running ? Math.max(0, endAt - performance.now()) : remainingMs;
    const adjustedMs = Math.min(TOTAL_SECONDS * 1000, Math.max(0, currentMs + delta * 60_000));

    if (adjustedMs <= 0) {
      if (!hasStarted) {
        selectedMinutes = 0;
        remainingMs = 0;
        render();
        return;
      }
      finishTimer();
      return;
    }

    if (currentMs <= 0 && delta > 0) hasStarted = false;
    remainingMs = adjustedMs;
    selectedMinutes = Math.ceil(remainingMs / 60_000);
    if (running) endAt = performance.now() + remainingMs;
    render();
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
    if (!AudioCtx) return;
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

  async function beepRepeated() {
    if (!audioContext) return;
    try {
      if (audioContext.state !== 'running') await audioContext.resume();
    } catch (_) {}
    stopAudioKeepAlive();
    if (audioContext.state !== 'running') return;
    const now = audioContext.currentTime + .04;
    const repeatCount = Number(alarmRepeat.value);
    const beepOffsets = [];
    const vibrationPattern = [];
    for (let repeat = 0; repeat < repeatCount; repeat++) {
      const groupStart = repeat * .82;
      beepOffsets.push(groupStart, groupStart + .16, groupStart + .32);
      if (repeat > 0) vibrationPattern.push(400);
      vibrationPattern.push(90, 70, 90, 70, 90);
    }
    beepOffsets.forEach(offset => beep(now + offset));
    if (navigator.vibrate) navigator.vibrate(vibrationPattern);
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
      endAt = performance.now() + remainingMs;
      startAudioKeepAlive();
      acquireWakeLock();
      tick();
    } else {
      remainingMs = Math.max(0, endAt - performance.now());
      stopAudioKeepAlive();
      releaseWakeLock();
      render();
    }
  }

  function doReset() {
    running = false;
    cancelAnimationFrame(frame);
    stopAudioKeepAlive();
    releaseWakeLock();
    selectedMinutes = 0;
    remainingMs = 0;
    hasStarted = false;
    render();
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
  alarmRepeat.addEventListener('change', () => {
    try { localStorage.setItem('alarmRepeat', alarmRepeat.value); } catch (_) {}
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && running) {
      remainingMs = Math.max(0, endAt - performance.now());
      if (remainingMs > 0) {
        acquireWakeLock();
        render();
      } else {
        finishTimer();
      }
    }
  });

  drawFace();
  try {
    const savedRepeat = localStorage.getItem('alarmRepeat');
    if (savedRepeat && alarmRepeat.querySelector(`option[value="${savedRepeat}"]`)) alarmRepeat.value = savedRepeat;
  } catch (_) {}
  render();
  if ('serviceWorker' in navigator) window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js'));
})();
