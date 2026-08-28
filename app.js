(() => {
  'use strict';

  const TOTAL_SECONDS = 60 * 60;
  const dial = document.querySelector('#dial');
  const sector = document.querySelector('#redSector');
  const ticks = document.querySelector('#ticks');
  const numbers = document.querySelector('#numbers');
  const timeText = document.querySelector('#timeText');
  const stateText = document.querySelector('#stateText');
  const minutesText = document.querySelector('#minutesText');
  const minus = document.querySelector('#minus');
  const plus = document.querySelector('#plus');
  const startPause = document.querySelector('#startPause');
  const reset = document.querySelector('#reset');

  let selectedMinutes = 15;
  let remainingMs = selectedMinutes * 60_000;
  let running = false;
  let endAt = 0;
  let frame = 0;
  let audioContext = null;
  let wakeLock = null;
  let dragging = false;

  const point = (angle, radius) => {
    const radians = (angle - 90) * Math.PI / 180;
    return { x: 200 + radius * Math.cos(radians), y: 200 + radius * Math.sin(radians) };
  };

  function drawFace() {
    for (let minute = 0; minute < 60; minute++) {
      const major = minute % 5 === 0;
      const outer = point(minute * 6, 177);
      const inner = point(minute * 6, major ? 159 : 169);
      const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      line.setAttribute('x1', inner.x); line.setAttribute('y1', inner.y);
      line.setAttribute('x2', outer.x); line.setAttribute('y2', outer.y);
      line.setAttribute('class', `tick ${major ? 'major' : 'minor'}`);
      ticks.append(line);
    }

    for (let minute = 0; minute < 60; minute += 5) {
      const p = point(minute * 6, 139);
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
      return 'M 200 200 L 200 20 A 180 180 0 1 1 199.99 20 Z';
    }
    const angle = (seconds / TOTAL_SECONDS) * 360;
    const end = point(angle, 180);
    return `M 200 200 L 200 20 A 180 180 0 ${angle > 180 ? 1 : 0} 1 ${end.x} ${end.y} Z`;
  }

  function render() {
    const seconds = Math.max(0, remainingMs / 1000);
    sector.setAttribute('d', sectorPath(seconds));
    const displaySeconds = Math.ceil(seconds);
    const mins = Math.floor(displaySeconds / 60);
    const secs = displaySeconds % 60;
    timeText.textContent = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
    minutesText.textContent = `${selectedMinutes}分`;
    dial.setAttribute('aria-valuenow', selectedMinutes);
    dial.setAttribute('aria-valuetext', `${selectedMinutes}分`);
    minus.disabled = running;
    plus.disabled = running;
    startPause.textContent = running ? '一時停止' : (remainingMs < selectedMinutes * 60_000 && remainingMs > 0 ? '再開' : 'スタート');
    startPause.classList.toggle('running', running);
    stateText.textContent = running ? '残り時間' : (remainingMs === 0 ? 'おしまい' : `${selectedMinutes}分`);
  }

  function setMinutes(value) {
    if (running) return;
    selectedMinutes = Math.min(60, Math.max(1, Math.round(value)));
    remainingMs = selectedMinutes * 60_000;
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
      running = false;
      releaseWakeLock();
      render();
      beepThreeTimes();
      return;
    }
    frame = requestAnimationFrame(tick);
  }

  async function primeAudio() {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;
    audioContext ||= new AudioCtx();
    if (audioContext.state === 'suspended') await audioContext.resume();
  }

  function beep(start, frequency = 1240) {
    if (!audioContext) return;
    const oscillator = audioContext.createOscillator();
    const gain = audioContext.createGain();
    oscillator.type = 'square';
    oscillator.frequency.value = frequency;
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(0.18, start + .012);
    gain.gain.setValueAtTime(0.18, start + .13);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + .18);
    oscillator.connect(gain).connect(audioContext.destination);
    oscillator.start(start); oscillator.stop(start + .19);
  }

  function beepThreeTimes() {
    if (!audioContext) return;
    const now = audioContext.currentTime + .04;
    [0, .29, .58].forEach(offset => beep(now + offset));
    if (navigator.vibrate) navigator.vibrate([120, 100, 120, 100, 120]);
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
    if (remainingMs <= 0) remainingMs = selectedMinutes * 60_000;
    running = !running;
    cancelAnimationFrame(frame);
    if (running) {
      endAt = performance.now() + remainingMs;
      acquireWakeLock();
      tick();
    } else {
      remainingMs = Math.max(0, endAt - performance.now());
      releaseWakeLock();
      render();
    }
  }

  function doReset() {
    running = false;
    cancelAnimationFrame(frame);
    releaseWakeLock();
    remainingMs = selectedMinutes * 60_000;
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
  minus.addEventListener('click', () => setMinutes(selectedMinutes - 1));
  plus.addEventListener('click', () => setMinutes(selectedMinutes + 1));
  startPause.addEventListener('click', toggleTimer);
  reset.addEventListener('click', doReset);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && running) {
      remainingMs = Math.max(0, endAt - performance.now());
      if (remainingMs > 0) acquireWakeLock();
      else { running = false; releaseWakeLock(); beepThreeTimes(); }
      render();
    }
  });

  drawFace();
  render();
  if ('serviceWorker' in navigator) window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js'));
})();
