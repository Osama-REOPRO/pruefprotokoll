import { TEMPLATE_TORE } from './template-tore.js';
import { db, uid, requestPersistence } from './db.js';

const TEMPLATES = { [TEMPLATE_TORE.id]: TEMPLATE_TORE };
const $app = document.getElementById('app');

// ---------- kleine Helfer ----------
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const buzz = (ms = 12) => { try { navigator.vibrate?.(ms); } catch {} };
const todayDE = () => new Date().toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });
const settings = {
  get(k, d) { try { return JSON.parse(localStorage.getItem('s.' + k)) ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem('s.' + k, JSON.stringify(v)); } catch {} },
};

// ---------- Darstellung (Hell / Dunkel / Sonne) & Schriftgröße ----------
const THEMES = ['hell', 'sonne', 'dunkel'];
function applyLook() {
  document.documentElement.dataset.theme = settings.get('theme', 'hell');
  document.documentElement.dataset.size = settings.get('size', 'normal');
}
applyLook();

// ---------- Zustand ----------
let insp = null;      // aktuell geöffnete Prüfung
let tpl = null;       // ihre Vorlage
let step = 0;         // 0 = Stammdaten, 1..n = Abschnitte, n+1 = Abschluss
let undoState = null;

const stepCount = () => tpl.sections.length + 2;
const allItems = () => tpl.sections.flatMap(s => s.items);

function stats() {
  const a = insp.answers, prev = insp.prev || {};
  let ok = 0, b = 0, open = 0, same = 0, changed = 0;
  for (const it of allItems()) {
    const s = a[it.id]?.s;
    if (s === 'ok') ok++; else if (s === 'b') b++; else open++;
    if (s && prev[it.id]?.s) (prev[it.id].s === s ? same++ : changed++);
  }
  return { ok, b, open, same, changed, total: ok + b + open };
}

function stepStatus(i) {
  if (i === 0) {
    const missing = tpl.header.flatMap(g => g.fields.filter(f => f.required && !insp.header[g.id]?.[f.key]));
    return missing.length ? 'open' : 'done';
  }
  if (i === stepCount() - 1) return insp.status === 'done' ? 'done' : 'open';
  const sec = tpl.sections[i - 1];
  const st = sec.items.map(it => insp.answers[it.id]?.s);
  if (st.includes('b')) return st.every(Boolean) ? 'defect' : 'defect-open';
  return st.every(Boolean) ? 'done' : (st.some(Boolean) ? 'partial' : 'open');
}

// ---------- Speichern ----------
let saveTimer = null;
function saveNow() {
  clearTimeout(saveTimer);
  insp.lastStep = step;
  const p = db.put('inspections', insp);
  p.then(() => showSaved());
  return p;
}
function saveSoon() { clearTimeout(saveTimer); saveTimer = setTimeout(saveNow, 400); markUnsaved(); }
function markUnsaved() { const el = document.getElementById('saved'); if (el) { el.textContent = '…'; el.classList.remove('ok'); } }
function showSaved() {
  const el = document.getElementById('saved');
  if (el) { el.textContent = '✓ gespeichert'; el.classList.add('ok'); }
}
// Bei Unterbrechung (Anruf, App-Wechsel, Bildschirm aus) sofort sichern
document.addEventListener('visibilitychange', () => { if (document.hidden && insp) saveNow(); else if (!document.hidden && insp) keepAwake(); });
window.addEventListener('pagehide', () => { if (insp) saveNow(); });

// Bildschirm während der Prüfung anlassen
let wakeLock = null;
async function keepAwake() {
  try { if ('wakeLock' in navigator && !wakeLock) { wakeLock = await navigator.wakeLock.request('screen'); wakeLock.addEventListener('release', () => wakeLock = null); } } catch {}
}
function releaseAwake() { try { wakeLock?.release(); } catch {} wakeLock = null; }

// ---------- Snackbar mit Rückgängig ----------
function snack(text, undoFn) {
  const el = document.getElementById('snack');
  el.innerHTML = `<span>${esc(text)}</span>${undoFn ? '<button data-act="undo">Rückgängig</button>' : ''}`;
  el.classList.add('show');
  undoState = undoFn || null;
  clearTimeout(el._t);
  el._t = setTimeout(() => { el.classList.remove('show'); undoState = null; }, 5000);
}

// ---------- Routing ----------
async function route() {
  closeJump();
  document.getElementById('snack').classList.remove('show');
  const h = location.hash.replace(/^#\/?/, '');
  const parts = h.split('/');
  if (parts[0] === 'p' && parts[1]) {
    if (!insp || insp.id !== parts[1]) {
      insp = await db.get('inspections', parts[1]);
      if (!insp) { location.hash = '#/'; return; }
      tpl = TEMPLATES[insp.templateId];
    }
    step = Math.max(0, Math.min(stepCount() - 1, parseInt(parts[2] ?? insp.lastStep ?? 0, 10) || 0));
    settings.set('last', { id: insp.id, step, at: Date.now() });
    keepAwake();
    renderStep();
  } else {
    if (insp) await saveNow();
    insp = null; tpl = null;
    releaseAwake();
    settings.set('last', null);
    renderHome();
  }
}
window.addEventListener('hashchange', route);
const go = (s) => { location.hash = `#/p/${insp.id}/${s}`; };

// ---------- Startseite ----------
async function renderHome() {
  const all = (await db.all('inspections')).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const drafts = all.filter(i => i.status !== 'done');
  const done = all.filter(i => i.status === 'done');
  const gates = await db.all('gates');
  const resume = drafts[0];

  $app.innerHTML = `
    <header class="bar">
      <div class="bar-title">Prüfprotokolle</div>
      <button class="icon-btn" data-act="size" aria-label="Schriftgröße">A<small>A</small></button>
      <button class="icon-btn" data-act="theme" aria-label="Darstellung">${{ hell: '☀︎', sonne: '◐', dunkel: '☾' }[settings.get('theme', 'hell')]}</button>
    </header>
    <main class="home">
      ${resume ? `
        <button class="resume-card" data-act="open" data-id="${resume.id}">
          <span class="eyebrow">Weitermachen</span>
          <strong>${esc(inspTitle(resume))}</strong>
          <span class="muted">${esc(inspSub(resume))}</span>
          ${progressMini(resume)}
        </button>` : ''}
      <button class="big-btn primary" data-act="new">＋ Neue Prüfung</button>
      ${gates.length ? `
        <section class="card">
          <h2>Bekanntes Tor erneut prüfen</h2>
          <input class="field" type="search" id="gateSearch" placeholder="Suchen: Kunde, Objekt, Standort, Fabr.-Nr." autocomplete="off">
          <div id="gateList">${gateListHTML(gates, '')}</div>
        </section>` : ''}
      ${drafts.length > 1 ? `<section class="card"><h2>Angefangen</h2>${drafts.slice(1).map(listRow).join('')}</section>` : ''}
      ${done.length ? `<section class="card"><h2>Abgeschlossen</h2>${done.slice(0, 30).map(listRow).join('')}</section>` : ''}
      ${!all.length ? `<p class="empty">Noch keine Prüfungen. Alles wird nur auf diesem Handy gespeichert und funktioniert auch ohne Netz.</p>` : ''}
    </main>`;

  const search = document.getElementById('gateSearch');
  search?.addEventListener('input', () => {
    document.getElementById('gateList').innerHTML = gateListHTML(gates, search.value);
  });
}

function inspTitle(i) {
  const o = i.header?.objekt || {}, k = i.header?.kunde || {};
  return o.name || o.strasse || k.name || 'Neue Prüfung';
}
function inspSub(i) {
  const t = i.header?.tor || {};
  return [t.standort, t.typ, i.status === 'done' ? i.datum : null].filter(Boolean).join(' · ') || 'Noch keine Angaben';
}
function progressMini(i) {
  const t = TEMPLATES[i.templateId];
  const items = t.sections.flatMap(s => s.items);
  const answered = items.filter(it => i.answers?.[it.id]?.s).length;
  const defects = items.filter(it => i.answers?.[it.id]?.s === 'b').length;
  return `<span class="mini-progress"><span style="width:${Math.round(answered / items.length * 100)}%"></span></span>
    <span class="muted small">${answered} von ${items.length} Punkten${defects ? ` · <b class="red">${defects} Mängel</b>` : ''}</span>`;
}
function listRow(i) {
  const defects = Object.values(i.answers || {}).filter(a => a.s === 'b').length;
  return `<button class="list-row" data-act="open" data-id="${i.id}">
    <span><strong>${esc(inspTitle(i))}</strong><br><span class="muted small">${esc(inspSub(i))}</span></span>
    ${i.status === 'done' ? (defects ? `<span class="pill red">${defects} Mängel</span>` : '<span class="pill green">o.B.</span>') : '<span class="pill">offen</span>'}
  </button>`;
}
function gateListHTML(gates, q) {
  q = q.trim().toLowerCase();
  const hits = gates.filter(g => !q || JSON.stringify(g.search || '').toLowerCase().includes(q)).slice(0, 12);
  if (!hits.length) return '<p class="muted">Nichts gefunden.</p>';
  return hits.map(g => `<button class="list-row" data-act="fromGate" data-id="${g.id}">
    <span><strong>${esc(g.label)}</strong><br><span class="muted small">${esc(g.sub)}</span></span><span class="chev">›</span></button>`).join('');
}

// Auswahl Tor oder Tür beim Anlegen
function openKindPicker() {
  const sheet = document.getElementById('sheet');
  sheet.innerHTML = `<div class="sheet-inner">
    <div class="sheet-grab"></div>
    <h2 class="sheet-h">Was wird geprüft?</h2>
    <button class="big-btn primary" data-act="newKind" data-kind="tor">Tor<br><span class="small">Prüfprotokoll kraftbetätigte Tore (ASR A1.7, DIN 14677)</span></button>
    <button class="big-btn" disabled>Tür<br><span class="small">Formular folgt, sobald das Türformular vorliegt</span></button>
  </div>`;
  sheet.classList.add('show');
}

async function newInspection(prefill = {}) {
  const tplNew = TEMPLATE_TORE;
  // Antworten der letzten Prüfung dieses Tors als Vorschlag (nicht als Antwort) mitnehmen
  const prev = prefill.prev || null;
  const answers = {};
  if (prev) for (const [id, a] of Object.entries(prev)) if (a.x !== undefined && a.x !== '') answers[id] = { x: structuredClone(a.x) };
  const rec = {
    id: uid(), templateId: tplNew.id, templateVersion: tplNew.version, status: 'draft',
    header: { kunde: {}, objekt: {}, tor: {}, antrieb: {}, fang: {}, ...structuredClone(prefill.header || {}) },
    customerId: prefill.customerId || null, siteId: prefill.siteId || null, gateId: prefill.gateId || null,
    prev, prevDatum: prefill.prevDatum || null,
    answers, remarks: '', angebot: false, ort: '', datum: todayDE(),
    sig: { ag: { name: '', img: null, absent: false }, an: { name: settings.get('techName', ''), img: null } },
    lastStep: 0,
  };
  await db.put('inspections', rec);
  insp = rec; tpl = tplNew;
  location.hash = `#/p/${rec.id}/0`;
}

// ---------- Kopfzeile + Fortschritt für alle Schritte ----------
function stepTitle(i) {
  if (i === 0) return 'Stammdaten';
  if (i === stepCount() - 1) return 'Abschluss';
  return tpl.sections[i - 1].title;
}
function topBar() {
  const n = stepCount();
  const segs = Array.from({ length: n }, (_, i) => `<span class="seg st-${stepStatus(i)} ${i === step ? 'cur' : ''}"></span>`).join('');
  return `
    <header class="bar">
      <button class="icon-btn" data-act="home" aria-label="Zur Übersicht">✕</button>
      <button class="bar-title as-btn" data-act="jump">
        <span class="small muted">${step + 1} / ${n} · ${esc(inspTitle(insp))}</span>
        <span class="t">${esc(stepTitle(step))} <span class="caret">▾</span></span>
      </button>
      <span id="saved" class="saved ok">✓ gespeichert</span>
    </header>
    <div class="segs" data-act="jump">${segs}</div>`;
}
function bottomBar(nextLabel, nextClass = '') {
  return `<nav class="bottom">
    <button class="nav-btn" data-act="prev" ${step === 0 ? 'disabled' : ''}>‹ Zurück</button>
    <button class="nav-btn next ${nextClass}" data-act="next">${nextLabel}</button>
  </nav>`;
}
function refreshChrome() {
  const segs = document.querySelector('.segs');
  if (segs) segs.outerHTML = topBar().match(/<div class="segs"[\s\S]*<\/div>/)[0];
  const nb = document.querySelector('.nav-btn.next');
  if (nb && step > 0 && step < stepCount() - 1) {
    const open = tpl.sections[step - 1].items.filter(it => !insp.answers[it.id]?.s).length;
    nb.textContent = open ? `Weiter (${open} leer) ›` : 'Weiter ›';
    nb.classList.toggle('ready', !open);
  }
  if (step > 0 && step < stepCount() - 1) {
    const untouched = tpl.sections[step - 1].items.filter(it => !insp.answers[it.id]?.s);
    const ok = document.querySelector('[data-act="allOk"]');
    if (ok) ok.disabled = !untouched.length;
    const last = document.querySelector('[data-act="asLast"]');
    if (last) last.disabled = !untouched.some(it => insp.prev?.[it.id]?.s);
  }
}

function renderStep() {
  if (step === 0) return renderHeader();
  if (step === stepCount() - 1) return renderFinish();
  return renderSection(tpl.sections[step - 1]);
}

// ---------- Schritt 0: Stammdaten ----------
function renderHeader() {
  const groups = tpl.header.map(g => {
    const vals = insp.header[g.id] || {};
    const filled = g.fields.filter(f => vals[f.key]).length;
    return `<section class="card form-group">
      <h2>${esc(g.title)} <span class="muted small">${filled}/${g.fields.length}</span></h2>
      <div class="grid">
      ${g.fields.map(f => `
        <label class="fld ${f.half ? 'half' : ''}">
          <span class="lbl">${esc(f.label)}${f.required ? ' <i class="req">*</i>' : ''}</span>
          <span class="inwrap">
            <input class="field" data-h="${g.id}.${f.key}" value="${esc(vals[f.key])}"
              ${f.inputmode ? `inputmode="${f.inputmode}"` : ''} enterkeyhint="next" autocomplete="off"
              ${f.hint ? `placeholder="${esc(f.hint)}"` : ''}>
            ${f.unit ? `<span class="unit">${esc(f.unit)}</span>` : ''}
          </span>
          ${f.suggest ? `<span class="chips">${f.suggest.map(s => `<button type="button" class="chip" data-act="fill" data-h="${g.id}.${f.key}" data-v="${esc(s)}">${esc(s)}</button>`).join('')}</span>` : ''}
        </label>`).join('')}
      </div>
    </section>`;
  }).join('');

  $app.innerHTML = `${topBar()}
    <main class="step">
      ${insp.gateId ? '<p class="hint">Daten vom letzten Mal übernommen. Nur prüfen, was sich geändert hat.</p>' : ''}
      ${groups}
    </main>
    ${bottomBar('Zur Prüfung ›', 'ready')}`;
}

// ---------- Prüfabschnitt ----------
const photoUrls = new Map(); // photoId -> objectURL
function thumbsHTML(ids = [], itemId = null, removable = false) {
  if (!ids.length) return '';
  return `<div class="thumbs">${ids.map(pid => `<span class="thumb" data-photo="${pid}">
      <img alt="" data-pid="${pid}" src="${photoUrls.get(pid) || ''}">
      ${removable ? `<button class="thumb-x" data-act="delPhoto" data-id="${itemId}" data-pid="${pid}" aria-label="Foto löschen">×</button>` : ''}
    </span>`).join('')}</div>`;
}
async function hydrateThumbs(root = document) {
  for (const img of root.querySelectorAll('img[data-pid]')) {
    const pid = img.dataset.pid;
    if (!photoUrls.has(pid)) {
      const rec = await db.get('photos', pid);
      if (!rec) continue;
      photoUrls.set(pid, URL.createObjectURL(rec.blob));
    }
    img.src = photoUrls.get(pid);
  }
}

function rowHTML(it) {
  const a = insp.answers[it.id] || {};
  const s = a.s;
  const p = insp.prev?.[it.id] || {};
  const ex = it.extra;
  let extra = '';
  if (ex?.type === 'single' || ex?.type === 'multi') {
    const sel = ex.type === 'multi' ? (a.x || []) : [a.x];
    extra = `<div class="chips opt">${ex.options.map(o => `<button class="chip ${sel.includes(o) ? 'on' : ''}" data-act="extra" data-id="${it.id}" data-v="${esc(o)}">${esc(o)}</button>`).join('')}</div>`;
  } else if (ex?.type === 'text') {
    extra = `<input class="field sm" data-x="${it.id}" value="${esc(a.x)}" placeholder="${esc(ex.placeholder || '')}" enterkeyhint="done" autocomplete="off">`;
  }
  // Mangel vom letzten Mal sichtbar machen, damit man prüft, ob er behoben ist
  const prevDefect = p.s === 'b' ? `<div class="prev-defect"><b>Letztes Mal Mangel${insp.prevDatum ? ` (${esc(insp.prevDatum)})` : ''}:</b> ${esc(p.note || 'ohne Beschreibung')}
      ${thumbsHTML(p.photos)}</div>` : '';
  const note = s === 'b' ? `
    <div class="defect">
      <div class="chips">${tpl.defectChips.map(c => `<button class="chip" data-act="chipNote" data-id="${it.id}" data-v="${esc(c)}">${esc(c)}</button>`).join('')}</div>
      <textarea class="field" rows="2" data-note="${it.id}" placeholder="Mangel beschreiben (Mikrofon auf der Tastatur geht auch)">${esc(a.note)}</textarea>
      ${thumbsHTML(a.photos, it.id, true)}
      <label class="photo-btn">📷 Foto aufnehmen<input type="file" accept="image/*" capture="environment" data-photo-for="${it.id}" hidden></label>
    </div>` : '';
  const ghost = (v) => !s && p.s === v ? 'ghost' : '';
  return `<div class="row ${s || ''} ${!s && p.s ? 'has-prev' : ''} ${p.s === 'b' ? 'was-b' : ''}" id="r-${it.id}">
    <div class="row-lbl">${esc(it.label)}</div>
    ${prevDefect}
    ${extra}
    <div class="seg2" role="group">
      <button class="s-ok ${s === 'ok' ? 'on' : ''} ${ghost('ok')}" data-act="set" data-id="${it.id}" data-v="ok"><b>✓</b> o.B.${ghost('ok') ? '<i>letztes Mal</i>' : ''}</button>
      <button class="s-b ${s === 'b' ? 'on' : ''} ${ghost('b')}" data-act="set" data-id="${it.id}" data-v="b"><b>✗</b> B.${ghost('b') ? '<i>letztes Mal</i>' : ''}</button>
    </div>
    ${note}
  </div>`;
}

function renderSection(sec) {
  const untouched = sec.items.filter(it => !insp.answers[it.id]?.s);
  const prevAvail = untouched.some(it => insp.prev?.[it.id]?.s);
  $app.innerHTML = `${topBar()}
    <main class="step">
      <div class="sec-tools">
        ${insp.prev ? `<button class="tool prev" data-act="asLast" ${prevAvail ? '' : 'disabled'}>↺ Wie letztes Mal</button>` : ''}
        <button class="tool ok" data-act="allOk" ${untouched.length ? '' : 'disabled'}>✓ Rest o.B.</button>
      </div>
      ${sec.items.map(rowHTML).join('')}
    </main>
    ${bottomBar(untouched.length ? `Weiter (${untouched.length} leer) ›` : 'Weiter ›', untouched.length ? '' : 'ready')}`;
  hydrateThumbs();
}

function rerenderRow(id) {
  const it = allItems().find(x => x.id === id);
  const el = document.getElementById('r-' + id);
  if (el) { el.outerHTML = rowHTML(it); hydrateThumbs(document.getElementById('r-' + id)); }
}

function setAnswer(id, v) {
  const a = insp.answers[id] || (insp.answers[id] = {});
  a.s = a.s === v ? undefined : v; // nochmal tippen = zurücknehmen
  // Mangel vom letzten Mal bestätigt: alte Beschreibung als Startpunkt übernehmen
  if (a.s === 'b' && !a.note && insp.prev?.[id]?.s === 'b') a.note = insp.prev[id].note || '';
  if (!a.s && !a.note && !a.x && !a.photos?.length) delete insp.answers[id];
  buzz(v === 'b' ? [10, 40, 10] : 12);
  rerenderRow(id);
  saveNow(); refreshChrome();
}

function bulk(sec, mode) {
  const before = structuredClone(insp.answers);
  let n = 0;
  for (const it of sec.items) {
    const a = insp.answers[it.id];
    if (a?.s) continue;
    const p = insp.prev?.[it.id];
    if (mode === 'last') {
      if (!p?.s) continue;
      insp.answers[it.id] = { ...(a || {}), s: p.s, ...(p.s === 'b' && !a?.note ? { note: p.note || '' } : {}) };
    } else insp.answers[it.id] = { ...(a || {}), s: 'ok' };
    n++;
  }
  buzz(20);
  saveNow(); renderStep();
  snack(mode === 'last' ? `${n} Punkte wie letztes Mal bestätigt` : `${n} Punkte auf o.B. gesetzt`, () => {
    insp.answers = before; saveNow(); renderStep();
  });
}

// Foto verkleinern (spart Speicher auf dem Handy) und ablegen
async function addPhoto(itemId, file) {
  const bmp = await createImageBitmap(file).catch(() => null);
  let blob = file;
  if (bmp) {
    const max = 1600, k = Math.min(1, max / Math.max(bmp.width, bmp.height));
    const c = document.createElement('canvas');
    c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
    c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
    blob = await new Promise(r => c.toBlob(r, 'image/jpeg', 0.8)) || file;
  }
  const pid = uid();
  await db.put('photos', { id: pid, inspectionId: insp.id, itemId, blob });
  const a = insp.answers[itemId] ||= {};
  (a.photos ||= []).push(pid);
  await saveNow();
  rerenderRow(itemId);
  buzz();
}

// ---------- Abschluss ----------
function renderFinish() {
  const st = stats();
  const defects = allItems().filter(it => insp.answers[it.id]?.s === 'b');
  if (!insp.ort) insp.ort = (insp.header.objekt?.plzOrt || '').replace(/^\s*\d{5}\s*/, '');
  const openSecs = tpl.sections.map((s, i) => ({ s, i, n: s.items.filter(it => !insp.answers[it.id]?.s).length })).filter(x => x.n);
  const savedSig = settings.get('techSig', null);

  $app.innerHTML = `${topBar()}
    <main class="step">
      <section class="card summary">
        <div class="tiles">
          <div class="tile green"><b>${st.ok}</b><span>o.B.</span></div>
          <div class="tile red"><b>${st.b}</b><span>B.</span></div>
          <div class="tile gray"><b>${st.open}</b><span>leer</span></div>
        </div>
        ${insp.prev ? `<p class="muted small center">Seit ${esc(insp.prevDatum || 'letztem Mal')}: ${st.same} unverändert bestätigt, <b>${st.changed} geändert</b></p>` : ''}
        ${st.open ? `
          <p class="muted">${st.open} Punkte bleiben leer (wie ein leeres Kästchen auf Papier). Zum Nachsehen antippen:</p>
          ${openSecs.map(x => `<button class="list-row" data-act="goto" data-step="${x.i + 1}"><span>${esc(x.s.title)}</span><span class="pill">${x.n} leer ›</span></button>`).join('')}` : ''}
      </section>

      <section class="card">
        <h2>Bemerkungen / Festgestellte Mängel</h2>
        ${defects.length ? `<ol class="defects">${defects.map(it => {
          const a = insp.answers[it.id];
          const sIdx = tpl.sections.findIndex(s => s.items.includes(it)) + 1;
          return `<li><button class="link" data-act="goto" data-step="${sIdx}"><b>${esc(it.label)}</b>${a.note ? `: ${esc(a.note)}` : ' <span class="red">(keine Beschreibung)</span>'}${a.photos?.length ? ` <span class="pill">📷 ${a.photos.length}</span>` : ''}</button></li>`;
        }).join('')}</ol>` : ''}
        <textarea class="field" rows="3" data-f="remarks" placeholder="${defects.length ? 'Weitere Bemerkungen' : 'z. B. Ohne Mängel'}">${esc(insp.remarks)}</textarea>
        ${!defects.length && !insp.remarks ? '<div class="chips"><button class="chip" data-act="remark" data-v="Ohne Mängel">Ohne Mängel</button></div>' : ''}
        <label class="toggle"><input type="checkbox" data-f="angebot" ${insp.angebot ? 'checked' : ''}><span>Kunde bittet um Angebot</span></label>
      </section>

      <section class="card">
        <div class="grid">
          <label class="fld half"><span class="lbl">Ort</span><input class="field" data-f="ort" value="${esc(insp.ort)}"></label>
          <label class="fld half"><span class="lbl">Datum</span><input class="field" data-f="datum" value="${esc(insp.datum)}" inputmode="numeric"></label>
        </div>
      </section>

      <section class="card">
        <h2>Unterschrift Auftraggeber</h2>
        <label class="toggle"><input type="checkbox" data-sig-absent ${insp.sig.ag.absent ? 'checked' : ''}><span>Niemand vor Ort zum Unterschreiben</span></label>
        <div class="${insp.sig.ag.absent ? 'hidden' : ''}" id="agBox">
          <input class="field" data-sig-name="ag" value="${esc(insp.sig.ag.name)}" placeholder="Name (z. B. i.A. Müller)">
          ${sigPadHTML('ag')}
        </div>
      </section>

      <section class="card">
        <h2>Unterschrift Auftragnehmer (Prüfer)</h2>
        <input class="field" data-sig-name="an" value="${esc(insp.sig.an.name)}" placeholder="Ihr Name">
        ${!insp.sig.an.img && savedSig ? `<button class="big-btn" data-act="useSig">Meine gespeicherte Unterschrift einsetzen</button>` : ''}
        ${sigPadHTML('an')}
        <label class="toggle"><input type="checkbox" id="rememberSig" ${settings.get('rememberSig', true) ? 'checked' : ''}><span>Name und Unterschrift für nächste Prüfungen merken</span></label>
      </section>
      <p class="disclaimer">${tpl.disclaimer.map(esc).join(' ')}</p>
    </main>
    <nav class="bottom">
      <button class="nav-btn" data-act="prev">‹ Zurück</button>
      ${insp.status === 'done'
        ? `<button class="nav-btn next ready" data-act="nextGate">＋ Nächstes Tor hier</button>`
        : `<button class="nav-btn next ready" data-act="finish">Abschließen ✓</button>`}
    </nav>`;
  initSigPad('ag'); initSigPad('an');
  saveSoon();
}

function sigPadHTML(who) {
  return `<div class="sigwrap"><canvas class="sig" id="sig-${who}"></canvas>
    <span class="sig-hint ${insp.sig[who].img ? 'hidden' : ''}">Hier mit dem Finger unterschreiben</span>
    <button class="sig-clear" data-act="sigClear" data-who="${who}">Löschen</button></div>`;
}
function initSigPad(who) {
  const c = document.getElementById('sig-' + who);
  if (!c) return;
  const dpr = window.devicePixelRatio || 1;
  const r = c.getBoundingClientRect();
  c.width = r.width * dpr; c.height = r.height * dpr;
  const ctx = c.getContext('2d');
  ctx.scale(dpr, dpr); ctx.lineWidth = 2.6; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  ctx.strokeStyle = '#0b2a6b';
  const img = insp.sig[who].img;
  if (img) { const im = new Image(); im.onload = () => ctx.drawImage(im, 0, 0, r.width, r.height); im.src = img; }
  let drawing = false, last = null;
  const pos = (e) => { const b = c.getBoundingClientRect(); return [e.clientX - b.left, e.clientY - b.top]; };
  c.addEventListener('pointerdown', e => { drawing = true; last = pos(e); c.setPointerCapture(e.pointerId); c.parentElement.querySelector('.sig-hint')?.classList.add('hidden'); });
  c.addEventListener('pointermove', e => {
    if (!drawing) return;
    const p = pos(e); ctx.beginPath(); ctx.moveTo(...last); ctx.lineTo(...p); ctx.stroke(); last = p;
  });
  const end = () => { if (!drawing) return; drawing = false; insp.sig[who].img = c.toDataURL('image/png'); saveNow(); };
  c.addEventListener('pointerup', end); c.addEventListener('pointercancel', end);
}

async function finish() {
  const st = stats();
  if (!st.ok && !st.b) { snack('Noch kein Prüfpunkt angekreuzt.'); return; }
  const missingDesc = allItems().filter(it => insp.answers[it.id]?.s === 'b' && !insp.answers[it.id].note);
  if (missingDesc.length) { snack(`${missingDesc.length} Mängel ohne Beschreibung.`); return; }
  if (!insp.sig.an.img) { snack('Bitte als Prüfer unterschreiben.'); return; }
  if (!insp.sig.ag.img && !insp.sig.ag.absent) { snack('Unterschrift Auftraggeber fehlt (oder „Niemand vor Ort“ ankreuzen).'); return; }

  if (document.getElementById('rememberSig')?.checked) {
    settings.set('techSig', insp.sig.an.img); settings.set('techName', insp.sig.an.name); settings.set('rememberSig', true);
  } else settings.set('rememberSig', false);

  await upsertMasterData();
  insp.status = 'done';
  insp.finishedAt = new Date().toISOString();
  await saveNow();
  buzz([20, 60, 20]);
  renderFinish();
  snack('Prüfung abgeschlossen und gespeichert.');
}

// Kunde, Objekt und Tor als eigene Datensätze ablegen, damit sie beim nächsten Mal vorbelegt sind
async function upsertMasterData() {
  const h = insp.header;
  insp.customerId ||= uid(); insp.siteId ||= uid(); insp.gateId ||= uid();
  await db.put('customers', { ...(await db.get('customers', insp.customerId) || {}), id: insp.customerId, ...h.kunde });
  await db.put('sites', { ...(await db.get('sites', insp.siteId) || {}), id: insp.siteId, customerId: insp.customerId, ...h.objekt });
  const gateData = Object.fromEntries(tpl.header.filter(g => g.scope === 'gate').map(g => [g.id, h[g.id] || {}]));
  await db.put('gates', {
    ...(await db.get('gates', insp.gateId) || {}), id: insp.gateId, siteId: insp.siteId, customerId: insp.customerId,
    templateId: tpl.id, data: gateData, lastInspectionId: insp.id, lastInspected: insp.datum,
    label: `${h.objekt.name || h.objekt.strasse || h.kunde.name || ''} · ${h.tor.standort || ''}`,
    sub: [h.tor.typ, h.tor.fabrNr && 'Nr. ' + h.tor.fabrNr, 'zuletzt ' + insp.datum].filter(Boolean).join(' · '),
    search: [h.kunde.name, h.objekt.name, h.objekt.strasse, h.objekt.plzOrt, h.tor.standort, h.tor.fabrNr, h.tor.typ].join(' '),
  });
}

async function fromGate(gateId) {
  const g = await db.get('gates', gateId);
  const site = await db.get('sites', g.siteId) || {};
  const cust = await db.get('customers', g.customerId) || {};
  const last = g.lastInspectionId ? await db.get('inspections', g.lastInspectionId) : null;
  const strip = ({ id, createdAt, updatedAt, customerId, ...rest }) => rest;
  await newInspection({ gateId, siteId: g.siteId, customerId: g.customerId,
    header: { kunde: strip(cust), objekt: strip(site), ...structuredClone(g.data) },
    prev: last ? structuredClone(last.answers) : null, prevDatum: last?.datum || null });
}
async function nextGateSameSite() {
  const { kunde, objekt } = insp.header;
  await saveNow();
  await newInspection({ siteId: insp.siteId, customerId: insp.customerId, header: { kunde, objekt } });
}

// ---------- Abschnittswahl (Bottom Sheet) ----------
function openJump() {
  const sheet = document.getElementById('sheet');
  const labels = { done: '✓', defect: '✗', 'defect-open': '✗', partial: '…', open: '', na: '–' };
  sheet.innerHTML = `<div class="sheet-inner">
    <div class="sheet-grab"></div>
    ${Array.from({ length: stepCount() }, (_, i) => {
      const s = stepStatus(i);
      let count = '';
      if (i > 0 && i < stepCount() - 1) {
        const items = tpl.sections[i - 1].items;
        count = `${items.filter(it => insp.answers[it.id]?.s).length}/${items.length}`;
      }
      return `<button class="list-row ${i === step ? 'cur' : ''}" data-act="goto" data-step="${i}">
        <span><span class="dot st-${s}">${labels[s] ?? ''}</span>${esc(stepTitle(i))}</span><span class="muted small">${count}</span></button>`;
    }).join('')}
  </div>`;
  sheet.classList.add('show');
}
function closeJump() { document.getElementById('sheet').classList.remove('show'); }

// ---------- Ereignisse ----------
document.addEventListener('click', async (e) => {
  const sheet = document.getElementById('sheet');
  if (e.target === sheet) return closeJump();
  const b = e.target.closest('[data-act]');
  if (!b) return;
  const act = b.dataset.act;
  switch (act) {
    case 'new': return openKindPicker();
    case 'newKind': closeJump(); return newInspection();
    case 'open': return (location.hash = `#/p/${b.dataset.id}`);
    case 'fromGate': return fromGate(b.dataset.id);
    case 'theme': { const t = settings.get('theme', 'hell'); settings.set('theme', THEMES[(THEMES.indexOf(t) + 1) % THEMES.length]); applyLook(); return renderHome(); }
    case 'size': { settings.set('size', settings.get('size', 'normal') === 'normal' ? 'gross' : 'normal'); return applyLook(); }
    case 'home': await saveNow(); return (location.hash = '#/');
    case 'jump': return openJump();
    case 'goto': closeJump(); return go(+b.dataset.step);
    case 'prev': return go(step - 1);
    case 'next': window.scrollTo(0, 0); return go(step + 1);
    case 'set': return setAnswer(b.dataset.id, b.dataset.v);
    case 'allOk': return bulk(tpl.sections[step - 1], 'ok');
    case 'asLast': return bulk(tpl.sections[step - 1], 'last');
    case 'delPhoto': {
      const a = insp.answers[b.dataset.id];
      a.photos = (a.photos || []).filter(x => x !== b.dataset.pid);
      db.del('photos', b.dataset.pid);
      saveNow(); return rerenderRow(b.dataset.id);
    }
    case 'undo': { const f = undoState; document.getElementById('snack').classList.remove('show'); return f?.(); }
    case 'fill': {
      const [g, k] = b.dataset.h.split('.');
      (insp.header[g] ||= {})[k] = b.dataset.v;
      document.querySelector(`input[data-h="${b.dataset.h}"]`).value = b.dataset.v;
      buzz(); return saveNow();
    }
    case 'extra': {
      const it = allItems().find(x => x.id === b.dataset.id);
      const a = insp.answers[it.id] ||= {};
      if (it.extra.type === 'multi') {
        const set = new Set(a.x || []); set.has(b.dataset.v) ? set.delete(b.dataset.v) : set.add(b.dataset.v); a.x = [...set];
      } else a.x = a.x === b.dataset.v ? undefined : b.dataset.v;
      document.getElementById('r-' + it.id).outerHTML = rowHTML(it);
      buzz(); return saveNow();
    }
    case 'chipNote': {
      const a = insp.answers[b.dataset.id];
      a.note = a.note ? `${a.note.replace(/[\s,]+$/, '')}, ${b.dataset.v}` : b.dataset.v;
      document.querySelector(`textarea[data-note="${b.dataset.id}"]`).value = a.note;
      buzz(); return saveNow();
    }
    case 'remark': insp.remarks = b.dataset.v; saveNow(); return renderFinish();
    case 'sigClear': {
      insp.sig[b.dataset.who].img = null; saveNow(); return renderFinish();
    }
    case 'useSig': insp.sig.an.img = settings.get('techSig', null); saveNow(); return renderFinish();
    case 'finish': return finish();
    case 'nextGate': return nextGateSameSite();
  }
});

document.addEventListener('input', (e) => {
  const t = e.target;
  if (!insp) return;
  if (t.dataset.h) { const [g, k] = t.dataset.h.split('.'); (insp.header[g] ||= {})[k] = t.value; return saveSoon(); }
  if (t.dataset.note) { (insp.answers[t.dataset.note] ||= {}).note = t.value; return saveSoon(); }
  if (t.dataset.x) { (insp.answers[t.dataset.x] ||= {}).x = t.value; return saveSoon(); }
  if (t.dataset.f) { insp[t.dataset.f] = t.type === 'checkbox' ? t.checked : t.value; return saveSoon(); }
  if (t.dataset.sigName) { insp.sig[t.dataset.sigName].name = t.value; return saveSoon(); }
  if ('sigAbsent' in t.dataset) { insp.sig.ag.absent = t.checked; document.getElementById('agBox').classList.toggle('hidden', t.checked); return saveSoon(); }
});
document.addEventListener('change', (e) => {
  const f = e.target.dataset?.photoFor;
  if (f && e.target.files?.[0]) { addPhoto(f, e.target.files[0]); e.target.value = ''; return; }
  if (e.target.type === 'checkbox') e.target.dispatchEvent(new Event('input', { bubbles: true })); });

// Enter springt ins nächste Feld (schnelles Tippen mit Handschuh)
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter' || e.target.tagName !== 'INPUT') return;
  e.preventDefault();
  const inputs = [...document.querySelectorAll('main input.field')];
  const i = inputs.indexOf(e.target);
  if (inputs[i + 1]) inputs[i + 1].focus(); else e.target.blur();
});

// ---------- Start ----------
(async function start() {
  requestPersistence();
  if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('./sw.js').catch(() => {});
  // Nach Unterbrechung direkt dort weitermachen, wo man war (innerhalb von 12 Stunden)
  const last = settings.get('last', null);
  if ((!location.hash || location.hash === '#/') && last && Date.now() - last.at < 12 * 3600e3) {
    location.hash = `#/p/${last.id}/${last.step}`;
  } else route();
})();
