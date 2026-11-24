import { TEMPLATE_TORE } from './template-tore.js';
import { TEMPLATE_TUER } from './template-tuer.js';
import { db, uid, requestPersistence } from './db.js';
import { printTore } from './print-tore.js';
import { printTuer } from './print-tuer.js';
import { LANG, setLang, startI18n } from './i18n.js';
import { exportVisit, sendFile, importFile, fileName } from './sync.js';
import { renderGuide, guideHref, openGuideToc, openZoom, closeZoom } from './guide-view.js';

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
// Laptop / PC (Maus, großer Bildschirm): eigene, dichte Oberfläche. Handy und Tablet bleiben unverändert.
const deskMQ = matchMedia('(min-width: 1000px) and (hover: hover) and (pointer: fine)');
let DESK = false;
function applyDesk() { DESK = deskMQ.matches; document.documentElement.classList.toggle('desk', DESK); if (!DESK) document.getElementById('dknav').innerHTML = ''; }
applyDesk();
deskMQ.addEventListener('change', () => { applyDesk(); route(); });

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
  const tools = (DESK && document.querySelector(`#sec-${step} .sec-tools`)) || document.querySelector('.sec-tools');
  if (!tools) return;
  tools.innerHTML = `<div class="undo-bar"><span>${esc(text)}</span><button data-act="undo">↶ Rückgängig</button></div>`;
  undoState = undoFn;
  clearTimeout(undoTimer);
  undoTimer = setTimeout(() => { undoState = null; if (document.querySelector('.undo-bar')) renderStepKeepScroll(); }, 6000);
}
function renderStepKeepScroll() { const y = window.scrollY; if (DESK) renderAllDesk(null); else renderStep(); window.scrollTo(0, y); }

// ---------- Desktop: alle Abschnitte einer Prüfung auf einer Seite ----------
// Die einzelnen Schritte werden wie auf dem Handy erzeugt, hier aber gesammelt und untereinander gezeigt.
let COLLECT = null, deskShown = null;
function paint(html) {
  if (!COLLECT) { $app.innerHTML = html; return false; }
  let body = (html.match(/<main class="step">([\s\S]*)<\/main>/) || [])[1] || '';
  const nav = html.match(/<nav class="bottom">([\s\S]*)<\/nav>/);
  if (step === stepCount() - 1 && nav) body += `<div class="dk-finish-nav">${nav[1].replace(/<button class="nav-btn" data-act="prev">[^<]*<\/button>/, '')}</div>`;
  COLLECT.push(`<section class="dk-sec" id="sec-${step}" data-step="${step}">${body}</section>`);
  return true;
}
function renderAllDesk(target) {
  const keep = step;
  COLLECT = [];
  try { for (let i = 0; i < stepCount(); i++) { step = i; renderStep(); } }
  finally { var parts = COLLECT; COLLECT = null; step = keep; }
  $app.innerHTML = `${topBar()}<main class="step dk-all">${parts.join('')}</main>`;
  deskShown = insp.id;
  hydrateThumbs(); initSigPad('ag'); initSigPad('an');
  kbIdx = -1;
  refreshChrome();
  if (target != null) scrollToSec(target);
}
function scrollToSec(i) {
  const el = document.getElementById('sec-' + i);
  if (!el) return;
  spyLock = Date.now();
  window.scrollTo(0, i === 0 ? 0 : el.getBoundingClientRect().top + window.scrollY - 56);
  markSide(i);
  kbToSec(i);
}
// Tastatur-Auswahl in den Abschnitt mitnehmen (ohne zu scrollen)
function kbToSec(i) {
  const rows = kbRows(), cur = rows[kbIdx];
  if (cur && cur.closest('.dk-sec')?.dataset.step == i) return;
  const first = document.querySelector(`#sec-${i} .row`);
  rows.forEach(r => r.classList.remove('kb-cur'));
  kbIdx = first ? rows.indexOf(first) : -1;
  if (first) first.classList.add('kb-cur');
}
function markSide(i) {
  document.querySelectorAll('.side-step').forEach(b => b.classList.toggle('cur', +b.dataset.step === i));
}
// Beim Scrollen: Abschnitt links markieren und Adresse mitführen (ohne neu aufzubauen)
let spyLock = 0, spyRaf = 0;
window.addEventListener('scroll', () => {
  if (!DESK || spyRaf || !insp || !document.querySelector('main.dk-all')) return;
  spyRaf = requestAnimationFrame(() => {
    spyRaf = 0;
    if (Date.now() - spyLock < 150) return;
    let cur = 0;
    const atEnd = window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 4;
    document.querySelectorAll('.dk-sec').forEach(el => { if (el.getBoundingClientRect().top <= 140) cur = +el.dataset.step; });
    if (atEnd) cur = Math.max(cur, stepCount() - 1);
    if (cur === step) return;
    spySet(cur);
    const r = kbRows()[kbIdx]?.getBoundingClientRect();
    if (!r || r.bottom < 0 || r.top > innerHeight) kbToSec(cur);
  });
}, { passive: true });
function spySet(cur) {
  if (cur === step) return;
  step = cur; markSide(cur);
  const h = `#/p/${insp.id}/${cur}`;
  history.replaceState(null, '', h); lastHash = h;
  settings.set('last', { id: insp.id, step: cur, at: Date.now() });
}

// ---------- Routing ----------
let lastHash = '';
// Handbuch: merken, woher man kam, damit ✕ genau dorthin (und an dieselbe Stelle) zurückführt
let guideReturn = null, pendingY = null;
const isGuide = (h) => /^#\/handbuch/.test(h || '');
async function route() {
  if (isGuide(location.hash) && !isGuide(lastHash)) guideReturn = { hash: lastHash || '#/', y: window.scrollY };
  await routeInner();
  if (DESK) await renderNav();
  if (pendingY != null) { const y = pendingY; pendingY = null; requestAnimationFrame(() => window.scrollTo(0, y)); }
}
async function routeInner() {
  if (location.hash !== lastHash) { lastHash = location.hash; window.scrollTo(0, 0); }
  closeJump();
  closeZoom();
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
    const v = ensurePairs(await db.get('visits', parts[1]));
    const ids = (await visitItems(v)).filter(i => !parts[2] || pairOfItem(v, i).id === parts[2]).map(i => i.id);
    return renderPrint(ids, `#/t/${v.id}`);
  }
  if (parts[0] === 'handbuch') {
    if (insp) await saveNow();
    releaseAwake();
    return renderGuide($app, parts[1], parts[2]);
  }
  if (parts[0] === 't' && parts[1]) {
    if (insp) await saveNow();
    insp = null; tpl = null;
    releaseAwake();
    settings.set('last', null);
    visit = await db.get('visits', parts[1]);
    if (!visit) { location.hash = '#/'; return; }
    const migrate = !Array.isArray(visit.pairs);
    ensurePairs(visit);
    if (migrate) await saveVisit();
    return parts[2] === 'edit' ? renderVisitEdit() : renderVisit();
  }
  if (parts[0] === 'p' && parts[1]) {
    if (!insp || insp.id !== parts[1]) {
      insp = await db.get('inspections', parts[1]);
      if (!insp) { location.hash = '#/'; return; }
      tpl = TEMPLATES[insp.templateId];
      // Anzahl der Flügel steht jetzt unter Grunddaten Tür (früher bei Tür)
      if (insp.header?.tuer?.fluegel && !insp.header.grund?.fluegel) { (insp.header.grund ||= {}).fluegel = insp.header.tuer.fluegel; delete insp.header.tuer.fluegel; }
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
  if (DESK) return renderHomeDesk({ open, done, single, resume, all, visits });

  $app.innerHTML = `
    <header class="bar">
      <div class="bar-title">Prüfprotokolle</div>
      <a class="icon-btn as-a" href="#/handbuch" aria-label="Handbuch öffnen" title="Feldhandbuch">📖</a>
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
      <label class="big-btn recv-btn">⇅ Termin empfangen (Datei öffnen)<input type="file" accept=".json,application/json" data-import hidden></label>
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
      <span class="muted small">${today ? '<b class="today">Heute</b> · ' : esc(v.datum || '') + ' · '}${esc(visitKunden(v))}</span><br>
      <span class="muted small">${items.length ? `${done} von ${items.length} fertig` : 'noch keine Tore'}${defects ? ` · <b class="red">${defects} mit Mängeln</b>` : ''}</span></span>
    <span class="chev">›</span></button><button class="more-btn" data-act="menu" data-for="visit" data-id="${v.id}" aria-label="Mehr">⋯</button></div>`;
}
// Ein Termin hat eine Liste von Paaren aus Kunde + Objekt. Jede Tür / jedes Tor gehört zu genau einem Paar.
// Alte Termine (ein Kunde, ein Objekt) werden beim Laden in ein Paar umgewandelt, ohne Daten zu verlieren.
const pairsOf = (v) => (Array.isArray(v?.pairs) && v.pairs.length) ? v.pairs : [{ kunde: v?.kunde || {}, objekt: v?.objekt || {} }];
const uniq = (a) => [...new Set(a.filter(Boolean))];
const short = (list) => list.length > 2 ? `${list.slice(0, 2).join(', ')} +${list.length - 2}` : list.join(', ');
const visitTitle = (v) => short(uniq(pairsOf(v).map(p => [p.objekt?.name, p.objekt?.strasse].filter(Boolean).join(', ')))) || short(uniq(pairsOf(v).map(p => p.kunde?.name))) || 'Neuer Termin';
const visitKunden = (v) => short(uniq(pairsOf(v).map(p => p.kunde?.name)));
function ensurePairs(v) {
  if (!v) return v;
  if (!Array.isArray(v.pairs) || !v.pairs.length) {
    v.pairs = [{ id: uid(), customerId: v.customerId || uid(), siteId: v.siteId || uid(), kunde: v.kunde || {}, objekt: v.objekt || {} }];
  }
  if (!v.pairs.some(p => p.id === v.editPair)) v.editPair = v.pairs[0].id;
  if (v.filter !== 'all' && !v.pairs.some(p => p.id === v.filter)) v.filter = v.pairs.length > 1 ? 'all' : v.pairs[0].id;
  return v;
}
const pairById = (v, id) => v.pairs.find(p => p.id === id);
const editPair = (v) => pairById(v, v.editPair) || v.pairs[0];
const pairOfItem = (v, i) => pairById(v, i.pairId) || v.pairs.find(p => p.siteId === i.siteId && p.customerId === i.customerId) || v.pairs[0];
const pairLabel = (p) => [p.kunde?.name, p.objekt?.name || p.objekt?.strasse].filter(Boolean).join(' · ') || 'Neues Paar';

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
    visitId: prefill.visitId || null, pairId: prefill.pairId || null, order: prefill.order ?? Date.now(),
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
// Abschnittsname groß direkt über den Prüfpunkten (nicht nur klein in der Kopfzeile)
function secTitle(i = step) {
  let count = '';
  if (i > 0 && i < stepCount() - 1) {
    const items = tpl.sections[i - 1].items.filter(isCheck);
    if (items.length) count = `${items.filter(it => insp.answers[it.id]?.s).length}/${items.length}`;
  }
  return `<h1 class="sec-title"><span class="sec-n">${i + 1} / ${stepCount()}</span> ${esc(stepTitle(i))}${count ? ` <span class="sec-c">${count}</span>` : ''}</h1>`;
}
function topBar() {
  const n = stepCount();
  const segs = Array.from({ length: n }, (_, i) => `<span class="seg st-${stepStatus(i)} ${i === step ? 'cur' : ''}"></span>`).join('');
  return `
    <header class="bar">
      <button class="icon-btn" data-act="home" aria-label="Zur Übersicht">✕</button>
      <button class="bar-title as-btn" data-act="jump">
        <span class="small muted">${esc(inspTitle(insp))}</span>
        <span class="t">${esc(unitOf(insp).standort || unitOf(insp).noun)} <span class="caret">▾</span></span>
      </button>
      <span id="saved" class="saved ok">✓ gespeichert</span>
      <button class="icon-btn" data-act="menu" data-for="insp" data-id="${insp.id}" aria-label="Mehr">⋯</button>
    </header>
    <div class="segs" data-act="jump">${segs}</div>${DESK ? '' : sideSteps()}`;
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
  if (DESK) document.querySelectorAll('.dk-sec').forEach(el => { const t = el.querySelector('.sec-title'); if (t) t.outerHTML = secTitle(+el.dataset.step); });
  else { const st = document.querySelector('.sec-title'); if (st) st.outerHTML = secTitle(); }
  const nb = document.querySelector('.nav-btn.next');
  if (!DESK && nb && step > 0 && step < stepCount() - 1) {
    const open = tpl.sections[step - 1].items.filter(isCheck).filter(it => !insp.answers[it.id]?.s).length;
    nb.textContent = 'Weiter ›';
  }
  const tools = (i, root) => {
    const untouched = tpl.sections[i - 1].items.filter(isCheck).filter(it => !insp.answers[it.id]?.s);
    const ok = root.querySelector('[data-act="allOk"]');
    if (ok) ok.disabled = !untouched.length;
    const last = root.querySelector('[data-act="asLast"]');
    if (last) last.disabled = !untouched.some(it => insp.prev?.[it.id]?.s);
  };
  if (DESK) document.querySelectorAll('.dk-sec').forEach(el => { const i = +el.dataset.step; if (i > 0 && i < stepCount() - 1) tools(i, el); });
  else if (step > 0 && step < stepCount() - 1) tools(step, document);
}

function renderStep() {
  if (DESK && !COLLECT) {
    if (deskShown === insp.id && document.querySelector('main.dk-all')) return scrollToSec(step);
    return renderAllDesk(step);
  }
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
              ${f.hint ? `placeholder="${esc(f.hint)}"` : ''} ${DESK && f.suggest ? `list="dl-${g.id}-${f.key}"` : ''}>
            ${DESK && f.suggest ? `<datalist id="dl-${g.id}-${f.key}">${f.suggest.map(x => `<option value="${esc(x)}">`).join('')}</datalist>` : ''}
            ${f.unit ? `<span class="unit">${esc(f.unit)}</span>` : ''}
          </span>
          ${f.suggest && !DESK ? `<span class="chips">${f.suggest.map(s => `<button type="button" class="chip" data-act="fill" data-h="${g.id}.${f.key}" data-v="${esc(s)}">${esc(s)}</button>`).join('')}</span>` : ''}
        </label>`).join('')}
      </div>
    </section>`;
  }).join('');

  if (paint(`${topBar()}
    <main class="step">
      ${secTitle()}
      ${insp.prev ? `<section class="card copy-last">
          <p><b>Nichts geändert seit ${esc(insp.prevDatum || 'letztem Mal')}?</b><br>Alle Häkchen, Angaben und Mängelbeschreibungen übernehmen und direkt zum Abschluss.</p>
          <button class="big-btn primary" data-act="copyAll">↺ Alles wie letztes Mal</button>
        </section>
        <p class="hint">Oder Daten unten prüfen und dann Abschnitt für Abschnitt bestätigen.</p>` : (insp.gateId ? '<p class="hint">Daten vom letzten Mal übernommen. Nur prüfen, was sich geändert hat.</p>' : '')}
      ${insp.visitId ? `<button class="hint pair-line" data-act="movePairAsk" data-id="${insp.id}"><span>Kunde und Objekt kommen vom Termin:</span> <b>${esc(pairLabel({ objekt: insp.header.objekt, kunde: insp.header.kunde }))}</b> <span class="link-ish">ändern ›</span></button>` : ''}
      ${groups}
    </main>
    ${bottomBar('Zur Prüfung ›', 'ready')}`)) return;
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
  if (DESK && !it.heading) return rowDesk(it);
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
    <div class="row-lbl">${esc(it.label)}${guideLink(it)}</div>
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
// Kleiner Buch-Link neben der Zeile: springt zum passenden Abschnitt im Feldhandbuch
function guideLink(it) {
  const sec = tpl.sections.find(s => s.items.includes(it));
  if (!sec) return '';
  const before = sec.items.slice(0, sec.items.indexOf(it)).reverse().find(x => x.heading);
  const href = guideHref(tpl.kind, sec.title, (before ? before.heading + ' ' : '') + it.label);
  return href ? ` <a class="guide-link" href="${href}" aria-label="Im Handbuch nachlesen" title="Im Handbuch nachlesen">📖</a>` : '';
}

function renderSection(sec) {
  const untouched = sec.items.filter(isCheck).filter(it => !insp.answers[it.id]?.s);
  const prevAvail = untouched.some(it => insp.prev?.[it.id]?.s);
  const t = unitOf(insp);
  const first = step === 1;
  const nothingYet = !Object.values(insp.answers).some(a => a.s);
  const summary = first && !DESK ? `
    <button class="gate-sum" data-act="goto" data-step="0">
      <span><b>${esc(t.standort || `${t.noun} ohne Standort`)}</b><br><span class="muted small">${esc(t.noun)}${unitSub(t) ? ' · ' + esc(unitSub(t)) : ' · Daten eintragen'}</span></span>
      <span class="small link-ish">Daten ›</span>
    </button>
    ${insp.prev && nothingYet ? `<section class="card copy-last">
      <p><b>Nichts geändert seit ${esc(insp.prevDatum || 'letztem Mal')}?</b></p>
      <button class="big-btn primary" data-act="copyAll">↺ Alles wie letztes Mal</button></section>` : ''}` : '';
  if (paint(`${topBar()}
    <main class="step">
      ${summary}
      ${secTitle()}
      <div class="sec-tools">
        ${insp.prev ? `<button class="tool prev" data-act="asLast" data-step="${step}" ${prevAvail ? '' : 'disabled'}>↺ Wie letztes Mal</button>` : ''}
        <button class="tool ok" data-act="allOk" data-step="${step}" ${untouched.length ? '' : 'disabled'}>✓ Rest o.B.</button>
      </div>
      ${DESK ? `<div class="dhead"><span>Prüfpunkt</span><span>${(tpl.states || ['ok', 'b']).map(v => STATE_BTN[v][2]).join(' · ')}</span><span>Notiz (steht neben dem Kästchen)</span></div>` : ''}
      ${sec.items.map(rowHTML).join('')}
    </main>
    ${bottomBar('Weiter ›')}`)) return;
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
  if (DESK && !COLLECT) return renderStepKeepScroll();
  const st = stats();
  const defects = allItems().filter(it => insp.answers[it.id]?.s === 'b');
  if (!insp.ort) insp.ort = (insp.header.objekt?.plzOrt || '').replace(/^\s*\d{5}\s*/, '');
  const openSecs = tpl.sections.map((s, i) => ({ s, i, n: s.items.filter(it => !insp.answers[it.id]?.s).length })).filter(x => x.n);
  const savedSig = settings.get('techSig', null);

  if (paint(`${topBar()}
    <main class="step">
      ${secTitle()}
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
    </nav>`)) return;
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
  const v = ensurePairs({ id: uid(), datum: todayDE(), agName: '', pairs: [{ id: uid(), customerId: uid(), siteId: uid(), kunde: {}, objekt: {} }] });
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
    visitId: src.visitId, pairId: src.pairId, order: (src.order ?? 0) + 0.5, agName: src.sig?.ag?.name || '',
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
  const p = { kind, id, customers: [], sites: [], gates: [], visits: [], inspections: [], pairRemovals: [] };
  visits.forEach(ensurePairs);
  if (kind === 'customer') {
    p.customers = [id];
    p.sites = sites.filter(x => x.customerId === id).map(x => x.id);
  }
  if (kind === 'site') p.sites = [id];
  if (kind === 'customer' || kind === 'site') {
    const S = new Set(p.sites);
    p.gates = gates.filter(g => S.has(g.siteId) || (kind === 'customer' && g.customerId === id)).map(g => g.id);
    // Termine mit mehreren Paaren: nur die betroffenen Paare entfernen, den Termin behalten
    for (const v of visits) {
      const hit = v.pairs.filter(pr => S.has(pr.siteId) || (kind === 'customer' && pr.customerId === id));
      if (!hit.length) continue;
      if (hit.length === v.pairs.length) p.visits.push(v.id);
      else p.pairRemovals.push({ visitId: v.id, pairIds: hit.map(x => x.id) });
    }
  }
  if (kind === 'pair') {
    const [vid, pid] = id.split(':');
    const v = visits.find(x => x.id === vid);
    if (v && v.pairs.length <= 1) p.visits.push(vid); else p.pairRemovals.push({ visitId: vid, pairIds: [pid] });
    p.inspections = inspections.filter(i => i.visitId === vid && v && pairOfItem(v, i).id === pid).map(i => i.id);
    p.name = v ? pairLabel(pairById(v, pid) || {}) : '';
  }
  if (kind === 'visit') p.visits = [id];
  if (kind === 'gate') p.gates = [id];
  if (kind === 'inspection') p.inspections = [id];
  const V = new Set(p.visits), S = new Set(p.sites);
  if (kind !== 'gate' && kind !== 'inspection' && kind !== 'pair') p.inspections = inspections.filter(i => V.has(i.visitId) || S.has(i.siteId) || (kind === 'customer' && i.customerId === id)
    || p.pairRemovals.some(pr => pr.visitId === i.visitId && pr.pairIds.includes(pairOfItem(visits.find(x => x.id === i.visitId), i).id))).map(i => i.id);
  if (kind === 'pair') return p;
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
  for (const pr of p.pairRemovals || []) {
    const v = await db.get('visits', pr.visitId); if (!v) continue;
    ensurePairs(v); v.pairs = v.pairs.filter(x => !pr.pairIds.includes(x.id));
    if (!v.pairs.length) { await db.del('visits', v.id); continue; }
    delete v.editPair; if (v.filter !== 'all') delete v.filter; ensurePairs(v);
    Object.assign(v, { customerId: v.pairs[0].customerId, siteId: v.pairs[0].siteId, kunde: v.pairs[0].kunde, objekt: v.pairs[0].objekt });
    await db.put('visits', v);
    if (visit?.id === v.id) visit = v;
  }
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
  const noun = { customer: 'Kunde', site: 'Objekt', visit: 'Termin', gate: 'Tür / Tor', inspection: 'Protokoll', pair: 'Paar' }[kind];
  const n = (k, one, many) => p[k].length ? `${p[k].length} ${p[k].length === 1 ? one : many}` : '';
  const also = [n('sites', 'Objekt', 'Objekte'), n('gates', 'Tür / Tor', 'Türen und Tore'), n('visits', 'Termin', 'Termine'), n('inspections', 'Protokoll', 'Protokolle')]
    .filter((x, i) => x && !(kind === 'site' && i === 0)).filter(x => !(kind === 'gate') && !(kind === 'inspection'));
  const note = kind === 'pair' ? (p.inspections.length ? `Dabei wird auch gelöscht: ${n('inspections', 'Protokoll', 'Protokolle')}. Kunde und Objekt bleiben gespeichert.` : 'Kunde und Objekt bleiben gespeichert.')
    : kind === 'gate' ? 'Sie wird nicht mehr vorgeschlagen. Frühere Protokolle in alten Terminen bleiben erhalten.'
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
    const v = ensurePairs(await db.get('visits', id)); if (!v) return;
    const P = forWhat === 'visit' && v.pairs.length > 1 ? null : editPair(v);
    const kName = P?.kunde?.name || 'Kunde', oName = [P?.objekt?.name, P?.objekt?.strasse].filter(Boolean).join(', ') || 'Objekt';
    const removePair = v.pairs.length > 1 && P ? [del('pair', `${v.id}:${P.id}`, `Paar aus Termin entfernen: ${pairLabel(P)}`)] : [];
    if (forWhat === 'visit') {
      title = visitTitle(v);
      rows = [go(`#/t/${v.id}/edit`, '✎ Termin bearbeiten'), btn('addPair', v.id, '＋ Paar (weiterer Kunde / weiteres Objekt)'), go(`#/druck-t/${v.id}`, '🖨 Alle Protokolle drucken'), btn('sendVisit', v.id, '📤 Termin senden (an Handy / Laptop)'), del('visit', v.id, 'Termin löschen'),
        ...(P ? [del('site', P.siteId, `Objekt löschen: ${oName}`), del('customer', P.customerId, `Kunde löschen: ${kName}`)] : [])];
    } else if (forWhat === 'kunde') { title = kName; rows = [...removePair, del('customer', P.customerId, 'Kunde löschen')]; }
    else { title = oName; rows = [...removePair, del('site', P.siteId, 'Objekt löschen')]; }
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
      ...(i.visitId ? [btn('movePairAsk', i.id, '⇄ Kunde / Objekt ändern')] : []),
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

// Vor Ort: Liste der Tore, Antippen führt direkt zur Checkliste.
// Mehrere Paare (Kunde + Objekt): oben Chips zum Filtern, "Alle" zeigt alles nach Paar gruppiert.
function pairChips(v, items, { edit = false } = {}) {
  const multi = v.pairs.length > 1;
  if (!multi && !edit) return '';
  const cnt = (p) => items.filter(i => pairOfItem(v, i).id === p.id).length;
  const cur = edit ? v.editPair : v.filter;
  return `<div class="pair-chips" role="tablist">
    ${!edit ? `<button class="pchip ${cur === 'all' ? 'on' : ''}" data-act="filterPair" data-id="all">Alle <span class="n">${items.length}</span></button>` : ''}
    ${v.pairs.map(p => `<button class="pchip ${cur === p.id ? 'on' : ''}" data-act="${edit ? 'editPairSel' : 'filterPair'}" data-id="${p.id}">${esc(pairLabel(p))} <span class="n">${cnt(p)}</span></button>`).join('')}
    <button class="pchip add" data-act="addPair">＋ Paar</button>
  </div>`;
}
function itemRow(i) {
  const [cls, label] = itemState(i);
  const t = unitOf(i);
  return `<div class="gate-line"><button class="gate-row st-${cls}" data-act="openItem" data-id="${i.id}">
    <span class="gate-ico">${{ fertig: '✓', maengel: '✗', arbeit: '…', offen: '' }[cls]}</span>
    <span class="gate-txt"><b>${esc(t.standort || `${t.noun} ohne Standort`)}</b><br><span class="muted small"><span class="kind">${esc(t.noun)}</span> ${esc(unitSub(t))}</span></span>
    <span class="pill ${cls === 'maengel' ? 'red' : cls === 'fertig' ? 'green' : ''}">${label}</span></button>
    <button class="dup-btn" data-act="menu" data-for="item" data-id="${i.id}" aria-label="Mehr zu ${esc(t.noun)}">⋯</button></div>`;
}
async function renderVisit() {
  if (DESK) return renderVisitDesk();
  const v = ensurePairs(visit), all = await visitItems(v);
  const multi = v.pairs.length > 1;
  const showAll = multi && v.filter === 'all';
  const items = showAll || !multi ? all : all.filter(i => pairOfItem(v, i).id === v.filter);
  const done = items.filter(i => i.status === 'done').length;
  const one = !multi ? v.pairs[0] : (showAll ? null : pairById(v, v.filter));
  const list = !items.length ? '<p class="empty">Noch keine Tore oder Türen in diesem Termin.</p>'
    : showAll ? v.pairs.map(p => {
        const its = all.filter(i => pairOfItem(v, i).id === p.id);
        return `<h3 class="pair-h"><button class="link" data-act="filterPair" data-id="${p.id}">${esc(pairLabel(p))} ›</button></h3>${its.map(itemRow).join('') || '<p class="muted small pair-empty">Noch keine Tore oder Türen.</p>'}`;
      }).join('')
    : items.map(itemRow).join('');
  $app.innerHTML = `
    <header class="bar">
      <button class="icon-btn" data-act="toHome" aria-label="Übersicht">‹</button>
      <div class="bar-title"><span class="small muted block">${esc(v.datum || '')} · ${esc(visitKunden(v))}</span>${esc(visitTitle(v))}</div>
      <button class="icon-btn" data-act="editVisit" aria-label="Termin bearbeiten">✎</button>
      <button class="icon-btn" data-act="menu" data-for="visit" data-id="${v.id}" aria-label="Mehr">⋯</button>
    </header>
    <main class="home">
      ${pairChips(v, all)}
      <section class="card visit-head">
        ${one ? `<div class="muted small">${esc([one.kunde?.name, [one.objekt?.name, one.objekt?.strasse, one.objekt?.plzOrt].filter(Boolean).join(', ')].filter(Boolean).join(' · '))}</div>` : ''}
        <div class="vprog"><span class="mini-progress"><span style="width:${items.length ? Math.round(done / items.length * 100) : 0}%"></span></span>
        <b>${done} von ${items.length} fertig</b></div>
      </section>
      ${list}
      <div class="two">
        <button class="big-btn" data-act="addNewGate" data-kind="tor">＋ Tor</button>
        <button class="big-btn" data-act="addNewGate" data-kind="tuer">＋ Tür</button>
      </div>
      <button class="big-btn" data-act="sendVisit" data-id="${v.id}">📤 Termin senden (an Handy / Laptop)</button>
      ${items.length ? `<button class="big-btn" data-act="printVisit">🖨 ${items.length === 1 ? 'Protokoll' : `Alle ${items.length} Protokolle`} drucken / PDF</button>` : ''}
    </main>`;
}

// Welches Paar bekommt eine neue Tür / ein neues Tor? Gefiltertes Paar, sonst das zuletzt gewählte, sonst fragen.
function pairForNew(v, inEdit) {
  if (inEdit) return editPair(v);
  if (v.pairs.length === 1) return v.pairs[0];
  if (v.filter !== 'all') return pairById(v, v.filter);
  return pairById(v, v.lastPair) || null;
}
function askPairFor(kind) {
  const v = visit;
  const sheet = document.getElementById('sheet');
  sheet.innerHTML = `<div class="sheet-inner">
    <div class="sheet-grab"></div>
    <h2 class="sheet-h">${kind === 'tuer' ? 'Neue Tür' : 'Neues Tor'}: für welchen Kunden / welches Objekt?</h2>
    ${v.pairs.map(p => `<button class="big-btn" data-act="addNewGateIn" data-kind="${kind}" data-pair="${p.id}">${esc(pairLabel(p))}</button>`).join('')}
    <button class="big-btn" data-act="cancelDel">Abbrechen</button>
  </div>`;
  sheet.classList.add('show');
}
async function movePairAsk(inspId) {
  const i = (insp?.id === inspId ? insp : await db.get('inspections', inspId)); if (!i?.visitId) return;
  const v = ensurePairs(await db.get('visits', i.visitId)); if (!v) return;
  const cur = pairOfItem(v, i);
  const sheet = document.getElementById('sheet');
  sheet.innerHTML = `<div class="sheet-inner">
    <div class="sheet-grab"></div>
    <h2 class="sheet-h">Kunde / Objekt für diese ${esc(unitOf(i).noun)}</h2>
    ${v.pairs.map(p => `<button class="big-btn ${p.id === cur.id ? 'primary' : ''}" data-act="movePair" data-id="${i.id}" data-pair="${p.id}">${p.id === cur.id ? '✓ ' : ''}${esc(pairLabel(p))}</button>`).join('')}
    <button class="big-btn" data-act="menuGo" data-href="#/t/${v.id}/edit">＋ Weiteres Paar im Termin anlegen</button>
    <button class="big-btn" data-act="cancelDel">Abbrechen</button>
  </div>`;
  sheet.classList.add('show');
}
async function movePair(inspId, pairId) {
  const i = (insp?.id === inspId ? insp : await db.get('inspections', inspId)); if (!i) return;
  const v = ensurePairs(await db.get('visits', i.visitId)); const p = pairById(v, pairId); if (!p) return;
  Object.assign(i, { pairId: p.id, customerId: p.customerId, siteId: p.siteId });
  i.header.kunde = structuredClone(p.kunde); i.header.objekt = structuredClone(p.objekt);
  if (insp?.id === i.id) { await saveNow(); renderStepKeepScroll(); } else { await db.put('inspections', i); if (visit) renderVisit(); }
  snack(`Zugeordnet: ${pairLabel(p)}`);
}

// Im Büro: Kunde, Objekt, Datum und die Tore vorbereiten
async function renderVisitEdit() {
  const v = ensurePairs(visit), allItems = await visitItems(v), P = editPair(v);
  const items = allItems.filter(i => pairOfItem(v, i).id === P.id);
  const gates = (await db.all('gates')).filter(g => g.siteId === P.siteId && !allItems.some(i => i.gateId === g.id));
  const sites = await db.all('sites');
  const groupHTML = (gid) => {
    const g = TEMPLATE_TORE.header.find(x => x.id === gid);
    return `<section class="card form-group"><h2 class="h-menu">${esc(g.title)}<button class="more-btn" data-act="menu" data-for="${gid}" data-id="${v.id}" aria-label="Mehr zu ${esc(g.title)}">⋯</button></h2><div class="grid">${g.fields.map(f => `
      <label class="fld ${f.half ? 'half' : ''}"><span class="lbl">${esc(f.label)}${f.required ? ' <i class="req">*</i>' : ''}</span>
        <input class="field" data-vh="${gid}.${f.key}" value="${esc(P[gid]?.[f.key])}" enterkeyhint="next" autocomplete="off" ${f.key === 'name' ? `data-suggest="${gid}" role="combobox" aria-autocomplete="list"` : ''}>
        ${f.key === 'name' ? `<div class="suggest hidden" id="sg-${gid}" role="listbox"></div>` : ''}</label>`).join('')}</div></section>`;
  };
  $app.innerHTML = `
    <header class="bar">
      <button class="icon-btn" data-act="openVisit" data-id="${v.id}" aria-label="Zum Termin">‹</button>
      <div class="bar-title">Termin vorbereiten</div>
      <span id="saved" class="saved ok">✓ gespeichert</span>
    </header>
    <main class="step">
      <section class="card"><label class="fld"><span class="lbl">Datum</span>
        <input class="field" data-vf="datum" value="${esc(v.datum)}" inputmode="numeric"></label></section>
      ${v.pairs.length > 1 ? '' : '<p class="muted small pair-tip">Mehrere Kunden oder Objekte in diesem Termin? Mit „＋ Paar“ ein weiteres Paar aus Kunde und Objekt anlegen.</p>'}
      ${pairChips(v, allItems, { edit: true })}
      ${groupHTML('objekt')}
      ${groupHTML('kunde')}
      <section class="card">
        <h2>${v.pairs.length > 1 ? 'Tore und Türen für dieses Paar' : 'Tore und Türen in diesem Termin'} <span class="muted small">${items.length}</span></h2>
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

  await setupSuggest(sites);
}

// Kunde- und Objekt-Feld sind zugleich Suche: beim Tippen bekannte Einträge vorschlagen.
// Antippen übernimmt den Eintrag, einfach weitertippen legt einen neuen an.
async function setupSuggest(sites) {
  const v = editPair(visit);
  const custs = await db.all('customers');
  const byId = Object.fromEntries(custs.map(c => [c.id, c]));
  const norm = (x) => String(x || '').toLowerCase();
  const find = (gid, q) => {
    q = norm(q).trim();
    if (gid === 'kunde') {
      if (!q) return [];
      return custs.filter(c => c.id !== v.customerId && c.name && norm([c.name, c.zusatz, c.strasse, c.plzOrt].join(' ')).includes(q)).slice(0, 6)
        .map(c => ({ act: 'pickCustomer', id: c.id, main: c.name, sub: [c.strasse, c.plzOrt].filter(Boolean).join(', ') }));
    }
    const list = sites.filter(st => st.id !== v.siteId && (st.name || st.strasse) &&
      (q ? norm([st.name, st.strasse, st.plzOrt, byId[st.customerId]?.name].join(' ')).includes(q) : st.customerId === v.customerId));
    list.sort((a, b) => (b.customerId === v.customerId) - (a.customerId === v.customerId));
    return list.slice(0, 6).map(st => ({ act: 'pickSite', id: st.id, main: [st.name, st.strasse].filter(Boolean).join(', '), sub: [st.plzOrt, byId[st.customerId]?.name].filter(Boolean).join(' · ') }));
  };
  for (const input of document.querySelectorAll('input[data-suggest]')) {
    const gid = input.dataset.suggest, box = document.getElementById('sg-' + gid);
    let active = -1, hits = [];
    const draw = () => {
      hits = find(gid, input.value); active = -1;
      box.classList.toggle('hidden', !hits.length);
      input.setAttribute('aria-expanded', hits.length ? 'true' : 'false');
      box.innerHTML = hits.map((h, i) => `<button type="button" class="sg-item" role="option" data-act="${h.act}" data-id="${h.id}" data-i="${i}">
          <b>${esc(h.main)}</b>${h.sub ? `<span class="muted small">${esc(h.sub)}</span>` : ''}</button>`).join('')
        + (input.value.trim() ? `<div class="sg-new muted small">${gid === 'kunde' ? 'Oder weitertippen: neuer Kunde' : 'Oder weitertippen: neues Objekt'}</div>` : '');
    };
    const mark = () => box.querySelectorAll('.sg-item').forEach((el, i) => el.classList.toggle('on', i === active));
    input.addEventListener('input', draw);
    input.addEventListener('focus', draw);
    input.addEventListener('blur', () => setTimeout(() => box.classList.add('hidden'), 150));
    box.addEventListener('pointerdown', (e) => e.preventDefault()); // Fokus behalten, damit der Klick ankommt
    input.addEventListener('keydown', (e) => {
      if (box.classList.contains('hidden') || !hits.length) return;
      if (e.key === 'ArrowDown') { e.preventDefault(); active = (active + 1) % hits.length; mark(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); active = (active - 1 + hits.length) % hits.length; mark(); }
      else if (e.key === 'Enter' && active >= 0) { e.preventDefault(); e.stopImmediatePropagation(); box.querySelectorAll('.sg-item')[active].click(); }
      else if (e.key === 'Escape') { box.classList.add('hidden'); }
    });
  }
}

// Beim Übernehmen eines bekannten Eintrags: den gerade erst angetippten, nirgends genutzten Entwurf wieder entfernen
async function dropIfUnused(kind, id) {
  if (!id) return;
  const [visits, inspections, gates, sites] = await Promise.all(['visits', 'inspections', 'gates', 'sites'].map(x => db.all(x)));
  const key = kind === 'customers' ? 'customerId' : 'siteId';
  const used = visits.some(x => x[key] === id) || inspections.some(x => x[key] === id) || gates.some(x => x[key] === id)
    || (kind === 'customers' && sites.some(x => x.customerId === id));
  if (!used) await db.del(kind, id);
}
async function pickCustomer(id) {
  clearTimeout(visitTimer);
  const c = await db.get('customers', id); if (!c) return;
  const P = editPair(visit), oldC = P.customerId;
  Object.assign(P, { customerId: c.id, kunde: strip(c) });
  await saveVisit();
  await dropIfUnused('customers', oldC);
  await renderVisitEdit();
  document.querySelector('input[data-vh="objekt.name"]')?.focus();
}

function refreshPairChip() {
  const el = document.querySelector(`.pair-chips [data-id="${visit.editPair}"]`);
  if (el) el.firstChild.nodeValue = pairLabel(editPair(visit)) + ' ';
}
let visitTimer = null;
function saveVisitSoon() { clearTimeout(visitTimer); markUnsaved(); visitTimer = setTimeout(saveVisit, 400); }
async function saveVisit() {
  clearTimeout(visitTimer);
  const v = visit;
  if (!v) return;
  // Felder des ersten Paars zusätzlich oben ablegen (für ältere Programmteile und Suche)
  if (v.pairs?.length) Object.assign(v, { customerId: v.pairs[0].customerId, siteId: v.pairs[0].siteId, kunde: v.pairs[0].kunde, objekt: v.pairs[0].objekt });
  await db.put('visits', v);
  // Kunde und Objekt jedes Paars als eigene Datensätze, und in die offenen Protokolle des jeweiligen Paars übernehmen
  ensurePairs(v);
  for (const p of v.pairs) {
    await db.put('customers', { ...(await db.get('customers', p.customerId) || {}), id: p.customerId, ...p.kunde });
    await db.put('sites', { ...(await db.get('sites', p.siteId) || {}), id: p.siteId, customerId: p.customerId, ...p.objekt });
  }
  for (const i of await visitItems(v)) {
    const p = pairOfItem(v, i);
    if (i.pairId !== p.id) i.pairId = p.id;
    if (i.status !== 'done') {
      i.header.kunde = structuredClone(p.kunde); i.header.objekt = structuredClone(p.objekt);
      i.customerId = p.customerId; i.siteId = p.siteId;
    }
    await db.put('inspections', i);
  }
  showSaved();
}
async function pickSite(siteId) {
  clearTimeout(visitTimer);
  const st = await db.get('sites', siteId); if (!st) return;
  const c = await db.get('customers', st.customerId) || {};
  const P = editPair(visit), oldS = P.siteId, oldC = P.customerId;
  Object.assign(P, { siteId: st.id, customerId: st.customerId || P.customerId, objekt: strip(st), ...(st.customerId ? { kunde: strip(c) } : {}) });
  await saveVisit();
  await dropIfUnused('sites', oldS);
  if (oldC !== P.customerId) await dropIfUnused('customers', oldC);
  renderVisitEdit();
}
async function addGateToVisit(gateId, kind = 'tor', pair = null) {
  const v = ensurePairs(visit), p = pair || editPair(v);
  const pre = gateId ? await prefillFromGate(gateId) : { header: {}, kind };
  return newInspection({ ...pre, visitId: v.id, customerId: p.customerId, siteId: p.siteId, agName: v.agName, pairId: p.id,
    header: { ...pre.header, kunde: structuredClone(p.kunde), objekt: structuredClone(p.objekt) } }, { open: false, step: 1 });
}
async function nextInVisit() {
  await saveNow();
  const items = await visitItems({ id: insp.visitId });
  const idx = items.findIndex(i => i.id === insp.id);
  const rest = [...items.slice(idx + 1), ...items.slice(0, idx)].filter(i => i.status !== 'done');
  const next = rest.find(i => i.pairId === insp.pairId) || rest[0];
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
  const zimg = e.target.closest('.gdoc img[data-zoom]');
  if (zimg) return openZoom(zimg);
  const b = e.target.closest('[data-act]');
  if (!b) return;
  const act = b.dataset.act;
  switch (act) {
    case 'new': return openKindPicker();
    case 'newKind': closeJump(); return newInspection();
    case 'open': return (location.hash = `#/p/${b.dataset.id}`);
    case 'fromGate': return fromGate(b.dataset.id);
    case 'theme': { const t = settings.get('theme', 'hell'); settings.set('theme', THEMES[(THEMES.indexOf(t) + 1) % THEMES.length]); applyLook(); return route(); }
    case 'size': { settings.set('size', settings.get('size', 'normal') === 'normal' ? 'gross' : 'normal'); return applyLook(); }
    case 'home': await saveNow(); return (location.hash = insp?.visitId ? `#/t/${insp.visitId}` : '#/');
    case 'jump': return openJump();
    case 'goto': closeJump(); return go(+b.dataset.step);
    case 'prev': return go(step - 1);
    case 'next': window.scrollTo(0, 0); return go(step + 1);
    case 'set': return setAnswer(b.dataset.id, b.dataset.v);
    case 'allOk': if (b.dataset.step) step = +b.dataset.step; return bulk(tpl.sections[step - 1], 'ok');
    case 'asLast': if (b.dataset.step) step = +b.dataset.step; return bulk(tpl.sections[step - 1], 'last');
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
    case 'sendVisit': return sendVisit(b.dataset.id);
    case 'guideClose': { const r = guideReturn; guideReturn = null; if (r && !isGuide(r.hash)) { pendingY = r.y; return (location.hash = r.hash || '#/'); } return (location.hash = '#/'); }
    case 'guideToc': return openGuideToc(sheet);
    case 'zoomClose': return closeZoom();
    case 'lang': setLang(LANG === 'en' ? 'de' : 'en'); return route();
    case 'menuGo': { closeJump(); return (location.hash = b.dataset.href); }
    case 'askDel': {
      if (b.dataset.quick) { const p = await deletePlan('inspection', b.dataset.id); await runDelete(p); return rerenderAfterDelete(p); }
      return askDelete(b.dataset.kind, b.dataset.id);
    }
    case 'confirmDel': { closeJump(); const p = pendingDelete; pendingDelete = null; await runDelete(p); buzz([20, 40, 20]); await rerenderAfterDelete(p); return setTimeout(() => snack('Gelöscht.'), 250); }
    case 'cancelDel': pendingDelete = null; return closeJump();
    case 'pickSite': return pickSite(b.dataset.id);
    case 'pickCustomer': return pickCustomer(b.dataset.id);
    case 'addKnownGate': await saveVisit(); await addGateToVisit(b.dataset.id); buzz(); return renderVisitEdit();
    case 'filterPair': { ensurePairs(visit); visit.filter = b.dataset.id; if (b.dataset.id !== 'all') { visit.lastPair = visit.editPair = b.dataset.id; } await saveVisit(); return renderVisit(); }
    case 'editPairSel': { await saveVisit(); visit.editPair = visit.filter = visit.lastPair = b.dataset.id; await saveVisit(); return renderVisitEdit(); }
    case 'addPair': {
      closeJump();
      if (!visit || visit.id !== (b.dataset.id || visit.id)) visit = await db.get('visits', b.dataset.id);
      if (!visit) return;
      ensurePairs(visit); await saveVisit();
      const p = { id: uid(), customerId: uid(), siteId: uid(), kunde: {}, objekt: {} };
      visit.pairs.push(p); visit.editPair = visit.filter = visit.lastPair = p.id;
      await saveVisit();
      if (!/\/edit$/.test(location.hash)) { location.hash = `#/t/${visit.id}/edit`; return; }
      await renderVisitEdit(); document.querySelector('input[data-vh="objekt.name"]')?.focus(); return;
    }
    case 'addNewGateIn': { closeJump(); const p = pairById(visit, b.dataset.pair); visit.lastPair = p.id; await saveVisit(); const r = await addGateToVisit(null, b.dataset.kind || 'tor', p); return (location.hash = `#/p/${r.id}/0`); }
    case 'movePairAsk': return movePairAsk(b.dataset.id);
    case 'movePair': closeJump(); return movePair(b.dataset.id, b.dataset.pair);
    case 'addAllKnown': {
      await saveVisit();
      const items = await visitItems(visit);
      for (const g of (await db.all('gates')).filter(g => g.siteId === editPair(visit).siteId && !items.some(i => i.gateId === g.id))) await addGateToVisit(g.id);
      buzz(); return renderVisitEdit();
    }
    case 'addNewGate': {
      ensurePairs(visit); await saveVisit();
      const p = pairForNew(visit, /\/edit$/.test(location.hash));
      if (!p) return askPairFor(b.dataset.kind || 'tor');
      const r = await addGateToVisit(null, b.dataset.kind || 'tor', p); return (location.hash = `#/p/${r.id}/0`);
    }
    case 'printVisit': return (location.hash = `#/druck-t/${visit.id}${visit.pairs?.length > 1 && visit.filter !== 'all' ? '/' + visit.filter : ''}`);
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
  if (!insp && visit && t.dataset.vh) { const [g, k] = t.dataset.vh.split('.'); const P = editPair(ensurePairs(visit)); (P[g] ||= {})[k] = t.value; refreshPairChip(); return saveVisitSoon(); }
  if (!insp && visit && t.dataset.vf) { visit[t.dataset.vf] = t.value; return saveVisitSoon(); }
  if (!insp) return;
  if (t.dataset.h) {
    const [g, k] = t.dataset.h.split('.'); (insp.header[g] ||= {})[k] = t.value;
    if (DESK) { // Titel oben und links mitführen, die Seite wird nicht neu aufgebaut
      const u = unitOf(insp), bt = document.querySelector('.bar .bar-title .t'), nt = document.querySelector('.dn-title b');
      if (bt?.firstChild) bt.firstChild.textContent = `${u.standort || u.noun} `;
      if (nt) nt.textContent = u.standort || `${u.noun} ohne Standort`;
    }
    return saveSoon();
  }
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
  ['H', 'Feldhandbuch'], ['Esc', 'Feld verlassen / Fenster schließen'], ['?', 'diese Hilfe'],
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
  const sec = DESK && rows[kbIdx].closest('.dk-sec');
  if (sec) { if (scroll) spyLock = Date.now() + 800; spySet(+sec.dataset.step); }
}
function kbCurId() { return kbRows()[kbIdx]?.id?.replace(/^r-/, ''); }
document.addEventListener('keydown', (e) => {
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  const t = e.target;
  const typing = t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable;
  const sheetOpen = document.getElementById('sheet').classList.contains('show');
  if (e.key === 'Escape') {
    if (closeZoom()) { e.preventDefault(); return; }
    if (sheetOpen) { e.preventDefault(); return closeJump(); }
    if (!typing && isGuide(location.hash)) { e.preventDefault(); return document.querySelector('[data-act=guideClose]')?.click(); }
    if (typing) { e.preventDefault(); const row = t.closest('.row'); t.blur(); if (row) kbSelect(kbRows().indexOf(row), false); }
    return;
  }
  if (typing || sheetOpen) return;
  const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  if (k === '?') { e.preventDefault(); return openKeys(); }
  if (k === 'h' && !isGuide(location.hash)) { e.preventDefault(); return (location.hash = '#/handbuch'); }
  if (!insp || !tpl) return;
  const all = DESK && document.querySelector('main.dk-all');
  const inSection = all || (step > 0 && step < stepCount() - 1);
  const click = (sel) => { const el = document.querySelector(sel); if (el && !el.disabled) { el.click(); return true; } return false; };
  if (all) {
    if (k === 'ArrowRight') { e.preventDefault(); return go(Math.min(stepCount() - 1, step + 1)); }
    if (k === 'ArrowLeft') { e.preventDefault(); return go(Math.max(0, step - 1)); }
    const sec = kbRows()[kbIdx]?.closest('.dk-sec') || document.getElementById(`sec-${step}`);
    if (k === 'a' || k === 'l') { e.preventDefault(); const b = sec?.querySelector(`[data-act=${k === 'a' ? 'allOk' : 'asLast'}]`); if (b && !b.disabled) b.click(); return; }
  }
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

// ---------- Laptop / PC: eigene Oberfläche ----------
// Links eine feste Leiste (Termine bzw. Abschnitte der Prüfung), rechts Werkzeugleiste + dichte Tabellen.
const pct = (a, b) => b ? Math.round(a / b * 100) : 0;
const progBar = (a, b) => `<span class="dk-prog"><span style="width:${pct(a, b)}%"></span></span>`;
const hasDefects = (i) => Object.values(i.answers || {}).some(a => a.s === 'b');
const defectCount = (i) => Object.values(i.answers || {}).filter(a => a.s === 'b').length;

async function renderNav() {
  const nav = document.getElementById('dknav');
  const h = location.hash;
  if (insp && tpl && /^#\/p\//.test(h)) {
    const u = unitOf(insp);
    nav.innerHTML = `
      <button class="dn-back" data-act="home">‹ ${insp.visitId ? 'Zum Termin' : 'Übersicht'}</button>
      <div class="dn-title"><b>${esc(u.standort || `${u.noun} ohne Standort`)}</b><span>${esc(u.noun)} · ${esc(inspTitle(insp))}</span></div>
      ${sideSteps()}`;
    return;
  }
  const visits = await db.all('visits');
  const allI = await db.all('inspections');
  const info = visits.map(v => { const its = allI.filter(i => i.visitId === v.id); return { v, n: its.length, d: its.filter(i => i.status === 'done').length }; });
  const isDone = (x) => x.n && x.d === x.n;
  const open = info.filter(x => !isDone(x)).sort((a, b) => dateKey(a.v.datum).localeCompare(dateKey(b.v.datum)));
  const done = info.filter(isDone).sort((a, b) => dateKey(b.v.datum).localeCompare(dateKey(a.v.datum))).slice(0, 12);
  const curV = (h.match(/^#\/t\/([^/]+)/) || [])[1];
  const vrow = ({ v, n, d }) => `<a class="dn-v ${v.id === curV ? 'on' : ''}" href="#/t/${v.id}">
      <span class="dn-t">${esc(visitTitle(v))}</span>
      <span class="dn-s">${esc(v.datum || '')}${visitKunden(v) ? ' · ' + esc(visitKunden(v)) : ''}</span>
      <span class="dn-n">${d}/${n}</span></a>`;
  const home = !h || h === '#/' || h === '#';
  nav.innerHTML = `
    <div class="dn-brand"><img src="icon.svg" alt=""> Prüfprotokolle</div>
    <a class="dn-item ${home ? 'on' : ''}" href="#/">▤ Übersicht</a>
    <div class="dn-h"><span>Offene Termine</span><button class="dn-add" data-act="newVisit" title="Neuer Termin">＋</button></div>
    ${open.map(vrow).join('') || '<p class="dn-empty">Keine offenen Termine</p>'}
    ${done.length ? `<div class="dn-h"><span>Erledigt</span></div>${done.map(vrow).join('')}` : ''}
    <div class="dn-foot">
      <a class="tb-btn sm ${isGuide(h) ? 'on' : ''}" href="#/handbuch" title="Feldhandbuch">📖 Handbuch</a>
      <button class="tb-btn sm" data-act="lang" title="Sprache">${LANG === 'en' ? 'DE' : 'EN'}</button>
      <button class="tb-btn sm" data-act="theme" title="Darstellung">${{ hell: '☀︎', sonne: '◐', dunkel: '☾' }[settings.get('theme', 'hell')]}</button>
      <button class="tb-btn sm" data-act="size" title="Schriftgröße">A<small>A</small></button>
      <button class="tb-btn sm" data-act="keys" title="Tastenkürzel">?</button>
    </div>`;
}

function renderHomeDesk({ open, done, single, resume }) {
  const vtr = ({ v, items }) => {
    const d = items.filter(i => i.status === 'done').length;
    const m = items.filter(i => i.status === 'done' && hasDefects(i)).length;
    const today = dateKey(v.datum) === dateKey(todayDE());
    return `<tr class="dt-click" data-act="openVisit" data-id="${v.id}">
      <td class="nw">${today ? '<b class="today">Heute</b>' : esc(v.datum || '–')}</td>
      <td><b>${esc(visitTitle(v))}</b></td>
      <td>${esc(visitKunden(v))}</td>
      <td class="num">${items.filter(i => TEMPLATES[i.templateId]?.kind === 'tor').length || ''}</td>
      <td class="num">${items.filter(i => TEMPLATES[i.templateId]?.kind === 'tuer').length || ''}</td>
      <td class="nw">${progBar(d, items.length)} <span class="muted">${d}/${items.length}</span></td>
      <td class="num">${m ? `<b class="red">${m}</b>` : ''}</td>
      <td class="acts"><button class="ib" data-act="sendVisit" data-id="${v.id}" title="Termin senden">📤</button><button class="ib" data-act="menu" data-for="visit" data-id="${v.id}" title="Mehr">⋯</button></td></tr>`;
  };
  const head = `<thead><tr><th>Datum</th><th>Objekt</th><th>Kunde</th><th class="num">Tore</th><th class="num">Türen</th><th>Fortschritt</th><th class="num">Mängel</th><th></th></tr></thead>`;
  $app.innerHTML = `
    <header class="bar dk-tb">
      <div class="bar-title">Übersicht</div>
      <button class="tb-btn primary" data-act="newVisit">＋ Neuer Termin</button>
      <label class="tb-btn">⇅ Termin empfangen<input type="file" accept=".json,application/json" data-import hidden></label>
    </header>
    <main class="dk-page">
      ${resume ? `<button class="dk-resume" data-act="open" data-id="${resume.id}"><span class="eyebrow">Weitermachen</span> <b>${esc(unitOf(resume).standort || inspTitle(resume))}</b> <span class="muted">${esc(inspTitle(resume))}</span> <span class="link-ish">Öffnen ›</span></button>` : ''}
      <section class="dk-panel">
        <h2>Offene Termine <span class="muted">${open.length}</span></h2>
        ${open.length ? `<table class="dt">${head}<tbody>${open.map(vtr).join('')}</tbody></table>` : '<p class="dk-empty">Keine offenen Termine. Mit „＋ Neuer Termin“ anlegen oder eine Datei vom Handy empfangen (auch per Ziehen ins Fenster).</p>'}
      </section>
      ${done.length ? `<section class="dk-panel"><h2>Erledigt <span class="muted">${done.length}</span></h2><table class="dt">${head}<tbody>${done.slice(0, 50).map(vtr).join('')}</tbody></table></section>` : ''}
      ${single.length ? `<section class="dk-panel"><h2>Einzelne Prüfungen <span class="muted">${single.length}</span></h2><table class="dt">
        <thead><tr><th>Datum</th><th>Art</th><th>Standort</th><th>Objekt</th><th>Status</th><th></th></tr></thead><tbody>
        ${single.slice(0, 50).map(i => { const u = unitOf(i); const m = defectCount(i); return `<tr class="dt-click" data-act="open" data-id="${i.id}">
          <td class="nw">${esc(i.datum || '')}</td><td>${esc(u.noun)}</td><td><b>${esc(u.standort || '–')}</b></td><td>${esc(inspTitle(i))}</td>
          <td>${i.status === 'done' ? (m ? `<span class="pill red">${m} Mängel</span>` : '<span class="pill green">o.B.</span>') : '<span class="pill">offen</span>'}</td>
          <td class="acts"><button class="ib" data-act="menu" data-for="item" data-id="${i.id}" title="Mehr">⋯</button></td></tr>`; }).join('')}
        </tbody></table></section>` : ''}
    </main>`;
}

async function renderVisitDesk() {
  const v = ensurePairs(visit), all = await visitItems(v);
  const multi = v.pairs.length > 1;
  const showAll = multi && v.filter === 'all';
  const items = showAll || !multi ? all : all.filter(i => pairOfItem(v, i).id === v.filter);
  const done = items.filter(i => i.status === 'done').length;
  const withDef = items.filter(i => i.status === 'done' && hasDefects(i)).length;
  const one = !multi ? v.pairs[0] : (showAll ? null : pairById(v, v.filter));
  const tr = (i, n) => {
    const [cls, label] = itemState(i);
    const u = unitOf(i), h = i.header || {}, g = h.tor || h.grund || {};
    const m = defectCount(i);
    return `<tr class="dt-click st-${cls}" data-act="openItem" data-id="${i.id}">
      <td class="num muted">${n}</td>
      <td><span class="kind-tag ${TEMPLATES[i.templateId]?.kind}">${esc(u.noun)}</span></td>
      <td><b>${esc(u.standort || '–')}</b></td>
      <td>${esc(u.nr || '')}</td>
      <td>${esc(u.typ || '')}</td>
      <td>${esc(g.hersteller || '')}</td>
      <td class="num">${esc(g.bj || '')}</td>
      ${showAll ? `<td class="muted">${esc(pairLabel(pairOfItem(v, i)))}</td>` : ''}
      <td><span class="pill ${cls === 'maengel' ? 'red' : cls === 'fertig' ? 'green' : ''}">${esc(label)}</span></td>
      <td class="num">${m ? `<b class="red">${m}</b>` : ''}</td>
      <td class="acts"><button class="ib" data-act="menuGo" data-href="#/druck/${i.id}" title="Drucken / PDF">🖨</button><button class="ib" data-act="duplicate" data-id="${i.id}" title="Kopie anlegen (gleiche Häkchen)">⧉</button><button class="ib" data-act="menu" data-for="item" data-id="${i.id}" title="Mehr">⋯</button></td></tr>`;
  };
  $app.innerHTML = `
    <header class="bar dk-tb">
      <button class="tb-btn icon" data-act="toHome" title="Übersicht">‹</button>
      <div class="bar-title"><span class="t">${esc(visitTitle(v))}</span><span class="sub">${esc(v.datum || '')}${visitKunden(v) ? ' · ' + esc(visitKunden(v)) : ''}</span></div>
      <button class="tb-btn" data-act="editVisit">✎ Termin bearbeiten</button>
      <span class="tb-sep"></span>
      <button class="tb-btn primary" data-act="addNewGate" data-kind="tor">＋ Tor</button>
      <button class="tb-btn primary" data-act="addNewGate" data-kind="tuer">＋ Tür</button>
      <span class="tb-sep"></span>
      <button class="tb-btn" data-act="sendVisit" data-id="${v.id}">📤 Senden</button>
      ${items.length ? `<button class="tb-btn" data-act="printVisit">🖨 ${items.length === 1 ? 'Drucken' : `Alle ${items.length} drucken`}</button>` : ''}
      <button class="tb-btn icon" data-act="menu" data-for="visit" data-id="${v.id}" title="Mehr">⋯</button>
    </header>
    <main class="dk-page">
      ${multi ? pairChips(v, all) : ''}
      <div class="dk-sum">
        ${one ? `<span>${esc([one.kunde?.name, [one.objekt?.name, one.objekt?.strasse, one.objekt?.plzOrt].filter(Boolean).join(', ')].filter(Boolean).join(' · '))}</span>` : `<span>${v.pairs.length} Paare aus Kunde und Objekt</span>`}
        <span class="dk-sum-r">${progBar(done, items.length)} <b>${done} von ${items.length} fertig</b>${withDef ? ` · <b class="red">${withDef} mit Mängeln</b>` : ''}</span>
      </div>
      <section class="dk-panel">
        ${items.length ? `<table class="dt">
          <thead><tr><th class="num">#</th><th>Tor / Tür</th><th>Standort / Lage</th><th>Nr.</th><th>Typ</th><th>Hersteller</th><th class="num">Bj.</th>${showAll ? '<th>Kunde · Objekt</th>' : ''}<th>Status</th><th class="num">Mängel</th><th></th></tr></thead>
          <tbody>${showAll
            ? v.pairs.map(p => { const its = all.filter(i => pairOfItem(v, i).id === p.id); return `<tr class="dt-group"><td colspan="11"><button class="link" data-act="filterPair" data-id="${p.id}">${esc(pairLabel(p))} ›</button> <span class="muted">${its.length}</span></td></tr>${its.map((i, n) => tr(i, n + 1)).join('')}`; }).join('')
            : items.map((i, n) => tr(i, n + 1)).join('')}</tbody></table>`
          : '<p class="dk-empty">Noch keine Tore oder Türen. Oben mit „＋ Tor“ oder „＋ Tür“ hinzufügen.</p>'}
      </section>
    </main>`;
}

// Prüfzeile als Tabellenzeile: Text | o.B. B. n.v. | Notiz. Bei B. klappt darunter die Mangelbeschreibung auf.
function rowDesk(it) {
  const a = insp.answers[it.id] || {};
  if (it.noStatus) {
    const input = it.choice
      ? `<div class="chips opt">${it.choice.map(o => `<button class="chip ${a.x === o ? 'on' : ''}" data-act="xchoice" data-id="${it.id}" data-v="${esc(o)}">${esc(o)}</button>`).join('')}</div>`
      : `<input class="field sm" data-x="${it.id}" value="${esc(a.x)}" ${it.inputmode ? `inputmode="${it.inputmode}"` : ''} autocomplete="off">`;
    return `<div class="row drow info" id="r-${it.id}"><div class="dc-lbl">${esc(it.label)}</div><div class="dc-in">${input}</div></div>`;
  }
  const s = a.s, p = insp.prev?.[it.id] || {}, ex = it.extra;
  let extra = '';
  if (ex?.type === 'single' || ex?.type === 'multi') {
    const sel = ex.type === 'multi' ? (a.x || []) : [a.x];
    extra = `<span class="chips opt">${ex.options.map(o => `<button class="chip ${sel.includes(o) ? 'on' : ''}" data-act="extra" data-id="${it.id}" data-v="${esc(o)}">${esc(o)}</button>`).join('')}</span>`;
  } else if (ex?.type === 'text') {
    extra = `<input class="field xs" data-x="${it.id}" value="${esc(a.x)}" placeholder="${esc(ex.placeholder || '')}" autocomplete="off">`;
  }
  const ghost = (v) => !s && p.s === v ? 'ghost' : '';
  const states = (tpl.states || ['ok', 'b']).map(v => { const [cls, icon, txt] = STATE_BTN[v];
    return `<button class="${cls} ${s === v ? 'on' : ''} ${ghost(v)}" data-act="set" data-id="${it.id}" data-v="${v}" title="${ghost(v) ? 'letztes Mal ' : ''}${txt}">${icon} ${txt}</button>`; }).join('');
  const defect = s === 'b' ? `
    <div class="dc-defect">
      <textarea class="field" rows="2" data-note="${it.id}" placeholder="Mangel beschreiben, steht auf dem Ausdruck neben der Zeile">${esc(a.note)}</textarea>
      <div class="dc-defect-tools"><span class="chips">${tpl.defectChips.map(c => `<button class="chip" data-act="chipNote" data-id="${it.id}" data-v="${esc(c)}">${esc(c)}</button>`).join('')}</span>
      <label class="tb-btn sm">📷 Foto<input type="file" accept="image/*" data-photo-for="${it.id}" hidden></label></div>
      ${thumbsHTML(a.photos, it.id, true)}
    </div>` : '';
  return `<div class="row drow ${s || ''} ${!s && p.s ? 'has-prev' : ''} ${p.s === 'b' ? 'was-b' : ''}" id="r-${it.id}">
    <div class="dc-lbl">${esc(it.label)}${guideLink(it)}${extra ? ` ${extra}` : ''}
      ${p.s === 'b' ? `<div class="dc-prev">Letztes Mal B.${insp.prevDatum ? ` (${esc(insp.prevDatum)})` : ''}${p.note ? ': ' + esc(p.note) : ''}</div>` : ''}</div>
    <div class="dc-st seg2 n${(tpl.states || ['ok', 'b']).length}" role="group">${states}</div>
    <div class="dc-note">${s === 'b' ? '<span class="muted small">siehe unten</span>' : `<input class="field xs" data-note="${it.id}" value="${esc(a.note)}" placeholder="${p.note ? 'letztes Mal: ' + esc(p.note) : 'Notiz'}" autocomplete="off">`}</div>
    ${defect}
  </div>`;
}

// ---------- Termin senden / empfangen ----------
async function sendVisit(id) {
  closeJump();
  if (visit?.id === id) await saveVisit();
  try {
    const data = await exportVisit(id);
    const r = await sendFile(data, fileName(visitTitle(data.visit), data.visit.datum));
    if (r === 'downloaded') snack('Datei gespeichert. Per Mail, WhatsApp oder AirDrop an das andere Gerät schicken und dort „Termin empfangen“ tippen.');
    else if (r === 'shared') snack('Gesendet. Auf dem anderen Gerät „Termin empfangen“ tippen.');
  } catch (e) { snack('Senden ging nicht: ' + e.message); }
}
async function receiveFile(file) {
  if (!file) return;
  try {
    if (insp) await saveNow();
    if (visit) await saveVisit();
    const r = await importFile(file);
    insp = null; tpl = null;
    const parts = [];
    if (r.isNew) parts.push('Neuer Termin übernommen.');
    else if (r.added + r.updated) parts.push(`Termin aktualisiert (${r.added + r.updated} Änderungen).`);
    else parts.push(r.keptLocal ? 'Nichts überschrieben: hier ist schon der neuere Stand.' : 'Nichts Neues, alles schon aktuell.');
    if (r.keptLocal && (r.isNew || r.added + r.updated)) parts.push(`${r.keptLocal} × war hier neuer und bleibt.`);
    buzz();
    if (location.hash === `#/t/${r.visitId}`) await route(); else location.hash = `#/t/${r.visitId}`;
    setTimeout(() => snack(parts.join(' ')), 300);
  } catch (e) { snack(e.message); }
}
document.addEventListener('change', (e) => {
  if (e.target.matches?.('input[data-import]')) { receiveFile(e.target.files[0]); e.target.value = ''; }
});
// Laptop: Datei einfach ins Fenster ziehen
document.addEventListener('dragover', (e) => { if ([...(e.dataTransfer?.types || [])].includes('Files')) e.preventDefault(); });
document.addEventListener('drop', (e) => {
  const f = e.dataTransfer?.files?.[0];
  if (f && /\.json$/i.test(f.name)) { e.preventDefault(); receiveFile(f); }
});
// Installierte App am Laptop (Chrome/Edge): Datei per Doppelklick öffnen
if ('launchQueue' in window) {
  window.launchQueue.setConsumer(async (p) => { for (const h of p.files || []) receiveFile(await h.getFile()); });
}

// ---------- Start ----------
(async function start() {
  requestPersistence();
  startI18n();
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    // Neue Version sofort übernehmen: nach Wechsel des Service Workers einmal neu laden
    const hadController = !!navigator.serviceWorker.controller;
    let reloaded = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => { if (hadController && !reloaded) { reloaded = true; location.reload(); } });
    navigator.serviceWorker.register('./sw.js', { updateViaCache: 'none' }).then(r => r.update()).catch(() => {});
  }
  // Nach Unterbrechung direkt dort weitermachen, wo man war (innerhalb von 12 Stunden)
  const last = settings.get('last', null);
  if ((!location.hash || location.hash === '#/') && last && Date.now() - last.at < 12 * 3600e3) {
    location.hash = `#/p/${last.id}/${last.step}`;
  } else route();
})();
