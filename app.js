/* Margin — workstation logic. No build step; plain script. */

(function () {
'use strict';

var STORE_KEY = 'margin.v2';

var DEFAULTS = {
  sheets: [],
  todos: [],
  events: {},
  prefs: {
    theme: 'dusk',
    surface: 'grid',
    gridStep: 28,
    paper: 'ruled',
    penColor: '#26313a',
    penWidth: 2.5,
    penOnly: false
  }
};

var state = load();
var tool = 'select';
var zTop = 10;
var calCursor = new Date();
var selectedDate = null;
var timerRuntimes = {};
var pdfDocCache = {};

function load() {
  try {
    var raw = JSON.parse(localStorage.getItem(STORE_KEY));
    if (!raw) return clone(DEFAULTS);
    raw.sheets = raw.sheets || [];
    raw.todos = raw.todos || [];
    raw.events = raw.events || {};
    raw.prefs = Object.assign(clone(DEFAULTS.prefs), raw.prefs || {});
    return raw;
  } catch (e) { return clone(DEFAULTS); }
}
function clone(o) { return JSON.parse(JSON.stringify(o)); }

var saveTimer = null;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(function () {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); }
    catch (e) { toast('Storage is full — remove a PDF to free space.'); }
  }, 120);
}

function uid() { return Math.random().toString(36).slice(2, 10); }

function toast(msg) {
  var t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toast._t);
  toast._t = setTimeout(function () { t.classList.remove('show'); }, 2200);
}

/* ================= Preferences / appearance ================= */

var THEMES = [
  { id: 'dusk',  label: 'Dusk',  swatch: '#24405a' },
  { id: 'sea',   label: 'Sea',   swatch: '#1f4a4d' },
  { id: 'slate', label: 'Slate', swatch: '#39414a' },
  { id: 'linen', label: 'Linen', swatch: '#e8e2d6' }
];
var SURFACES = [
  { id: 'grid',  label: 'Grid' },
  { id: 'dots',  label: 'Dots' },
  { id: 'plain', label: 'Plain' }
];
var PAPERS = [
  { id: 'ruled',  label: 'Ruled' },
  { id: 'grid',   label: 'Grid' },
  { id: 'dotted', label: 'Dotted' },
  { id: 'blank',  label: 'Blank' }
];
var INK_COLORS = ['#26313a', '#2f5fa8', '#c96a55', '#4f8f68', '#8a5fb0', '#d9a05b'];

function applyPrefs() {
  var p = state.prefs;
  document.documentElement.setAttribute('data-theme', p.theme);
  document.documentElement.style.setProperty('--grid-step', p.gridStep + 'px');
  document.getElementById('board').setAttribute('data-surface', p.surface);
}

function buildSettings() {
  var themeRow = document.getElementById('opt-theme');
  themeRow.innerHTML = '';
  THEMES.forEach(function (t) {
    var b = document.createElement('button');
    b.className = 'opt opt-dot' + (state.prefs.theme === t.id ? ' is-active' : '');
    b.style.background = t.swatch;
    b.title = t.label;
    b.setAttribute('aria-label', t.label);
    b.addEventListener('click', function () {
      state.prefs.theme = t.id; save(); applyPrefs(); buildSettings();
    });
    themeRow.appendChild(b);
  });

  fillOptRow('opt-grid', SURFACES, 'surface', function () { applyPrefs(); });
  fillOptRow('opt-paper', PAPERS, 'paper', function () {});

  var gs = document.getElementById('grid-size');
  gs.value = state.prefs.gridStep;
  gs.oninput = function () {
    state.prefs.gridStep = parseInt(gs.value, 10);
    applyPrefs(); save();
  };
}

function fillOptRow(elId, items, prefKey, after) {
  var row = document.getElementById(elId);
  row.innerHTML = '';
  items.forEach(function (item) {
    var b = document.createElement('button');
    b.className = 'opt' + (state.prefs[prefKey] === item.id ? ' is-active' : '');
    b.textContent = item.label;
    b.addEventListener('click', function () {
      state.prefs[prefKey] = item.id;
      save();
      buildSettings();
      after();
    });
    row.appendChild(b);
  });
}

function buildInkTray() {
  var row = document.getElementById('swatches');
  row.innerHTML = '';
  INK_COLORS.forEach(function (c) {
    var b = document.createElement('button');
    b.className = 'swatch' + (state.prefs.penColor === c ? ' is-active' : '');
    b.style.background = c;
    b.setAttribute('aria-label', 'Ink colour');
    b.addEventListener('click', function () {
      state.prefs.penColor = c; save(); buildInkTray();
    });
    row.appendChild(b);
  });
  var nib = document.getElementById('nib-size');
  nib.value = state.prefs.penWidth;
  nib.oninput = function () { state.prefs.penWidth = parseFloat(nib.value); save(); };
  var po = document.getElementById('pen-only');
  po.checked = !!state.prefs.penOnly;
  po.onchange = function () { state.prefs.penOnly = po.checked; save(); };
}

function setTool(next) {
  tool = next;
  document.body.setAttribute('data-tool', next);
  document.querySelectorAll('.tool-mode').forEach(function (b) {
    b.classList.toggle('is-active', b.dataset.tool === next);
  });
  document.getElementById('ink-tray').hidden = (next === 'select');
}

/* ================= Sheets ================= */

var sheetLayer = document.getElementById('sheet-layer');
var emptyHint = document.getElementById('empty-hint');

function renderSheets() {
  Object.keys(timerRuntimes).forEach(function (k) { clearInterval(timerRuntimes[k]); });
  timerRuntimes = {};
  sheetLayer.innerHTML = '';
  emptyHint.style.display = state.sheets.length ? 'none' : 'block';
  state.sheets.forEach(drawSheet);
}

function drawSheet(sheet) {
  var el = document.createElement('div');
  el.className = 'sheet'
    + (sheet.type === 'pdf' ? ' sheet-pdf' : '')
    + (sheet.type === 'timer' ? ' sheet-timer' : '');
  el.style.left = sheet.x + 'px';
  el.style.top = sheet.y + 'px';
  if (sheet.w) el.style.width = sheet.w + 'px';
  el.dataset.id = sheet.id;

  var head = document.createElement('div');
  head.className = 'sheet-head';

  var title = document.createElement('span');
  title.className = 'sheet-title';
  title.textContent = sheet.title || defaultTitle(sheet);
  head.appendChild(title);

  if (sheet.type === 'note') {
    var paperBtn = document.createElement('button');
    paperBtn.className = 'head-btn';
    paperBtn.title = 'Change paper';
    paperBtn.innerHTML = '<svg viewBox="0 0 24 24"><rect x="4" y="3" width="16" height="18" rx="2"/><path d="M4 9h16M4 15h16"/></svg>';
    paperBtn.addEventListener('click', function () {
      var order = PAPERS.map(function (p) { return p.id; });
      var i = order.indexOf(sheet.paper || state.prefs.paper);
      sheet.paper = order[(i + 1) % order.length];
      save();
      renderSheets();
      toast('Paper: ' + sheet.paper);
    });
    head.appendChild(paperBtn);
  }

  var del = document.createElement('button');
  del.className = 'head-btn danger';
  del.title = 'Remove';
  del.innerHTML = '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg>';
  del.addEventListener('click', function () { removeSheet(sheet.id); });
  head.appendChild(del);

  el.appendChild(head);

  if (sheet.type === 'note') buildNote(sheet, el);
  else if (sheet.type === 'pdf') buildPdf(sheet, el);
  else if (sheet.type === 'timer') buildTimer(sheet, el);

  sheetLayer.appendChild(el);
  makeDraggable(el, sheet, head);

  if (sheet.type !== 'timer') addResizeHandle(el, sheet);
}

function defaultTitle(s) {
  if (s.type === 'pdf') return s.filename || 'PDF';
  if (s.type === 'timer') return 'Focus';
  return 'Page';
}

function removeSheet(id) {
  state.sheets = state.sheets.filter(function (s) { return s.id !== id; });
  delete pdfDocCache[id];
  save();
  renderSheets();
}

function makeDraggable(el, sheet, handle) {
  var dragging = false, offX = 0, offY = 0;
  handle.addEventListener('pointerdown', function (e) {
    if (e.target.closest('.head-btn')) return;
    dragging = true;
    el.style.zIndex = ++zTop;
    offX = e.clientX - el.offsetLeft;
    offY = e.clientY - el.offsetTop;
    handle.setPointerCapture(e.pointerId);
    e.preventDefault();
  });
  handle.addEventListener('pointermove', function (e) {
    if (!dragging) return;
    sheet.x = Math.max(0, e.clientX - offX);
    sheet.y = Math.max(0, e.clientY - offY);
    el.style.left = sheet.x + 'px';
    el.style.top = sheet.y + 'px';
  });
  ['pointerup', 'pointercancel'].forEach(function (ev) {
    handle.addEventListener(ev, function () { if (dragging) { dragging = false; save(); } });
  });
}

function addResizeHandle(el, sheet) {
  var grip = document.createElement('div');
  grip.className = 'sheet-resize';
  el.appendChild(grip);
  var resizing = false, startX = 0, startW = 0;
  grip.addEventListener('pointerdown', function (e) {
    resizing = true;
    startX = e.clientX;
    startW = el.offsetWidth;
    grip.setPointerCapture(e.pointerId);
    e.preventDefault();
    e.stopPropagation();
  });
  grip.addEventListener('pointermove', function (e) {
    if (!resizing) return;
    var w = Math.max(220, Math.min(900, startW + (e.clientX - startX)));
    sheet.w = w;
    el.style.width = w + 'px';
    var ink = el.querySelector('.ink-layer');
    if (ink) sizeInkCanvas(ink, sheet);
  });
  ['pointerup', 'pointercancel'].forEach(function (ev) {
    grip.addEventListener(ev, function () { if (resizing) { resizing = false; save(); renderSheets(); } });
  });
}

/* ---------- Note sheets ---------- */

function buildNote(sheet, el) {
  sheet.paper = sheet.paper || state.prefs.paper;
  sheet.h = sheet.h || 260;

  var wrap = document.createElement('div');
  wrap.className = 'sheet-canvas-wrap';

  var ruling = document.createElement('div');
  ruling.className = 'paper-ruling';
  ruling.setAttribute('data-paper', sheet.paper);
  wrap.appendChild(ruling);

  var ta = document.createElement('textarea');
  ta.className = 'page-surface';
  ta.value = sheet.text || '';
  ta.placeholder = 'Type here, or pick up the pen.';
  ta.style.height = sheet.h + 'px';
  ta.addEventListener('input', function () { sheet.text = ta.value; save(); });
  wrap.appendChild(ta);

  var ink = document.createElement('canvas');
  ink.className = 'ink-layer';
  wrap.appendChild(ink);

  el.appendChild(wrap);

  requestAnimationFrame(function () {
    sizeInkCanvas(ink, sheet);
    attachInk(ink, sheet, function () { return sheet.strokes || (sheet.strokes = []); });
  });
}

/* ---------- PDF sheets ---------- */

if (window.pdfjsLib) {
  pdfjsLib.GlobalWorkerOptions.workerSrc =
    'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
}

function buildPdf(sheet, el) {
  var stack = document.createElement('div');
  stack.className = 'pdf-stack sheet-canvas-wrap';

  var pdfCanvas = document.createElement('canvas');
  pdfCanvas.className = 'pdf-canvas';
  stack.appendChild(pdfCanvas);

  var ink = document.createElement('canvas');
  ink.className = 'ink-layer';
  stack.appendChild(ink);

  el.appendChild(stack);

  var pager = document.createElement('div');
  pager.className = 'pdf-pager';
  var prev = document.createElement('button'); prev.textContent = 'Prev';
  var label = document.createElement('span');
  var next = document.createElement('button'); next.textContent = 'Next';
  pager.append(prev, label, next);
  el.appendChild(pager);

  sheet.inkByPage = sheet.inkByPage || {};

  function currentStrokes() {
    var key = String(sheet.page);
    if (!sheet.inkByPage[key]) sheet.inkByPage[key] = [];
    return sheet.inkByPage[key];
  }

  function show() {
    label.textContent = 'Page ' + sheet.page + ' of ' + (sheet.numPages || '?');
    renderPdfPage(sheet, pdfCanvas).then(function () {
      sizeInkCanvas(ink, sheet, pdfCanvas.offsetHeight);
      redraw(ink, currentStrokes());
    });
  }

  prev.addEventListener('click', function () {
    if (sheet.page > 1) { sheet.page--; save(); show(); }
  });
  next.addEventListener('click', function () {
    if (sheet.page < sheet.numPages) { sheet.page++; save(); show(); }
  });

  attachInk(ink, sheet, currentStrokes);
  show();
}

function loadPdfDoc(sheet) {
  if (pdfDocCache[sheet.id]) return Promise.resolve(pdfDocCache[sheet.id]);
  var bytes = base64ToBytes(sheet.pdfData);
  return pdfjsLib.getDocument({ data: bytes }).promise.then(function (doc) {
    pdfDocCache[sheet.id] = doc;
    sheet.numPages = doc.numPages;
    save();
    return doc;
  });
}

function renderPdfPage(sheet, canvas) {
  return loadPdfDoc(sheet).then(function (doc) {
    return doc.getPage(sheet.page);
  }).then(function (page) {
    var base = page.getViewport({ scale: 1 });
    var targetW = (sheet.w || 420) - 2;
    var dpr = window.devicePixelRatio || 1;
    var vp = page.getViewport({ scale: (targetW / base.width) * dpr });
    canvas.width = vp.width;
    canvas.height = vp.height;
    canvas.style.width = targetW + 'px';
    canvas.style.height = (vp.height / dpr) + 'px';
    return page.render({ canvasContext: canvas.getContext('2d'), viewport: vp }).promise;
  }).catch(function () {
    toast('That page would not render.');
  });
}

function bytesToBase64(bytes) {
  var CHUNK = 0x8000, out = '';
  for (var i = 0; i < bytes.length; i += CHUNK) {
    out += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
  }
  return btoa(out);
}
function base64ToBytes(b64) {
  var bin = atob(b64), bytes = new Uint8Array(bin.length);
  for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

/* ================= Ink engine ================= */

function sizeInkCanvas(canvas, sheet, forcedH) {
  var wrap = canvas.parentElement;
  var w = wrap.offsetWidth;
  var h = forcedH || wrap.offsetHeight;
  if (!w || !h) return;
  var dpr = window.devicePixelRatio || 1;
  canvas.width = w * dpr;
  canvas.height = h * dpr;
  canvas.style.width = w + 'px';
  canvas.style.height = h + 'px';
  var ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

function redraw(canvas, strokes) {
  var ctx = canvas.getContext('2d');
  var dpr = window.devicePixelRatio || 1;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  strokes.forEach(function (s) { paintStroke(ctx, s); });
}

function paintStroke(ctx, s) {
  if (!s.pts.length) return;
  ctx.strokeStyle = s.color;
  if (s.pts.length === 1) {
    ctx.beginPath();
    ctx.arc(s.pts[0][0], s.pts[0][1], s.width / 2, 0, Math.PI * 2);
    ctx.fillStyle = s.color;
    ctx.fill();
    return;
  }
  for (var i = 1; i < s.pts.length; i++) {
    var a = s.pts[i - 1], b = s.pts[i];
    // pressure modulates width when the stylus reports it
    ctx.lineWidth = s.width * (0.55 + (b[2] || 0.5) * 0.9);
    ctx.beginPath();
    ctx.moveTo(a[0], a[1]);
    ctx.lineTo(b[0], b[1]);
    ctx.stroke();
  }
}

function attachInk(canvas, sheet, getStrokes) {
  var drawing = false;
  var live = null;

  function local(e) {
    var r = canvas.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top, e.pressure > 0 ? e.pressure : 0.5];
  }

  canvas.addEventListener('pointerdown', function (e) {
    if (tool === 'select') return;
    // Palm rejection: when stylus-only is on, ignore fingers.
    if (state.prefs.penOnly && e.pointerType !== 'pen') return;
    canvas.setPointerCapture(e.pointerId);
    e.preventDefault();

    if (tool === 'eraser') {
      drawing = true;
      eraseAt(local(e));
      return;
    }
    drawing = true;
    live = { color: state.prefs.penColor, width: state.prefs.penWidth, pts: [local(e)] };
    getStrokes().push(live);
    redraw(canvas, getStrokes());
  });

  canvas.addEventListener('pointermove', function (e) {
    if (!drawing) return;
    e.preventDefault();
    if (tool === 'eraser') { eraseAt(local(e)); return; }
    if (!live) return;

    var pts = (e.getCoalescedEvents ? e.getCoalescedEvents() : [e]);
    pts.forEach(function (p) {
      var r = canvas.getBoundingClientRect();
      live.pts.push([p.clientX - r.left, p.clientY - r.top, p.pressure > 0 ? p.pressure : 0.5]);
    });
    // draw only the new tail, so long strokes stay fast
    var ctx = canvas.getContext('2d');
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    paintStroke(ctx, { color: live.color, width: live.width, pts: live.pts.slice(-3) });
  });

  ['pointerup', 'pointercancel', 'pointerleave'].forEach(function (ev) {
    canvas.addEventListener(ev, function () {
      if (!drawing) return;
      drawing = false;
      live = null;
      save();
    });
  });

  function eraseAt(pt) {
    var strokes = getStrokes();
    var before = strokes.length;
    var hitR = Math.max(12, state.prefs.penWidth * 3);
    for (var i = strokes.length - 1; i >= 0; i--) {
      if (strokeNear(strokes[i], pt, hitR)) strokes.splice(i, 1);
    }
    if (strokes.length !== before) redraw(canvas, strokes);
  }
}

function strokeNear(stroke, pt, r) {
  for (var i = 0; i < stroke.pts.length; i++) {
    var dx = stroke.pts[i][0] - pt[0];
    var dy = stroke.pts[i][1] - pt[1];
    if (dx * dx + dy * dy <= r * r) return true;
  }
  return false;
}

/* ================= Creating sheets ================= */

function nextSpot() {
  var board = document.getElementById('board');
  return {
    x: board.scrollLeft + 40 + (state.sheets.length % 5) * 26,
    y: board.scrollTop + 34 + (state.sheets.length % 5) * 22
  };
}

function addNote() {
  var p = nextSpot();
  state.sheets.push({
    id: uid(), type: 'note', x: p.x, y: p.y, w: 340, h: 260,
    text: '', paper: state.prefs.paper, strokes: []
  });
  save();
  renderSheets();
}

function addTimer() {
  var p = nextSpot();
  state.sheets.push({
    id: uid(), type: 'timer', x: p.x, y: p.y,
    focusMins: 25, breakMins: 5, phase: 'focus',
    remaining: 25 * 60, running: false, rounds: 0
  });
  save();
  renderSheets();
}

var pdfInput = document.getElementById('pdf-input');
pdfInput.addEventListener('change', function () {
  var file = pdfInput.files[0];
  if (!file) return;
  if (file.size > 4 * 1024 * 1024) {
    toast('That PDF is over 4MB and may not fit in storage.');
  }
  file.arrayBuffer().then(function (buf) {
    var p = nextSpot();
    state.sheets.push({
      id: uid(), type: 'pdf', x: p.x, y: p.y, w: 420,
      filename: file.name.replace(/\.pdf$/i, ''),
      pdfData: bytesToBase64(new Uint8Array(buf)),
      page: 1, inkByPage: {}
    });
    save();
    renderSheets();
    toast('Added ' + file.name);
    pdfInput.value = '';
  });
});

/* ================= Timer ================= */

function buildTimer(sheet, el) {
  sheet.focusMins = sheet.focusMins || 25;
  sheet.breakMins = sheet.breakMins || 5;
  sheet.phase = sheet.phase || 'focus';
  sheet.rounds = sheet.rounds || 0;
  if (typeof sheet.remaining !== 'number') sheet.remaining = sheet.focusMins * 60;

  var R = 74, CIRC = 2 * Math.PI * R;

  var body = document.createElement('div');
  body.className = 'timer-body';
  body.innerHTML =
    '<div class="timer-dial">' +
      '<svg viewBox="0 0 168 168">' +
        '<circle class="timer-track" cx="84" cy="84" r="' + R + '"></circle>' +
        '<circle class="timer-progress" cx="84" cy="84" r="' + R + '" stroke-dasharray="' + CIRC + '" stroke-dashoffset="0"></circle>' +
      '</svg>' +
      '<div class="timer-readout"><div class="timer-clock">25:00</div><div class="timer-phase">FOCUS</div></div>' +
    '</div>' +
    '<div class="timer-controls"><button class="start"></button><button class="ghost reset">Reset</button></div>' +
    '<div class="timer-lengths"><span>focus</span><input type="number" min="1" max="180" class="focus-len">' +
    '<span>break</span><input type="number" min="1" max="60" class="break-len"><span>min</span></div>' +
    '<div class="timer-rounds"></div>';
  el.appendChild(body);

  var progress = body.querySelector('.timer-progress');
  var clock = body.querySelector('.timer-clock');
  var phaseLabel = body.querySelector('.timer-phase');
  var startBtn = body.querySelector('.start');
  var resetBtn = body.querySelector('.reset');
  var focusLen = body.querySelector('.focus-len');
  var breakLen = body.querySelector('.break-len');
  var roundsEl = body.querySelector('.timer-rounds');

  focusLen.value = sheet.focusMins;
  breakLen.value = sheet.breakMins;

  function total() { return (sheet.phase === 'focus' ? sheet.focusMins : sheet.breakMins) * 60; }

  function paint() {
    var m = Math.floor(sheet.remaining / 60), s = sheet.remaining % 60;
    clock.textContent = String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
    phaseLabel.textContent = sheet.phase === 'focus' ? 'FOCUS' : 'BREAK';
    progress.classList.toggle('resting', sheet.phase === 'break');
    var t = total();
    progress.setAttribute('stroke-dashoffset', String(CIRC * (t ? 1 - sheet.remaining / t : 0)));
    startBtn.textContent = sheet.running ? 'Pause' : 'Start';
    roundsEl.textContent = sheet.rounds === 1 ? '1 round done' : sheet.rounds + ' rounds done';
  }

  function stopTicking() {
    if (timerRuntimes[sheet.id]) { clearInterval(timerRuntimes[sheet.id]); delete timerRuntimes[sheet.id]; }
  }
  function startTicking() {
    stopTicking();
    timerRuntimes[sheet.id] = setInterval(tick, 1000);
  }
  function tick() {
    sheet.remaining--;
    if (sheet.remaining <= 0) {
      if (sheet.phase === 'focus') { sheet.rounds++; sheet.phase = 'break'; toast('Focus block done. Take the break.'); }
      else { sheet.phase = 'focus'; toast('Break over.'); }
      sheet.remaining = total();
      chime();
      save();
    }
    paint();
    if (sheet.remaining % 10 === 0) save();
  }

  startBtn.addEventListener('click', function () {
    sheet.running = !sheet.running;
    if (sheet.running) startTicking(); else stopTicking();
    save(); paint();
  });
  resetBtn.addEventListener('click', function () {
    sheet.running = false; stopTicking();
    sheet.remaining = total(); save(); paint();
  });

  function applyLen(input, key, fallback) {
    var v = parseInt(input.value, 10);
    if (!isFinite(v) || v < 1) v = fallback;
    sheet[key] = v;
    input.value = v;
    if (!sheet.running) sheet.remaining = total();
    save(); paint();
  }
  focusLen.addEventListener('change', function () { applyLen(focusLen, 'focusMins', 25); });
  breakLen.addEventListener('change', function () { applyLen(breakLen, 'breakMins', 5); });
  [focusLen, breakLen].forEach(function (i) {
    i.addEventListener('pointerdown', function (e) { e.stopPropagation(); });
  });

  if (sheet.running) startTicking();
  paint();
}

function chime() {
  try {
    var Ctx = window.AudioContext || window.webkitAudioContext;
    var ctx = new Ctx();
    var osc = ctx.createOscillator(), gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = 622;
    gain.gain.setValueAtTime(0.0001, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.13, ctx.currentTime + 0.03);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 1.1);
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 1.15);
  } catch (e) {}
}

/* ================= Tasks ================= */

var todoList = document.getElementById('todo-list');

function renderTodos() {
  todoList.innerHTML = '';
  state.todos.forEach(function (t) {
    var li = document.createElement('li');
    if (t.done) li.className = 'done';
    var cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = t.done;
    cb.addEventListener('change', function () { t.done = cb.checked; save(); renderTodos(); });
    var span = document.createElement('span');
    span.className = 'txt';
    span.textContent = t.text;
    var x = document.createElement('button');
    x.textContent = '\u2715';
    x.setAttribute('aria-label', 'Delete task');
    x.addEventListener('click', function () {
      state.todos = state.todos.filter(function (o) { return o.id !== t.id; });
      save(); renderTodos();
    });
    li.append(cb, span, x);
    todoList.appendChild(li);
  });
}

document.getElementById('todo-form').addEventListener('submit', function (e) {
  e.preventDefault();
  var input = document.getElementById('todo-input');
  var text = input.value.trim();
  if (!text) return;
  state.todos.push({ id: uid(), text: text, done: false });
  input.value = '';
  save(); renderTodos();
});

/* ================= Calendar ================= */

var calGrid = document.getElementById('cal-grid');
var calLabel = document.getElementById('cal-label');
var calDayTitle = document.getElementById('cal-day-title');
var eventForm = document.getElementById('event-form');
var eventList = document.getElementById('event-list');

function dateKey(d) {
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

function renderCalendar() {
  calGrid.innerHTML = '';
  var y = calCursor.getFullYear(), m = calCursor.getMonth();
  calLabel.textContent = calCursor.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });

  ['S','M','T','W','T','F','S'].forEach(function (d) {
    var e = document.createElement('div');
    e.className = 'cal-dow';
    e.textContent = d;
    calGrid.appendChild(e);
  });

  var offset = new Date(y, m, 1).getDay();
  var days = new Date(y, m + 1, 0).getDate();
  var today = dateKey(new Date());

  for (var i = 0; i < offset; i++) {
    var f = document.createElement('div');
    f.className = 'cal-cell faded';
    calGrid.appendChild(f);
  }
  for (var d = 1; d <= days; d++) {
    (function (day) {
      var key = dateKey(new Date(y, m, day));
      var cell = document.createElement('div');
      cell.className = 'cal-cell';
      if (key === today) cell.classList.add('today');
      if (key === selectedDate) cell.classList.add('selected');
      if (state.events[key] && state.events[key].length) cell.classList.add('has-event');
      cell.textContent = day;
      cell.addEventListener('click', function () {
        selectedDate = key; renderCalendar(); renderEvents();
      });
      calGrid.appendChild(cell);
    })(d);
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
  var parts = selectedDate.split('-');
  var d = new Date(+parts[0], +parts[1] - 1, +parts[2]);
  calDayTitle.textContent = d.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
  eventList.innerHTML = '';
  (state.events[selectedDate] || []).forEach(function (ev) {
    var li = document.createElement('li');
    var span = document.createElement('span');
    span.className = 'txt';
    span.textContent = ev.text;
    var x = document.createElement('button');
    x.textContent = '\u2715';
    x.setAttribute('aria-label', 'Delete event');
    x.addEventListener('click', function () {
      state.events[selectedDate] = state.events[selectedDate].filter(function (o) { return o.id !== ev.id; });
      save(); renderEvents(); renderCalendar();
    });
    li.append(span, x);
    eventList.appendChild(li);
  });
}

eventForm.addEventListener('submit', function (e) {
  e.preventDefault();
  var input = document.getElementById('event-input');
  var text = input.value.trim();
  if (!text || !selectedDate) return;
  if (!state.events[selectedDate]) state.events[selectedDate] = [];
  state.events[selectedDate].push({ id: uid(), text: text });
  input.value = '';
  save(); renderEvents(); renderCalendar();
});

document.querySelector('[data-action="cal-prev"]').addEventListener('click', function () {
  calCursor.setMonth(calCursor.getMonth() - 1); renderCalendar();
});
document.querySelector('[data-action="cal-next"]').addEventListener('click', function () {
  calCursor.setMonth(calCursor.getMonth() + 1); renderCalendar();
});

/* ================= Drawers & actions ================= */

var scrim = document.getElementById('scrim');

function closeDrawers() {
  document.querySelectorAll('.drawer').forEach(function (d) { d.classList.remove('open'); });
  scrim.classList.remove('show');
}
function toggleDrawer(id) {
  var el = document.getElementById(id);
  var wasOpen = el.classList.contains('open');
  closeDrawers();
  if (!wasOpen) { el.classList.add('open'); scrim.classList.add('show'); }
}
scrim.addEventListener('click', closeDrawers);

document.addEventListener('click', function (e) {
  var btn = e.target.closest('[data-action]');
  if (!btn) return;
  var a = btn.dataset.action;
  if (a === 'new-note') addNote();
  if (a === 'new-timer') addTimer();
  if (a === 'import-pdf') pdfInput.click();
  if (a === 'toggle-todo') toggleDrawer('todo-drawer');
  if (a === 'toggle-calendar') toggleDrawer('calendar-drawer');
  if (a === 'toggle-settings') toggleDrawer('settings-drawer');
  if (a === 'clear-board') {
    if (confirm('Remove every page and PDF from the table?')) {
      state.sheets = [];
      pdfDocCache = {};
      save(); renderSheets(); closeDrawers();
    }
  }
});

document.querySelectorAll('.tool-mode').forEach(function (b) {
  b.addEventListener('click', function () { setTool(b.dataset.tool); });
});

document.addEventListener('keydown', function (e) {
  if (e.target.matches('input, textarea')) return;
  if (e.key === 'v') setTool('select');
  if (e.key === 'p') setTool('pen');
  if (e.key === 'e') setTool('eraser');
  if (e.key === 'Escape') closeDrawers();
});

/* Re-fit ink canvases when the device rotates or the window resizes. */
var resizeTimer = null;
function refit() {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(function () { renderSheets(); }, 200);
}
window.addEventListener('resize', refit);
window.addEventListener('orientationchange', refit);

/* ================= Init ================= */

applyPrefs();
buildSettings();
buildInkTray();
setTool('select');
renderSheets();
renderTodos();
renderCalendar();
renderEvents();

})();
