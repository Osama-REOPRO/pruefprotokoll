import { TEMPLATE_TORE } from './template-tore.js';
import { TEMPLATE_TUER } from './template-tuer.js';
import { db, uid, requestPersistence } from './db.js';
import { printTore } from './print-tore.js';
import { printTuer } from './print-tuer.js';
import { LANG, setLang, startI18n } from './i18n.js';

const TEMPLATES = { [TEMPLATE_TORE.id]: TEMPLATE_TORE, [TEMPLATE_TUER.id]: TEMPLATE_TUER };
const BY_KIND = { tor: TEMPLATE_TORE, tuer: TEMPLATE_TUER };
const PRINTERS = { [TEMPLATE_TORE.id]: printTore, [TEMPLATE_TUER.id]: printTuer };
const STATE_BTN = { ok: ['s-ok', '✓', 'o.B.'], b: ['s-b', '✗', 'B.'], nv: ['s-nv', '–', 'n.v.'] };
// Kurzbeschreibung eines Tors oder einer Tür (Standort, Typ, Nummer) unabhängig vom Formular
function unitOf(i) {
  const t = TEMPLATES[i.templateId] || TEMPLATE_TORE, u = t.unit, h = i.header || {};
  const grp = h[u.group] || {};
  const val = (k) => grp[k] ?? Object.values(h).find(g => g && g[k])?.[k];
  return { noun: u.noun, standort: val(u.standort), typ: val(u.typ), nr: val(u.nr), nrLabel: u.nrLabel };
}
const unitSub = (u) => [u.typ, u.nr && `${u.nrLabel} ${u.nr}`].filter(Boolean).join(' · ');
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
const allItems = () => tpl.sections.flatMap(s => s.items).filter(it => it.id);
const isCheck = (it) => it.id && !it.noStatus;
const checkItems = () => allItems().filter(isCheck);

function stats() {
  const a = insp.answers, prev = insp.prev || {};
  let ok = 0, b = 0, nv = 0, open = 0, same = 0, changed = 0;
  for (const it of checkItems()) {
    const s = a[it.id]?.s;
    if (s === 'ok') ok++; else if (s === 'b') b++; else if (s === 'nv') nv++; else open++;
    if (s && prev[it.id]?.s) (prev[it.id].s === s ? same++ : changed++);
  }
  return { ok, b, nv, open, same, changed, total: ok + b + nv + open };
}

function stepStatus(i) {
  if (i === 0) {
    const missing = tpl.header.flatMap(g => g.fields.filter(f => f.required && !insp.header[g.id]?.[f.key]));
    return missing.length ? 'open' : 'done';
  }
  if (i === stepCount() - 1) return insp.status === 'done' ? 'done' : 'open';
  const sec = tpl.sections[i - 1];
  const st = sec.items.filter(isCheck).map(it => insp.answers[it.id]?.s);
  // Leere Zeile = trifft nicht zu (wie auf Papier). Abschnitt gilt als erledigt, sobald er angesehen wurde.
  if (st.includes('b')) return 'defect';
  return st.some(Boolean) || (insp.maxStep ?? 0) > i ? 'done' : 'open';
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
// Hinweise: kurz einblenden, blockieren keine Knöpfe (Tipps gehen durch)
function snack(text) {
  const el = document.getElementById('snack');
  el.textContent = text;
  el.classList.add('show');
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.remove('show'), 3500);
}

// Rückgängig erscheint genau dort, wo der Sammel-Knopf war, und verdeckt nichts
let undoTimer = null;
function undoInline(text, undoFn) {
  const tools = document.querySelector('.sec-tools');
  if (!tools) return;
  tools.innerHTML = `<div class="undo-bar"><span>${esc(text)}</span><button data-act="undo">↶ Rückgängig</button></div>`;
  undoState = undoFn;
  clearTimeout(undoTimer);
  undoTimer = setTimeout(() => { undoState = null; if (document.querySelector('.undo-bar')) renderStepKeepScroll(); }, 6000);
}
function renderStepKeepScroll() { const y = window.scrollY; renderStep(); window.scrollTo(0, y); }

// ---------- Routing ----------
let lastHash = '';
async function route() {
  if (location.hash !== lastHash) { lastHash = location.hash; window.scrollTo(0, 0); }
  closeJump();
  document.getElementById('snack').classList.remove('show');
  const h = location.hash.replace(/^#\/?/, '');
  const parts = h.split('/');
  if ((parts[0] === 'druck' || parts[0] === 'druck-t') && parts[1]) {
    if (insp) await saveNow();
    releaseAwake();
    if (parts[0] === 'druck') {
      const r = await db.get('inspections', parts[1]);
      return renderPrint([parts[1]], `#/p/${parts[1]}/${(TEMPLATES[r?.templateId]?.sections.length ?? 0) + 1}`);
    }
    const v = await db.get('visits', parts[1]);
    const ids = (await visitItems(v)).map(i => i.id);
    return renderPrint(ids, `#/t/${v.id}`);
  }
  if (parts[0] === 't' && parts[1]) {
    if (insp) await saveNow();
    insp = null; tpl = null;
    releaseAwake();
    settings.set('last', null);
    visit = await db.get('visits', parts[1]);
    if (!visit) { location.hash = '#/'; return; }
    return parts[2] === 'edit' ? renderVisitEdit() : renderVisit();
  }
  if (parts[0] === 'p' && parts[1]) {
    if (!insp || insp.id !== parts[1]) {
      insp = await db.get('inspections', parts[1]);
      if (!insp) { location.hash = '#/'; return; }
      tpl = TEMPLATES[insp.templateId];
      // Name des Kunden-Unterzeichners vom letzten Tor dieses Termins vorschlagen
      if (insp.visitId && !insp.sig.ag.name && insp.status !== 'done') {
        const v = await db.get('visits', insp.visitId);
        if (v?.agName) insp.sig.ag.name = v.agName;
      }
    }
    step = Math.max(0, Math.min(stepCount() - 1, parseInt(parts[2] ?? insp.lastStep ?? 0, 10) || 0));
    if (step > (insp.maxStep ?? 0)) insp.maxStep = step;
    settings.set('last', { id: insp.id, step, at: Date.now() });
    keepAwake();
    renderStep();
  } else {
    if (insp) await saveNow();
    insp = null; tpl = null; visit = null;
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
  const visits = await db.all('visits');
  const vInfo = await Promise.all(visits.map(async v => ({ v, items: await visitItems(v) })));
  const isDone = ({ items }) => items.length && items.every(i => i.status === 'done');
  const open = vInfo.filter(x => !isDone(x)).sort((a, b) => dateKey(a.v.datum).localeCompare(dateKey(b.v.datum)));
  const done = vInfo.filter(isDone).sort((a, b) => dateKey(b.v.datum).localeCompare(dateKey(a.v.datum)));
  const single = all.filter(i => !i.visitId);
  const resume = all.find(i => i.status !== 'done' && Object.keys(i.answers || {}).some(k => i.answers[k].s));

  $app.innerHTML = `
    <header class="bar">
      <div class="bar-title">Prüfprotokolle</div>
      <button class="icon-btn" data-act="size" aria-label="Schriftgröße">A<small>A</small></button>
      <button class="icon-btn lang-btn" data-act="lang" aria-label="Sprache">${LANG === 'en' ? 'DE' : 'EN'}</button>
      <button class="icon-btn" data-act="theme" aria-label="Darstellung">${{ hell: '☀︎', sonne: '◐', dunkel: '☾' }[settings.get('theme', 'hell')]}</button>
    </header>
    <main class="home">
      ${resume ? `
        <button class="resume-card" data-act="open" data-id="${resume.id}">
          <span class="eyebrow">Weitermachen</span>
          <strong>${esc(unitOf(resume).standort || inspTitle(resume))}</strong>
          <span class="muted">${esc(inspTitle(resume))}</span>
          ${progressMini(resume)}
        </button>` : ''}
      <button class="big-btn primary" data-act="newVisit">＋ Neuer Termin</button>
      ${open.length ? `<section class="card"><h2>Termine</h2>${open.map(visitRow).join('')}</section>` : ''}
      ${done.length ? `<section class="card"><h2>Erledigt</h2>${done.slice(0, 30).map(visitRow).join('')}</section>` : ''}
      ${single.length ? `<section class="card"><h2>Einzelne Prüfungen</h2>${single.slice(0, 30).map(listRow).join('')}</section>` : ''}
      ${!all.length && !visits.length ? `<p class="empty">Noch keine Termine. Im Büro einen Termin anlegen: Kunde, Objekt und die Tore eintragen. Vor Ort dann nur noch die Checkliste.<br><br>Alles wird nur auf diesem Handy gespeichert und funktioniert auch ohne Netz.</p>` : ''}
    </main>`;
}
// "17.11.2026" -> "2026-11-17" zum Sortieren
function dateKey(d = '') { const m = String(d).match(/(\d{1,2})\.(\d{1,2})\.(\d{2,4})/); return m ? `${m[3].padStart(4, '20')}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}` : '0000'; }
function visitRow({ v, items }) {
  const done = items.filter(i => i.status === 'done').length;
  const defects = items.filter(i => i.status === 'done' && Object.values(i.answers || {}).some(a => a.s === 'b')).length;
  const today = dateKey(v.datum) === dateKey(todayDE());
  return `<div class="row-wrap"><button class="list-row" data-act="openVisit" data-id="${v.id}">
    <span><strong>${esc(visitTitle(v))}</strong><br>
      <span class="muted small">${today ? '<b class="today">Heute</b> · ' : esc(v.datum || '') + ' · '}${esc(v.kunde?.name || '')}</span><br>
      <span class="muted small">${items.length ? `${done} von ${items.length} fertig` : 'noch keine Tore'}${defects ? ` · <b class="red">${defects} mit Mängeln</b>` : ''}</span></span>
    <span class="chev">›</span></button><button class="more-btn" data-act="menu" data-for="visit" data-id="${v.id}" aria-label="Mehr">⋯</button></div>`;
}
const visitTitle = (v) => [v.objekt?.name, v.objekt?.strasse].filter(Boolean).join(', ') || v.kunde?.name || 'Neuer Termin';

function inspTitle(i) {
  const o = i.header?.objekt || {}, k = i.header?.kunde || {};
  return o.name || o.strasse || k.name || 'Neue Prüfung';
}
function inspSub(i) {
  const t = unitOf(i);
  return [t.noun, t.standort, t.typ, i.status === 'done' ? i.datum : null].filter(Boolean).join(' · ') || 'Noch keine Angaben';
}
function progressMini(i) {
  const t = TEMPLATES[i.templateId];
  const items = t.sections.flatMap(s => s.items).filter(isCheck);
  const answered = items.filter(it => i.answers?.[it.id]?.s).length;
  const defects = items.filter(it => i.answers?.[it.id]?.s === 'b').length;
  return `<span class="mini-progress"><span style="width:${Math.round(answered / items.length * 100)}%"></span></span>
    <span class="muted small">${answered} von ${items.length} Punkten${defects ? ` · <b class="red">${defects} Mängel</b>` : ''}</span>`;
}
function listRow(i) {
  const defects = Object.values(i.answers || {}).filter(a => a.s === 'b').length;
  return `<div class="row-wrap"><button class="list-row" data-act="open" data-id="${i.id}">
    <span><strong>${esc(inspTitle(i))}</strong><br><span class="muted small">${esc(inspSub(i))}</span></span>
    ${i.status === 'done' ? (defects ? `<span class="pill red">${defects} Mängel</span>` : '<span class="pill green">o.B.</span>') : '<span class="pill">offen</span>'}
  </button><button class="more-btn" data-act="menu" data-for="item" data-id="${i.id}" aria-label="Mehr">⋯</button></div>`;
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

async function newInspection(prefill = {}, { open = true, step: startStep = 0 } = {}) {
  const tplNew = TEMPLATES[prefill.templateId] || BY_KIND[prefill.kind] || TEMPLATE_TORE;
  // Antworten der letzten Prüfung dieses Tors als Vorschlag (nicht als Antwort) mitnehmen
  const prev = prefill.prev || null;
  const answers = {};
  if (prev) for (const [id, a] of Object.entries(prev)) if (a.x !== undefined && a.x !== '') answers[id] = { x: structuredClone(a.x) };
  const rec = {
    id: uid(), templateId: tplNew.id, templateVersion: tplNew.version, status: 'draft',
    header: { ...Object.fromEntries(tplNew.header.map(g => [g.id, {}])), ...structuredClone(prefill.header || {}) },
    customerId: prefill.customerId || null, siteId: prefill.siteId || null, gateId: prefill.gateId || null,
    visitId: prefill.visitId || null, order: prefill.order ?? Date.now(),
    prev, prevDatum: prefill.prevDatum || null, prevRemarks: prefill.prevRemarks || '',
    answers, remarks: '', angebot: false, ort: '', datum: todayDE(),
    sig: { ag: { name: prefill.agName || '', img: null, absent: false }, an: { name: settings.get('techName', ''), img: null } },
    lastStep: startStep,
  };
  await db.put('inspections', rec);
  if (open) { insp = rec; tpl = tplNew; location.hash = `#/p/${rec.id}/${startStep}`; }
  return rec;
}

// ---------- Kopfzeile + Fortschritt für alle Schritte ----------
function stepTitle(i) {
  if (i === 0) return 'Stammdaten';
  if (i === stepCount() - 1) return 'Abschluss';
  return tpl.sections[i - 1].title;
}
// Großer Bildschirm: Abschnitte dauerhaft links (auf dem Handy per CSS ausgeblendet)
function sideSteps() {
  const labels = { done: '✓', defect: '✗', open: '' };
  return `<aside class="side-steps">${Array.from({ length: stepCount() }, (_, i) => {
    const st = stepStatus(i);
    let count = '';
    if (i > 0 && i < stepCount() - 1) {
      const items = tpl.sections[i - 1].items.filter(isCheck);
      count = items.length ? `${items.filter(it => insp.answers[it.id]?.s).length}/${items.length}` : '';
    }
    return `<button class="side-step ${i === step ? 'cur' : ''}" data-act="goto" data-step="${i}"><span class="dot st-${st}">${labels[st] ?? ''}</span><span class="side-t">${esc(stepTitle(i))}</span><span class="muted small">${count}</span></button>`;
  }).join('')}
  <button class="side-help" data-act="keys">⌨ Tastenkürzel <kbd>?</kbd></button></aside>`;
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
      <button class="icon-btn" data-act="menu" data-for="insp" data-id="${insp.id}" aria-label="Mehr">⋯</button>
    </header>
    <div class="segs" data-act="jump">${segs}</div>${sideSteps()}`;
}
function bottomBar(nextLabel, nextClass = '') {
  return `<nav class="bottom">
    <button class="nav-btn" data-act="prev" ${step === 0 ? 'disabled' : ''}>‹ Zurück</button>
    <button class="nav-btn next ${nextClass}" data-act="next">${nextLabel}</button>
    <button class="kb-hint" data-act="keys"><kbd>1</kbd> o.B. <kbd>2</kbd> B.${(tpl.states || []).includes('nv') ? ' <kbd>3</kbd> n.v.' : ''} · <kbd>↑</kbd><kbd>↓</kbd> Zeile · <kbd>←</kbd><kbd>→</kbd> Abschnitt · <kbd>?</kbd> alle Kürzel</button>
  </nav>`;
}
function refreshChrome() {
  const segs = document.querySelector('.segs');
  if (segs) segs.outerHTML = `<div class="segs" data-act="jump">${Array.from({ length: stepCount() }, (_, i) => `<span class="seg st-${stepStatus(i)} ${i === step ? 'cur' : ''}"></span>`).join('')}</div>`;
  const side = document.querySelector('.side-steps');
  if (side) side.outerHTML = sideSteps();
  const nb = document.querySelector('.nav-btn.next');
  if (nb && step > 0 && step < stepCount() - 1) {
    const open = tpl.sections[step - 1].items.filter(isCheck).filter(it => !insp.answers[it.id]?.s).length;
    nb.textContent = 'Weiter ›';
  }
  if (step > 0 && step < stepCount() - 1) {
    const untouched = tpl.sections[step - 1].items.filter(isCheck).filter(it => !insp.answers[it.id]?.s);
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
  const groups = tpl.header.filter(g => !(insp.visitId && (g.scope === 'customer' || g.scope === 'site'))).map(g => {
    const vals = insp.header[g.id] || {};
    const filled = g.fields.filter(f => vals[f.key]).length;
    return `<section class="card form-group">
      <h2>${esc(g.title)} <span class="muted small">${filled}/${g.fields.length}</span></h2>
      <div class="grid">
      ${g.fields.filter(f => !f.showIf || vals[f.showIf[0]] === f.showIf[1]).map(f => f.type === 'choice' ? `
        <div class="fld">
          <span class="lbl">${esc(f.label)}</span>
          <span class="chips opt">${f.options.map(o => `<button type="button" class="chip ${vals[f.key] === o ? 'on' : ''}" data-act="hchoice" data-h="${g.id}.${f.key}" data-v="${esc(o)}">${esc(o)}</button>`).join('')}</span>
        </div>` : `
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
      ${insp.prev ? `<section class="card copy-last">
          <p><b>Nichts geändert seit ${esc(insp.prevDatum || 'letztem Mal')}?</b><br>Alle Häkchen, Angaben und Mängelbeschreibungen übernehmen und direkt zum Abschluss.</p>
          <button class="big-btn primary" data-act="copyAll">↺ Alles wie letztes Mal</button>
        </section>
        <p class="hint">Oder Daten unten prüfen und dann Abschnitt für Abschnitt bestätigen.</p>` : (insp.gateId ? '<p class="hint">Daten vom letzten Mal übernommen. Nur prüfen, was sich geändert hat.</p>' : '')}
      ${insp.visitId ? `<p class="hint">Kunde und Objekt kommen vom Termin: <b>${esc(visitTitle({ objekt: insp.header.objekt, kunde: insp.header.kunde }))}</b></p>` : ''}
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
  if (it.heading) return `<h3 class="row-head">${esc(it.heading)}</h3>`;
  const a = insp.answers[it.id] || {};
  // Nur Angabe, ohne o.B./B. (z. B. Typ, Anzahl bei der Feststellanlage)
  if (it.noStatus) {
    const input = it.choice
      ? `<div class="chips opt">${it.choice.map(o => `<button class="chip ${a.x === o ? 'on' : ''}" data-act="xchoice" data-id="${it.id}" data-v="${esc(o)}">${esc(o)}</button>`).join('')}</div>`
      : `<input class="field sm" data-x="${it.id}" value="${esc(a.x)}" ${it.inputmode ? `inputmode="${it.inputmode}"` : ''} enterkeyhint="next" autocomplete="off">`;
    return `<div class="row info" id="r-${it.id}"><label class="row-lbl">${esc(it.label)}</label>${input}</div>`;
  }
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
  const prevDefect = p.s === 'b' ? `<div class="prev-defect"><b>Letztes Mal B.${insp.prevDatum ? ` (${esc(insp.prevDatum)})` : ''}${p.note ? ':' : ''}</b> ${esc(p.note || '')}
      ${thumbsHTML(p.photos)}</div>` : '';
  const note = s === 'b' ? `
    <div class="defect">
      <div class="chips">${tpl.defectChips.map(c => `<button class="chip" data-act="chipNote" data-id="${it.id}" data-v="${esc(c)}">${esc(c)}</button>`).join('')}</div>
      <textarea class="field" rows="2" data-note="${it.id}" placeholder="Mangel beschreiben, steht auf dem Ausdruck neben der Zeile">${esc(a.note)}</textarea>
      ${thumbsHTML(a.photos, it.id, true)}
      <label class="photo-btn">📷 Foto aufnehmen<input type="file" accept="image/*" capture="environment" data-photo-for="${it.id}" hidden></label>
    </div>` : '';
  // Kurze Notiz neben jeder Zeile (kommt auf dem Ausdruck in den freien Platz neben das Kästchen)
  const shortNote = s === 'b' ? '' : (a.note || openNotes.has(it.id))
    ? `<div class="row-note"><input class="field sm" data-note="${it.id}" value="${esc(a.note)}" placeholder="${p.note ? 'letztes Mal: ' + esc(p.note) : 'Notiz zu dieser Zeile'}" enterkeyhint="done" autocomplete="off"></div>`
    : `<button class="note-btn" data-act="noteOpen" data-id="${it.id}">✎ Notiz${p.note ? ` <span class="muted">(letztes Mal: ${esc(p.note)})</span>` : ''}</button>`;
  const ghost = (v) => !s && p.s === v ? 'ghost' : '';
  return `<div class="row ${s || ''} ${!s && p.s ? 'has-prev' : ''} ${p.s === 'b' ? 'was-b' : ''}" id="r-${it.id}">
    <div class="row-lbl">${esc(it.label)}</div>
    ${prevDefect}
    ${extra}
    <div class="seg2 n${(tpl.states || ['ok', 'b']).length}" role="group">
      ${(tpl.states || ['ok', 'b']).map(v => { const [cls, icon, txt] = STATE_BTN[v];
        return `<button class="${cls} ${s === v ? 'on' : ''} ${ghost(v)}" data-act="set" data-id="${it.id}" data-v="${v}"><b>${icon}</b> ${txt}${ghost(v) ? '<i>letztes Mal</i>' : ''}</button>`; }).join('')}
    </div>
    ${shortNote}
    ${note}
  </div>`;
}
const openNotes = new Set();

function renderSection(sec) {
  const untouched = sec.items.filter(isCheck).filter(it => !insp.answers[it.id]?.s);
  const prevAvail = untouched.some(it => insp.prev?.[it.id]?.s);
  const t = unitOf(insp);
  const first = step === 1;
  const nothingYet = !Object.values(insp.answers).some(a => a.s);
  const summary = first ? `
    <button class="gate-sum" data-act="goto" data-step="0">
      <span><b>${esc(t.standort || `${t.noun} ohne Standort`)}</b><br><span class="muted small">${esc(t.noun)}${unitSub(t) ? ' · ' + esc(unitSub(t)) : ' · Daten eintragen'}</span></span>
      <span class="small link-ish">Daten ›</span>
    </button>
    ${insp.prev && nothingYet ? `<section class="card copy-last">
      <p><b>Nichts geändert seit ${esc(insp.prevDatum || 'letztem Mal')}?</b></p>
      <button class="big-btn primary" data-act="copyAll">↺ Alles wie letztes Mal</button></section>` : ''}` : '';
  $app.innerHTML = `${topBar()}
    <main class="step">
      ${summary}
      <div class="sec-tools">
        ${insp.prev ? `<button class="tool prev" data-act="asLast" ${prevAvail ? '' : 'disabled'}>↺ Wie letztes Mal</button>` : ''}
        <button class="tool ok" data-act="allOk" ${untouched.length ? '' : 'disabled'}>✓ Rest o.B.</button>
      </div>
      ${sec.items.map(rowHTML).join('')}
    </main>
    ${bottomBar('Weiter ›')}`;
  hydrateThumbs();
  kbIdx = -1;
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
  for (const it of sec.items.filter(isCheck)) {
    const a = insp.answers[it.id];
    if (a?.s) continue;
    const p = insp.prev?.[it.id];
    if (mode === 'last') {
      if (!p?.s) continue;
      insp.answers[it.id] = { ...(a || {}), s: p.s, ...(p.note && !a?.note ? { note: p.note } : {}) };
    } else insp.answers[it.id] = { ...(a || {}), s: 'ok' };
    n++;
  }
  buzz(20);
  saveNow(); renderStepKeepScroll();
  // Nur die Punkte zurücknehmen, die der Sammel-Knopf gesetzt hat und die seitdem nicht geändert wurden
  const filled = sec.items.filter(isCheck).filter(it => !before[it.id]?.s && insp.answers[it.id]?.s).map(it => [it.id, insp.answers[it.id].s]);
  undoInline(mode === 'last' ? `${n} wie letztes Mal bestätigt` : `${n} auf o.B. gesetzt`, () => {
    for (const [id, v] of filled) {
      if (insp.answers[id]?.s !== v) continue;
      if (before[id]) insp.answers[id] = before[id]; else delete insp.answers[id];
    }
    saveNow(); renderStepKeepScroll();
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
        <div class="tiles ${tpl.states?.includes('nv') ? 'four' : ''}">
          <div class="tile green"><b>${st.ok}</b><span>o.B.</span></div>
          <div class="tile red"><b>${st.b}</b><span>B.</span></div>
          ${tpl.states?.includes('nv') ? `<div class="tile gray"><b>${st.nv}</b><span>n.v.</span></div>
          <div class="tile gray"><b>${st.open}</b><span>leer</span></div>` : `<div class="tile gray"><b>${st.open}</b><span>trifft nicht zu</span></div>`}
        </div>
        ${insp.prev ? `<p class="muted small center">Seit ${esc(insp.prevDatum || 'letztem Mal')}: ${st.same} unverändert bestätigt, <b>${st.changed} geändert</b></p>` : ''}

      </section>

      <section class="card">
        <h2>Bemerkungen / Festgestellte Mängel</h2>
        ${defects.length ? `<ol class="defects">${defects.map(it => {
          const a = insp.answers[it.id];
          const sIdx = tpl.sections.findIndex(s => s.items.includes(it)) + 1;
          return `<li><button class="link" data-act="goto" data-step="${sIdx}"><b>${esc(it.label)}</b>${a.note ? `: ${esc(a.note)}` : ''}${a.photos?.length ? ` <span class="pill">📷 ${a.photos.length}</span>` : ''}</button></li>`;
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
      <button class="big-btn" data-act="print">🖨 Protokoll ansehen / drucken / PDF</button>
      <button class="big-btn ghost" data-act="duplicate" data-id="${insp.id}">⧉ ${esc(unitOf(insp).noun)} duplizieren (gleiche Häkchen)</button>
      <p class="disclaimer">${tpl.disclaimer.map(esc).join(' ')}</p>
      <button class="big-btn danger" data-act="askDel" data-kind="inspection" data-id="${insp.id}">🗑 Dieses Protokoll löschen</button>
    </main>
    <nav class="bottom">
      <button class="nav-btn" data-act="prev">‹ Zurück</button>
      ${insp.status === 'done'
        ? (insp.visitId ? `<button class="nav-btn next ready" data-act="nextInVisit">Nächstes ›</button>` : `<button class="nav-btn next ready" data-act="nextGate">＋ Nächstes Tor hier</button>`)
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
  // Nichts blockiert: fehlende Unterschriften werden nur erwähnt
  const unsigned = [!insp.sig.ag.img && !insp.sig.ag.absent && 'Auftraggeber', !insp.sig.an.img && 'Prüfer'].filter(Boolean);

  if (document.getElementById('rememberSig')?.checked) {
    settings.set('techSig', insp.sig.an.img); settings.set('techName', insp.sig.an.name); settings.set('rememberSig', true);
  } else settings.set('rememberSig', false);

  await upsertMasterData();
  if (insp.visitId && insp.sig.ag.name) {
    const v = await db.get('visits', insp.visitId);
    if (v) { v.agName = insp.sig.ag.name; await db.put('visits', v); }
  }
  insp.status = 'done';
  insp.finishedAt = new Date().toISOString();
  await saveNow();
  buzz([20, 60, 20]);
  renderFinish();
  snack(unsigned.length ? `Gespeichert. Ohne Unterschrift ${unsigned.join(' und ')}, kann später ergänzt werden.` : 'Prüfung abgeschlossen und gespeichert.');
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
    standort: unitOf(insp).standort || '',
    label: `${h.objekt.name || h.objekt.strasse || h.kunde.name || ''} · ${unitOf(insp).standort || ''}`,
    sub: [unitSub(unitOf(insp)), 'zuletzt ' + insp.datum].filter(Boolean).join(' · '),
    search: [h.kunde.name, h.objekt.name, h.objekt.strasse, h.objekt.plzOrt, unitOf(insp).standort, unitOf(insp).nr, unitOf(insp).typ].join(' '),
  });
}

const strip = ({ id, createdAt, updatedAt, customerId, ...rest }) => rest;
async function prefillFromGate(gateId) {
  const g = await db.get('gates', gateId);
  const site = await db.get('sites', g.siteId) || {};
  const cust = await db.get('customers', g.customerId) || {};
  const last = g.lastInspectionId ? await db.get('inspections', g.lastInspectionId) : null;
  return { gateId, siteId: g.siteId, customerId: g.customerId, templateId: g.templateId,
    header: { kunde: strip(cust), objekt: strip(site), ...structuredClone(g.data) },
    prev: last ? structuredClone(last.answers) : null, prevDatum: last?.datum || null, prevRemarks: last?.remarks || '' };
}
async function fromGate(gateId) { await newInspection(await prefillFromGate(gateId)); }
async function nextGateSameSite() {
  const { kunde, objekt } = insp.header;
  await saveNow();
  await newInspection({ siteId: insp.siteId, customerId: insp.customerId, header: { kunde, objekt } });
}

// Ganze letzte Prüfung übernehmen (Fotos nicht, die gehören zur alten Prüfung)
function copyAllFromLast() {
  const before = { answers: structuredClone(insp.answers), remarks: insp.remarks };
  let n = 0;
  for (const it of allItems()) {
    const p = insp.prev?.[it.id];
    if (!p?.s && p?.x === undefined) continue;
    const a = insp.answers[it.id] || {};
    insp.answers[it.id] = { ...a, ...(p.s ? { s: p.s } : {}), ...(p.x !== undefined ? { x: structuredClone(p.x) } : {}), ...(p.note || a.note ? { note: a.note || p.note } : {}) };
    if (p.s) n++;
  }
  if (!insp.remarks && insp.prevRemarks) insp.remarks = insp.prevRemarks;
  buzz([20, 60, 20]);
  saveNow();
  go(stepCount() - 1);
  setTimeout(() => snack(`${n} Punkte wie am ${insp.prevDatum || 'letzten Termin'} übernommen.`), 150);
}

// ---------- Termine (ein Kunde, ein Objekt, ein Datum, mehrere Tore/Türen) ----------
let visit = null;
async function visitItems(v) {
  if (!v) return [];
  return (await db.all('inspections')).filter(i => i.visitId === v.id).sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
}
function itemState(i) {
  const defects = Object.values(i.answers || {}).filter(a => a.s === 'b').length;
  if (i.status === 'done') return defects ? ['maengel', `fertig · ${defects} Mängel`] : ['fertig', 'fertig · o.B.'];
  if (Object.values(i.answers || {}).some(a => a.s)) return ['arbeit', 'in Arbeit'];
  return ['offen', 'offen'];
}
async function newVisit() {
  const v = { id: uid(), datum: todayDE(), kunde: {}, objekt: {}, customerId: uid(), siteId: uid(), agName: '' };
  await db.put('visits', v);
  location.hash = `#/t/${v.id}/edit`;
}
function openItem(i) {
  const last = TEMPLATES[i.templateId].sections.length + 1;
  const st = i.status === 'done' ? last : (i.lastStep > 0 ? i.lastStep : 1);
  location.hash = `#/p/${i.id}/${st}`;
}

// Tür/Tor duplizieren: gleiche Häkchen und Angaben, aber Standort und Nummer leer,
// damit die Kopie nicht versehentlich als dasselbe Element durchgeht. Notizen und Fotos gehören zum Original.
async function duplicateItem(id) {
  const src = await db.get('inspections', id);
  if (!src) return;
  const t = TEMPLATES[src.templateId];
  const header = structuredClone(src.header || {});
  const u = t.unit;
  if (header[u.group]) { delete header[u.group][u.standort]; delete header[u.group][u.nr]; }
  const answers = {};
  for (const [k, a] of Object.entries(src.answers || {})) {
    const c = {};
    if (a.s) c.s = a.s;
    if (a.x !== undefined && a.x !== '') c.x = structuredClone(a.x);
    if (Object.keys(c).length) answers[k] = c;
  }
  const rec = await newInspection({
    templateId: src.templateId, header, customerId: src.customerId, siteId: src.siteId, gateId: null,
    visitId: src.visitId, order: (src.order ?? 0) + 0.5, agName: src.sig?.ag?.name || '',
  }, { open: false });
  Object.assign(rec, { answers, angebot: !!src.angebot, ort: src.ort || '', copiedFrom: src.id, maxStep: t.sections.length });
  await db.put('inspections', rec);
  buzz();
  location.hash = `#/p/${rec.id}/0`;
  setTimeout(() => snack(`Kopie angelegt. Bitte Standort${u.nr ? ' und ' + u.nrLabel : ''} eintragen.`), 250);
}

// ---------- Löschen ----------
// Was mitgelöscht wird: Kunde -> seine Objekte, Termine, Protokolle; Objekt -> seine Türen/Tore, Termine, Protokolle;
// Termin -> seine Protokolle. Eine bekannte Tür / ein bekanntes Tor löscht nur den Stammdatensatz,
// alte Protokolle in früheren Terminen bleiben erhalten.
let pendingDelete = null;
async function deletePlan(kind, id) {
  const [customers, sites, gates, visits, inspections] = await Promise.all(['customers', 'sites', 'gates', 'visits', 'inspections'].map(x => db.all(x)));
  const p = { kind, id, customers: [], sites: [], gates: [], visits: [], inspections: [] };
  if (kind === 'customer') {
    p.customers = [id];
    p.sites = sites.filter(x => x.customerId === id).map(x => x.id);
  }
  if (kind === 'site') p.sites = [id];
  if (kind === 'customer' || kind === 'site') {
    const S = new Set(p.sites);
    p.gates = gates.filter(g => S.has(g.siteId) || (kind === 'customer' && g.customerId === id)).map(g => g.id);
    p.visits = visits.filter(v => S.has(v.siteId) || (kind === 'customer' && v.customerId === id)).map(v => v.id);
  }
  if (kind === 'visit') p.visits = [id];
  if (kind === 'gate') p.gates = [id];
  if (kind === 'inspection') p.inspections = [id];
  const V = new Set(p.visits), S = new Set(p.sites);
  if (kind !== 'gate' && kind !== 'inspection') p.inspections = inspections.filter(i => V.has(i.visitId) || S.has(i.siteId) || (kind === 'customer' && i.customerId === id)).map(i => i.id);
  p.name = kind === 'customer' ? customers.find(x => x.id === id)?.name
    : kind === 'site' ? [sites.find(x => x.id === id)?.name, sites.find(x => x.id === id)?.strasse].filter(Boolean).join(', ')
    : kind === 'visit' ? visitTitle(visits.find(x => x.id === id) || {})
    : kind === 'gate' ? (gates.find(x => x.id === id)?.standort || gates.find(x => x.id === id)?.label)
    : unitOf(inspections.find(x => x.id === id) || {}).standort;
  return p;
}
async function runDelete(p) {
  if (!p) return;
  const I = new Set(p.inspections);
  if (insp && I.has(insp.id)) { p.backTo = insp.visitId && !p.visits.includes(insp.visitId) ? `#/t/${insp.visitId}` : '#/'; clearTimeout(saveTimer); insp = null; tpl = null; }
  const photos = (await db.all('photos')).filter(ph => I.has(ph.inspectionId));
  for (const ph of photos) await db.del('photos', ph.id);
  for (const id of p.inspections) await db.del('inspections', id);
  for (const store of ['visits', 'gates', 'sites', 'customers']) for (const id of p[store]) await db.del(store, id);
  if (visit && p.visits.includes(visit.id)) visit = null;
}
function rerenderAfterDelete(p) {
  const h = location.hash;
  if (p?.backTo) return (location.hash = p.backTo);
  if (/^#\/t\//.test(h) && !visit) return (location.hash = '#/');
  if (/^#\/t\/.+\/edit/.test(h)) return renderVisitEdit();
  if (/^#\/t\//.test(h)) return renderVisit();
  return route();
}
async function askDelete(kind, id) {
  const p = await deletePlan(kind, id);
  pendingDelete = p;
  const noun = { customer: 'Kunde', site: 'Objekt', visit: 'Termin', gate: 'Tür / Tor', inspection: 'Protokoll' }[kind];
  const n = (k, one, many) => p[k].length ? `${p[k].length} ${p[k].length === 1 ? one : many}` : '';
  const also = [n('sites', 'Objekt', 'Objekte'), n('gates', 'Tür / Tor', 'Türen und Tore'), n('visits', 'Termin', 'Termine'), n('inspections', 'Protokoll', 'Protokolle')]
    .filter((x, i) => x && !(kind === 'site' && i === 0)).filter(x => !(kind === 'gate') && !(kind === 'inspection'));
  const note = kind === 'gate' ? 'Sie wird nicht mehr vorgeschlagen. Frühere Protokolle in alten Terminen bleiben erhalten.'
    : also.length ? `Dabei wird auch gelöscht: ${also.join(', ')}.` : '';
  const sheet = document.getElementById('sheet');
  sheet.innerHTML = `<div class="sheet-inner">
    <div class="sheet-grab"></div>
    <h2 class="sheet-h">${esc(noun)} löschen?</h2>
    <p><b>${esc(p.name || noun)}</b></p>
    ${note ? `<p class="muted">${esc(note)}</p>` : ''}
    <p class="muted small">Das lässt sich nicht rückgängig machen.</p>
    <button class="big-btn danger solid" data-act="confirmDel">🗑 Endgültig löschen</button>
    <button class="big-btn" data-act="cancelDel">Abbrechen</button>
  </div>`;
  sheet.classList.add('show');
}

// ⋯-Menü: Aktionen direkt dort, wo Termin, Kunde, Objekt oder Tür/Tor angezeigt wird
async function openMenu(forWhat, id) {
  const del = (kind, kid, label) => `<button class="big-btn danger-row" data-act="askDel" data-kind="${kind}" data-id="${kid}">🗑 ${esc(label)}</button>`;
  const go = (href, label) => `<button class="big-btn" data-act="menuGo" data-href="${href}">${label}</button>`;
  const btn = (act, kid, label) => `<button class="big-btn" data-act="${act}" data-id="${kid}">${label}</button>`;
  let title = '', rows = [];
  if (forWhat === 'visit' || forWhat === 'kunde' || forWhat === 'objekt') {
    const v = await db.get('visits', id); if (!v) return;
    const kName = v.kunde?.name || 'Kunde', oName = [v.objekt?.name, v.objekt?.strasse].filter(Boolean).join(', ') || 'Objekt';
    if (forWhat === 'visit') {
      title = visitTitle(v);
      rows = [go(`#/t/${v.id}/edit`, '✎ Termin bearbeiten'), go(`#/druck-t/${v.id}`, '🖨 Alle Protokolle drucken'), del('visit', v.id, 'Termin löschen'), del('site', v.siteId, `Objekt löschen: ${oName}`), del('customer', v.customerId, `Kunde löschen: ${kName}`)];
    } else if (forWhat === 'kunde') { title = kName; rows = [del('customer', v.customerId, 'Kunde löschen')]; }
    else { title = oName; rows = [del('site', v.siteId, 'Objekt löschen')]; }
  } else if (forWhat === 'site') {
    const st = await db.get('sites', id); if (!st) return;
    const c = st.customerId && await db.get('customers', st.customerId);
    title = [st.name, st.strasse].filter(Boolean).join(', ') || 'Objekt';
    rows = [del('site', st.id, 'Objekt löschen'), ...(c ? [del('customer', c.id, `Kunde löschen: ${c.name || ''}`)] : [])];
  } else if (forWhat === 'gate') {
    const g = await db.get('gates', id); if (!g) return;
    title = g.standort || g.label || 'Tür / Tor';
    rows = [del('gate', g.id, 'Nicht mehr vorschlagen (löschen)')];
  } else if (forWhat === 'item' || forWhat === 'insp') {
    const i = await db.get('inspections', id) || (insp?.id === id ? insp : null); if (!i) return;
    const u = unitOf(i);
    title = `${u.noun} · ${u.standort || 'ohne Standort'}`;
    const gate = i.gateId && await db.get('gates', i.gateId);
    rows = [
      ...(forWhat === 'item' ? [go(`#/p/${i.id}/0`, '✎ Daten bearbeiten')] : [go(`#/p/${i.id}/0`, '✎ Stammdaten')]),
      btn('duplicate', i.id, `⧉ Kopie anlegen (gleiche Häkchen)`),
      go(`#/druck/${i.id}`, '🖨 Drucken / PDF'),
      del('inspection', i.id, i.visitId ? `${u.noun} aus diesem Termin löschen` : 'Protokoll löschen'),
      ...(gate ? [del('gate', gate.id, `${u.noun} nicht mehr vorschlagen`)] : []),
    ];
  }
  const sheet = document.getElementById('sheet');
  sheet.innerHTML = `<div class="sheet-inner">
    <div class="sheet-grab"></div>
    <h2 class="sheet-h">${esc(title)}</h2>
    ${rows.join('')}
    <button class="big-btn" data-act="cancelDel">Abbrechen</button>
  </div>`;
  sheet.classList.add('show');
}

// Vor Ort: Liste der Tore, Antippen führt direkt zur Checkliste
async function renderVisit() {
  const v = visit, items = await visitItems(v);
  const done = items.filter(i => i.status === 'done').length;
  $app.innerHTML = `
    <header class="bar">
      <button class="icon-btn" data-act="toHome" aria-label="Übersicht">‹</button>
      <div class="bar-title"><span class="small muted block">${esc(v.datum || '')} · ${esc(v.kunde?.name || '')}</span>${esc(visitTitle(v))}</div>
      <button class="icon-btn" data-act="editVisit" aria-label="Termin bearbeiten">✎</button>
      <button class="icon-btn" data-act="menu" data-for="visit" data-id="${v.id}" aria-label="Mehr">⋯</button>
    </header>
    <main class="home">
      <section class="card visit-head">
        <div class="muted small">${esc([v.objekt?.strasse, v.objekt?.plzOrt].filter(Boolean).join(', '))}</div>
        <div class="vprog"><span class="mini-progress"><span style="width:${items.length ? Math.round(done / items.length * 100) : 0}%"></span></span>
        <b>${done} von ${items.length} fertig</b></div>
      </section>
      ${items.length ? items.map(i => {
        const [cls, label] = itemState(i);
        const t = unitOf(i);
        return `<div class="gate-line"><button class="gate-row st-${cls}" data-act="openItem" data-id="${i.id}">
          <span class="gate-ico">${{ fertig: '✓', maengel: '✗', arbeit: '…', offen: '' }[cls]}</span>
          <span class="gate-txt"><b>${esc(t.standort || `${t.noun} ohne Standort`)}</b><br><span class="muted small"><span class="kind">${esc(t.noun)}</span> ${esc(unitSub(t))}</span></span>
          <span class="pill ${cls === 'maengel' ? 'red' : cls === 'fertig' ? 'green' : ''}">${label}</span></button>
          <button class="dup-btn" data-act="menu" data-for="item" data-id="${i.id}" aria-label="Mehr zu ${esc(t.noun)}">⋯</button></div>`;
      }).join('') : '<p class="empty">Noch keine Tore oder Türen in diesem Termin.</p>'}
      <div class="two">
        <button class="big-btn" data-act="addNewGate" data-kind="tor">＋ Tor</button>
        <button class="big-btn" data-act="addNewGate" data-kind="tuer">＋ Tür</button>
      </div>
      ${items.length ? `<button class="big-btn" data-act="printVisit">🖨 ${items.length === 1 ? 'Protokoll' : `Alle ${items.length} Protokolle`} drucken / PDF</button>` : ''}
    </main>`;
}

// Im Büro: Kunde, Objekt, Datum und die Tore vorbereiten
async function renderVisitEdit() {
  const v = visit, items = await visitItems(v);
  const gates = (await db.all('gates')).filter(g => g.siteId === v.siteId && !items.some(i => i.gateId === g.id));
  const sites = await db.all('sites');
  const groupHTML = (gid) => {
    const g = TEMPLATE_TORE.header.find(x => x.id === gid);
    return `<section class="card form-group"><h2 class="h-menu">${esc(g.title)}<button class="more-btn" data-act="menu" data-for="${gid}" data-id="${v.id}" aria-label="Mehr zu ${esc(g.title)}">⋯</button></h2><div class="grid">${g.fields.map(f => `
      <label class="fld ${f.half ? 'half' : ''}"><span class="lbl">${esc(f.label)}${f.required ? ' <i class="req">*</i>' : ''}</span>
        <input class="field" data-vh="${gid}.${f.key}" value="${esc(v[gid]?.[f.key])}" enterkeyhint="next" autocomplete="off"></label>`).join('')}</div></section>`;
  };
  $app.innerHTML = `
    <header class="bar">
      <button class="icon-btn" data-act="openVisit" data-id="${v.id}" aria-label="Zum Termin">‹</button>
      <div class="bar-title">Termin vorbereiten</div>
      <span id="saved" class="saved ok">✓ gespeichert</span>
    </header>
    <main class="step">
      ${sites.length && !items.length && !v.sitePicked ? `<section class="card">
        <h2>Bekanntes Objekt?</h2>
        <input class="field" type="search" id="siteSearch" placeholder="Suchen: Kunde, Straße, Ort" autocomplete="off">
        <div id="siteList"></div>
      </section>` : ''}
      <section class="card"><label class="fld"><span class="lbl">Datum</span>
        <input class="field" data-vf="datum" value="${esc(v.datum)}" inputmode="numeric"></label></section>
      ${groupHTML('kunde')}
      ${groupHTML('objekt')}
      <section class="card">
        <h2>Tore und Türen in diesem Termin <span class="muted small">${items.length}</span></h2>
        ${items.map(i => {
          const t = unitOf(i);
          const started = i.status === 'done' || Object.values(i.answers || {}).some(a => a.s);
          return `<div class="list-row static"><button class="row-main" data-act="editItem" data-id="${i.id}"><span><b>${esc(t.standort || `${t.noun} ohne Standort`)}</b><br><span class="muted small"><span class="kind">${esc(t.noun)}</span> ${esc(unitSub(t) || 'Daten eintragen ›')}</span></span></button>
            <button class="mini-x" data-act="askDel" data-kind="inspection" data-id="${i.id}" data-quick="${started ? '' : '1'}" aria-label="Entfernen">×</button></div>`;
        }).join('')}
        ${gates.length ? `<h3 class="sub">Schon bekannt an diesem Objekt</h3>
          ${gates.map(g => `<div class="list-row static"><button class="row-main" data-act="addKnownGate" data-id="${g.id}">
            <span><b>${esc(g.standort || g.data?.tor?.standort || g.label)}</b><br><span class="muted small"><span class="kind">${esc(TEMPLATES[g.templateId]?.unit.noun || 'Tor')}</span> ${esc(g.sub)}</span></span><span class="pill">＋</span></button>
            <button class="more-btn" data-act="menu" data-for="gate" data-id="${g.id}" aria-label="Mehr">⋯</button></div>`).join('')}
          ${gates.length > 1 ? `<button class="big-btn" data-act="addAllKnown">Alle ${gates.length} hinzufügen</button>` : ''}` : ''}
        <div class="two">
          <button class="big-btn" data-act="addNewGate" data-kind="tor">＋ Neues Tor</button>
          <button class="big-btn" data-act="addNewGate" data-kind="tuer">＋ Neue Tür</button>
        </div>
      </section>
      <button class="big-btn danger" data-act="askDel" data-kind="visit" data-id="${v.id}">🗑 Termin löschen</button>
    </main>
    <nav class="bottom"><button class="nav-btn next ready" data-act="openVisit" data-id="${v.id}">Fertig ›</button></nav>`;

  const search = document.getElementById('siteSearch');
  if (search) {
    const custs = Object.fromEntries((await db.all('customers')).map(c => [c.id, c]));
    const draw = () => {
      const q = search.value.trim().toLowerCase();
      const hits = sites.filter(st => st.id !== v.siteId && (st.name || st.strasse || st.plzOrt)).filter(st => !q || [st.name, st.strasse, st.plzOrt, custs[st.customerId]?.name].join(' ').toLowerCase().includes(q)).slice(0, 8);
      document.getElementById('siteList').innerHTML = hits.map(st => `<div class="row-wrap"><button class="list-row" data-act="pickSite" data-id="${st.id}">
        <span><b>${esc([st.name, st.strasse].filter(Boolean).join(', '))}</b><br><span class="muted small">${esc([st.plzOrt, custs[st.customerId]?.name].filter(Boolean).join(' · '))}</span></span><span class="chev">›</span></button><button class="more-btn" data-act="menu" data-for="site" data-id="${st.id}" aria-label="Mehr">⋯</button></div>`).join('') || (q ? '<p class="muted">Nichts gefunden.</p>' : '');
    };
    search.addEventListener('input', draw); draw();
  }
}

let visitTimer = null;
function saveVisitSoon() { clearTimeout(visitTimer); markUnsaved(); visitTimer = setTimeout(saveVisit, 400); }
async function saveVisit() {
  clearTimeout(visitTimer);
  const v = visit;
  await db.put('visits', v);
  // Kunde und Objekt als eigene Datensätze, und in alle offenen Protokolle dieses Termins übernehmen
  await db.put('customers', { ...(await db.get('customers', v.customerId) || {}), id: v.customerId, ...v.kunde });
  await db.put('sites', { ...(await db.get('sites', v.siteId) || {}), id: v.siteId, customerId: v.customerId, ...v.objekt });
  for (const i of await visitItems(v)) {
    if (i.status === 'done') continue;
    i.header.kunde = structuredClone(v.kunde); i.header.objekt = structuredClone(v.objekt);
    i.customerId = v.customerId; i.siteId = v.siteId;
    await db.put('inspections', i);
  }
  showSaved();
}
async function pickSite(siteId) {
  const st = await db.get('sites', siteId);
  const c = await db.get('customers', st.customerId) || {};
  Object.assign(visit, { siteId: st.id, customerId: st.customerId, objekt: strip(st), kunde: strip(c), sitePicked: true });
  await saveVisit();
  renderVisitEdit();
}
async function addGateToVisit(gateId, kind = 'tor') {
  const v = visit;
  const pre = gateId ? await prefillFromGate(gateId) : { header: {}, kind };
  return newInspection({ ...pre, visitId: v.id, customerId: v.customerId, siteId: v.siteId, agName: v.agName,
    header: { ...pre.header, kunde: structuredClone(v.kunde), objekt: structuredClone(v.objekt) } }, { open: false, step: 1 });
}
async function nextInVisit() {
  await saveNow();
  const items = await visitItems({ id: insp.visitId });
  const idx = items.findIndex(i => i.id === insp.id);
  const next = [...items.slice(idx + 1), ...items.slice(0, idx)].find(i => i.status !== 'done');
  if (next) { insp = null; openItem(next); }
  else { location.hash = `#/t/${items[0]?.visitId}`; setTimeout(() => snack('Alle Tore dieses Termins sind fertig.'), 200); }
}

// ---------- Druckansicht (wie das Papierformular) ----------
async function renderPrint(ids, backHash) {
  let pages = '';
  for (const id of ids) {
    const rec = await db.get('inspections', id);
    if (!rec) continue;
    const t = TEMPLATES[rec.templateId];
    const photos = [];
    for (const it of t.sections.flatMap(s => s.items)) {
      const a = rec.answers[it.id];
      if (a?.s !== 'b') continue;
      for (const pid of a.photos || []) {
        const ph = await db.get('photos', pid);
        if (!ph) continue;
        if (!photoUrls.has(pid)) photoUrls.set(pid, URL.createObjectURL(ph.blob));
        photos.push({ url: photoUrls.get(pid), caption: `${it.label}${a.note ? ': ' + a.note : ''}` });
      }
    }
    pages += (PRINTERS[rec.templateId] || printTore)(rec, t, photos);
  }
  $app.innerHTML = `
    <div class="print-bar">
      <button class="pb-back" data-act="printBack" data-href="${esc(backHash)}">‹ Zurück</button>
      <button class="pb-print" data-act="doPrint" ${pages ? '' : 'disabled'}>🖨 Drucken / PDF</button>
    </div>
    <p class="print-hint">${ids.length > 1 ? `${ids.length} Protokolle. ` : ''}Vorschau im Format A4. Zum Speichern als PDF im Druckmenü „Als PDF sichern“ bzw. „Teilen“ wählen.</p>
    <div class="print-stage"><div class="print-scale">${pages || '<p class="empty">Noch kein abgeschlossenes Protokoll.</p>'}</div></div>`;
  fitPrint();
  window.scrollTo(0, 0);
}
function fitPrint() {
  const sc = document.querySelector('.print-scale');
  if (!sc) return;
  sc.style.transform = '';
  const pg = sc.querySelector('.ppage');
  if (!pg) return;
  const pageW = pg.offsetWidth;
  const k = Math.min(1, (document.documentElement.clientWidth - 16) / pageW);
  sc.style.transform = `scale(${k})`;
  sc.style.width = pageW + 'px';
  sc.style.marginLeft = Math.max(8, (document.documentElement.clientWidth - pageW * k) / 2) + 'px';
  sc.parentElement.style.height = sc.offsetHeight * k + 30 + 'px';
}
window.addEventListener('resize', fitPrint);
window.addEventListener('beforeprint', () => { const sc = document.querySelector('.print-scale'); if (sc) sc.style.transform = 'none'; });
window.addEventListener('afterprint', fitPrint);

// ---------- Abschnittswahl (Bottom Sheet) ----------
function openJump() {
  const sheet = document.getElementById('sheet');
  const labels = { done: '✓', defect: '✗', open: '' };
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
    case 'home': await saveNow(); return (location.hash = insp?.visitId ? `#/t/${insp.visitId}` : '#/');
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
    case 'undo': { const f = undoState; undoState = null; clearTimeout(undoTimer); return f?.(); }
    case 'fill': {
      const [g, k] = b.dataset.h.split('.');
      (insp.header[g] ||= {})[k] = b.dataset.v;
      document.querySelector(`input[data-h="${b.dataset.h}"]`).value = b.dataset.v;
      buzz(); return saveNow();
    }
    case 'hchoice': {
      const [g, k] = b.dataset.h.split('.');
      const grp = insp.header[g] ||= {};
      grp[k] = grp[k] === b.dataset.v ? '' : b.dataset.v;
      buzz(); saveNow(); return renderStepKeepScroll();
    }
    case 'xchoice': {
      const a = insp.answers[b.dataset.id] ||= {};
      a.x = a.x === b.dataset.v ? undefined : b.dataset.v;
      rerenderRow(b.dataset.id); buzz(); return saveNow();
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
    case 'noteOpen': {
      openNotes.add(b.dataset.id);
      const row = document.getElementById('r-' + b.dataset.id);
      const it = allItems().find(x => x.id === b.dataset.id);
      if (row && it) { row.outerHTML = rowHTML(it); document.querySelector(`input[data-note="${b.dataset.id}"]`)?.focus(); }
      return;
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
    case 'copyAll': return copyAllFromLast();
    case 'newVisit': return newVisit();
    case 'openVisit': if (visit) await saveVisit(); return (location.hash = `#/t/${b.dataset.id}`);
    case 'editVisit': return (location.hash = `#/t/${visit.id}/edit`);
    case 'toHome': return (location.hash = '#/');
    case 'openItem': return openItem(await db.get('inspections', b.dataset.id));
    case 'editItem': await saveVisit(); return (location.hash = `#/p/${b.dataset.id}/0`);
    case 'menu': return openMenu(b.dataset.for, b.dataset.id);
    case 'keys': return openKeys();
    case 'lang': setLang(LANG === 'en' ? 'de' : 'en'); return route();
    case 'menuGo': { closeJump(); return (location.hash = b.dataset.href); }
    case 'askDel': {
      if (b.dataset.quick) { const p = await deletePlan('inspection', b.dataset.id); await runDelete(p); return rerenderAfterDelete(p); }
      return askDelete(b.dataset.kind, b.dataset.id);
    }
    case 'confirmDel': { closeJump(); const p = pendingDelete; pendingDelete = null; await runDelete(p); buzz([20, 40, 20]); await rerenderAfterDelete(p); return setTimeout(() => snack('Gelöscht.'), 250); }
    case 'cancelDel': pendingDelete = null; return closeJump();
    case 'pickSite': return pickSite(b.dataset.id);
    case 'addKnownGate': await saveVisit(); await addGateToVisit(b.dataset.id); buzz(); return renderVisitEdit();
    case 'addAllKnown': {
      await saveVisit();
      const items = await visitItems(visit);
      for (const g of (await db.all('gates')).filter(g => g.siteId === visit.siteId && !items.some(i => i.gateId === g.id))) await addGateToVisit(g.id);
      buzz(); return renderVisitEdit();
    }
    case 'addNewGate': { await saveVisit(); const r = await addGateToVisit(null, b.dataset.kind || 'tor'); return (location.hash = `#/p/${r.id}/0`); }
    case 'printVisit': return (location.hash = `#/druck-t/${visit.id}`);
    case 'nextInVisit': return nextInVisit();
    case 'print': await saveNow(); return (location.hash = `#/druck/${insp.id}`);
    case 'printBack': return (location.hash = b.dataset.href || '#/');
    case 'doPrint': return window.print();
    case 'nextGate': return nextGateSameSite();
    case 'duplicate': { closeJump(); if (insp) await saveNow(); return duplicateItem(b.dataset.id); }
  }
});

document.addEventListener('input', (e) => {
  const t = e.target;
  if (!insp && visit && t.dataset.vh) { const [g, k] = t.dataset.vh.split('.'); (visit[g] ||= {})[k] = t.value; return saveVisitSoon(); }
  if (!insp && visit && t.dataset.vf) { visit[t.dataset.vf] = t.value; return saveVisitSoon(); }
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

// ---------- Tastenkürzel (für Tastatur am Rechner) ----------
const KEYS = [
  ['1 / O', 'o.B.'], ['2 / B', 'B. (Befund), danach direkt Notiz tippen'], ['3 / V', 'n.v. (Türen)'],
  ['↓ / J', 'nächste Zeile'], ['↑ / K', 'vorige Zeile'], ['N', 'Notiz zur Zeile'],
  ['→', 'nächster Abschnitt'], ['←', 'voriger Abschnitt'],
  ['A', 'Rest o.B.'], ['L', 'Wie letztes Mal'], ['P', 'Drucken / PDF'],
  ['Esc', 'Feld verlassen / Fenster schließen'], ['?', 'diese Hilfe'],
];
function openKeys() {
  const sheet = document.getElementById('sheet');
  sheet.innerHTML = `<div class="sheet-inner keys">
    <div class="sheet-grab"></div>
    <h2 class="sheet-h">Tastenkürzel</h2>
    <table class="keys-t">${KEYS.map(([k, d]) => `<tr><td>${k.split(' / ').map(x => `<kbd>${esc(x)}</kbd>`).join(' ')}</td><td>${esc(d)}</td></tr>`).join('')}</table>
    <p class="muted small">Gilt beim Ausfüllen der Prüfpunkte. In Textfeldern wird normal getippt, Esc springt zurück.</p>
    <button class="big-btn" data-act="cancelDel">Schließen</button>
  </div>`;
  sheet.classList.add('show');
}
let kbIdx = -1;
const kbRows = () => [...document.querySelectorAll('main.step .row')];
function kbSelect(i, scroll = true) {
  const rows = kbRows();
  if (!rows.length) return;
  kbIdx = Math.max(0, Math.min(rows.length - 1, i));
  rows.forEach((r, j) => r.classList.toggle('kb-cur', j === kbIdx));
  if (scroll) rows[kbIdx].scrollIntoView({ block: 'center', behavior: 'smooth' });
}
function kbCurId() { return kbRows()[kbIdx]?.id?.replace(/^r-/, ''); }
document.addEventListener('keydown', (e) => {
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  const t = e.target;
  const typing = t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable;
  const sheetOpen = document.getElementById('sheet').classList.contains('show');
  if (e.key === 'Escape') {
    if (sheetOpen) { e.preventDefault(); return closeJump(); }
    if (typing) { e.preventDefault(); const row = t.closest('.row'); t.blur(); if (row) kbSelect(kbRows().indexOf(row), false); }
    return;
  }
  if (typing || sheetOpen) return;
  const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  if (k === '?') { e.preventDefault(); return openKeys(); }
  if (!insp || !tpl) return;
  const inSection = step > 0 && step < stepCount() - 1;
  const click = (sel) => { const el = document.querySelector(sel); if (el && !el.disabled) { el.click(); return true; } return false; };
  if (k === 'ArrowRight') { e.preventDefault(); return click('.bottom [data-act=next], .bottom [data-act=finish], .bottom [data-act=nextInVisit], .bottom [data-act=nextGate]'); }
  if (k === 'ArrowLeft') { e.preventDefault(); return click('.bottom [data-act=prev]'); }
  if (k === 'p') { e.preventDefault(); saveNow(); return (location.hash = `#/druck/${insp.id}`); }
  if (!inSection) return;
  if (k === 'ArrowDown' || k === 'j') { e.preventDefault(); return kbSelect(kbIdx + 1); }
  if (k === 'ArrowUp' || k === 'k') { e.preventDefault(); return kbSelect(kbIdx - 1); }
  if (k === 'a') { e.preventDefault(); return click('[data-act=allOk]'); }
  if (k === 'l') { e.preventDefault(); return click('[data-act=asLast]'); }
  if (kbIdx < 0) kbSelect(0, false);
  const id = kbCurId();
  const row = kbRows()[kbIdx];
  if (!id || !row) return;
  if (k === 'Enter' && row.classList.contains('info')) { e.preventDefault(); return row.querySelector('input, .chip')?.focus(); }
  const state = { '1': 'ok', o: 'ok', '2': 'b', b: 'b', '3': 'nv', v: 'nv' }[k];
  if (state && row.querySelector(`[data-act=set][data-v=${state}]`)) {
    e.preventDefault();
    const was = insp.answers[id]?.s;
    setAnswer(id, state);
    kbSelect(kbIdx, false);
    if (state === 'b' && was !== 'b') return document.querySelector(`textarea[data-note="${id}"]`)?.focus();
    if (insp.answers[id]?.s) kbSelect(kbIdx + 1);
    return;
  }
  if (k === 'n') {
    e.preventDefault();
    const inp = row.querySelector('[data-note]');
    if (inp) return inp.focus();
    row.querySelector('[data-act=noteOpen]')?.click();
  }
});

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
  startI18n();
  if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('./sw.js').catch(() => {});
  // Nach Unterbrechung direkt dort weitermachen, wo man war (innerhalb von 12 Stunden)
  const last = settings.get('last', null);
  if ((!location.hash || location.hash === '#/') && last && Date.now() - last.at < 12 * 3600e3) {
    location.hash = `#/p/${last.id}/${last.step}`;
  } else route();
})();
