// Drafting Table — blueprint workstation
// No build step. Plain ES module. State lives in localStorage only.

const STORE_KEY = 'draftingtable.v1';

const state = load() || {
  sheets: [],   // {id, type:'note'|'pdf', x, y, text, pdfData(base64), page}
  todos: [],    // {id, text, done}
  events: {},   // { 'YYYY-MM-DD': [ {id, text} ] }
};

let zTop = 10;
let calCursor = new Date();
let selectedDate = null;

function save() {
  localStorage.setItem(STORE_KEY, JSON.stringify(state));
}
function load() {
  try { return JSON.parse(localStorage.getItem(STORE_KEY)); }
  catch { return null; }
}
function uid() {
  return Math.random().toString(36).slice(2, 10);
}
function toast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.remove('show'), 1800);
}

/* ---------------- Sheets (notes + pdf pages on the table) ---------------- */

const sheetLayer = document.getElementById('sheet-layer');

function renderSheets() {
  // Kill any live timer intervals — buildTimer restarts the ones still running.
  timerRuntimes.forEach(handle => clearInterval(handle));
  timerRuntimes.clear();
  sheetLayer.innerHTML = '';
  if (state.sheets.length === 0) {
    const hint = document.createElement('div');
    hint.className = 'empty-hint';
    hint.innerHTML = '<b>Empty table.</b><br>Use Note to jot something down, Import to bring in a PDF, or Timer to start a focus block. Drag sheets anywhere — the table remembers where you left them.';
    sheetLayer.appendChild(hint);
    return;
  }
  state.sheets.forEach(drawSheet);
}

function drawSheet(sheet) {
  const el = document.createElement('div');
  el.className = 'sheet'
    + (sheet.type === 'pdf' ? ' sheet-pdf' : '')
    + (sheet.type === 'timer' ? ' sheet-timer' : '');
  el.style.left = sheet.x + 'px';
  el.style.top = sheet.y + 'px';
  el.dataset.id = sheet.id;

  const head = document.createElement('div');
  head.className = 'sheet-head';
  const labels = { pdf: 'PDF', timer: 'TIMER', note: 'NOTE' };
  head.innerHTML = `<span>${labels[sheet.type] || 'NOTE'}</span>`;
  const closeBtn = document.createElement('button');
  closeBtn.textContent = '\u2715';
  closeBtn.title = 'Remove';
  closeBtn.addEventListener('click', () => removeSheet(sheet.id));
  head.appendChild(closeBtn);
  el.appendChild(head);

  const body = document.createElement('div');
  body.className = 'sheet-body';

  if (sheet.type === 'note') {
    const ta = document.createElement('textarea');
    ta.value = sheet.text || '';
    ta.placeholder = 'Write here\u2026';
    ta.addEventListener('input', () => { sheet.text = ta.value; save(); });
    body.appendChild(ta);
  } else if (sheet.type === 'timer') {
    buildTimer(sheet, body);
  } else {
    const canvas = document.createElement('canvas');
    body.appendChild(canvas);
    const pager = document.createElement('div');
    pager.className = 'pdf-pager';
    const prev = document.createElement('button');
    prev.textContent = '\u2190';
    const label = document.createElement('span');
    const next = document.createElement('button');
    next.textContent = '\u2192';
    pager.append(prev, label, next);
    body.appendChild(pager);

    const renderPage = () => {
      label.textContent = `Page ${sheet.page} / ${sheet.numPages}`;
      renderPdfPage(sheet, canvas);
    };
    prev.addEventListener('click', () => { if (sheet.page > 1) { sheet.page--; save(); renderPage(); } });
    next.addEventListener('click', () => { if (sheet.page < sheet.numPages) { sheet.page++; save(); renderPage(); } });
    loadPdfDoc(sheet).then(() => renderPage());
  }

  el.appendChild(body);
  sheetLayer.appendChild(el);
  makeDraggable(el, sheet);
}

function makeDraggable(el, sheet) {
  let dragging = false, offX = 0, offY = 0;
  el.addEventListener('pointerdown', (e) => {
    if (e.target.tagName === 'TEXTAREA' || e.target.tagName === 'BUTTON') return;
    dragging = true;
    el.style.zIndex = ++zTop;
    offX = e.clientX - el.offsetLeft;
    offY = e.clientY - el.offsetTop;
    el.setPointerCapture(e.pointerId);
  });
  el.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    sheet.x = e.clientX - offX;
    sheet.y = e.clientY - offY;
    el.style.left = sheet.x + 'px';
    el.style.top = sheet.y + 'px';
  });
  ['pointerup', 'pointercancel'].forEach(ev => el.addEventListener(ev, () => {
    if (dragging) { dragging = false; save(); }
  }));
}

function addNote() {
  const sheet = { id: uid(), type: 'note', x: 60 + Math.random() * 200, y: 60 + Math.random() * 160, text: '' };
  state.sheets.push(sheet);
  save();
  renderSheets();
}

function removeSheet(id) {
  state.sheets = state.sheets.filter(s => s.id !== id);
  save();
  renderSheets();
}

/* ---------------- PDF import (pdf.js) ---------------- */

pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

const pdfDocCache = new Map();

function loadPdfDoc(sheet) {
  if (pdfDocCache.has(sheet.id)) return Promise.resolve(pdfDocCache.get(sheet.id));
  const bytes = base64ToBytes(sheet.pdfData);
  return pdfjsLib.getDocument({ data: bytes }).promise.then(doc => {
    pdfDocCache.set(sheet.id, doc);
    sheet.numPages = doc.numPages;
    save();
    return doc;
  });
}

async function renderPdfPage(sheet, canvas) {
  const doc = await loadPdfDoc(sheet);
  const page = await doc.getPage(sheet.page);
  const viewport = page.getViewport({ scale: 1 });
  const scale = 340 / viewport.width;
  const scaledViewport = page.getViewport({ scale });
  canvas.width = scaledViewport.width;
  canvas.height = scaledViewport.height;
  const ctx = canvas.getContext('2d');
  await page.render({ canvasContext: ctx, viewport: scaledViewport }).promise;
}

function bytesToBase64(bytes) {
  let binary = '';
  bytes.forEach(b => binary += String.fromCharCode(b));
  return btoa(binary);
}
function base64ToBytes(b64) {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

const pdfInput = document.getElementById('pdf-input');
pdfInput.addEventListener('change', async () => {
  const file = pdfInput.files[0];
  if (!file) return;
  const buf = await file.arrayBuffer();
  const bytes = new Uint8Array(buf);
  const sheet = {
    id: uid(), type: 'pdf', x: 80 + Math.random() * 200, y: 80 + Math.random() * 160,
    pdfData: bytesToBase64(bytes), page: 1,
  };
  state.sheets.push(sheet);
  save();
  renderSheets();
  toast('PDF pinned to the table');
  pdfInput.value = '';
});

/* ---------------- Study timer ---------------- */

const timerRuntimes = new Map(); // sheetId -> interval handle

function addTimer() {
  const sheet = {
    id: uid(), type: 'timer',
    x: 60 + Math.random() * 200, y: 60 + Math.random() * 160,
    focusMins: 25, breakMins: 5,
    phase: 'focus',      // 'focus' | 'break'
    remaining: 25 * 60,  // seconds
    running: false,
    rounds: 0,
  };
  state.sheets.push(sheet);
  save();
  renderSheets();
}

function buildTimer(sheet, body) {
  // Guard against stale values from an older save.
  sheet.focusMins = sheet.focusMins || 25;
  sheet.breakMins = sheet.breakMins || 5;
  sheet.phase = sheet.phase || 'focus';
  sheet.rounds = sheet.rounds || 0;
  if (typeof sheet.remaining !== 'number') sheet.remaining = sheet.focusMins * 60;

  const RADIUS = 68;
  const CIRC = 2 * Math.PI * RADIUS;

  const dial = document.createElement('div');
  dial.className = 'timer-dial';
  dial.innerHTML = `
    <svg viewBox="0 0 156 156">
      <circle class="timer-track" cx="78" cy="78" r="${RADIUS}"></circle>
      <circle class="timer-progress" cx="78" cy="78" r="${RADIUS}"
              stroke-dasharray="${CIRC}" stroke-dashoffset="0"></circle>
    </svg>
    <div class="timer-readout">
      <div class="timer-clock">25:00</div>
      <div class="timer-phase">FOCUS</div>
    </div>`;
  body.appendChild(dial);

  const progress = dial.querySelector('.timer-progress');
  const clock = dial.querySelector('.timer-clock');
  const phaseLabel = dial.querySelector('.timer-phase');

  const controls = document.createElement('div');
  controls.className = 'timer-controls';
  const startBtn = document.createElement('button');
  const resetBtn = document.createElement('button');
  resetBtn.className = 'ghost';
  resetBtn.textContent = 'Reset';
  controls.append(startBtn, resetBtn);
  body.appendChild(controls);

  const lengths = document.createElement('div');
  lengths.className = 'timer-lengths';
  lengths.innerHTML = `
    <span>focus</span><input type="number" min="1" max="180" class="focus-len">
    <span>break</span><input type="number" min="1" max="60" class="break-len">
    <span>min</span>`;
  body.appendChild(lengths);

  const focusLen = lengths.querySelector('.focus-len');
  const breakLen = lengths.querySelector('.break-len');
  focusLen.value = sheet.focusMins;
  breakLen.value = sheet.breakMins;

  const roundsEl = document.createElement('div');
  roundsEl.className = 'timer-rounds';
  body.appendChild(roundsEl);

  function totalForPhase() {
    return (sheet.phase === 'focus' ? sheet.focusMins : sheet.breakMins) * 60;
  }

  function paint() {
    const mins = Math.floor(sheet.remaining / 60);
    const secs = sheet.remaining % 60;
    clock.textContent = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
    phaseLabel.textContent = sheet.phase === 'focus' ? 'FOCUS' : 'BREAK';
    progress.classList.toggle('resting', sheet.phase === 'break');
    const total = totalForPhase();
    const fraction = total > 0 ? 1 - sheet.remaining / total : 0;
    progress.setAttribute('stroke-dashoffset', String(CIRC * fraction));
    startBtn.textContent = sheet.running ? 'Pause' : 'Start';
    roundsEl.textContent = sheet.rounds === 1
      ? '1 round done'
      : `${sheet.rounds} rounds done`;
  }

  function stopTicking() {
    const handle = timerRuntimes.get(sheet.id);
    if (handle) { clearInterval(handle); timerRuntimes.delete(sheet.id); }
  }

  function switchPhase() {
    if (sheet.phase === 'focus') {
      sheet.rounds++;
      sheet.phase = 'break';
      toast('Focus block done — take the break.');
    } else {
      sheet.phase = 'focus';
      toast('Break over. Back to it.');
    }
    sheet.remaining = totalForPhase();
    chime();
    save();
    paint();
  }

  function tick() {
    sheet.remaining--;
    if (sheet.remaining <= 0) {
      switchPhase();
    } else {
      paint();
      if (sheet.remaining % 10 === 0) save();
    }
  }

  function startTicking() {
    stopTicking();
    timerRuntimes.set(sheet.id, setInterval(tick, 1000));
  }

  startBtn.addEventListener('click', () => {
    sheet.running = !sheet.running;
    if (sheet.running) startTicking(); else stopTicking();
    save();
    paint();
  });

  resetBtn.addEventListener('click', () => {
    sheet.running = false;
    stopTicking();
    sheet.remaining = totalForPhase();
    save();
    paint();
  });

  function applyLength(input, key, fallback) {
    let val = parseInt(input.value, 10);
    if (!Number.isFinite(val) || val < 1) val = fallback;
    sheet[key] = val;
    input.value = val;
    if (!sheet.running) sheet.remaining = totalForPhase();
    save();
    paint();
  }
  focusLen.addEventListener('change', () => applyLength(focusLen, 'focusMins', 25));
  breakLen.addEventListener('change', () => applyLength(breakLen, 'breakMins', 5));

  // Keep inputs from dragging the sheet around underneath them.
  [focusLen, breakLen].forEach(i => i.addEventListener('pointerdown', e => e.stopPropagation()));

  if (sheet.running) startTicking();
  paint();
}

function chime() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = 660;
    gain.gain.setValueAtTime(0.0001, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.15, ctx.currentTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.9);
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.95);
  } catch { /* audio blocked until first interaction — no matter */ }
}

/* ---------------- Tasks ---------------- */

const todoList = document.getElementById('todo-list');
const todoForm = document.getElementById('todo-form');
const todoInput = document.getElementById('todo-input');

function renderTodos() {
  todoList.innerHTML = '';
  state.todos.forEach(t => {
    const li = document.createElement('li');
    if (t.done) li.classList.add('done');
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = t.done;
    cb.addEventListener('change', () => { t.done = cb.checked; save(); renderTodos(); });
    const span = document.createElement('span');
    span.className = 'txt';
    span.textContent = t.text;
    const del = document.createElement('button');
    del.textContent = '\u2715';
    del.addEventListener('click', () => { state.todos = state.todos.filter(x => x.id !== t.id); save(); renderTodos(); });
    li.append(cb, span, del);
    todoList.appendChild(li);
  });
}

todoForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const text = todoInput.value.trim();
  if (!text) return;
  state.todos.push({ id: uid(), text, done: false });
  todoInput.value = '';
  save();
  renderTodos();
});

/* ---------------- Calendar ---------------- */

const calGrid = document.getElementById('cal-grid');
const calLabel = document.getElementById('cal-label');
const calDayTitle = document.querySelector('.cal-day-title');
const eventForm = document.getElementById('event-form');
const eventInput = document.getElementById('event-input');
const eventList = document.getElementById('event-list');

function dateKey(d) {
  return d.toISOString().slice(0, 10);
}

function renderCalendar() {
  calGrid.innerHTML = '';
  const year = calCursor.getFullYear();
  const month = calCursor.getMonth();
  calLabel.textContent = calCursor.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });

  ['S', 'M', 'T', 'W', 'T', 'F', 'S'].forEach(d => {
    const el = document.createElement('div');
    el.className = 'cal-dow';
    el.textContent = d;
    calGrid.appendChild(el);
  });

  const firstDay = new Date(year, month, 1);
  const startOffset = firstDay.getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const today = dateKey(new Date());

  for (let i = 0; i < startOffset; i++) {
    const filler = document.createElement('div');
    filler.className = 'cal-cell faded';
    calGrid.appendChild(filler);
  }
  for (let day = 1; day <= daysInMonth; day++) {
    const d = new Date(year, month, day);
    const key = dateKey(d);
    const cell = document.createElement('div');
    cell.className = 'cal-cell';
    if (key === today) cell.classList.add('today');
    if (key === selectedDate) cell.classList.add('selected');
    if (state.events[key] && state.events[key].length) cell.classList.add('has-event');
    cell.textContent = day;
    cell.addEventListener('click', () => { selectedDate = key; renderCalendar(); renderEvents(); });
    calGrid.appendChild(cell);
  }
}

function renderEvents() {
  if (!selectedDate) {
    calDayTitle.textContent = 'Pick a date';
    eventForm.style.display = 'none';
    eventList.innerHTML = '';
    return;
  }
  eventForm.style.display = 'flex';
  const d = new Date(selectedDate + 'T00:00:00');
  calDayTitle.textContent = d.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
  eventList.innerHTML = '';
  (state.events[selectedDate] || []).forEach(ev => {
    const li = document.createElement('li');
    const span = document.createElement('span');
    span.className = 'txt';
    span.textContent = ev.text;
    const del = document.createElement('button');
    del.textContent = '\u2715';
    del.addEventListener('click', () => {
      state.events[selectedDate] = state.events[selectedDate].filter(x => x.id !== ev.id);
      save(); renderEvents(); renderCalendar();
    });
    li.append(span, del);
    eventList.appendChild(li);
  });
}

eventForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const text = eventInput.value.trim();
  if (!text || !selectedDate) return;
  state.events[selectedDate] = state.events[selectedDate] || [];
  state.events[selectedDate].push({ id: uid(), text });
  eventInput.value = '';
  save();
  renderEvents();
  renderCalendar();
});

document.querySelector('[data-action="cal-prev"]').addEventListener('click', () => {
  calCursor.setMonth(calCursor.getMonth() - 1);
  renderCalendar();
});
document.querySelector('[data-action="cal-next"]').addEventListener('click', () => {
  calCursor.setMonth(calCursor.getMonth() + 1);
  renderCalendar();
});

/* ---------------- Pegboard actions ---------------- */

document.querySelectorAll('[data-action]').forEach(btn => {
  btn.addEventListener('click', () => {
    const action = btn.dataset.action;
    if (action === 'new-note') addNote();
    if (action === 'new-timer') addTimer();
    if (action === 'import-pdf') pdfInput.click();
    if (action === 'toggle-todo') document.getElementById('todo-drawer').classList.toggle('open');
    if (action === 'toggle-calendar') document.getElementById('calendar-drawer').classList.toggle('open');
    if (action === 'clear-board') {
      if (confirm('Clear every sheet from the table? Tasks and calendar are untouched.')) {
        state.sheets = [];
        save();
        renderSheets();
      }
    }
  });
});

/* ---------------- Init ---------------- */

renderSheets();
renderTodos();
renderCalendar();
renderEvents();
