import { TEMPLATE_TORE } from './template-tore.js';
import { TEMPLATE_TUER } from './template-tuer.js';
import { db, uid, requestPersistence } from './db.js';
import { printTore } from './print-tore.js';
import { printTuer } from './print-tuer.js';
import { LANG, setLang, startI18n } from './i18n.js';
import { exportVisit, sendFile, importFile, fileName } from './sync.js';
import { mountPlan, preparePlanImage } from './plan.js';
import { renderGuide, guideHref, guidePopHTML, openGuideToc, openZoom, closeZoom } from './guide-view.js';

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
// Kopfzeile: erst Nummer, dann Standort
const unitHead = (u) => u.nr ? `<b class="h-nr">${esc(u.nr)}</b>${u.standort ? ` <span class="h-st">${esc(u.standort)}</span>` : ''}` : `<b>${esc(u.standort || u.noun)}</b>`;
const unitSub = (u) => [u.typ, u.nr && `${u.nrLabel} ${u.nr}`].filter(Boolean).join(' · ');
const $app = document.getElementById('app');
// Laptop / PC (Maus, großer Bildschirm): eigene, dichte Oberfläche. Handy und Tablet bleiben unverändert.
const deskMQ = matchMedia('(min-width: 1000px) and (hover: hover) and (pointer: fine)');
let DESK = false;
function applyDesk() { DESK = deskMQ.matches; document.documentElement.classList.toggle('desk', DESK); if (!DESK) document.getElementById('dknav').innerHTML = ''; }
applyDesk();
// Safari/WebKit druckt nur im bedruckbaren Bereich des Druckers (@page margin:0 wird ignoriert):
// dort das Formular etwas kleiner setzen, damit es auf eine Seite passt
if (/AppleWebKit/.test(navigator.userAgent) && !/Chrome\/|Chromium|Edg\/|Android/.test(navigator.userAgent)) document.documentElement.classList.add('webkit-print');
deskMQ.addEventListener('change', () => { if (matchMedia('print').matches) return; applyDesk(); route(); }); // beim Drucken nicht umbauen

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
// Abschnitt ausgeschaltet (betrifft diese Tür nicht)? Ältere Protokolle ohne Schalter: alles an.
const secOff = (sec, i = insp) => !!sec && !sec.always && i?.secOn?.[sec.id] === false;
const stepOff = (n) => n > 0 && n < stepCount() - 1 && secOff(tpl.sections[n - 1]);
const defaultSecOn = (t) => Object.fromEntries(t.sections.filter(x => !x.always).map(x => [x.id, false]));
// Für eine Tür ohne gespeicherte Schalter: an, wenn im letzten Protokoll dort etwas eingetragen war
const secOnFrom = (t, answers) => Object.fromEntries(t.sections.filter(x => !x.always).map(x => [x.id, x.items.some(it => answers?.[it.id]?.s || (answers?.[it.id]?.x ?? '') !== '')]));
const allItems = () => tpl.sections.filter(x => !secOff(x)).flatMap(s => s.items).filter(it => it.id);
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
  if (i === 0) return isMarked(0) ? 'done' : 'open';
  if (stepOff(i)) return 'off';
  if (i === stepCount() - 1) return insp.status === 'done' ? 'done' : 'open';
  const sec = tpl.sections[i - 1];
  const st = sec.items.filter(isCheck).map(it => insp.answers[it.id]?.s);
  // Erledigt: alle Punkte ausgefüllt oder mit „✓ Geprüft“ bestätigt. Nur Ansehen zählt nicht.
  if (st.includes('b')) return 'defect';
  return autoDone(i) || isMarked(i) ? 'done' : 'open';
}
// „✓ Geprüft“ je Abschnitt (Stammdaten: 'head', sonst die Abschnitts-ID)
const secKey = (i) => i === 0 ? 'head' : tpl.sections[i - 1]?.id;
const isMarked = (i) => !!insp.checked?.[secKey(i)];
function autoDone(i) {
  if (i <= 0 || i >= stepCount() - 1) return false;
  const st = tpl.sections[i - 1].items.filter(isCheck).map(it => insp.answers[it.id]?.s);
  return st.length > 0 && st.every(Boolean);
}
function secHasData(i) {
  return isMarked(i) || tpl.sections[i - 1].items.some(it => { const a = insp.answers[it.id]; return a && (a.s || a.note || a.photos?.length || (a.x !== undefined && a.x !== '' && !(Array.isArray(a.x) && !a.x.length))); });
}
// Abschnitt leeren: Häkchen, Notizen, Fotos, Angaben und „✓ Geprüft“; mit Rückgängig
function clearSection(i) {
  const sec = tpl.sections[i - 1];
  const before = Object.fromEntries(sec.items.map(it => [it.id, insp.answers[it.id]]).filter(([, a]) => a));
  const wasMarked = isMarked(i);
  for (const it of sec.items) delete insp.answers[it.id];
  sec.items.forEach(it => openNotes.delete(it.id));
  setMarked(i, false);
  buzz(20); saveNow(); renderStepKeepScroll();
  undoInline('Abschnitt geleert (Häkchen, Notizen, Fotos)', () => {
    for (const [id, a] of Object.entries(before)) if (!insp.answers[id]) insp.answers[id] = a;
    if (wasMarked) setMarked(i, true);
    saveNow(); renderStepKeepScroll();
  });
}
function setMarked(i, on) {
  insp.checked = { ...(insp.checked || {}) };
  if (on) insp.checked[secKey(i)] = true; else delete insp.checked[secKey(i)];
}
function checkBtn(i = step) {
  const auto = autoDone(i), on = auto || isMarked(i);
  const hint = auto ? 'alle Punkte ausgefüllt' : on ? (DESK ? 'nochmal klicken zum Zurücknehmen' : 'nochmal tippen zum Zurücknehmen') : '';
  return `<div class="sec-check"><button class="check-btn ${on ? 'on' : ''}" data-act="secCheck" data-step="${i}" aria-pressed="${on}" ${auto ? 'disabled' : ''}>${on ? '✓ Geprüft' : '☐ Abschnitt als geprüft markieren'}</button>${hint ? `<span class="muted small">${hint}</span>` : ''}</div>`;
}

// ---------- Speichern ----------
let saveTimer = null;
function saveNow() {
  clearTimeout(saveTimer);
  insp.lastStep = step;
  const p = db.put('inspections', insp);
  p.then(() => showSaved());
  if (insp.freshGate && insp.gateId && insp.status !== 'done') { const i = insp; p.then(() => syncFreshGate(i)); }
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
  hydrateThumbs(); initSigPad('ag'); initSigPad('an'); checkDupes();
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
let lastHash = '', prevHash = '', listBack = '';
const backOf = { o: '#/o', k: '#/k' };
const screenOf = (h) => (h || '').replace(/^#\/?/, '').split('/').slice(0, 2).join('/');
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
  await flushReg();
  prevHash = lastHash;
  if (location.hash !== lastHash) { lastHash = location.hash; window.scrollTo(0, 0); }
  closeJump();
  closeZoom();
  document.getElementById('snack').classList.remove('show');
  const h = location.hash.replace(/^#\/?/, '');
  const parts = h.split('/');
  if (parts[0] !== 'plan') planClose();
  if (parts[0] === 'plan' && parts[1]) {
    if (insp) await saveNow();
    insp = null; tpl = null; visit = null; curDoor = null; doorScope = null;
    return renderPlan(parts[1], parts[2]);
  }
  if (!['p', 'd', 'druck', 'druck-t', 'handbuch'].includes(parts[0])) {
    // Woher man kam: Türseite, Objekt und Kunde führen mit ‹ genau dorthin zurück
    if ((parts[0] === 'o' || parts[0] === 'k') && parts[1] && !/^#\/(d|p|plan)\//.test(prevHash) && screenOf(prevHash) !== screenOf(location.hash)) backOf[parts[0]] = prevHash || `#/${parts[0]}`;
    listBack = location.hash || '#/';
  }
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
    if (visit?.id !== parts[1]) visitQuery = ''; // Suche gilt nur für diesen Termin
    visit = await db.get('visits', parts[1]);
    if (!visit) { location.hash = '#/'; return; }
    const migrate = !Array.isArray(visit.pairs);
    ensurePairs(visit);
    if (migrate) await saveVisit();
    return parts[2] === 'edit' ? renderVisitEdit() : renderVisit();
  }
  if (['o', 'd', 'k', 'tueren'].includes(parts[0])) {
    if (insp) await saveNow();
    insp = null; tpl = null; visit = null;
    releaseAwake();
    settings.set('last', null);
    if (parts[0] === 'd' && parts[1]) { loadLearn(); return renderDoor(parts[1]); }
    curDoor = null; doorScope = null;
    if (screenOf(location.hash) !== screenOf(prevHash)) { regQuery = ''; selDoors = new Set(); }
    if (parts[0] === 'k') return parts[1] ? renderKunde(parts[1]) : renderKunden();
    if (parts[0] === 'o') return parts[1] ? renderObjekt(parts[1]) : renderObjekte();
    return renderDoors();
  }
  if (parts[0] === 'p' && parts[1]) {
    if (!insp || insp.id !== parts[1]) {
      insp = await db.get('inspections', parts[1]);
      if (!insp) { location.hash = '#/'; return; }
      tpl = TEMPLATES[insp.templateId];
      // Neue Angaben der Tür und jüngstes Protokoll (auch nachgetragenes Papier) übernehmen
      if (insp.gateId && insp.status !== 'done' && !insp.paper) await refreshFromDoor(insp);
      await loadTodos();
      await loadCtxNotes();
      loadLearn();
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
// Nächster / voriger Abschnitt, ausgeschaltete Abschnitte werden übersprungen
function stepBy(d) { let n = step + d; while (stepOff(n)) n += d; return Math.max(0, Math.min(stepCount() - 1, n)); }

// ---------- Startseite ----------
// ---------- Suchen (Tür-Nr. zuerst) und doppelte Türen erkennen ----------
// Nummern vergleichen ohne Leerzeichen, Punkte, Striche: „1.UG 14“ = „1ug14“
const normNr = (s) => String(s || '').toLowerCase().replace(/[\s.\-_/]+/g, '');
const normTxt = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/ß/g, 'ss');
// Treffer-Punkte: Nummer zählt am meisten, dann Standort usw.; 0 = kein Treffer
function matchScore(i, q) {
  const nq = normNr(q), toks = normTxt(q).split(/\s+/).filter(Boolean);
  if (!toks.length) return 1;
  const u = unitOf(i), h = i.header || {}, g = h.tor || h.grund || {}, nr = normNr(u.nr);
  let sc = 0;
  if (nr && nq) sc = nr === nq ? 100 : nr.startsWith(nq) ? 60 : nr.includes(nq) ? 40 : 0;
  const hay = normTxt([u.nr, u.standort, u.typ, g.hersteller, g.fabrNr, u.noun, h.objekt?.name, h.objekt?.strasse, h.kunde?.name].join(' '));
  if (toks.every(t => hay.includes(t))) sc = Math.max(sc, 10 + (normTxt(u.standort).includes(toks[0]) ? 5 : 0));
  return sc;
}
const kindOf = (i) => TEMPLATES[i.templateId]?.kind;
// Gleiche Nummer, gleiche Art, gleicher Kunde + Objekt im selben Termin = doppelt
const dupKey = (i) => { const n = normNr(unitOf(i).nr); return n ? `${i.visitId || '-'}|${i.siteId || ''}|${kindOf(i)}|${n}` : null; };
function dupSet(items) {
  const c = new Map(); items.forEach(i => { const k = dupKey(i); if (k) c.set(k, (c.get(k) || 0) + 1); });
  return new Set(items.filter(i => c.get(dupKey(i)) > 1).map(i => i.id));
}
const dupPill = '<span class="pill red dup-pill" title="Diese Nummer gibt es in diesem Termin mehrmals">doppelt</span>';
const searchBox = (id, q, ph) => `<div class="search-box"><input class="field" type="search" id="${id}" value="${esc(q)}" placeholder="${ph}" autocomplete="off" enterkeyhint="search">${q ? `<button class="search-x" data-act="clearSearch" data-for="${id}" aria-label="Suche leeren">×</button>` : ''}</div>`;
let homeQuery = '', visitQuery = '';
// Suchfeld neu zeichnen, ohne dass der Cursor springt
async function rerenderKeepFocus(id, fn) {
  const el = document.getElementById(id), pos = el?.selectionStart;
  await fn();
  const n = document.getElementById(id);
  if (n && el) { n.focus(); try { n.setSelectionRange(pos, pos); } catch {} }
}
// Treffer über alle Termine (Übersicht)
function searchResults(all, visits, q) {
  const vById = new Map(visits.map(v => [v.id, v]));
  const hits = all.map(i => [i, matchScore(i, q)]).filter(([, sc]) => sc > 0)
    .sort((a, b) => b[1] - a[1] || dateKey(b[0].datum).localeCompare(dateKey(a[0].datum))).slice(0, 60).map(([i]) => i);
  return { hits, vOf: (i) => vById.get(i.visitId) };
}

async function renderHome() {
  const all = (await db.all('inspections')).filter(i => !i.paper).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const visits = await db.all('visits');
  const vInfo = await Promise.all(visits.map(async v => ({ v, items: await visitItems(v) })));
  const isDone = ({ items }) => items.length && items.every(i => i.status === 'done');
  const open = vInfo.filter(x => !isDone(x)).sort((a, b) => dateKey(a.v.datum).localeCompare(dateKey(b.v.datum)));
  const done = vInfo.filter(isDone).sort((a, b) => dateKey(b.v.datum).localeCompare(dateKey(a.v.datum)));
  const single = all.filter(i => !i.visitId);
  const resume = all.find(i => i.status !== 'done' && Object.keys(i.answers || {}).some(k => i.answers[k].s));
  if (DESK) return renderHomeDesk({ open, done, single, resume, all, visits });
  const sr = homeQuery.trim() ? searchResults(all, visits, homeQuery) : null;

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
      ${all.length ? searchBox('homeSearch', homeQuery, 'Tür suchen: Tür-Nr., Standort, Objekt …') : ''}
      ${sr ? `<section class="card"><h2>Treffer <span class="muted small">${sr.hits.length}</span></h2>${sr.hits.map(i => {
        const u = unitOf(i), v = sr.vOf(i), [cls, label] = itemState(i);
        return `<div class="row-wrap"><button class="list-row" data-act="open" data-id="${i.id}"><span><strong>${u.nr ? `<span class="nr-tag">${esc(u.nr)}</span> ` : ''}${esc(u.standort || `${u.noun} ohne Standort`)}</strong><br>
          <span class="muted small">${esc(u.noun)} · ${esc(inspTitle(i))}${v ? ` · Termin ${esc(v.datum || '')}` : i.datum ? ' · ' + esc(i.datum) : ''}</span></span>
          <span class="pill ${cls === 'maengel' ? 'red' : cls === 'fertig' ? 'green' : ''}">${esc(label)}</span></button></div>`;
      }).join('') || '<p class="muted">Nichts gefunden.</p>'}</section>` : ''}
      ${sr ? '' : `<button class="big-btn primary" data-act="newVisit">＋ Neuer Termin</button>
      <div class="nav3"><a class="big-btn as-a" href="#/k">👤 Kunden</a><a class="big-btn as-a" href="#/o">🏢 Objekte</a><a class="big-btn as-a" href="#/tueren">🚪 Türen</a></div>
      <label class="big-btn recv-btn">⇅ Termin empfangen (Datei öffnen)<input type="file" accept=".json,application/json" data-import hidden></label>
      ${open.length ? `<section class="card"><h2>Termine</h2>${open.map(visitRow).join('')}</section>` : ''}
      ${done.length ? `<section class="card"><h2>Erledigt</h2>${done.slice(0, 30).map(visitRow).join('')}</section>` : ''}
      ${single.length ? `<section class="card"><h2>Einzelne Prüfungen</h2>${single.slice(0, 30).map(listRow).join('')}</section>` : ''}
      `}
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
  const items = t.sections.filter(x => !secOff(x, i)).flatMap(s => s.items).filter(isCheck);
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
    prev, prevDatum: prefill.prevDatum || null, prevRemarks: prefill.prevRemarks || '', prevId: prefill.prevId || null,
    gateBase: prefill.gateBase || null, paper: !!prefill.paper, returnTo: prefill.returnTo || null,
    secOn: structuredClone(prefill.secOn || defaultSecOn(tplNew)),
    answers, remarks: '', angebot: false, ort: '', datum: prefill.datum ?? todayDE(),
    sig: { ag: { name: prefill.agName || '', img: null, absent: false }, an: { name: prefill.paper ? '' : settings.get('techName', ''), img: null } },
    lastStep: startStep,
  };
  // Neue Tür / neues Tor: sofort als eigener Datensatz im Register anlegen (nicht erst beim Abschließen)
  if (!rec.gateId && rec.siteId && !rec.paper) {
    const g = { id: uid(), siteId: rec.siteId, customerId: rec.customerId, templateId: rec.templateId, data: doorData(rec), createdFrom: rec.id, secOn: { ...rec.secOn } };
    rec.gateId = g.id; rec.freshGate = true;
    await saveGate(g);
  }
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
  const labels = { done: '✓', defect: '✗', open: '', off: '–' };
  return `<aside class="side-steps">${Array.from({ length: stepCount() }, (_, i) => {
    const st = stepStatus(i);
    let count = '';
    if (i > 0 && i < stepCount() - 1) {
      const items = tpl.sections[i - 1].items.filter(isCheck);
      count = stepOff(i) ? 'aus' : items.length ? `${items.filter(it => insp.answers[it.id]?.s).length}/${items.length}` : '';
    }
    return `<button class="side-step ${i === step ? 'cur' : ''} ${st === 'off' ? 'off' : ''}" data-act="goto" data-step="${i}"><span class="dot st-${st}">${labels[st] ?? ''}</span><span class="side-t">${esc(stepTitle(i))}</span><span class="muted small">${count}</span></button>`;
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
        <span class="t"><span class="t-main">${unitHead(unitOf(insp))}</span> <span class="caret">▾</span></span>
      </button>
      <span id="saved" class="saved ok">✓ gespeichert</span>
      <button class="icon-btn" data-act="menu" data-for="insp" data-id="${insp.id}" aria-label="Mehr">⋯</button>
    </header>
    <div class="segs" data-act="jump">${segs}</div>${DESK ? '' : sideSteps()}`;
}
function bottomBar(nextLabel, nextClass = '') {
  return `<nav class="bottom">
    <button class="nav-btn" data-act="prev" ${step === 0 ? 'disabled' : ''}>‹ Zurück</button>
    <button class="nav-btn" data-act="next">${nextLabel}</button>
    <button class="nav-btn next ${nextClass}" data-act="checkNext">✓ Check und weiter</button>
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
  document.querySelectorAll('.sec-check').forEach(el => { el.outerHTML = checkBtn(+el.querySelector('[data-step]').dataset.step); });
  const tools = (i, root) => {
    const untouched = tpl.sections[i - 1].items.filter(isCheck).filter(it => !insp.answers[it.id]?.s);
    const ok = root.querySelector('[data-act="allOk"]');
    if (ok) ok.disabled = !untouched.length;
    const clr = root.querySelector('[data-act="clearSec"]');
    if (clr) clr.disabled = !secHasData(i);
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
  const groups = tpl.header.filter(g => !((insp.visitId || insp.paper) && (g.scope === 'customer' || g.scope === 'site'))).map(g => {
    const vals = insp.header[g.id] || {};
    const filled = g.fields.filter(f => vals[f.key]).length;
    return `<section class="card form-group">
      <h2>${esc(g.title)} <span class="muted small">${filled}/${g.fields.length}</span></h2>
      <div class="grid">
      ${g.fields.filter(f => !f.showIf || vals[f.showIf[0]] === f.showIf[1]).map(f => f.type === 'choice' ? `
        <div class="fld">
          <span class="lbl">${esc(f.label)}${pinBtn(`h:${g.id}.${f.key}`, f.label)}</span>
          <span class="chips opt">${f.options.map(o => `<button type="button" class="chip ${vals[f.key] === o ? 'on' : ''}" data-act="hchoice" data-h="${g.id}.${f.key}" data-v="${esc(o)}">${esc(o)}</button>`).join('')}</span>
          ${g.scope === 'gate' && !f.perInspection ? chgNote(g.id, f.key) : ''}
          ${todoBox(`h:${g.id}.${f.key}`)}
        </div>` : `
        <label class="fld ${f.half ? 'half' : ''}">
          <span class="lbl">${esc(f.label)}${f.required ? ' <i class="req">*</i>' : ''}${pinBtn(`h:${g.id}.${f.key}`, f.label)}</span>
          <span class="inwrap">
            <input class="field" data-h="${g.id}.${f.key}" value="${esc(vals[f.key])}"
              ${f.inputmode ? `inputmode="${f.inputmode}"` : ''} enterkeyhint="next" autocomplete="off"
              ${f.hint ? `placeholder="${esc(f.hint)}"` : ''} ${learnable(g, f, tpl) ? `data-learn="${g.id}.${f.key}"` : ''}>
            ${f.unit ? `<span class="unit">${esc(f.unit)}</span>` : ''}
          </span>
          ${g.scope === 'gate' && !f.perInspection ? chgNote(g.id, f.key) : ''}
          ${todoBox(`h:${g.id}.${f.key}`)}
          ${f.suggest && !DESK ? `<span class="chips">${f.suggest.map(s => `<button type="button" class="chip" data-act="fill" data-h="${g.id}.${f.key}" data-v="${esc(s)}">${esc(s)}</button>`).join('')}</span>` : ''}
        </label>`).join('')}
      ${g.id === tpl.unit.group && insp.gateId && insp.siteId ? `<label class="fld half"><span class="lbl">Etage</span>${etageSelect(ctxSite, ctxEtage, insp.gateId)}</label>` : ''}
      </div>
    </section>`;
  }).join('');

  if (paint(`${topBar()}
    <main class="step">
      ${secTitle()}
      ${noteSection('inspections', insp.id, insp.intNote)}
      ${insp.paper ? `<section class="card paper-card"><h2>📄 Altes Papierprotokoll nachtragen</h2>
        <p class="muted small">So eintragen, wie es auf dem Papier steht. Es wird nicht gedruckt und erscheint vor Ort als „letztes Mal“ zum Vergleich.</p>
        <div class="grid"><label class="fld half"><span class="lbl">Datum der Prüfung <i class="req">*</i></span><input class="field" data-f="datum" value="${esc(insp.datum)}" inputmode="numeric" placeholder="TT.MM.JJJJ" autocomplete="off"></label>
        <label class="fld half"><span class="lbl">Prüfer (vom Papier)</span><input class="field" data-sig-name="an" value="${esc(insp.sig.an.name)}" autocomplete="off"></label></div>
        <p class="hint">Kunde und Objekt kommen von der ${esc(unitOf(insp).noun)}: <b>${esc(pairLabel({ objekt: insp.header.objekt, kunde: insp.header.kunde }))}</b></p></section>` : ''}
      ${insp.prev ? `<section class="card copy-last">
          <p><b>Nichts geändert seit ${esc(insp.prevDatum || 'letztem Mal')}?</b><br>Alle Häkchen, Angaben und Mängelbeschreibungen übernehmen und direkt zum Abschluss.</p>
          <button class="big-btn primary" data-act="copyAll">↺ Alles wie letztes Mal</button>
        </section>
        <p class="hint">Oder Daten unten prüfen und dann Abschnitt für Abschnitt bestätigen.</p>` : (insp.gateId && !insp.paper && !insp.freshGate ? '<p class="hint">Daten vom letzten Mal übernommen. Nur prüfen, was sich geändert hat.</p>' : '')}
      ${todoListCard()}
      <div id="dupWarn" class="dup-warn"></div>
      ${insp.visitId ? `<button class="hint pair-line" data-act="movePairAsk" data-id="${insp.id}"><span>Kunde und Objekt kommen vom Termin:</span> <b>${esc(pairLabel({ objekt: insp.header.objekt, kunde: insp.header.kunde }))}</b> <span class="link-ish">ändern ›</span></button>` : ''}
      ${groups}
      ${checkBtn()}
    </main>
    ${bottomBar('Weiter ›')}`)) return;
  checkDupes();
}
// Gibt es diese Nummer schon? Im selben Termin = doppelt; an diesem Objekt bekannt = verknüpfen anbieten
const gateNr = (g) => { const u = TEMPLATES[g.templateId]?.unit; return u ? g.data?.[u.group]?.[u.nr] : ''; };
async function findKnownGate(i, inspections) {
  const n = normNr(unitOf(i).nr);
  if (!n || !i.siteId) return null;
  const g = (await db.all('gates')).find(g => g.id !== i.gateId && g.siteId === i.siteId && TEMPLATES[g.templateId]?.kind === kindOf(i) && normNr(gateNr(g)) === n);
  if (!g) return null;
  // schon als eigene Zeile in diesem Termin? Dann ist es der Fall „doppelt im Termin“
  return inspections.some(x => x.id !== i.id && i.visitId && x.visitId === i.visitId && x.gateId === g.id) ? null : g;
}
let dupTimer = null;
// Hinweis auch direkt am Nummernfeld (der Kasten oben ist beim Tippen evtl. nicht im Blick)
function markNrField(kind) {
  const inp = document.querySelector(`input[data-h="${tpl.unit.group}.${tpl.unit.nr}"]`);
  if (!inp) return;
  inp.classList.toggle('dup', kind === 'twin');
  let tip = inp.parentElement.querySelector('.dup-inline');
  if (!kind) { tip?.remove(); return; }
  if (!tip) { tip = document.createElement('button'); tip.type = 'button'; tip.className = 'dup-inline'; inp.after(tip); }
  tip.dataset.act = 'toDupWarn';
  tip.textContent = kind === 'twin' ? '⚠ Diese Nummer gibt es in diesem Termin schon ›' : 'ⓘ An diesem Objekt schon bekannt ›';
}
async function checkDupes() {
  const box = document.getElementById('dupWarn');
  if (!box || !insp) return;
  const u = unitOf(insp), n = normNr(u.nr);
  if (!n) { box.innerHTML = ''; markNrField(null); return; }
  const inspections = await db.all('inspections');
  const twin = insp.visitId && inspections.find(i => i.id !== insp.id && i.visitId === insp.visitId && i.siteId === insp.siteId && kindOf(i) === kindOf(insp) && normNr(unitOf(i).nr) === n);
  if (twin) {
    const tu = unitOf(twin);
    box.innerHTML = `<div class="dup-box"><p><b>⚠ ${esc(u.nrLabel)} ${esc(u.nr)} gibt es in diesem Termin schon</b> (${esc(tu.standort || `${tu.noun} ohne Standort`)}). Jede ${esc(u.noun)} sollte nur einmal im Termin stehen.</p>
      <div class="dup-acts"><button class="dup-b" data-act="openItem" data-id="${twin.id}">Zur vorhandenen ${esc(u.noun)} ›</button><button class="dup-b danger" data-act="askDel" data-kind="inspection" data-id="${insp.id}">Diese hier löschen</button></div></div>`;
    markNrField('twin');
    return;
  }
  const g = await findKnownGate(insp, inspections);
  box.innerHTML = g ? `<div class="dup-box info"><p><b>${esc(u.nrLabel)} ${esc(u.nr)} ist an diesem Objekt schon bekannt</b> (${esc(g.standort || '')}${g.lastInspected ? `, zuletzt geprüft ${esc(g.lastInspected)}` : ''}). Übernehmen, damit es keine doppelte ${esc(u.noun)} gibt. Die letzte Prüfung steht dann zum Vergleich bereit.</p>
    <div class="dup-acts"><button class="dup-b primary" data-act="linkGate" data-id="${g.id}">Als diese ${esc(u.noun)} übernehmen</button></div></div>` : '';
  markNrField(g ? 'known' : null);
}
async function linkGate(gid) {
  const pre = await prefillFromGate(gid);
  // die eben erst mit diesem Protokoll angelegte Tür ist dann überflüssig
  const old = insp.gateId && insp.gateId !== gid ? await db.get('gates', insp.gateId) : null;
  if (old?.createdFrom === insp.id && !(await db.all('inspections')).some(x => x.id !== insp.id && x.gateId === old.id)) await db.del('gates', old.id);
  insp.gateId = gid; insp.freshGate = false; insp.gateBase = pre.gateBase;
  await loadTodos();
  for (const [k, val] of Object.entries(pre.header)) {
    if (k === 'kunde' || k === 'objekt') continue;
    const mine = Object.fromEntries(Object.entries(insp.header[k] || {}).filter(([, x]) => x !== '' && x != null));
    insp.header[k] = { ...val, ...mine };
  }
  if (!insp.prev && pre.prev) Object.assign(insp, { prev: pre.prev, prevDatum: pre.prevDatum, prevRemarks: pre.prevRemarks });
  buzz(); await saveNow(); renderStepKeepScroll();
  snack(`Übernommen${pre.prevDatum ? `: letzte Prüfung vom ${pre.prevDatum} zum Vergleich` : ''}.`);
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
    return `<div class="row info" id="r-${it.id}"><label class="row-lbl">${esc(it.label)}${pinBtn('i:' + it.id, it.label)}</label>${todoBox('i:' + it.id)}${input}</div>`;
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
  const dOpen = s === 'b' && openDefects.has(it.id);
  const note = dOpen ? `
    <div class="defect">
      <button class="note-btn dclose" data-act="defectClose" data-id="${it.id}">▴ zuklappen</button>
      <div class="chips">${tpl.defectChips.map(c => `<button class="chip" data-act="chipNote" data-id="${it.id}" data-v="${esc(c)}">${esc(c)}</button>`).join('')}</div>
      <textarea class="field" rows="2" data-note="${it.id}" placeholder="Mangel beschreiben, steht auf dem Ausdruck neben der Zeile">${esc(a.note)}</textarea>
      ${thumbsHTML(a.photos, it.id, true)}
      <label class="photo-btn">📷 Foto aufnehmen<input type="file" accept="image/*" capture="environment" data-photo-for="${it.id}" hidden></label>
    </div>` : '';
  // Kurze Notiz neben jeder Zeile (kommt auf dem Ausdruck in den freien Platz neben das Kästchen)
  const dBtn = s === 'b' && !dOpen ? `<button class="note-btn" data-act="defectOpen" data-id="${it.id}">📷 Foto / Vorschläge${a.photos?.length ? ` (${a.photos.length})` : ''}</button>` : '';
  const shortNote = dOpen ? '' : (s === 'b' && !a.note && !openNotes.has(it.id) ? '<div class="note-line">' : '') + ((a.note || openNotes.has(it.id))
    ? `<div class="row-note"><input class="field sm" data-note="${it.id}" value="${esc(a.note)}" placeholder="${p.note ? 'letztes Mal: ' + esc(p.note) : 'Notiz zu dieser Zeile'}" enterkeyhint="done" autocomplete="off"></div>`
    : `<button class="note-btn" data-act="noteOpen" data-id="${it.id}">✎ Notiz${p.note ? ` <span class="muted">(letztes Mal: ${esc(p.note)})</span>` : ''}</button>`) + (s === 'b' ? dBtn + (!a.note && !openNotes.has(it.id) ? '</div>' : '') : '');
  const ghost = (v) => !s && p.s === v ? 'ghost' : '';
  return `<div class="row ${s || ''} ${!s && p.s ? 'has-prev' : ''} ${p.s === 'b' ? 'was-b' : ''}" id="r-${it.id}">
    <div class="row-lbl">${esc(it.label)}${guideLink(it)}${pinBtn('i:' + it.id, it.label)}</div>
    ${prevDefect}
    ${todoBox('i:' + it.id)}
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
const openDefects = new Set(); // B.-Zeilen, deren Mangel-Feld (Vorschläge, Foto) aufgeklappt ist
// Kleiner Buch-Link neben der Zeile: springt zum passenden Abschnitt im Feldhandbuch
function guideLink(it) {
  const sec = tpl.sections.find(s => s.items.includes(it));
  if (!sec) return '';
  const before = sec.items.slice(0, sec.items.indexOf(it)).reverse().find(x => x.heading);
  const href = guideHref(tpl.kind, sec.title, (before ? before.heading + ' ' : '') + it.label);
  return href ? ` <button type="button" class="guide-link" data-act="guidePop" data-href="${href}" aria-label="Im Handbuch nachlesen" title="Im Handbuch nachlesen">📖</button>` : '';
}
// Handbuch-Abschnitt als Fenster über der Seite: Bild und Erklärung, Schließen führt genau hierher zurück
function openGuidePop(href) {
  const html = guidePopHTML(href);
  if (!html) return (location.hash = href);
  const sheet = document.getElementById('sheet');
  sheet.innerHTML = `<div class="sheet-inner gpop-sheet">${html}</div>`;
  sheet.classList.add('show');
}

// Ein/Aus-Schalter für Abschnitte, die nicht jede Tür hat
function secSwitch(i) {
  const sec = tpl.sections[i - 1];
  if (!sec || sec.always) return '';
  const on = !secOff(sec);
  return `<button class="sec-sw ${on ? 'on' : ''}" role="switch" aria-checked="${on}" data-act="secToggle" data-step="${i}"><span class="sw"><i></i></span>${on ? 'Abschnitt an' : 'Abschnitt aus'}</button>`;
}
async function secToggle(i) {
  const sec = tpl.sections[i - 1]; if (!sec || sec.always) return;
  const turnOff = !secOff(sec);
  const before = Object.fromEntries(sec.items.map(it => [it.id, insp.answers[it.id]]).filter(([, a]) => a)), wasMarked = isMarked(i);
  insp.secOn = { ...(insp.secOn || Object.fromEntries(tpl.sections.filter(x => !x.always).map(x => [x.id, true]))), [sec.id]: !turnOff };
  if (turnOff) { for (const it of sec.items) delete insp.answers[it.id]; setMarked(i, false); }
  buzz(15); await saveNow(); syncSecOn(); renderStepKeepScroll();
  if (turnOff && Object.keys(before).length) undoInline('Abschnitt ausgeschaltet, Einträge entfernt', () => {
    insp.secOn = { ...insp.secOn, [sec.id]: true };
    for (const [id, a] of Object.entries(before)) if (!insp.answers[id]) insp.answers[id] = a;
    if (wasMarked) setMarked(i, true);
    saveNow(); syncSecOn(); renderStepKeepScroll();
  });
}
// Schalter gehören zur Tür: dort speichern, damit die nächste Prüfung gleich so startet
async function syncSecOn() {
  if (!insp?.gateId) return;
  const g = await db.get('gates', insp.gateId); if (!g) return;
  g.secOn = { ...(insp.secOn || {}) }; await saveGate(g);
}
function renderSection(sec) {
  if (secOff(sec)) {
    if (paint(`${topBar()}
      <main class="step">
        <div class="sec-line">${secTitle()}${secSwitch(step)}</div>
        <p class="muted off-note">Ausgeschaltet: diesen Abschnitt hat diese ${esc(unitOf(insp).noun)} nicht. Er wird ausgeblendet und beim nächsten Mal auch.</p>
      </main>
      ${bottomBar('Weiter ›')}`)) return;
    return;
  }
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
      ${first && !DESK ? todoListCard() : ''}
      <div class="sec-line">
      ${secTitle()}
      ${secSwitch(step)}
      <div class="sec-tools">
        ${insp.prev ? `<button class="tool prev" data-act="asLast" data-step="${step}" ${prevAvail ? '' : 'disabled'}>↺ Wie letztes Mal</button>` : ''}
        <button class="tool ok" data-act="allOk" data-step="${step}" ${untouched.length ? '' : 'disabled'}>✓ Rest o.B.</button>
        <button class="tool clr" data-act="clearSec" data-step="${step}" ${secHasData(step) ? '' : 'disabled'} title="Alle Häkchen, Notizen und Fotos dieses Abschnitts entfernen">⌫ Leeren</button>
      </div>
      </div>
      ${sec.items.map(rowHTML).join('')}
      ${checkBtn()}
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
  if (insp.paper) return renderFinishPaper();
  const st = stats();
  const defects = allItems().filter(it => insp.answers[it.id]?.s === 'b');
  if (!insp.ort) insp.ort = (insp.header.objekt?.plzOrt || '').replace(/^\s*\d{5}\s*/, '');
  const openSecs = tpl.sections.filter(x => !secOff(x)).map((s, i) => ({ s, i, n: s.items.filter(it => !insp.answers[it.id]?.s).length })).filter(x => x.n);
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
        ${insp.status === 'done' && insp.doorChanges?.length ? `<div class="chg-box"><b>ⓘ ${tpl.kind === 'tuer' ? 'An der Tür' : 'Am Tor'} gespeichert:</b> ${insp.doorChanges.map(c => `${esc(c.field)} <s>${esc(c.from)}</s> → <b>${esc(c.to)}</b>`).join(', ')}${insp.gateId ? ` <a class="link-ish" href="#/d/${insp.gateId}">Zur ${esc(unitOf(insp).noun)} ›</a>` : ''}</div>` : ''}

      </section>

      <section class="card">
        <h2>Bemerkungen / Festgestellte Mängel</h2>
        <textarea class="field" rows="3" data-f="remarks" placeholder="${defects.length ? 'Bemerkungen für das Protokoll' : 'z. B. Ohne Mängel'}">${esc(insp.remarks)}</textarea>
        ${!defects.length && !insp.remarks ? '<div class="chips"><button class="chip" data-act="remark" data-v="Ohne Mängel">Ohne Mängel</button></div>' : ''}
        ${defects.length ? `<p class="muted small sugg-h">Punkte mit B. (die Notiz steht schon neben dem Kästchen). Bei Bedarf in die Bemerkungen übernehmen:</p>
        <ol class="defects sugg">${defects.map(it => {
          const a = insp.answers[it.id];
          const sIdx = tpl.sections.findIndex(s => s.items.includes(it)) + 1;
          const txt = a.note ? `${it.label}: ${a.note}` : it.label;
          const added = (insp.remarks || '').includes(txt);
          return `<li><button class="link" data-act="goto" data-step="${sIdx}"><b>${esc(it.label)}</b>${a.note ? `: ${esc(a.note)}` : ''}${a.photos?.length ? ` <span class="pill">📷 ${a.photos.length}</span>` : ''}</button>
            <button class="chip sugg-add ${added ? 'on' : ''}" data-act="addRemark" data-v="${esc(txt)}" ${added ? 'disabled' : ''}>${added ? '✓ übernommen' : '＋ übernehmen'}</button></li>`;
        }).join('')}</ol>` : ''}
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

// Abschluss eines nachgetragenen Papierprotokolls: keine Unterschriften, kein Druck
function renderFinishPaper() {
  const st = stats();
  if (paint(`${topBar()}
    <main class="step">
      ${secTitle()}
      <section class="card summary">
        <div class="tiles ${tpl.states?.includes('nv') ? 'four' : ''}">
          <div class="tile green"><b>${st.ok}</b><span>o.B.</span></div>
          <div class="tile red"><b>${st.b}</b><span>B.</span></div>
          ${tpl.states?.includes('nv') ? `<div class="tile gray"><b>${st.nv}</b><span>n.v.</span></div>` : ''}
          <div class="tile gray"><b>${st.open}</b><span>leer</span></div>
        </div>
      </section>
      <section class="card">
        <h2>Bemerkungen / Festgestellte Mängel (vom Papier)</h2>
        <textarea class="field" rows="4" data-f="remarks" placeholder="Was auf dem Papier unter Bemerkungen steht">${esc(insp.remarks)}</textarea>
      </section>
      <section class="card paper-card">
        <div class="grid ${DESK ? 'hidden' : ''}">
          <label class="fld half"><span class="lbl">Datum der Prüfung <i class="req">*</i></span><input class="field" data-f="datum" value="${esc(insp.datum)}" inputmode="numeric" placeholder="TT.MM.JJJJ" autocomplete="off"></label>
          <label class="fld half"><span class="lbl">Prüfer (vom Papier)</span><input class="field" data-sig-name="an" value="${esc(insp.sig.an.name)}" autocomplete="off"></label>
        </div>
        <p class="muted small">📄 Wird nicht gedruckt. Erscheint bei der nächsten Prüfung dieser ${esc(unitOf(insp).noun)} als „letztes Mal“.</p>
      </section>
      <button class="big-btn danger" data-act="askDel" data-kind="inspection" data-id="${insp.id}">🗑 Dieses Papierprotokoll löschen</button>
    </main>
    <nav class="bottom">
      <button class="nav-btn" data-act="prev">‹ Zurück</button>
      ${insp.status === 'done' ? `<button class="nav-btn next ready" data-act="finish">✓ Speichern und zurück</button>` : `<button class="nav-btn next ready" data-act="finish">✓ Papierprotokoll speichern</button>`}
    </nav>`)) return;
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
  if (insp.paper) return finishPaper();
  const st = stats();
  // Nichts blockiert: fehlende Unterschriften werden nur erwähnt
  const unsigned = [!insp.sig.ag.img && !insp.sig.ag.absent && 'Auftraggeber', !insp.sig.an.img && 'Prüfer'].filter(Boolean);

  if (document.getElementById('rememberSig')?.checked) {
    settings.set('techSig', insp.sig.an.img); settings.set('techName', insp.sig.an.name); settings.set('rememberSig', true);
  } else settings.set('rememberSig', false);

  insp.status = 'done';
  insp.finishedAt = new Date().toISOString();
  await upsertMasterData();
  if (insp.visitId && insp.sig.ag.name) {
    const v = await db.get('visits', insp.visitId);
    if (v) { v.agName = insp.sig.ag.name; await db.put('visits', v); }
  }
  await saveNow();
  buzz([20, 60, 20]);
  renderFinish();
  const ch = insp.doorChanges?.length ? ` ${tpl.kind === 'tuer' ? 'An der Tür' : 'Am Tor'} geändert: ${changeText(insp.doorChanges)}.` : '';
  snack((unsigned.length ? `Gespeichert. Ohne Unterschrift ${unsigned.join(' und ')}, kann später ergänzt werden.` : 'Prüfung abgeschlossen und gespeichert.') + ch);
}

// Kunde, Objekt und Tür als eigene Datensätze ablegen. Korrekturen vor Ort gehen sichtbar an die Tür:
// was vorher anders war, steht im Änderungsprotokoll der Tür und in insp.doorChanges.
async function upsertMasterData() {
  const h = insp.header, all = await db.all('inspections');
  let g = insp.gateId ? await db.get('gates', insp.gateId) : null;
  // Neue Tür mit einer Nummer, die es an diesem Objekt schon gibt: mit der vorhandenen verknüpfen statt doppelt anlegen
  const fresh = !g || (g.createdFrom === insp.id && !all.some(x => x.id !== insp.id && x.gateId === g.id && x.status === 'done'));
  if (fresh && !insp.paper) {
    const known = await findKnownGate(insp, all);
    if (known) { if (g) await db.del('gates', g.id); g = known; insp.gateId = known.id; }
  }
  insp.customerId ||= uid(); insp.siteId ||= uid();
  await db.put('customers', { ...(await db.get('customers', insp.customerId) || {}), id: insp.customerId, ...h.kunde });
  const oldSite = await db.get('sites', insp.siteId) || {};
  await db.put('sites', { ...oldSite, id: insp.siteId, customerId: oldSite.customerId || insp.customerId, ...h.objekt });
  if (!g) { g = { id: insp.gateId ||= uid(), templateId: tpl.id, data: {} }; }
  const isNew = !g.siteId;
  // Gibt es schon ein jüngeres Protokoll dieser Tür? Dann nur Lücken füllen, nichts überschreiben.
  const newer = all.some(x => x.id !== insp.id && x.gateId === g.id && x.status === 'done' && dateKey(x.datum) > dateKey(insp.datum));
  const changes = applyDoorData(g, doorData(insp), { fillOnly: newer });
  if (!newer && g.customerId && insp.customerId && g.customerId !== insp.customerId) {
    changes.push({ field: 'Kunde', from: (await db.get('customers', g.customerId))?.name || '–', to: h.kunde?.name || '–' });
  }
  if (!newer || !g.siteId) { g.siteId = insp.siteId; g.customerId = insp.customerId; if (insp.secOn) g.secOn = { ...insp.secOn }; }
  g.templateId ||= tpl.id;
  delete g.createdFrom;
  insp.freshGate = false;
  insp.doorChanges = isNew ? [] : changes;
  if (!isNew) logDoor(g, changes, insp.paper ? `Papierprotokoll vom ${insp.datum}` : `Prüfung vom ${insp.datum}`);
  await saveNow();
  await saveGate(g, { last: true });
}

const strip = ({ id, createdAt, updatedAt, customerId, kundenIds, intNote, ...rest }) => rest;
async function prefillFromGate(gateId, { withPrev = true } = {}) {
  const g = await db.get('gates', gateId);
  const site = await db.get('sites', g.siteId) || {};
  const cust = await db.get('customers', g.customerId) || {};
  // „Letztes Mal“ = jüngstes abgeschlossenes Protokoll dieser Tür, egal ob aus der App oder vom Papier
  const last = withPrev ? await latestProto(gateId) : null;
  return { gateId, siteId: g.siteId, customerId: g.customerId, templateId: g.templateId,
    header: { kunde: strip(cust), objekt: strip(site), ...structuredClone(g.data || {}) }, gateBase: structuredClone(g.data || {}),
    secOn: g.secOn ? structuredClone(g.secOn) : last ? secOnFrom(TEMPLATES[g.templateId], last.answers) : null,
    prev: last ? structuredClone(last.answers) : null, prevDatum: last?.datum || null, prevRemarks: last?.remarks || '', prevId: last?.id || null };
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
  for (let i = 0; i < stepCount() - 1; i++) setMarked(i, true); // „Nichts geändert“ = alles angesehen
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
    visitId: src.visitId, pairId: src.pairId, order: (src.order ?? 0) + 0.5, agName: src.sig?.ag?.name || '', secOn: src.secOn || null,
  }, { open: false });
  Object.assign(rec, { answers, angebot: !!src.angebot, ort: src.ort || '', copiedFrom: src.id, maxStep: t.sections.length, checked: Object.fromEntries(Object.entries(src.checked || {}).filter(([k]) => k !== 'head')) });
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
    // Objekte nur mitlöschen, wenn dort keine Türen anderer Kunden sind
    p.sites = sites.filter(x => x.customerId === id && !gates.some(g => g.siteId === x.id && g.customerId && g.customerId !== id)
      && !(x.kundenIds || []).some(k => k !== id)).map(x => x.id);
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
  if (kind === 'gate') { p.gates = [id]; p.inspections = inspections.filter(i => i.gateId === id && i.paper).map(i => i.id); }
  if (kind === 'inspection') p.inspections = [id];
  const V = new Set(p.visits), S = new Set(p.sites);
  if (kind !== 'gate' && kind !== 'inspection' && kind !== 'pair') p.inspections = inspections.filter(i => V.has(i.visitId) || S.has(i.siteId) || (kind === 'customer' && i.customerId === id)
    || p.pairRemovals.some(pr => pr.visitId === i.visitId && pr.pairIds.includes(pairOfItem(visits.find(x => x.id === i.visitId), i).id))).map(i => i.id);
  // Eine Tür, die nur mit diesem (noch offenen) Protokoll angelegt wurde, verschwindet mit ihm
  const I = new Set(p.inspections);
  for (const g of gates) if (g.createdFrom && I.has(g.createdFrom) && !p.gates.includes(g.id) && !inspections.some(i => i.gateId === g.id && !I.has(i.id))) p.gates.push(g.id);
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
  if (insp && I.has(insp.id)) { p.backTo = insp.paper ? (insp.returnTo || `#/d/${insp.gateId}`) : insp.visitId && !p.visits.includes(insp.visitId) ? `#/t/${insp.visitId}` : '#/'; clearTimeout(saveTimer); insp = null; tpl = null; }
  if (p.kind === 'gate' && curDoor?.id === p.id) { p.backTo = listBack && !/^#\/d\//.test(listBack) ? listBack : `#/o/${curDoor.siteId}`; curDoor = null; }
  const S = new Set(p.sites || []);
  const photos = (await db.all('photos')).filter(ph => I.has(ph.inspectionId) || S.has(ph.planSite));
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
    : kind === 'gate' ? `Sie verschwindet aus dem Register und wird nicht mehr vorgeschlagen.${p.inspections.length ? ` Ihre ${p.inspections.length} Papierprotokolle werden mitgelöscht.` : ''} Protokolle in Terminen bleiben erhalten.`
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
    rows = [...(/^#\/o\//.test(location.hash) ? [] : [btn('openSite', st.id, '🏢 Objekt öffnen')]), del('site', st.id, 'Objekt löschen')];
  } else if (forWhat === 'customer') {
    const c = await db.get('customers', id); if (!c) return;
    title = c.name || 'Kunde';
    rows = [...(/^#\/k\//.test(location.hash) ? [] : [go(`#/k/${c.id}`, '👤 Kunde öffnen')]), btn('newSiteFor', c.id, '＋ Objekt für diesen Kunden'), del('customer', c.id, 'Kunde löschen')];
  } else if (forWhat === 'gate') {
    const g = await db.get('gates', id); if (!g) return;
    title = g.standort || g.label || 'Tür / Tor';
    rows = [...(/^#\/d\//.test(location.hash) ? [] : [go(`#/d/${g.id}`, '🚪 Öffnen')]), btn('paperNew', g.id, '📄 Altes Papierprotokoll nachtragen'), btn('moveDoorsAsk', g.id, '⇄ Kunde ändern'), del('gate', g.id, `${gateUnit(g).noun} löschen`)];
  } else if (forWhat === 'item' || forWhat === 'insp') {
    const i = await db.get('inspections', id) || (insp?.id === id ? insp : null); if (!i) return;
    const u = unitOf(i);
    title = `${u.noun} · ${u.standort || 'ohne Standort'}`;
    const gate = i.gateId && await db.get('gates', i.gateId);
    rows = i.paper ? [
      ...(gate ? [go(`#/d/${gate.id}`, `🚪 Zur ${u.noun} (alle Protokolle)`)] : []),
      del('inspection', i.id, 'Papierprotokoll löschen'),
    ] : [
      ...(forWhat === 'item' ? [go(`#/p/${i.id}/0`, '✎ Daten bearbeiten')] : [go(`#/p/${i.id}/0`, '✎ Stammdaten')]),
      ...(gate ? [go(`#/d/${gate.id}`, `🚪 Zur ${u.noun} (Daten und alle Protokolle)`)] : []),
      ...(i.status !== 'done' ? [btn('paperFor', i.id, '📄 Altes Papierprotokoll nachtragen')] : []),
      btn('duplicate', i.id, `⧉ Kopie anlegen (gleiche Häkchen)`),
      ...(i.visitId ? [btn('movePairAsk', i.id, '⇄ Kunde / Objekt ändern')] : []),
      go(`#/druck/${i.id}`, '🖨 Drucken / PDF'),
      del('inspection', i.id, i.visitId ? `${u.noun} aus diesem Termin löschen` : 'Protokoll löschen'),
      ...(gate ? [del('gate', gate.id, `${u.noun} löschen (aus dem Register)`)] : []),
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
// ---------- Liste im Termin sortieren (Spalte anklicken / Auswahl auf dem Handy) ----------
const SORTS = [['nr0', 'Reihenfolge'], ['kind', 'Tor / Tür'], ['standort', 'Standort / Lage'], ['nr', 'Nr.'], ['typ', 'Typ'], ['hersteller', 'Hersteller'], ['bj', 'Baujahr'], ['pair', 'Kunde · Objekt'], ['status', 'Status'], ['maengel', 'Mängel']];
const getSort = () => { const s = settings.get('visitSort', null); return s && SORTS.some(([k]) => k === s.k) ? s : { k: 'nr0', d: 1 }; };
function sortVal(i, k, v) {
  const u = unitOf(i), h = i.header || {}, g = h.tor || h.grund || {};
  switch (k) {
    case 'kind': return u.noun;
    case 'standort': return u.standort || '';
    case 'nr': return u.nr || '';
    case 'typ': return u.typ || '';
    case 'hersteller': return g.hersteller || '';
    case 'bj': return g.bj || '';
    case 'pair': return v ? pairLabel(pairOfItem(v, i)) : '';
    case 'status': return { offen: 0, arbeit: 1, fertig: 2, maengel: 3 }[itemState(i)[0]];
    case 'maengel': return defectCount(i);
  }
  return 0;
}
// Gibt [Element, ursprüngliche Nummer] zurück; leere Werte stehen immer am Ende
function sortItems(list, v) {
  const { k, d } = getSort();
  const rows = list.map((i, n) => [i, n + 1]);
  if (k === 'nr0') return d === 1 ? rows : rows.reverse();
  const key = new Map(rows.map(([i]) => [i, sortVal(i, k, v)]));
  return rows.sort(([a, na], [b, nb]) => {
    const x = key.get(a), y = key.get(b);
    const ex = x === '' || x == null, ey = y === '' || y == null;
    if (ex || ey) return ex === ey ? na - nb : ex ? 1 : -1;
    const c = typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y), 'de', { numeric: true, sensitivity: 'base' });
    return c * d || na - nb;
  });
}
function setSort(k) {
  const cur = getSort();
  settings.set('visitSort', { k, d: cur.k === k ? -cur.d : 1 });
  renderVisit();
}
function sortBarHTML() {
  const { k, d } = getSort();
  return `<div class="sort-bar"><label class="muted small" for="visitSortSel">Sortieren</label>
    <select class="field sm" id="visitSortSel" data-sort-sel>${SORTS.filter(([x]) => x !== 'pair').map(([x, t]) => `<option value="${x}" ${x === k ? 'selected' : ''}>${t}</option>`).join('')}</select>
    <button class="icon-btn sm sort-dir" data-act="sortDir" aria-label="${d === 1 ? 'Aufsteigend' : 'Absteigend'}" title="Richtung umkehren">${d === 1 ? '↑' : '↓'}</button></div>`;
}

function itemRow(i, dup = false, todoN = 0) {
  const [cls, label] = itemState(i);
  const t = unitOf(i);
  return `<div class="gate-line"><button class="gate-row st-${cls}" data-act="openItem" data-id="${i.id}">
    <span class="gate-ico">${{ fertig: '✓', maengel: '✗', arbeit: '…', offen: '' }[cls]}</span>
    <span class="gate-txt"><b>${esc(t.standort || `${t.noun} ohne Standort`)}</b><br><span class="muted small"><span class="kind">${esc(t.noun)}</span> ${esc(unitSub(t))}</span></span>
    ${dup ? dupPill : ''}${i.status !== 'done' ? todoPill(todoN) : ''}<span class="pill ${cls === 'maengel' ? 'red' : cls === 'fertig' ? 'green' : ''}">${label}</span></button>
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
  const dups = dupSet(all);
  const q = visitQuery.trim();
  const shown = (list) => q ? list.filter(i => matchScore(i, q) > 0) : list;
  const tN = await todoCounts();
  const rowM = (i) => itemRow(i, dups.has(i.id), tN.get(i.gateId) || 0);
  const list = q ? (() => { const hits = sortItems(shown(items), v).sort((a, b) => matchScore(b[0], q) - matchScore(a[0], q)); return hits.map(([i]) => rowM(i)).join('') || '<p class="empty">Keine Tür und kein Tor passt zur Suche.</p>'; })()
    : !items.length ? '<p class="empty">Noch keine Tore oder Türen in diesem Termin.</p>'
    : showAll ? v.pairs.map(p => {
        const its = all.filter(i => pairOfItem(v, i).id === p.id);
        return `<h3 class="pair-h"><button class="link" data-act="filterPair" data-id="${p.id}">${esc(pairLabel(p))} ›</button></h3>${sortItems(its, v).map(([i]) => rowM(i)).join('') || '<p class="muted small pair-empty">Noch keine Tore oder Türen.</p>'}`;
      }).join('')
    : sortItems(items, v).map(([i]) => rowM(i)).join('');
  $app.innerHTML = `
    <header class="bar">
      <button class="icon-btn" data-act="toHome" aria-label="Übersicht">‹</button>
      <div class="bar-title"><span class="small muted block">${esc(v.datum || '')} · ${esc(visitKunden(v))}</span>${esc(visitTitle(v))}</div>
      <button class="icon-btn" data-act="editVisit" aria-label="Termin bearbeiten">✎</button>
      <button class="icon-btn" data-act="menu" data-for="visit" data-id="${v.id}" aria-label="Mehr">⋯</button>
    </header>
    <main class="home">
      ${noteSection('visits', v.id, v.intNote)}
      ${pairChips(v, all)}
      <section class="card visit-head">
        ${one ? `<div class="muted small">${esc([one.kunde?.name, [one.objekt?.name, one.objekt?.strasse, one.objekt?.plzOrt].filter(Boolean).join(', ')].filter(Boolean).join(' · '))}</div>` : ''}
        <div class="vprog"><span class="mini-progress"><span style="width:${items.length ? Math.round(done / items.length * 100) : 0}%"></span></span>
        <b>${done} von ${items.length} fertig</b></div>
      </section>
      ${items.length > 1 ? searchBox('visitSearch', visitQuery, 'Suchen: Tür-Nr., Standort …') : ''}
      ${items.length > 1 && !q ? sortBarHTML() : ''}
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
  const allGates = await db.all('gates'), gById = new Map(allGates.map(g => [g.id, g]));
  // Bekannte Türen an diesem Objekt: zuerst die dieses Kunden, dann die anderer Kunden (die kommen in ihr eigenes Paar)
  const atSite = allGates.filter(g => g.siteId === P.siteId && !allItems.some(i => i.gateId === g.id)).sort(byNr);
  const gates = atSite.filter(g => !g.customerId || g.customerId === P.customerId);
  const others = atSite.filter(g => g.customerId && g.customerId !== P.customerId);
  const custs = new Map((await db.all('customers')).map(c => [c.id, c]));
  const sites = await db.all('sites');
  const knownRow = (g, kn) => `<div class="list-row static"><button class="row-main" data-act="addKnownGate" data-id="${g.id}">
            <span><b>${gateUnit(g).nr ? `<span class="nr-tag">${esc(gateUnit(g).nr)}</span> ` : ''}${esc(g.standort || g.label)}</b><br><span class="muted small"><span class="kind">${esc(TEMPLATES[g.templateId]?.unit.noun || 'Tor')}</span> ${esc([g.sub, kn].filter(Boolean).join(' · '))}</span></span><span class="pill">＋</span></button>
            <button class="more-btn" data-act="menu" data-for="gate" data-id="${g.id}" aria-label="Mehr">⋯</button></div>`;
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
      ${noteSection('visits', v.id, v.intNote)}
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
          const gt = gById.get(i.gateId), last = gt?.lastInspected ? `letztes Mal ${gt.lastInspected}${gt.lastPaper ? ' (Papier)' : ''}` : '';
          return `<div class="list-row static"><button class="row-main" data-act="editItem" data-id="${i.id}"><span><b>${esc(t.standort || `${t.noun} ohne Standort`)}</b><br><span class="muted small"><span class="kind">${esc(t.noun)}</span> ${esc(unitSub(t) || 'Daten eintragen ›')}</span>${last ? `<br><span class="muted small">${esc(last)}</span>` : ''}</span></button>
            ${i.status !== 'done' ? `<button class="mini-x paper-b" data-act="paperFor" data-id="${i.id}" aria-label="Altes Papierprotokoll nachtragen" title="Altes Papierprotokoll nachtragen">📄</button>` : ''}
            <button class="mini-x" data-act="askDel" data-kind="inspection" data-id="${i.id}" data-quick="${started ? '' : '1'}" aria-label="Entfernen">×</button></div>`;
        }).join('')}
        ${gates.length ? `<h3 class="sub">Schon bekannt an diesem Objekt</h3>
          ${gates.map(g => knownRow(g, '')).join('')}
          ${gates.length > 1 ? `<button class="big-btn" data-act="addAllKnown">Alle ${gates.length} hinzufügen</button>` : ''}` : ''}
        ${others.length ? `<h3 class="sub">Türen anderer Kunden an diesem Objekt</h3>
          ${others.map(g => knownRow(g, custs.get(g.customerId)?.name || '')).join('')}` : ''}
        ${P.siteId && (P.objekt?.name || P.objekt?.strasse) ? `<p class="muted small"><a class="link-ish" href="#/o/${P.siteId}">🏢 Objekt mit allen Türen öffnen ›</a> Dort lassen sich auch alte Papierprotokolle nachtragen.</p>` : ''}
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
    const os = await db.get('sites', p.siteId) || {};
    await db.put('sites', { ...os, id: p.siteId, customerId: os.customerId || p.customerId, ...p.objekt });
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

// ---------- Objekte und Türen (Register) ----------
// Türen und Tore sind eigene Datensätze (Store „gates“). Jede zeigt auf ihr Objekt (siteId) und ihren Kunden (customerId),
// denn an einem Objekt kann es für verschiedene Türen verschiedene Kunden geben.
// Termine und Protokolle zeigen nur auf die Tür, sie enthalten sie nicht. Alte Papierprotokolle sind Protokolle mit paper: true.
const gateUnit = (g) => unitOf({ templateId: g.templateId, header: g.data || {} });
const gateKind = (g) => TEMPLATES[g.templateId]?.kind || 'tor';
const doorFields = (t) => (t || TEMPLATE_TORE).header.filter(g => g.scope === 'gate').flatMap(g => g.fields.filter(f => !f.perInspection).map(f => [g.id, f]));
const blank = (x) => x === undefined || x === null || x === '';
function doorData(i) {
  const d = {};
  for (const [gid, f] of doorFields(TEMPLATES[i.templateId])) { const v = i.header?.[gid]?.[f.key]; if (!blank(v)) (d[gid] ||= {})[f.key] = v; }
  return d;
}
const protoSort = (a, b) => dateKey(b.datum).localeCompare(dateKey(a.datum)) || String(b.finishedAt || '').localeCompare(String(a.finishedAt || ''));
const protosOf = (gid, inspections) => inspections.filter(i => i.gateId === gid && i.status === 'done').sort(protoSort);
async function latestProto(gid, exclId = null) { return protosOf(gid, await db.all('inspections')).find(i => i.id !== exclId) || null; }
const hasName = (s) => !!(s?.name || s?.strasse);
const sname = (s) => [s?.name, s?.strasse].filter(Boolean).join(', ') || 'Objekt ohne Namen';
const anDer = (kind) => kind === 'tuer' ? 'an der Tür' : 'am Tor';
const changeText = (list) => list.map(c => `${c.field} ${c.from} → ${c.to}`).join(', ');

// Tür speichern; Anzeige- und Suchtext neu berechnen, bei last: true auch „zuletzt geprüft“
async function saveGate(g, { last = false } = {}) {
  if (last) { const lp = await latestProto(g.id); g.lastInspectionId = lp?.id || null; g.lastInspected = lp?.datum || ''; g.lastPaper = !!lp?.paper; }
  const site = await db.get('sites', g.siteId) || {}, cust = await db.get('customers', g.customerId) || {};
  const u = gateUnit(g);
  Object.assign(g, {
    standort: u.standort || '',
    label: `${site.name || site.strasse || cust.name || ''} · ${u.standort || (u.nr ? `${u.nrLabel} ${u.nr}` : '')}`,
    sub: [unitSub(u), g.lastInspected && `zuletzt ${g.lastInspected}${g.lastPaper ? ' (Papier)' : ''}`].filter(Boolean).join(' · '),
    search: [cust.name, site.name, site.strasse, site.plzOrt, u.standort, u.nr, u.typ].join(' '),
  });
  return db.put('gates', g);
}
// Daten in die Tür übernehmen. Leere Felder werden gefüllt; ein anderer Wert ersetzt den alten (außer fillOnly) und wird gemeldet.
function applyDoorData(g, data, { fillOnly = false } = {}) {
  const changes = [];
  g.data ||= {};
  for (const [gid, f] of doorFields(TEMPLATES[g.templateId])) {
    const nv = data[gid]?.[f.key], ov = g.data[gid]?.[f.key];
    if (blank(nv) || nv === ov || (!blank(ov) && fillOnly)) continue;
    (g.data[gid] ||= {})[f.key] = nv;
    if (!blank(ov)) changes.push({ field: f.label, from: ov, to: nv });
  }
  return changes;
}
function logDoor(g, changes, src) {
  if (!changes.length) return;
  const at = new Date().toISOString();
  g.log = [...(g.log || []), ...changes.map(c => ({ at, datum: todayDE(), src, ...c }))].slice(-300);
}
// Neue Tür aus einem offenen Protokoll: solange sie nur dort existiert, spiegelt sie dessen Angaben
async function syncFreshGate(i) {
  const g = await db.get('gates', i.gateId);
  if (!g || g.createdFrom !== i.id) { i.freshGate = false; return; }
  g.data = doorData(i); g.siteId = i.siteId; g.customerId = i.customerId;
  if (i.secOn) g.secOn = { ...i.secOn };
  await saveGate(g);
}
// Beim Öffnen eines offenen Protokolls: neue Angaben der Tür (z. B. aus einem nachgetragenen Papierprotokoll) und das
// jüngste Protokoll als „letztes Mal“ übernehmen. Eigene Eingaben bleiben unangetastet.
async function refreshFromDoor(i) {
  const g = await db.get('gates', i.gateId); if (!g) return;
  i.freshGate = g.createdFrom === i.id;
  if (i.freshGate) return;
  i.gateBase ||= {};
  // Abschnitts-Schalter der Tür übernehmen, wo in diesem Protokoll noch nichts eingetragen ist
  if (g.secOn && i.secOn) for (const x of TEMPLATES[i.templateId].sections) {
    if (x.always || g.secOn[x.id] === undefined) continue;
    if (!x.items.some(it => i.answers[it.id])) i.secOn[x.id] = g.secOn[x.id];
  }
  for (const [gid, f] of doorFields(TEMPLATES[i.templateId])) {
    const gv = g.data?.[gid]?.[f.key]; if (blank(gv)) continue;
    if (blank(i.header[gid]?.[f.key])) (i.header[gid] ||= {})[f.key] = gv;
    if (blank(i.gateBase[gid]?.[f.key])) (i.gateBase[gid] ||= {})[f.key] = gv;
  }
  const lp = await latestProto(g.id, i.id);
  if (lp && lp.id !== i.prevId && dateKey(lp.datum) <= dateKey(i.datum)) {
    Object.assign(i, { prev: structuredClone(lp.answers || {}), prevDatum: lp.datum, prevRemarks: lp.remarks || '', prevId: lp.id });
    for (const [id, a] of Object.entries(i.prev)) if (a.x !== undefined && a.x !== '' && i.answers[id]?.x === undefined) (i.answers[id] ||= {}).x = structuredClone(a.x);
  }
}
// Hinweis unter einem Türfeld, wenn der Wert vor Ort vom gespeicherten abweicht
function chgNote(gid, key) {
  if (insp.paper || insp.status === 'done' || !insp.gateBase) return '';
  const b = insp.gateBase[gid]?.[key], v = insp.header[gid]?.[key];
  const show = !blank(b) && v !== b;
  return `<span class="chg-note ${show ? '' : 'hidden'}" id="cn-${gid}-${key}">ⓘ Wird ${anDer(tpl.kind)} gespeichert. Vorher: „${esc(b)}“</span>`;
}
function updChgNote(gid, key) { const el = document.getElementById(`cn-${gid}-${key}`); if (el) el.outerHTML = chgNote(gid, key); }

// ----- Altes Papierprotokoll nachtragen -----
async function newPaperProto(gateId, returnTo) {
  const pre = await prefillFromGate(gateId, { withPrev: false });
  return newInspection({ ...pre, paper: true, returnTo, datum: '' }, { step: 0 });
}
async function finishPaper() {
  if (dateKey(insp.datum) === '0000') {
    snack('Bitte zuerst das Datum vom Papier eintragen (TT.MM.JJJJ).');
    const f = document.querySelector('input[data-f="datum"]'); if (f) { f.focus(); f.scrollIntoView({ block: 'center' }); } else go(0);
    return;
  }
  insp.status = 'done';
  insp.finishedAt ||= new Date().toISOString();
  await upsertMasterData();
  buzz([20, 60, 20]);
  const back = insp.returnTo || `#/d/${insp.gateId}`, d = insp.datum, ch = insp.doorChanges || [];
  insp = null; tpl = null;
  location.hash = back;
  setTimeout(() => snack(`Papierprotokoll vom ${d} gespeichert. Es erscheint vor Ort als „letztes Mal“.${ch.length ? ` Tür aktualisiert: ${changeText(ch)}.` : ''}`), 250);
}
async function paperForItem(inspId) {
  let i = await db.get('inspections', inspId); if (!i) return;
  if (!i.gateId || !(await db.get('gates', i.gateId))) {
    if (!i.siteId) { snack('Erst Kunde und Objekt im Termin eintragen.'); return; }
    const g = { id: uid(), siteId: i.siteId, customerId: i.customerId, templateId: i.templateId, data: doorData(i), createdFrom: i.id };
    await saveGate(g); i.gateId = g.id; i.freshGate = true; await db.put('inspections', i);
  }
  closeJump();
  return newPaperProto(i.gateId, location.hash);
}

// ----- Seiten -----
let regQuery = '', curSite = null, curDoor = null, doorBase = null, selDoors = new Set(), selSite = null, focusNr = false;
let doorTimer = null, siteTimer = null, kp = null;
async function flushReg() {
  if (doorTimer) { clearTimeout(doorTimer); doorTimer = null; if (curDoor) await saveGate(curDoor); }
  if (siteTimer) { clearTimeout(siteTimer); siteTimer = null; if (curSite) await db.put('sites', curSite); }
}
async function regData() {
  const [sites, gates, custs, inspections, visits] = await Promise.all(['sites', 'gates', 'customers', 'inspections', 'visits'].map(x => db.all(x)));
  return { sites, gates, custs, inspections, visits, cById: new Map(custs.map(c => [c.id, c])), sById: new Map(sites.map(x => [x.id, x])) };
}
const kundenAt = (site, gates) => uniq([...gates.filter(g => g.siteId === site.id).map(g => g.customerId), site.customerId, ...(site.kundenIds || [])]);
function doorScore(g, q, R) {
  const nq = normNr(q), toks = normTxt(q).split(/\s+/).filter(Boolean);
  if (!toks.length) return 1;
  const u = gateUnit(g), nr = normNr(u.nr), d = g.data || {}, gg = d.tor || d.grund || {};
  const s = R.sById.get(g.siteId) || {}, c = R.cById.get(g.customerId) || {};
  let sc = 0;
  if (nr && nq) sc = nr === nq ? 100 : nr.startsWith(nq) ? 60 : nr.includes(nq) ? 40 : 0;
  const hay = normTxt([u.nr, u.standort, u.typ, gg.hersteller, gg.fabrNr, u.noun, s.name, s.strasse, s.plzOrt, c.name, floorName(s, g.etageId)].join(' '));
  if (toks.every(t => hay.includes(t))) sc = Math.max(sc, 10);
  return sc;
}
const byNr = (a, b) => (gateUnit(a).nr || '~').localeCompare(gateUnit(b).nr || '~', 'de', { numeric: true }) || (a.standort || '').localeCompare(b.standort || '', 'de');
const lastPill = (g) => g.lastInspected ? `<span class="pill ${g.lastPaper ? 'paper' : ''}">${esc(g.lastInspected)}${g.lastPaper ? ' · Papier' : ''}</span>` : '<span class="pill">noch nie</span>';
function regDupSet(gates) {
  const key = (g) => { const n = normNr(gateUnit(g).nr); return n ? `${g.siteId}|${gateKind(g)}|${n}` : null; };
  const c = new Map(); gates.forEach(g => { const k = key(g); if (k) c.set(k, (c.get(k) || 0) + 1); });
  return new Set(gates.filter(g => c.get(key(g)) > 1).map(g => g.id));
}
const regDupPill = '<span class="pill red dup-pill" title="Diese Nummer gibt es an diesem Objekt mehrmals">doppelt</span>';
// Eine Tür in einer Liste (Handy: Zeile, PC: Tabellenzeile)
function doorRow(g, R, { site = false, kunde = false, sel = false, dup = false } = {}) {
  const u = gateUnit(g), s = R.sById.get(g.siteId), c = R.cById.get(g.customerId);
  const cb = sel ? `<input type="checkbox" class="sel-in" data-sel="${g.id}" ${selDoors.has(g.id) ? 'checked' : ''} aria-label="Auswählen">` : '';
  if (DESK) return `<tr class="dt-click" data-act="openDoor" data-id="${g.id}">${sel ? `<td class="cb">${cb}</td>` : ''}
    <td class="nw"><b>${esc(u.nr || '')}</b></td><td><span class="kind-tag ${gateKind(g)}">${esc(u.noun)}</span></td><td class="nw">${esc(floorName(s, g.etageId))}</td>
    <td><b>${esc(u.standort || '–')}</b>${dup ? ' ' + regDupPill : ''}</td><td>${esc(u.typ || '')}</td>
    ${site ? `<td>${esc(sname(s))}</td>` : ''}${kunde ? `<td>${esc(c?.name || '')}</td>` : ''}<td class="nw">${lastPill(g)}</td></tr>`;
  return `<div class="gate-line">${sel ? `<label class="sel-cb">${cb}</label>` : ''}<button class="gate-row door-row" data-act="openDoor" data-id="${g.id}">
    <span class="gate-txt"><b>${u.nr ? `<span class="nr-tag">${esc(u.nr)}</span> ` : ''}${esc(u.standort || `${u.noun} ohne Standort`)}</b>${dup ? ' ' + regDupPill : ''}<br>
    <span class="muted small"><span class="kind">${esc(u.noun)}</span> ${esc([floorName(s, g.etageId), u.typ, site && sname(s), kunde && c?.name].filter(Boolean).join(' · '))}</span></span>
    ${lastPill(g)}</button></div>`;
}
const doorHead = ({ site = false, kunde = false, sel = false } = {}) => `<thead><tr>${sel ? '<th class="cb"></th>' : ''}<th>Nr.</th><th>Art</th><th>Etage</th><th>Standort / Lage</th><th>Typ</th>${site ? '<th>Objekt</th>' : ''}${kunde ? '<th>Kunde</th>' : ''}<th>Zuletzt geprüft</th></tr></thead>`;
const doorTable = (rows, opts) => DESK ? `<table class="dt">${doorHead(opts)}<tbody>${rows}</tbody></table>` : rows;
const regBar = (back, title, sub, right = '') => DESK
  ? `<header class="bar dk-tb">${back ? `<button class="tb-btn icon" data-act="menuGo" data-href="${back}" title="Zurück">‹</button>` : ''}<div class="bar-title"><span class="t">${title}</span>${sub ? `<span class="sub">${sub}</span>` : ''}</div>${right}</header>`
  : `<header class="bar"><button class="icon-btn" data-act="menuGo" data-href="${back || '#/'}" aria-label="Zurück">‹</button><div class="bar-title">${sub ? `<span class="small muted block">${sub}</span>` : ''}${title}</div>${right}</header>`;
const panel = (h, body, cls = '') => DESK ? `<section class="dk-panel ${cls}"><h2>${h}</h2>${body}</section>` : `<section class="card ${cls}"><h2>${h}</h2>${body}</section>`;

// Türenliste: gleiche Suche, Filter und Gruppierung auf „Türen und Tore“ und auf jedem Objekt.
// Auf einem Objekt (doorScope) ist das Objekt fest, gruppiert wird dort standardmäßig nach Etage.
const DF0 = { site: '', kunde: '', kind: '', herst: '', etage: '', group: '' };
let doorScope = null;
const getDF = () => {
  if (!doorScope) return { ...DF0, ...(settings.get('doorFilter', {}) || {}) };
  const s = settings.get('objFilter', {}) || {};
  return { ...DF0, group: 'etage', ...(s.id === doorScope ? s : {}), site: doorScope, id: doorScope };
};
const setDF = (F) => settings.set(doorScope ? 'objFilter' : 'doorFilter', doorScope ? { ...F, id: doorScope } : F);
const rerenderDL = () => doorScope ? renderObjekt(doorScope) : renderDoors();
const herstOf = (g) => { const d = g.data || {}; return (d.tor || d.grund || {}).hersteller || Object.values(d).find(x => x?.hersteller)?.hersteller || ''; };
const GROUPS = [['', 'nichts'], ['etage', 'Etage'], ['objekt', 'Objekt'], ['kunde', 'Kunde'], ['art', 'Art'], ['herst', 'Hersteller']];
function doorList(R, F, q) {
  const scoped = !!doorScope;
  const sitesUsed = R.sites.filter(x => x.name || x.strasse || R.gates.some(g => g.siteId === x.id)).sort((a, b) => sname(a).localeCompare(sname(b), 'de'));
  // Kunden-Auswahl: bei gewähltem Objekt nur die dort vorkommenden
  const kIds = new Set(R.gates.filter(g => !F.site || g.siteId === F.site).map(g => g.customerId).filter(Boolean));
  if (F.kunde) kIds.add(F.kunde);
  const kunden = R.custs.filter(c => c.name && (kIds.has(c.id) || (!F.site && R.sites.some(x => x.customerId === c.id)))).sort((a, b) => a.name.localeCompare(b.name, 'de'));
  const base = R.gates.filter(g => !F.site || g.siteId === F.site);
  const hersts = uniq(base.map(herstOf)).sort((a, b) => a.localeCompare(b, 'de'));
  const fSite = F.site && R.sById.get(F.site), floors = floorsOf(fSite), fIds = new Set(floors.map(f => f.id));
  const etOk = (g) => !F.site || !F.etage || (F.etage === 'none' ? !fIds.has(g.etageId) : g.etageId === F.etage);
  let list = base.filter(g => (!F.kunde || g.customerId === F.kunde) && (!F.kind || gateKind(g) === F.kind) && (!F.herst || herstOf(g) === F.herst) && etOk(g));
  const total = list.length;
  list = q ? list.map(g => [g, doorScore(g, q, R)]).filter(([, sc]) => sc > 0).sort((a, b) => b[1] - a[1] || byNr(a[0], b[0])).map(([g]) => g)
    : list.sort((a, b) => sname(R.sById.get(a.siteId)).localeCompare(sname(R.sById.get(b.siteId)), 'de') || byNr(a, b));
  const dups = regDupSet(R.gates);
  const sel = (k, label, opts, all = 'Alle') => `<label class="flt ${F[k] ? 'on' : ''}"><span class="lbl">${label}</span><select class="field" data-flt="${k}">
    <option value="">${all}</option>${opts.map(([v, t]) => `<option value="${esc(v)}" ${F[k] === v ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select></label>`;
  const groups = GROUPS.filter(([k]) => k && (k === 'etage' ? !!F.site : k === 'objekt' ? !F.site : true));
  const group = groups.some(([k]) => k === F.group) ? F.group : '';
  const anyF = ['kunde', 'kind', 'herst', 'etage', ...(scoped ? [] : ['site'])].some(k => F[k]);
  const filters = `<div class="flt-bar">
    ${scoped ? '' : sel('site', 'Objekt', sitesUsed.map(x => [x.id, sname(x)]))}
    ${F.site ? sel('etage', 'Etage', [...floors.slice().reverse().map(f => [f.id, f.name]), ['none', 'ohne Etage']]) : ''}
    ${sel('kunde', 'Kunde', kunden.map(c => [c.id, c.name]))}
    ${sel('kind', 'Art', [['tuer', 'Türen'], ['tor', 'Tore']])}
    ${hersts.length ? sel('herst', 'Hersteller', hersts.map(h => [h, h])) : ''}
    <label class="flt flt-g"><span class="lbl">Gruppieren nach</span><select class="field" data-flt="group"><option value="">nichts</option>${groups.map(([k, t]) => `<option value="${k}" ${group === k ? 'selected' : ''}>${t}</option>`).join('')}</select></label>
    ${anyF ? '<button class="flt-x" data-act="fltReset">Filter zurücksetzen</button>' : ''}</div>`;
  const opts = { site: !F.site, kunde: !F.kunde, sel: true };
  const fKunde = F.kunde && R.cById.get(F.kunde);
  const info = !scoped && (fSite || fKunde) ? `<p class="muted small flt-info">${fSite ? `<span>🏢 <a class="link-ish" href="#/o/${fSite.id}">${esc([sname(fSite), fSite.plzOrt].filter(Boolean).join(', '))} ›</a></span>` : ''}
    ${fKunde ? `<span>👤 <a class="link-ish" href="#/k/${fKunde.id}">${esc([fKunde.name, fKunde.plzOrt].filter(Boolean).join(', '))} ›</a></span>` : ''}</p>` : '';
  const count = `${list.length}${list.length !== total ? ` von ${total}` : ''}`;
  const head = (h, n) => DESK ? `<tr class="dt-group"><td colspan="12"><b>${esc(h)}</b> <span class="muted">${n}</span></td></tr>` : `<h3 class="pair-h fl-h">${esc(h)} <span class="muted small">${n}</span></h3>`;
  const body = list.length
    ? doorTable(groupList(list, q ? '' : group, R, floors, fIds).map(([h, gs]) => (h ? head(h, gs.length) : '') + gs.map(g => doorRow(g, R, { ...opts, dup: dups.has(g.id) })).join('')).join(''), opts)
    : `<p class="${DESK ? 'dk-empty' : 'muted'}">${total || q ? 'Nichts passt zu Suche und Filtern.' : base.length ? 'Keine Tür passt zu den Filtern.' : scoped ? 'Noch keine Türen an diesem Objekt. Mit „＋ Tür“ oder „＋ Tor“ anlegen.' : 'Noch keine Türen. Mit „＋ Tür“ anlegen und dann die alten Papierprotokolle nachtragen. Türen aus Terminen erscheinen hier automatisch.'}</p>`;
  const title = F.kind === 'tor' ? 'Tore' : F.kind === 'tuer' ? 'Türen' : 'Türen und Tore';
  return { filters, info, title, count, body };
}
const addDoorBtns = (cls) => `<button class="${cls}" data-act="newDoorAsk" data-kind="tuer">＋ Tür</button><button class="${cls}" data-act="newDoorAsk" data-kind="tor">＋ Tor</button>`;
const selBar = () => `<div class="sel-bar ${selDoors.size ? '' : 'hidden'}" id="selBar"><span id="selN">${selDoors.size} ausgewählt</span>
      <button class="sel-b primary" data-act="moveDoorsAsk">Kunde ändern ›</button><button class="sel-b" data-act="selClear">Aufheben</button></div>`;
async function renderDoors() {
  doorScope = null;
  const R = await regData(), D = doorList(R, getDF(), regQuery.trim());
  $app.innerHTML = `
    ${regBar('#/', 'Türen und Tore', '', DESK ? `${addDoorBtns('tb-btn primary')}${searchBox('regSearch', regQuery, 'Suchen: Tür-Nr., Standort, Objekt …  ( / )')}` : '')}
    <main class="${DESK ? 'dk-page' : 'home'} reg-page">
      ${DESK ? '' : searchBox('regSearch', regQuery, 'Suchen: Tür-Nr., Standort, Objekt …')}
      ${D.filters}
      ${D.info}
      ${panel(`${D.title} <span class="muted small">${D.count}</span>`, D.body)}
      ${DESK ? '' : `<div class="two">${addDoorBtns('big-btn primary')}</div>`}
    </main>
    ${selBar()}`;
}
// Gruppen in Anzeige-Reihenfolge; Etagen von oben nach unten wie im Haus
function groupList(list, key, R, floors, fIds) {
  if (!key) return [[null, list]];
  if (key === 'etage') {
    if (!floors.length) return [[null, list]];
    const groups = floors.slice().reverse().map(f => [f.name, list.filter(g => g.etageId === f.id)]);
    groups.push(['Ohne Etage', list.filter(g => !fIds.has(g.etageId))]);
    return groups.filter(([, gs]) => gs.length);
  }
  const lab = { objekt: (g) => sname(R.sById.get(g.siteId)) || 'Ohne Objekt', kunde: (g) => R.cById.get(g.customerId)?.name || 'Ohne Kunde', art: (g) => gateKind(g) === 'tor' ? 'Tore' : 'Türen', herst: (g) => herstOf(g) || 'Ohne Hersteller' }[key];
  const m = new Map(); list.forEach(g => { const k = lab(g); if (!m.has(k)) m.set(k, []); m.get(k).push(g); });
  return [...m].sort((a, b) => a[0].startsWith('Ohne ') - b[0].startsWith('Ohne ') || a[0].localeCompare(b[0], 'de', { numeric: true }));
}

// ----- Kunden und Objekte: eigene Listen und eigene Seiten -----
let kQuery = '', oQuery = '';
const txtHit = (q, parts) => normTxt(q).split(/\s+/).filter(Boolean).every(t => normTxt(parts.join(' ')).includes(t));
const sitesOfKunde = (R, cid) => R.sites.filter(s => s.customerId === cid || (s.kundenIds || []).includes(cid) || R.gates.some(g => g.siteId === s.id && g.customerId === cid));
const visitsOfKunde = (R, cid) => R.visits.filter(v => pairsOf(v).some(p => p.customerId === cid)).sort((a, b) => dateKey(b.datum).localeCompare(dateKey(a.datum)));
const nDoors = (n) => `${n} ${n === 1 ? 'Tür/Tor' : 'Türen/Tore'}`;
const fold = (key, h, body, open) => {
  const o = settings.get('fold:' + key, open);
  return `<details class="${DESK ? 'dk-panel' : 'card'} fold" data-fold="${key}" ${o ? 'open' : ''}><summary><h2>${h}</h2></summary><div class="fold-body">${body}</div></details>`;
};
document.addEventListener('toggle', (e) => { const k = e.target.dataset?.fold; if (k) settings.set('fold:' + k, e.target.open); }, true);
const fieldGrid = (fields, rec, attr, idAttr) => `<div class="grid ${DESK ? 'dk-form' : ''}">${fields.map(f => `<label class="fld ${f.half ? 'half' : ''}"><span class="lbl">${esc(f.label)}</span><input class="field" ${attr}="${f.key}" ${idAttr}="${rec.id}" value="${esc(rec[f.key])}" autocomplete="off"></label>`).join('')}</div>`;

async function renderKunden() {
  const R = await regData(), q = kQuery.trim();
  const list = R.custs.filter(c => c.name || R.gates.some(g => g.customerId === c.id))
    .filter(c => !q || txtHit(q, [c.name, c.zusatz, c.strasse, c.plzOrt, c.ansprech, c.tel]))
    .sort((a, b) => (a.name || '~').localeCompare(b.name || '~', 'de'));
  const row = (c) => {
    const st = sitesOfKunde(R, c.id), n = R.gates.filter(g => g.customerId === c.id).length, vs = visitsOfKunde(R, c.id);
    return DESK ? `<tr class="dt-click" data-act="menuGo" data-href="#/k/${c.id}"><td><b>${esc(c.name || 'Kunde ohne Namen')}</b></td><td>${esc([c.strasse, c.plzOrt].filter(Boolean).join(', '))}</td>
        <td class="nw">${st.length}</td><td class="nw">${n}</td><td class="nw">${esc(vs[0]?.datum || '–')}</td></tr>`
      : `<div class="row-wrap"><button class="list-row" data-act="menuGo" data-href="#/k/${c.id}"><span><strong>${esc(c.name || 'Kunde ohne Namen')}</strong><br>
        <span class="muted small">${esc([[c.strasse, c.plzOrt].filter(Boolean).join(', '), `${st.length} ${st.length === 1 ? 'Objekt' : 'Objekte'}`, nDoors(n)].filter(Boolean).join(' · '))}</span></span><span class="chev">›</span></button></div>`;
  };
  $app.innerHTML = `
    ${regBar('#/', 'Kunden', '', DESK ? `<button class="tb-btn primary" data-act="newKunde">＋ Neuer Kunde</button>${searchBox('kSearch', kQuery, 'Kunde suchen …  ( / )')}` : '')}
    <main class="${DESK ? 'dk-page' : 'home'} reg-page">
      ${DESK ? '' : `${searchBox('kSearch', kQuery, 'Kunde suchen: Name, Ort …')}<button class="big-btn primary" data-act="newKunde">＋ Neuer Kunde</button>`}
      ${panel(`Kunden <span class="muted small">${list.length}</span>`, list.length ? (DESK ? `<table class="dt"><thead><tr><th>Name</th><th>Adresse</th><th>Objekte</th><th>Türen und Tore</th><th>Letzter Termin</th></tr></thead><tbody>${list.map(row).join('')}</tbody></table>` : list.map(row).join(''))
        : `<p class="${DESK ? 'dk-empty' : 'muted'}">${q ? 'Kein Kunde passt zur Suche.' : 'Noch keine Kunden.'}</p>`)}
    </main>`;
}
async function renderKunde(id) {
  const R = await regData(), c = R.cById.get(id);
  if (!c) { location.hash = '#/k'; return; }
  const kg = TEMPLATE_TORE.header.find(x => x.id === 'kunde');
  const sites = sitesOfKunde(R, id).sort((a, b) => sname(a).localeCompare(sname(b), 'de')), vs = visitsOfKunde(R, id);
  const nAll = R.gates.filter(g => g.customerId === id).length;
  const sRow = (s) => {
    const mine = R.gates.filter(g => g.siteId === s.id && g.customerId === id).length, all = R.gates.filter(g => g.siteId === s.id).length;
    const others = kundenAt(s, R.gates).filter(k => k !== id).map(k => R.cById.get(k)?.name).filter(Boolean);
    const cnt = `${nDoors(mine)}${all > mine ? ` (von ${all})` : ''}`;
    return DESK ? `<tr class="dt-click" data-act="menuGo" data-href="#/o/${s.id}"><td><b>${esc(sname(s))}</b></td><td>${esc(s.plzOrt || '')}</td><td class="nw">${cnt}</td><td class="nw">${floorsOf(s).length || '–'}</td><td>${esc(others.join(', '))}</td></tr>`
      : `<div class="row-wrap"><button class="list-row" data-act="menuGo" data-href="#/o/${s.id}"><span><strong>${esc(sname(s))}</strong><br>
        <span class="muted small">${esc([s.plzOrt, cnt, others.length ? 'auch: ' + others.join(', ') : ''].filter(Boolean).join(' · '))}</span></span><span class="chev">›</span></button></div>`;
  };
  const vRow = (v) => {
    const its = R.inspections.filter(i => i.visitId === v.id), d = its.filter(i => i.status === 'done').length;
    return DESK ? `<tr class="dt-click" data-act="openVisit" data-id="${v.id}"><td class="nw"><b>${esc(v.datum || '–')}</b></td><td>${esc(visitTitle(v))}</td><td class="nw">${d} / ${its.length}</td></tr>`
      : `<div class="row-wrap"><button class="list-row" data-act="openVisit" data-id="${v.id}"><span><strong>${esc(v.datum || 'ohne Datum')}</strong> <span class="muted small">${esc(visitTitle(v))}</span><br><span class="muted small">${d} von ${its.length} fertig</span></span><span class="chev">›</span></button></div>`;
  };
  $app.innerHTML = `
    ${regBar(backOf.k, `<span id="scrT">${esc(c.name || 'Neuer Kunde')}</span>`, 'Kunde', `${DESK ? '<button class="tb-btn primary" data-act="newSiteFor" data-id="' + id + '">＋ Objekt</button>' : ''}<button class="${DESK ? 'tb-btn icon' : 'icon-btn'}" data-act="menu" data-for="customer" data-id="${id}" aria-label="Mehr">⋯</button>`)}
    <main class="${DESK ? 'dk-page' : 'home'} reg-page ent-page">
      ${noteSection('customers', id, c.intNote)}
      <div class="ent-top">
        ${fold('kData', 'Kundendaten', fieldGrid(kg.fields, c, 'data-ck', 'data-cid'), !c.name || DESK)}
      </div>
      ${panel(`Objekte <span class="muted small">${sites.length}</span>${DESK ? '' : `<button class="mini-link push-r" data-act="newSiteFor" data-id="${id}">＋ Objekt</button>`}`, sites.length
        ? (DESK ? `<table class="dt"><thead><tr><th>Objekt</th><th>Ort</th><th>Türen und Tore</th><th>Etagen</th><th>Weitere Kunden</th></tr></thead><tbody>${sites.map(sRow).join('')}</tbody></table>` : sites.map(sRow).join(''))
        : `<p class="${DESK ? 'dk-empty' : 'muted'}">Noch keine Objekte. Mit „＋ Objekt“ anlegen.</p>`)}
      ${nAll ? `<p class="muted small"><button class="link-ish" data-act="kundeDoors" data-id="${id}">🚪 Alle ${nDoors(nAll)} dieses Kunden in einer Liste ›</button></p>` : ''}
      ${panel(`Termine <span class="muted small">${vs.length}</span>`, vs.length ? (DESK ? `<table class="dt"><thead><tr><th>Datum</th><th>Termin</th><th>Fertig</th></tr></thead><tbody>${vs.map(vRow).join('')}</tbody></table>` : vs.map(vRow).join(''))
        : `<p class="${DESK ? 'dk-empty' : 'muted'}">Noch keine Termine.</p>`)}
    </main>`;
  if (!c.name) document.querySelector('input[data-ck="name"]')?.focus();
}
async function renderObjekte() {
  const R = await regData(), q = oQuery.trim();
  const list = R.sites.filter(s => s.name || s.strasse || R.gates.some(g => g.siteId === s.id))
    .map(s => ({ s, ks: kundenAt(s, R.gates).map(k => R.cById.get(k)?.name).filter(Boolean) }))
    .filter(({ s, ks }) => !q || txtHit(q, [s.name, s.strasse, s.plzOrt, ...ks]))
    .sort((a, b) => (sname(a.s) || '~').localeCompare(sname(b.s) || '~', 'de'));
  const row = ({ s, ks }) => {
    const n = R.gates.filter(g => g.siteId === s.id).length, fl = floorsOf(s).length;
    return DESK ? `<tr class="dt-click" data-act="menuGo" data-href="#/o/${s.id}"><td><b>${esc(sname(s))}</b></td><td>${esc(s.plzOrt || '')}</td><td>${esc(ks.join(', '))}</td><td class="nw">${n}</td><td class="nw">${fl || '–'}</td></tr>`
      : `<div class="row-wrap"><button class="list-row" data-act="menuGo" data-href="#/o/${s.id}"><span><strong>${esc(sname(s))}</strong><br>
        <span class="muted small">${esc([s.plzOrt, ks.join(', '), nDoors(n), fl ? `${fl} ${fl === 1 ? 'Etage' : 'Etagen'}` : ''].filter(Boolean).join(' · '))}</span></span><span class="chev">›</span></button></div>`;
  };
  $app.innerHTML = `
    ${regBar('#/', 'Objekte', '', DESK ? `<button class="tb-btn primary" data-act="newSiteFor">＋ Neues Objekt</button>${searchBox('oSearch', oQuery, 'Objekt suchen …  ( / )')}` : '')}
    <main class="${DESK ? 'dk-page' : 'home'} reg-page">
      ${DESK ? '' : `${searchBox('oSearch', oQuery, 'Objekt suchen: Name, Straße, Kunde …')}<button class="big-btn primary" data-act="newSiteFor">＋ Neues Objekt</button>`}
      ${panel(`Objekte <span class="muted small">${list.length}</span>`, list.length ? (DESK ? `<table class="dt"><thead><tr><th>Objekt</th><th>Ort</th><th>Kunden</th><th>Türen und Tore</th><th>Etagen</th></tr></thead><tbody>${list.map(row).join('')}</tbody></table>` : list.map(row).join(''))
        : `<p class="${DESK ? 'dk-empty' : 'muted'}">${q ? 'Kein Objekt passt zur Suche.' : 'Noch keine Objekte.'}</p>`)}
    </main>`;
}
async function renderObjekt(id) {
  const R = await regData(), st = R.sById.get(id);
  if (!st) { location.hash = '#/o'; return; }
  doorScope = id; curSite = st;
  const og = TEMPLATE_TORE.header.find(x => x.id === 'objekt');
  const ks = kundenAt(st, R.gates).map(k => R.cById.get(k)).filter(Boolean);
  const kChips = ks.map(c => { const n = R.gates.filter(g => g.siteId === id && g.customerId === c.id).length;
    return `<span class="ent-chip"><a href="#/k/${c.id}">👤 ${esc(c.name || 'ohne Namen')}</a> <span class="muted small">${n}</span>${n ? '' : `<button class="mini-x" data-act="siteKundeDel" data-id="${c.id}" aria-label="Vom Objekt entfernen" title="Vom Objekt entfernen">×</button>`}</span>`; }).join('');
  const D = doorList(R, getDF(), regQuery.trim());
  const maps = floorsOf(st).filter(f => f.map);
  const plan = `<p class="muted small plan-soon">Mit „＋ Plan“ ein Bild des Grundrisses zu einer Etage hinzufügen. Türen auf dem Plan markieren kommt als Nächstes.</p>`;
  const planRow = maps.length ? `<section class="${DESK ? 'dk-sum' : 'card'} ent-kunden ent-plans"><span class="muted">🗺 Pläne</span> ${maps.slice().reverse().map(f => `<button class="chip" data-act="planGo" data-site="${id}" data-id="${f.id}">${esc(f.name)}</button>`).join('')}</section>` : '';
  $app.innerHTML = `
    ${regBar(backOf.o, `<span id="scrT">${esc(hasName(st) ? sname(st) : 'Neues Objekt')}</span>`, `Objekt${st.plzOrt ? ' · ' + esc(st.plzOrt) : ''}`, `${DESK ? `${addDoorBtns('tb-btn primary')}${searchBox('regSearch', regQuery, 'Tür suchen …  ( / )')}` : ''}<button class="${DESK ? 'tb-btn icon' : 'icon-btn'}" data-act="menu" data-for="site" data-id="${id}" aria-label="Mehr">⋯</button>`)}
    <main class="${DESK ? 'dk-page' : 'home'} reg-page ent-page">
      ${noteSection('sites', id, st.intNote)}
      <section class="${DESK ? 'dk-sum' : 'card'} ent-kunden"><span class="muted">Kunden</span> ${kChips || '<span class="muted small">noch keiner</span>'} <button class="mini-link" data-act="siteKundeAdd" data-id="${id}">＋ Kunde</button></section>
      ${planRow}
      <div class="ent-top">
        ${fold('oData', 'Objektdaten', fieldGrid(og.fields, st, 'data-os', 'data-sid'), !hasName(st) || DESK)}
        ${fold('oFloors', `Etagen und Pläne <span class="muted small">${floorsOf(st).length}</span>`, floorsEditor(st) + plan, DESK)}
      </div>
      ${DESK ? '' : searchBox('regSearch', regQuery, 'Tür suchen: Nr., Standort …')}
      ${D.filters}
      ${panel(`${D.title} <span class="muted small">${D.count}</span>`, D.body)}
      ${DESK ? '' : `<div class="two">${addDoorBtns('big-btn primary')}</div>`}
    </main>
    ${selBar()}`;
  if (!hasName(st)) document.querySelector('input[data-os="name"]')?.focus();
}
// Neue Tür: Objekt und Kunde kommen aus den Filtern, sonst kurz fragen
async function newDoorAsk(kind) {
  const F = getDF(), R = await regData();
  if (F.site && F.kunde) return newDoor(F.site, F.kunde, kind);
  const ks = F.site && R.sById.get(F.site) ? kundenAt(R.sById.get(F.site), R.gates) : [];
  if (ks.length === 1) return newDoor(F.site, ks[0], kind);
  const sites = R.sites.filter(x => x.name || x.strasse).sort((a, b) => sname(a).localeCompare(sname(b), 'de'));
  const custs = R.custs.filter(c => c.name).sort((a, b) => a.name.localeCompare(b.name, 'de'));
  const sheet = document.getElementById('sheet');
  sheet.innerHTML = `<div class="sheet-inner">
    <div class="sheet-grab"></div>
    <h2 class="sheet-h">${kind === 'tuer' ? 'Neue Tür' : 'Neues Tor'}</h2>
    <label class="fld"><span class="lbl">Objekt</span><select class="field" id="ndSite"><option value="">＋ Neues Objekt …</option>${sites.map(x => `<option value="${x.id}" ${x.id === F.site ? 'selected' : ''}>${esc([sname(x), x.plzOrt].filter(Boolean).join(', '))}</option>`).join('')}</select></label>
    <input class="field ${F.site ? 'hidden' : ''}" id="ndSiteNew" placeholder="Name oder Straße des neuen Objekts" autocomplete="off">
    <label class="fld"><span class="lbl">Kunde</span><select class="field" id="ndKunde"><option value="">＋ Neuer Kunde …</option>${custs.map(c => `<option value="${c.id}" ${c.id === F.kunde ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select></label>
    <input class="field ${F.kunde ? 'hidden' : ''}" id="ndKundeNew" placeholder="Name des neuen Kunden" autocomplete="off">
    <button class="big-btn primary" data-act="newDoorGo" data-kind="${kind}">Anlegen ›</button>
    <button class="big-btn" data-act="cancelDel">Abbrechen</button>
  </div>`;
  sheet.classList.add('show');
}
async function newDoorGo(kind) {
  let sid = document.getElementById('ndSite').value, cid = document.getElementById('ndKunde').value;
  const sNew = document.getElementById('ndSiteNew').value.trim(), cNew = document.getElementById('ndKundeNew').value.trim();
  if (!sid && !sNew) { snack('Bitte ein Objekt wählen oder neu eintragen.'); return document.getElementById('ndSiteNew').focus(); }
  if (!cid && !cNew) { snack('Bitte einen Kunden wählen oder neu eintragen.'); return document.getElementById('ndKundeNew').focus(); }
  if (!cid) { cid = uid(); await db.put('customers', { id: cid, name: cNew }); }
  if (!sid) { sid = uid(); await db.put('sites', { id: sid, customerId: cid, ...(/\d/.test(sNew) ? { strasse: sNew } : { name: sNew }) }); }
  closeJump();
  return newDoor(sid, cid, kind);
}
async function editSite(sid) {
  const st = await db.get('sites', sid); if (!st) return;
  const og = TEMPLATE_TORE.header.find(x => x.id === 'objekt');
  const sheet = document.getElementById('sheet');
  sheet.innerHTML = `<div class="sheet-inner">
    <div class="sheet-grab"></div>
    <h2 class="sheet-h">Objekt</h2>
    <div class="grid">${og.fields.map(f => `<label class="fld ${f.half ? 'half' : ''}"><span class="lbl">${esc(f.label)}</span><input class="field" data-os="${f.key}" data-sid="${sid}" value="${esc(st[f.key])}" autocomplete="off"></label>`).join('')}</div>
    ${floorsEditor(st)}
    <p class="muted small">Gilt für alle Türen an diesem Objekt. Fertige Protokolle behalten die Angaben von damals.</p>
    <button class="big-btn primary" data-act="kundeDone">Fertig</button>
  </div>`;
  sheet.classList.add('show');
}
function updSelBar() {
  const bar = document.getElementById('selBar'); if (!bar) return;
  bar.classList.toggle('hidden', !selDoors.size);
  document.getElementById('selN').textContent = `${selDoors.size} ausgewählt`;
}

async function renderDoor(id) {
  const R = await regData(), g = R.gates.find(x => x.id === id);
  if (!g) { location.hash = '#/tueren'; return; }
  curDoor = g; doorBase = structuredClone(g.data || {});
  const t = TEMPLATES[g.templateId] || TEMPLATE_TORE, u = gateUnit(g), st = R.sById.get(g.siteId), c = R.cById.get(g.customerId);
  const protos = R.inspections.filter(i => i.gateId === id).sort((a, b) => (a.status === 'done') - (b.status === 'done') || protoSort(a, b));
  const nr = normNr(u.nr);
  const twins = nr ? R.gates.filter(x => x.id !== id && x.siteId === g.siteId && gateKind(x) === gateKind(g) && normNr(gateUnit(x).nr) === nr) : [];
  const vals = g.data || {};
  const groups = t.header.filter(x => x.scope === 'gate').map(gr => {
    const v = vals[gr.id] || {};
    const fields = gr.fields.filter(f => !f.perInspection && (!f.showIf || v[f.showIf[0]] === f.showIf[1]));
    return panel(esc(gr.title), `<div class="grid ${DESK ? 'dk-form' : ''}">${fields.map(f => f.type === 'choice' ? `
      <div class="fld"><span class="lbl">${esc(f.label)}</span><span class="chips opt">${f.options.map(o => `<button type="button" class="chip ${v[f.key] === o ? 'on' : ''}" data-act="gdchoice" data-h="${gr.id}.${f.key}" data-v="${esc(o)}">${esc(o)}</button>`).join('')}</span></div>` : `
      <label class="fld ${f.half ? 'half' : ''}"><span class="lbl">${esc(f.label)}</span><span class="inwrap">
        <input class="field" data-gd="${gr.id}.${f.key}" ${learnable(gr, f, t) ? `data-learn="${gr.id}.${f.key}"` : ''} value="${esc(v[f.key])}" ${f.inputmode ? `inputmode="${f.inputmode}"` : ''} enterkeyhint="next" autocomplete="off" ${f.hint ? `placeholder="${esc(f.hint)}"` : ''}>
        ${f.unit ? `<span class="unit">${esc(f.unit)}</span>` : ''}</span></label>`).join('')}</div>`);
  }).join('');
  const vById = new Map(R.visits.map(v => [v.id, v]));
  const protoRow = (i) => {
    const [cls, label] = itemState(i), v = vById.get(i.visitId);
    const src = i.paper ? '<span class="pill paper">vom Papier</span>' : v ? `Termin ${esc(v.datum || '')}` : 'Einzelprüfung';
    const act = i.paper ? `data-act="menuGo" data-href="#/p/${i.id}/0"` : `data-act="open" data-id="${i.id}"`;
    return DESK ? `<tr class="dt-click" ${act}><td class="nw"><b>${esc(i.datum || '–')}</b></td><td>${src}</td><td>${esc(i.header?.kunde?.name || '')}</td>
        <td><span class="pill ${cls === 'maengel' ? 'red' : cls === 'fertig' ? 'green' : ''}">${esc(label)}</span></td><td class="muted">${esc((i.remarks || '').split('\n')[0].slice(0, 80))}</td></tr>`
      : `<div class="row-wrap"><button class="list-row" ${act}><span><strong>${esc(i.datum || 'ohne Datum')}</strong> <span class="muted small">${src}</span><br>
        <span class="muted small">${esc((i.remarks || '').split('\n')[0].slice(0, 60))}</span></span>
        <span class="pill ${cls === 'maengel' ? 'red' : cls === 'fertig' ? 'green' : ''}">${esc(label)}</span></button></div>`;
  };
  const log = (g.log || []).slice().reverse();
  $app.innerHTML = `
    ${regBar(listBack || `#/o/${g.siteId}`, u.nr ? unitHead(u) : esc(u.standort || `${u.noun} ohne Standort`), `${esc(u.noun)} · ${esc(sname(st))}`,
      `${DESK ? `<button class="tb-btn primary" data-act="paperNew" data-id="${g.id}">📄 Altes Protokoll (Papier) nachtragen</button>` : ''}<button class="${DESK ? 'tb-btn icon' : 'icon-btn'}" data-act="menu" data-for="gate" data-id="${g.id}" aria-label="Mehr">⋯</button>`)}
    <main class="${DESK ? 'dk-page' : 'home'} reg-page">
      ${noteSection('gates', g.id, g.intNote)}
      ${twins.length ? `<div class="dup-box"><p><b>⚠ ${esc(u.nrLabel)} ${esc(u.nr)} gibt es an diesem Objekt ${twins.length === 1 ? 'noch einmal' : `noch ${twins.length}-mal`}.</b> Bitte prüfen, ob es dieselbe ${esc(u.noun)} ist, und die doppelte löschen.</p>
        <div class="dup-acts">${twins.map(x => `<button class="dup-b" data-act="openDoor" data-id="${x.id}">Zur anderen: ${esc(x.standort || 'ohne Standort')} ›</button>`).join('')}</div></div>` : ''}
      <section class="${DESK ? 'dk-sum' : 'card'} door-who">
        <span><span class="muted">Objekt</span> <a class="link" href="#/o/${g.siteId}" title="Objekt öffnen">${esc(sname(st))}</a></span>
        <span class="door-et"><span class="muted">Etage</span> ${etageSelect(st, g.etageId, g.id)}</span>
        <span><span class="muted">Kunde</span> ${c ? `<a class="link" href="#/k/${c.id}" title="Kunde öffnen">${esc(c.name || 'ohne Namen')}</a>` : '<b>kein Kunde</b>'} <button class="mini-link" data-act="moveDoorsAsk" data-id="${g.id}">ändern</button></span>
      </section>
      ${DESK ? '' : `<button class="big-btn primary" data-act="paperNew" data-id="${g.id}">📄 Altes Protokoll (Papier) nachtragen</button>`}
      ${(() => {
        const tf = (t) => (t.ref?.startsWith('i:') ? t.label : t.ref?.startsWith('h:') ? t.label : '') || 'Allgemein';
        const open = (g.todos || []).filter(t => !t.done), done = (g.todos || []).filter(t => t.done).slice(-10).reverse();
        return panel(`📌 Zu prüfen <span class="muted small">${open.length}</span><button class="mini-link push-r" data-act="todoAdd" data-ref="" data-label="" data-gid="${g.id}">＋ Merken</button>`,
          `<div class="todo-wrap">${open.map(t => `<div class="todo-li"><span><b>${esc(tf(t))}</b>: ${esc(t.text)} <span class="muted small">${esc(t.src)}</span></span><button class="todo-ok" data-act="todoDone" data-id="${t.id}" title="Erledigt">✓</button><button class="mini-link" data-act="todoDel" data-id="${t.id}" title="Entfernen">✕</button></div>`).join('')
            || '<p class="muted small">Nichts offen. Beim Nachtragen eines Papierprotokolls jedes Feld mit 📌 merken, oder hier mit „＋ Merken“.</p>'}
          ${done.length ? `<details class="todo-done"><summary class="muted small">Erledigt (${done.length})</summary>${done.map(t => `<div class="todo-li done"><span><s>${esc(tf(t))}: ${esc(t.text)}</s> <span class="muted small">erledigt ${esc(t.doneDatum || '')}</span></span><button class="mini-link" data-act="todoUndone" data-id="${t.id}">wieder öffnen</button></div>`).join('')}</details>` : ''}</div>`);
      })()}
      ${panel(`Protokolle <span class="muted small">${protos.length}</span>`, protos.length ? (DESK ? `<table class="dt"><thead><tr><th>Datum</th><th>Herkunft</th><th>Kunde</th><th>Ergebnis</th><th>Bemerkungen</th></tr></thead><tbody>${protos.map(protoRow).join('')}</tbody></table>` : protos.map(protoRow).join(''))
        : `<p class="${DESK ? 'dk-empty' : 'muted'}">Noch keine Protokolle. Alte Papierprotokolle hier nachtragen, dann stehen sie vor Ort als „letztes Mal“ zum Vergleich bereit.</p>`)}
      <div class="door-groups">${groups}</div>
      ${log.length ? panel(`Änderungen <span class="muted small">${log.length}</span>`, `<ul class="door-log">${log.slice(0, 50).map(l => `<li><span class="muted">${esc(l.datum)} · ${esc(l.src)}:</span> ${esc(l.field)} <s>${esc(l.from)}</s> → <b>${esc(l.to)}</b></li>`).join('')}</ul>`) : ''}
    </main>`;
  if (focusNr) { focusNr = false; document.querySelector(`input[data-gd="${t.unit.group}.${t.unit.nr}"]`)?.focus(); }
}
// Tür von Hand geändert (Türseite): beim Verlassen des Felds protokollieren, wenn vorher etwas anderes drinstand
function logDoorEdit(h) {
  const [gid, key] = h.split('.'), g = curDoor; if (!g) return;
  const from = doorBase[gid]?.[key], to = g.data?.[gid]?.[key] ?? '';
  if (!blank(from) && from !== to) {
    const f = doorFields(TEMPLATES[g.templateId]).find(([x, ff]) => x === gid && ff.key === key)?.[1];
    logDoor(g, [{ field: f?.label || key, from, to: to || '(leer)' }], 'von Hand geändert');
  }
  (doorBase[gid] ||= {})[key] = to;
  clearTimeout(doorTimer); doorTimer = null; return saveGate(g);
}
async function newDoor(siteId, customerId, kind) {
  const g = { id: uid(), siteId, customerId: customerId || null, templateId: BY_KIND[kind].id, data: {} };
  await saveGate(g);
  focusNr = true;
  location.hash = `#/d/${g.id}`;
}
// Kunde wählen: an einem Objekt hinzufügen oder für ausgewählte Türen setzen
async function openKundePicker(mode, ids = []) {
  kp = { mode, ids, custs: await db.all('customers') };
  const R = await regData();
  const site = mode === 'site' ? curSite : R.sById.get(R.gates.find(g => g.id === ids[0])?.siteId);
  kp.here = new Set(site ? kundenAt(site, R.gates) : []);
  kp.cur = mode === 'doors' && ids.length === 1 ? R.gates.find(g => g.id === ids[0])?.customerId : null;
  const sheet = document.getElementById('sheet');
  sheet.innerHTML = `<div class="sheet-inner">
    <div class="sheet-grab"></div>
    <h2 class="sheet-h">${mode === 'site' ? 'Kunde an diesem Objekt hinzufügen' : ids.length === 1 ? 'Kunde für diese Tür' : `Kunde für ${ids.length} Türen`}</h2>
    <input class="field" id="kpSearch" placeholder="Kunde suchen oder neuen Namen eingeben" autocomplete="off">
    <div id="kpList" class="kp-list"></div>
    <button class="big-btn" data-act="cancelDel">Abbrechen</button>
  </div>`;
  sheet.classList.add('show');
  drawKp('');
}
function drawKp(q) {
  const box = document.getElementById('kpList'); if (!box || !kp) return;
  const toks = normTxt(q).split(/\s+/).filter(Boolean);
  const hits = kp.custs.filter(c => c.name && toks.every(t => normTxt([c.name, c.zusatz, c.strasse, c.plzOrt].join(' ')).includes(t)))
    .sort((a, b) => kp.here.has(b.id) - kp.here.has(a.id) || a.name.localeCompare(b.name, 'de')).slice(0, 12);
  box.innerHTML = hits.map(c => `<button class="list-row" data-act="kpPick" data-id="${c.id}"><span><strong>${c.id === kp.cur ? '✓ ' : ''}${esc(c.name)}</strong><br><span class="muted small">${esc([c.strasse, c.plzOrt].filter(Boolean).join(', '))}${kp.here.has(c.id) ? ' · an diesem Objekt' : ''}</span></span></button>`).join('')
    + (q.trim() ? `<button class="list-row" data-act="kpNew"><span><strong>＋ Neuer Kunde „${esc(q.trim())}“</strong></span></button>` : '')
    + (!hits.length && !q.trim() ? '<p class="muted small">Namen eintippen, um einen Kunden zu suchen oder neu anzulegen.</p>' : '');
}
async function kpApply(cid) {
  const { mode, ids } = kp; kp = null; closeJump();
  if (mode === 'site') {
    const st = await db.get('sites', curSite.id);
    st.kundenIds = uniq([...(st.kundenIds || []), cid]); if (!st.customerId) st.customerId = cid;
    await db.put('sites', st); curSite = st;
    return route();
  }
  const c = await db.get('customers', cid);
  let n = 0;
  for (const id of ids) {
    const g = await db.get('gates', id); if (!g || g.customerId === cid) continue;
    const old = g.customerId && await db.get('customers', g.customerId);
    logDoor(g, [{ field: 'Kunde', from: old?.name || '–', to: c?.name || '–' }], 'von Hand geändert');
    g.customerId = cid; await saveGate(g); n++;
  }
  selDoors = new Set();
  await route();
  snack(n ? `${n === 1 ? '1 Tür' : `${n} Türen`} jetzt bei ${c?.name || 'Kunde'}.` : 'Nichts geändert.');
}
async function editKunde(cid) {
  const c = await db.get('customers', cid); if (!c) return;
  const kg = TEMPLATE_TORE.header.find(x => x.id === 'kunde');
  const sheet = document.getElementById('sheet');
  sheet.innerHTML = `<div class="sheet-inner">
    <div class="sheet-grab"></div>
    <h2 class="sheet-h">Kunde</h2>
    <div class="grid">${kg.fields.map(f => `<label class="fld ${f.half ? 'half' : ''}"><span class="lbl">${esc(f.label)}</span><input class="field" data-ck="${f.key}" data-cid="${cid}" value="${esc(c[f.key])}" autocomplete="off"></label>`).join('')}</div>
    <p class="muted small">Gilt für alle Objekte und Türen dieses Kunden. Fertige Protokolle behalten die Angaben von damals.</p>
    <button class="big-btn primary" data-act="kundeDone">Fertig</button>
  </div>`;
  sheet.classList.add('show');
}


// ---------- Zu prüfen: Merkzettel an der Tür ----------
// Beim Nachtragen eines Papierprotokolls lässt sich jedes Feld mit 📌 und einer Notiz merken.
// Die Einträge gehören zur Tür (gate.todos) und erscheinen vor Ort am Feld und oben in einer Liste, bis sie erledigt sind.
let curTodos = [];
async function loadTodos() { curTodos = insp?.gateId ? ((await db.get('gates', insp.gateId))?.todos || []) : []; }
const openTodos = (ref) => curTodos.filter(t => !t.done && (ref === undefined || t.ref === ref));
function todoBox(ref) {
  return openTodos(ref).map(t => `<div class="todo-box"><span>📌 <b>Zu prüfen:</b> ${esc(t.text)} <span class="muted small">(${esc(t.src)})</span></span>
    ${insp.paper ? `<button class="mini-link" data-act="todoDel" data-id="${t.id}">entfernen</button>` : `<button class="todo-ok" data-act="todoDone" data-id="${t.id}">✓ Erledigt</button>`}</div>`).join('');
}
const pinBtn = (ref, label) => insp?.paper ? `<button type="button" class="pin-btn" data-act="todoAdd" data-ref="${esc(ref)}" data-label="${esc(label)}" title="Für vor Ort merken: zu prüfen" aria-label="Zu prüfen merken">📌</button>` : '';
// Zu welchem Abschnitt gehört ein Eintrag? i:<Prüfpunkt> -> Abschnitt, h:<Gruppe.Feld> -> Stammdaten
function todoStep(t) {
  if (!t.ref?.startsWith('i:')) return 0;
  const n = tpl.sections.findIndex(x => x.items.some(it => it.id === t.ref.slice(2)));
  return n < 0 ? 0 : n + 1;
}
function todoListCard() {
  const list = openTodos(); if (!list.length) return '';
  return `<section class="card todo-card"><h2>📌 Zu prüfen an dieser ${esc(unitOf(insp).noun)} <span class="muted small">${list.length}</span></h2>
    ${list.map(t => `<div class="todo-li"><button class="link" data-act="goto" data-step="${todoStep(t)}"><b>${esc(t.label || 'Allgemein')}</b>: ${esc(t.text)}</button>
      <span class="muted small">${esc(t.src)}</span>${insp.paper ? '' : `<button class="todo-ok" data-act="todoDone" data-id="${t.id}">✓</button>`}</div>`).join('')}</section>`;
}
function todoAddSheet(ref, label, gid = null) {
  const sheet = document.getElementById('sheet');
  sheet.innerHTML = `<div class="sheet-inner">
    <div class="sheet-grab"></div>
    <h2 class="sheet-h">📌 Vor Ort prüfen${label ? `: ${esc(label)}` : ''}</h2>
    <textarea class="field" rows="3" id="todoText" placeholder="z. B. Schließer war undicht, prüfen ob getauscht"></textarea>
    <button class="big-btn primary" data-act="todoSave" data-ref="${esc(ref)}" data-label="${esc(label)}" data-gid="${gid || ''}">Merken</button>
    <button class="big-btn" data-act="cancelDel">Abbrechen</button>
  </div>`;
  sheet.classList.add('show');
  setTimeout(() => document.getElementById('todoText')?.focus(), 50);
}
async function todoChange(gid, fn) {
  const g = await db.get('gates', gid); if (!g) return null;
  g.todos = fn([...(g.todos || [])]);
  await saveGate(g);
  if (insp?.gateId === gid) curTodos = g.todos;
  if (curDoor?.id === gid) curDoor.todos = g.todos;
  return g;
}
async function todoSave(b) {
  const text = document.getElementById('todoText')?.value.trim();
  if (!text) { snack('Bitte kurz notieren, was zu prüfen ist.'); return; }
  const gid = b.dataset.gid || insp?.gateId; if (!gid) return;
  const src = insp?.paper ? `vom Papier ${insp.datum || ''}`.trim() : `notiert ${todayDE()}`;
  await todoChange(gid, (l) => [...l, { id: uid(), ref: b.dataset.ref || '', label: b.dataset.label || '', text, src, at: new Date().toISOString(), done: false }]);
  closeJump(); buzz();
  if (insp) renderStepKeepScroll(); else { const y = scrollY; await renderDoor(gid); window.scrollTo(0, y); }
}
async function todoSetDone(id, done) {
  const gid = insp?.gateId || curDoor?.id; if (!gid) return;
  await todoChange(gid, (l) => l.map(t => t.id === id ? { ...t, done, doneAt: done ? new Date().toISOString() : null, doneDatum: done ? todayDE() : null, doneIn: done ? insp?.id || null : null } : t));
  buzz(15);
  const rr = async () => { if (insp) renderStepKeepScroll(); else { const y = scrollY; await renderDoor(gid); window.scrollTo(0, y); } };
  await rr();
  if (done) undoInline('Als erledigt markiert', async () => { await todoChange(gid, (l) => l.map(t => t.id === id ? { ...t, done: false, doneAt: null, doneDatum: null, doneIn: null } : t)); rr(); });
}
async function todoDel(id) {
  const gid = insp?.gateId || curDoor?.id; if (!gid) return;
  await todoChange(gid, (l) => l.filter(t => t.id !== id));
  if (insp) renderStepKeepScroll(); else { const y = scrollY; await renderDoor(gid); window.scrollTo(0, y); }
}
async function todoCounts() { const m = new Map(); for (const g of await db.all('gates')) { const n = (g.todos || []).filter(t => !t.done).length; if (n) m.set(g.id, n); } return m; }
const todoPill = (n) => n ? `<span class="pill todo-pill" title="${n} Punkte zu prüfen">📌 ${n}</span>` : '';


// ---------- Vorschläge aus früheren Einträgen ----------
// Felder mit wiederkehrenden Werten (Hersteller, Typ, Antrieb …): alle bisherigen Werte aller Türen als Liste,
// die beim Tippen enger wird. Nummern, Standort und Zahlenfelder bekommen keine Vorschläge.
const learnable = (g, f, t) => g.scope === 'gate' && f.type !== 'choice' && !f.perInspection && !f.inputmode
  && f.key !== t.unit.nr && f.key !== t.unit.standort && !/fabrNr|nr$/i.test(f.key);
let learnVals = new Map();
async function loadLearn() {
  const cnt = new Map();
  const add = (k, v, w) => { v = String(v ?? '').trim(); if (!v) return; const m = cnt.get(k) || new Map(); const key = v.toLowerCase(); const o = m.get(key) || { v, n: 0 }; o.n += w; m.set(key, o); cnt.set(k, m); };
  for (const t of Object.values(TEMPLATES)) for (const g of t.header) for (const f of g.fields) (f.suggest || []).forEach(v => add(`${t.kind}|${g.id}.${f.key}`, v, 0.5));
  for (const gate of await db.all('gates')) { const k = gateKind(gate); for (const [gid, grp] of Object.entries(gate.data || {})) for (const [key, v] of Object.entries(grp || {})) add(`${k}|${gid}.${key}`, v, 1); }
  learnVals = new Map([...cnt].map(([k, m]) => [k, [...m.values()].sort((a, b) => b.n - a.n || a.v.localeCompare(b.v, 'de')).map(o => o.v)]));
}
const learnKind = () => tpl?.kind || (curDoor && gateKind(curDoor)) || 'tuer';
let learnIdx = -1;
function learnShow(inp) {
  const q = normTxt(inp.value.trim());
  const all = learnVals.get(`${learnKind()}|${inp.dataset.learn}`) || [];
  const hits = all.filter(v => normTxt(v) !== q && (!q || normTxt(v).includes(q)))
    .sort((a, b) => (q ? normTxt(b).startsWith(q) - normTxt(a).startsWith(q) : 0)).slice(0, 8);
  let box = inp.parentElement.querySelector('.learn-sg');
  if (!hits.length) { box?.remove(); return; }
  if (!box) { box = document.createElement('div'); box.className = 'suggest learn-sg'; box.setAttribute('role', 'listbox'); inp.after(box); box.addEventListener('pointerdown', (e) => e.preventDefault()); }
  learnIdx = -1;
  box.innerHTML = hits.map((v, i) => `<button type="button" class="sg-item" role="option" data-act="learnPick" data-i="${i}" data-v="${esc(v)}">${esc(v)}</button>`).join('');
}
function learnPick(btn) {
  const inp = btn.closest('.inwrap, .fld')?.querySelector('input[data-learn]'); if (!inp) return;
  inp.value = btn.dataset.v;
  btn.closest('.learn-sg')?.remove();
  inp.dispatchEvent(new Event('input', { bubbles: true }));
  inp.dispatchEvent(new Event('change', { bubbles: true }));
  buzz();
}
document.addEventListener('focusin', (e) => { if (e.target.matches?.('input[data-learn]')) learnShow(e.target); });
document.addEventListener('focusout', (e) => { if (e.target.matches?.('input[data-learn]')) setTimeout(() => e.target.parentElement?.querySelector('.learn-sg')?.remove(), 150); });
document.addEventListener('input', (e) => { if (e.target.matches?.('input[data-learn]')) learnShow(e.target); });
document.addEventListener('keydown', (e) => {
  const inp = e.target; if (!inp.matches?.('input[data-learn]')) return;
  const box = inp.parentElement.querySelector('.learn-sg'); if (!box) return;
  const items = [...box.querySelectorAll('.sg-item')];
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); e.stopImmediatePropagation(); learnIdx = (learnIdx + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length; items.forEach((x, i) => x.classList.toggle('on', i === learnIdx)); }
  else if (e.key === 'Enter' && learnIdx >= 0) { e.preventDefault(); e.stopImmediatePropagation(); learnPick(items[learnIdx]); }
  else if (e.key === 'Escape') { e.stopImmediatePropagation(); box.remove(); }
}, true);


// ---------- Interne Notizen (nur für uns, kommen nie ins Protokoll) ----------
// Jede Tür, jeder Termin, Kunde, jedes Objekt und Protokoll hat ein Feld intNote.
let ctxNotes = {};
// Eine Notiz pro Ding, immer am Ende seiner eigenen Seite. Nur für uns, kommt nie ins Protokoll.
const INOTE_LBL = { inspections: 'diesem Protokoll', gates: 'dieser Tür', sites: 'diesem Objekt', customers: 'diesem Kunden', visits: 'diesem Termin' };
const openINotes = new Set();
function noteSection(store, id, val) {
  if (!id) return '';
  const key = `${store}:${id}`;
  if (!val && !openINotes.has(key)) return `<button type="button" class="inote-btn" data-act="inoteOpen" data-key="${key}">📝 ＋ Interne Notiz</button>`;
  return `<section class="${DESK ? 'dk-panel' : 'card'} inote-card"><button type="button" class="inote-x" data-act="inoteDel" data-key="${key}" aria-label="Notiz entfernen" title="Notiz entfernen">✕</button><label class="inote-l"><span class="lbl">📝 Interne Notiz <span class="muted small">nur für uns, nicht im Protokoll</span></span>
    <textarea class="field" rows="2" data-inote="${key}" placeholder="Notiz zu ${INOTE_LBL[store]}">${esc(val || '')}</textarea></label></section>`;
}
let inoteChain = Promise.resolve();
function saveINote(key, val) {
  const [store, id] = key.split(':');
  if (store === 'inspections' && insp?.id === id) { insp.intNote = val; return saveSoon(); }
  if (store === 'visits' && visit?.id === id && !insp) { visit.intNote = val; return saveVisitSoon(); }
  if (store === 'gates' && curDoor?.id === id) { curDoor.intNote = val; clearTimeout(doorTimer); doorTimer = setTimeout(() => { doorTimer = null; saveGate(curDoor); }, 400); return; }
  if (insp) ctxNotes[store] = val;
  inoteChain = inoteChain.then(async () => { const r = await db.get(store, id); if (r) { r.intNote = val; await db.put(store, r); } });
}
async function loadCtxNotes() {
  const [g, st, c] = await Promise.all([insp?.gateId && db.get('gates', insp.gateId), insp?.siteId && db.get('sites', insp.siteId), insp?.customerId && db.get('customers', insp.customerId)]);
  ctxSite = st || null; ctxEtage = g?.etageId || null;
  ctxNotes = { gates: g?.intNote || '', sites: st?.intNote || '', customers: c?.intNote || '', visits: insp?.visitId ? (await db.get('visits', insp.visitId))?.intNote || '' : '' };
}


// ---------- Etagen ----------
// Jedes Objekt hat eine geordnete Liste von Etagen: site.etagen = [{ id, name, order }].
// Eine Tür zeigt mit gate.etageId auf eine davon. Später kann jede Etage einen Plan bekommen (z. B. etage.map)
// und jede Tür ihre Lage darauf (z. B. gate.pos = { etageId, x, y }), ohne dass sich hier etwas ändert.
function floorRank(name) {
  const n = normTxt(name).replace(/[\s.]+/g, ''); let m;
  if ((m = n.match(/^(\d+)(ug|kg|untergeschoss|keller)/))) return -Number(m[1]);
  if (/^(ug|kg|keller|untergeschoss|souterrain)/.test(n)) return -1;
  if (/^(eg|erdgeschoss|hochparterre|hp|parterre)/.test(n)) return 0;
  if ((m = n.match(/^(\d+)(og|obergeschoss|etage|stock)/))) return Number(m[1]);
  if (/^(dg|dach)/.test(n)) return 90;
  return null;
}
const floorsOf = (site) => (site?.etagen || []).slice().sort((a, b) => a.order - b.order || a.name.localeCompare(b.name, 'de', { numeric: true }));
const floorName = (site, id) => floorsOf(site).find(f => f.id === id)?.name || '';
const FLOOR_QUICK = ['2. UG', 'UG', 'EG', '1. OG', '2. OG', '3. OG', '4. OG', 'DG'];
function addFloor(site, name) {
  name = name.trim(); if (!name) return null;
  const fl = floorsOf(site), same = fl.find(f => normTxt(f.name).replace(/[\s.]/g, '') === normTxt(name).replace(/[\s.]/g, ''));
  if (same) return same;
  // Nach Geschoss einsortieren (UG unter EG unter 1. OG …), unbekannte Namen ans Ende
  const r = floorRank(name), f = { id: uid(), name, order: 0 };
  const at = r == null ? -1 : fl.findIndex(x => (floorRank(x.name) ?? Infinity) > r);
  at < 0 ? fl.push(f) : fl.splice(at, 0, f);
  fl.forEach((x, k) => { x.order = k; });
  site.etagen = fl;
  return f;
}
function etageSelect(site, cur, gid) {
  return `<select class="field" data-etage="${gid}"><option value="">– keine Etage –</option>${floorsOf(site).reverse().map(f => `<option value="${f.id}" ${f.id === cur ? 'selected' : ''}>${esc(f.name)}</option>`).join('')}<option value="__new">＋ Neue Etage …</option></select>`;
}
async function setDoorEtage(gid, eid) {
  const g = await db.get('gates', gid); if (!g) return;
  const st = await db.get('sites', g.siteId);
  const from = floorName(st, g.etageId), to = floorName(st, eid);
  if ((g.etageId || '') === (eid || '')) return;
  if (from) logDoor(g, [{ field: 'Etage', from, to: to || '(keine)' }], insp ? `Prüfung vom ${insp.datum || todayDE()}` : 'von Hand geändert');
  g.etageId = eid || null;
  await saveGate(g);
  if (curDoor?.id === gid) Object.assign(curDoor, { etageId: g.etageId, log: g.log });
  if (insp?.gateId === gid) ctxEtage = g.etageId;
}
let ctxSite = null, ctxEtage = null;
function askNewEtage(siteId, gid) {
  const sheet = document.getElementById('sheet');
  sheet.innerHTML = `<div class="sheet-inner">
    <div class="sheet-grab"></div>
    <h2 class="sheet-h">Neue Etage</h2>
    <input class="field" id="etName" placeholder="z. B. 1. OG, Zwischengeschoss, Halle 2" autocomplete="off">
    <div class="chips">${FLOOR_QUICK.map(n => `<button class="chip" data-act="etQuick" data-v="${esc(n)}">${esc(n)}</button>`).join('')}</div>
    <button class="big-btn primary" data-act="etSave" data-site="${siteId}" data-gid="${gid || ''}">Anlegen</button>
    <button class="big-btn" data-act="etCancel">Abbrechen</button>
  </div>`;
  sheet.classList.add('show');
  setTimeout(() => document.getElementById('etName')?.focus(), 50);
}
async function etSave(siteId, gid, name) {
  const st = await db.get('sites', siteId); if (!st || !name.trim()) return;
  const f = addFloor(st, name); await db.put('sites', st);
  if (gid) await setDoorEtage(gid, f.id);
  closeJump();
  if (insp) { await loadCtxNotes(); renderStepKeepScroll(); } else route();
}
// Etagen eines Objekts verwalten (im Objekt-Fenster)
function floorsEditor(st) {
  // Angezeigt wie im Haus: oberste Etage oben. ↑ macht eine Etage höher, ↓ tiefer.
  const fl = floorsOf(st), top = fl.slice().reverse();
  return `<div class="fl-edit"><span class="lbl">Etagen <span class="muted small">(oben die oberste)</span></span>
    ${top.map((f, i) => `<div class="fl-row"><input class="field sm" data-flname="${st.id}:${f.id}" value="${esc(f.name)}" autocomplete="off">
      <button class="mini-x" data-act="flMove" data-site="${st.id}" data-id="${f.id}" data-d="1" ${i === 0 ? 'disabled' : ''} aria-label="Nach oben" title="Eine Etage höher">↑</button>
      <button class="mini-x" data-act="flMove" data-site="${st.id}" data-id="${f.id}" data-d="-1" ${i === top.length - 1 ? 'disabled' : ''} aria-label="Nach unten" title="Eine Etage tiefer">↓</button>
      ${f.map ? `<button class="mini-x plan-b on" data-act="planGo" data-site="${st.id}" data-id="${f.id}" title="Plan öffnen" aria-label="Plan öffnen">🗺</button>` : planPickBtn(st.id, f.id, '＋ Plan', 'mini-x plan-b')}
      <button class="mini-x" data-act="flDel" data-site="${st.id}" data-id="${f.id}" aria-label="Löschen">×</button></div>`).join('') || '<p class="muted small">Noch keine Etagen.</p>'}
    <div class="chips">${FLOOR_QUICK.filter(n => !fl.some(f => normTxt(f.name).replace(/[\s.]/g, '') === normTxt(n).replace(/[\s.]/g, ''))).map(n => `<button class="chip" data-act="flAdd" data-site="${st.id}" data-v="${esc(n)}">＋ ${esc(n)}</button>`).join('')}
      <button class="chip" data-act="flAddAsk" data-site="${st.id}">＋ andere …</button></div></div>`;
}
let flChain = Promise.resolve();
async function flUpdate(siteId, fn) {
  await flChain; await ckChain;
  const st = await db.get('sites', siteId); if (!st) return;
  fn(st); await db.put('sites', st);
  if (doorScope === siteId && !document.getElementById('sheet').classList.contains('show')) { const y = scrollY; await renderObjekt(siteId); return window.scrollTo(0, y); }
  const box = document.querySelector('.fl-edit'); if (box) box.outerHTML = floorsEditor(st);
}


// ---------- Etagenplan ansehen ----------
// Bild liegt im Speicher "photos" ({ planSite, planEtage }), die Etage zeigt mit etage.map = { photoId, w, h } darauf.
let planCtl = null, planUrl = null, planCur = null;
const FINE = matchMedia('(hover: hover) and (pointer: fine)');
function planClose() { planCtl?.destroy(); planCtl = null; planCur = null; if (planUrl) { URL.revokeObjectURL(planUrl); planUrl = null; } document.documentElement.classList.remove('pv-open'); }
// cam: direkt die Kamera öffnen (Handy / Tablet)
const planUpBtn = (sid, fid, label, cls = 'chip', cam = false) => `<label class="${cls} plan-up">${label}<input type="file" accept="image/*" ${cam ? 'capture="environment"' : ''} data-planup="${sid}:${fid}" hidden></label>`;
// Auf Touch-Geräten: Foto aufnehmen oder Bild wählen; am PC direkt die Dateiauswahl
const planPickBtn = (sid, fid, label, cls) => FINE.matches ? planUpBtn(sid, fid, label, cls) : `<button class="${cls}" data-act="planAdd" data-site="${sid}" data-id="${fid}">${label}</button>`;
const planSources = (sid, fid, cls = 'big-btn') => FINE.matches ? planUpBtn(sid, fid, '🖼 Bild wählen', cls)
  : `${planUpBtn(sid, fid, '📷 Foto aufnehmen', cls + ' primary', true)}${planUpBtn(sid, fid, '🖼 Bild aus Galerie oder Dateien', cls)}`;
function planAdd(sid, fid) {
  const sheet = document.getElementById('sheet');
  sheet.innerHTML = `<div class="sheet-inner"><div class="sheet-grab"></div><h2 class="sheet-h">Plan für diese Etage</h2>
    <p class="muted small">Den Grundriss möglichst gerade von oben fotografieren, z. B. den Fluchtplan an der Wand.</p>
    ${planSources(sid, fid)}<button class="big-btn" data-act="cancelDel">Abbrechen</button></div>`;
  sheet.classList.add('show');
}
async function renderPlan(sid, fid) {
  planClose();
  const st = await db.get('sites', sid); if (!st) { location.hash = '#/o'; return; }
  const fl = floorsOf(st), f = fl.find(x => x.id === fid) || fl.find(x => x.map) || fl[0];
  if (!f) { location.hash = `#/o/${sid}`; return; }
  if (f.id !== fid) { history.replaceState(null, '', `#/plan/${sid}/${f.id}`); lastHash = location.hash; }
  const ph = f.map?.photoId && await db.get('photos', f.map.photoId);
  if (ph?.blob) planUrl = URL.createObjectURL(ph.blob);
  planCur = { sid, fid: f.id };
  const fine = FINE.matches;
  const tabs = fl.slice().reverse().map(x => `<button class="pv-tab ${x.id === f.id ? 'on' : ''} ${x.map ? '' : 'nomap'}" data-act="planGo" data-site="${sid}" data-id="${x.id}">${esc(x.name)}</button>`).join('');
  const ctrls = fine ? `<div class="pv-ui pv-tools">
      <button class="pv-b" data-act="pvZoom" data-d="-1" title="Verkleinern ( − )">−</button><span class="pv-val" id="pvZ">100 %</span><button class="pv-b" data-act="pvZoom" data-d="1" title="Vergrößern ( + )">＋</button>
      <span class="pv-sep"></span>
      <button class="pv-b" data-act="pvRot" data-d="-15" title="Nach links drehen ( Q )">⟲</button><span class="pv-val" id="pvR">0°</span><button class="pv-b" data-act="pvRot" data-d="15" title="Nach rechts drehen ( E )">⟳</button>
      <span class="pv-sep"></span>
      <button class="pv-b wide" data-act="pvNorth" title="Drehung auf 0° ( R )">⬆ Gerade</button><button class="pv-b wide" data-act="pvFit" title="Ganzen Plan zeigen ( 0 )">⤢ Ganz</button><button class="pv-b" data-act="pvKeys" title="Tastenkürzel ( ? )">?</button></div>`
    : `<div class="pv-ui pv-fab"><button class="pv-round" data-act="pvNorth" aria-label="Drehung auf 0°"><span class="pv-compass" id="pvC">⬆</span></button><button class="pv-round" data-act="pvFit" aria-label="Ganzen Plan zeigen">⤢</button></div>`;
  $app.innerHTML = `<div class="pv ${fine ? 'fine' : 'touch'}">
    <header class="pv-ui pv-top">
      <button class="pv-b" data-act="menuGo" data-href="#/o/${sid}" aria-label="Zurück" title="Zurück ( Esc )">‹</button>
      <div class="pv-title"><b>${esc(f.name)}</b><span>${esc(sname(st))}</span></div>
      ${ph ? `<button class="pv-b" data-act="planMenu" data-site="${sid}" data-id="${f.id}" aria-label="Plan ändern" title="Plan ersetzen oder entfernen">⋯</button>` : ''}
    </header>
    <nav class="pv-ui pv-tabs">${tabs}</nav>
    ${ph ? `<div class="pv-stage" id="pvStage"><div class="pv-world"><img id="pvImg" src="${planUrl}" width="${f.map.w}" height="${f.map.h}" alt="Plan ${esc(f.name)}" draggable="false"></div></div>
      ${ctrls}
      <p class="pv-ui pv-hint" id="pvHint">${fine ? 'Ziehen: verschieben · Mausrad: zoomen · Umschalt + Rad oder rechte Maustaste ziehen: drehen' : 'Ein Finger: verschieben<br>Zwei Finger: zoomen und drehen<br>Doppeltippen: näher'}</p>`
    : `<div class="pv-empty"><p>Für <b>${esc(f.name)}</b> gibt es noch keinen Plan.</p><p class="muted small">Ein Foto oder Bild des Grundrisses wählen. Es bleibt nur auf diesem Gerät gespeichert und wird mit Terminen mitgeschickt.</p>
      <div class="pv-src">${FINE.matches ? planUpBtn(sid, f.id, '🖼 Bild für den Plan wählen', 'big-btn primary') : planSources(sid, f.id)}</div></div>`}
  </div>`;
  document.documentElement.classList.add('pv-open');
  if (!ph) return;
  const stage = document.getElementById('pvStage'), zEl = document.getElementById('pvZ'), rEl = document.getElementById('pvR'), cEl = document.getElementById('pvC');
  planCtl = mountPlan(stage, document.getElementById('pvImg'), {
    w: f.map.w, h: f.map.h, rot: +settings.get('planRot:' + f.id, 0) || 0,
    onRot: (r) => settings.set('planRot:' + f.id, Math.round(r * 10) / 10),
    onChange: (v, fitS) => {
      if (zEl) zEl.textContent = `${Math.round(v.s / fitS * 100)} %`;
      if (rEl) rEl.textContent = `${Math.round(v.r)}°`;
      if (cEl) { cEl.style.transform = `rotate(${v.r}deg)`; cEl.parentElement.classList.toggle('off', Math.abs(v.r) < 0.5); }
    },
  });
  setTimeout(() => document.getElementById('pvHint')?.classList.add('gone'), 4000);
}
async function planUpload(input) {
  const [sid, fid] = input.dataset.planup.split(':'), file = input.files?.[0];
  input.value = '';
  if (!file) return;
  closeJump();
  snack('Plan wird gespeichert …');
  let img;
  try { img = await preparePlanImage(file); } catch { return snack('Dieses Bild lässt sich nicht öffnen. Bitte ein JPG oder PNG wählen.'); }
  const ph = { id: uid(), blob: img.blob, planSite: sid, planEtage: fid };
  await db.put('photos', ph);
  await flChain; await ckChain;
  const st = await db.get('sites', sid), f = st?.etagen?.find(x => x.id === fid); if (!f) return;
  const old = f.map?.photoId;
  f.map = { photoId: ph.id, w: img.w, h: img.h, name: file.name || '' };
  await db.put('sites', st);
  if (old) await db.del('photos', old);
  settings.set('planRot:' + fid, 0);
  document.getElementById('snack').classList.remove('show');
  const h = `#/plan/${sid}/${fid}`;
  if (location.hash === h) return route();
  location.hash = h;
}
async function planRemove(sid, fid) {
  const st = await db.get('sites', sid), f = st?.etagen?.find(x => x.id === fid); if (!f?.map) return;
  const old = f.map.photoId; delete f.map; await db.put('sites', st);
  if (old) await db.del('photos', old);
  closeJump(); route();
}
function planMenu(sid, fid, confirm = false) {
  const sheet = document.getElementById('sheet');
  sheet.innerHTML = `<div class="sheet-inner">
    <div class="sheet-grab"></div>
    <h2 class="sheet-h">Plan dieser Etage</h2>
    ${FINE.matches ? planUpBtn(sid, fid, '🖼 Anderes Bild wählen', 'big-btn') : `${planUpBtn(sid, fid, '📷 Neues Foto aufnehmen', 'big-btn', true)}${planUpBtn(sid, fid, '🖼 Anderes Bild wählen', 'big-btn')}`}
    ${confirm ? `<p class="muted">Der Plan wird von diesem Gerät gelöscht. Die Etage und ihre Türen bleiben.</p><button class="big-btn danger solid" data-act="planDel" data-site="${sid}" data-id="${fid}">🗑 Plan endgültig entfernen</button>`
      : `<button class="big-btn danger-row" data-act="planDelAsk" data-site="${sid}" data-id="${fid}">🗑 Plan entfernen</button>`}
    <button class="big-btn" data-act="cancelDel">Abbrechen</button>
  </div>`;
  sheet.classList.add('show');
}
function planKeys() {
  const K = [['Ziehen', 'Plan verschieben'], ['Mausrad', 'zoomen (an der Mausposition)'], ['Umschalt + Rad', 'drehen'], ['Rechte Maustaste ziehen', 'drehen'], ['Doppelklick', 'näher (mit Umschalt: weiter weg)'],
    ['+ / −', 'zoomen'], ['Q / E', 'um 15° drehen (mit Umschalt: 1°)'], ['R', 'gerade (0°)'], ['0 / F', 'ganzen Plan zeigen'], ['← ↑ → ↓', 'verschieben'], ['Bild ↑ / Bild ↓', 'Etage höher / tiefer'], ['Esc', 'zurück zum Objekt']];
  const sheet = document.getElementById('sheet');
  sheet.innerHTML = `<div class="sheet-inner keys"><div class="sheet-grab"></div><h2 class="sheet-h">Plan: Maus und Tasten</h2>
    <table class="keys-t">${K.map(([k, d]) => `<tr><td>${esc(k)}</td><td>${esc(d)}</td></tr>`).join('')}</table>
    <button class="big-btn" data-act="cancelDel">Schließen</button></div>`;
  sheet.classList.add('show');
}
window.addEventListener('keydown', (e) => {
  if (!planCur || e.ctrlKey || e.metaKey || e.altKey) return;
  const t = e.target; if (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA') return;
  if (document.getElementById('sheet').classList.contains('show')) return;
  const k = e.key, c = planCtl, step = e.shiftKey ? 1 : 15;
  const floor = async (d) => { const st = await db.get('sites', planCur.sid), fl = floorsOf(st), i = fl.findIndex(f => f.id === planCur.fid), n = fl[i + d]; if (n) location.replace(`#/plan/${planCur.sid}/${n.id}`); };
  const act = {
    Escape: () => (location.hash = `#/o/${planCur.sid}`), PageUp: () => floor(1), PageDown: () => floor(-1), '?': planKeys,
    ...(c ? { '+': c.zoomIn, '=': c.zoomIn, '-': c.zoomOut, '_': c.zoomOut, q: () => c.rotate(-step), Q: () => c.rotate(-step), e: () => c.rotate(step), E: () => c.rotate(step),
      r: () => c.setRot(0), R: () => c.setRot(0), 0: c.fit, f: c.fit, F: c.fit,
      ArrowLeft: () => c.pan(80, 0), ArrowRight: () => c.pan(-80, 0), ArrowUp: () => c.pan(0, 80), ArrowDown: () => c.pan(0, -80) } : {}),
  }[k];
  if (!act) return;
  e.preventDefault(); e.stopImmediatePropagation(); act();
}, true);

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
  const labels = { done: '✓', defect: '✗', open: '', off: '–' };
  sheet.innerHTML = `<div class="sheet-inner">
    <div class="sheet-grab"></div>
    ${Array.from({ length: stepCount() }, (_, i) => {
      const s = stepStatus(i);
      let count = '';
      if (i > 0 && i < stepCount() - 1) {
        const items = tpl.sections[i - 1].items;
        count = stepOff(i) ? 'aus' : `${items.filter(it => insp.answers[it.id]?.s).length}/${items.length}`;
      }
      return `<button class="list-row ${i === step ? 'cur' : ''} ${s === 'off' ? 'off' : ''}" data-act="goto" data-step="${i}">
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
  const gp = e.target.closest('[data-gpop]');
  if (gp) { e.preventDefault(); return openGuidePop(gp.dataset.gpop); }
  if (e.target.closest('.gpop-more')) closeJump();
  const zimg = e.target.closest('.gdoc img[data-zoom]');
  if (zimg) return openZoom(zimg);
  if (e.target.closest('.col-rs')) return; // Ziehgriff am Spaltenrand sortiert nicht
  if (e.target.closest('.sel-in, .sel-cb, td.cb')) { if (e.target.matches('td.cb, .sel-cb')) { const i = e.target.querySelector('input'); if (i) { i.checked = !i.checked; i.dispatchEvent(new Event('input', { bubbles: true })); } } return; }
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
    case 'home': await saveNow(); return (location.hash = insp?.paper ? (insp.returnTo || `#/d/${insp.gateId}`) : insp?.visitId ? `#/t/${insp.visitId}` : '#/');
    case 'jump': return openJump();
    case 'goto': closeJump(); return go(+b.dataset.step);
    case 'prev': return go(stepBy(-1));
    case 'next': window.scrollTo(0, 0); return go(stepBy(1));
    case 'checkNext': if (!autoDone(step)) setMarked(step, true); saveNow(); window.scrollTo(0, 0); return go(stepBy(1));
    case 'inoteOpen': { openINotes.add(b.dataset.key); const [st, id] = b.dataset.key.split(':'); const d = document.createElement('div'); d.innerHTML = noteSection(st, id, ''); b.replaceWith(d.firstElementChild); return document.querySelector(`textarea[data-inote="${b.dataset.key}"]`)?.focus(); }
    case 'kundeDone': await inoteChain; await ckChain; await flChain; closeJump(); if (insp) { await loadCtxNotes(); return renderStepKeepScroll(); } return route();
    case 'etQuick': { const i = document.getElementById('etName'); if (i) i.value = b.dataset.v; return; }
    case 'etSave': return etSave(b.dataset.site, b.dataset.gid, document.getElementById('etName')?.value || '');
    case 'etCancel': closeJump(); return;
    case 'flAdd': return flUpdate(b.dataset.site, (st) => addFloor(st, b.dataset.v));
    case 'flAddAsk': { const name = (document.querySelector('.fl-new')?.value) || ''; if (name) return flUpdate(b.dataset.site, (st) => addFloor(st, name));
      const box = b.closest('.chips'); box.insertAdjacentHTML('afterend', `<div class="fl-row"><input class="field sm fl-new" placeholder="Name der Etage" autocomplete="off"><button class="mini-x" data-act="flAddAsk" data-site="${b.dataset.site}">＋</button></div>`); box.nextElementSibling.querySelector('input').focus(); return; }
    case 'flMove': return flUpdate(b.dataset.site, (st) => { const fl = floorsOf(st); const i = fl.findIndex(f => f.id === b.dataset.id), j = i + (+b.dataset.d); if (j < 0 || j >= fl.length) return; [fl[i], fl[j]] = [fl[j], fl[i]]; fl.forEach((f, k) => { f.order = k; }); st.etagen = fl; });
    case 'flDel': return flUpdate(b.dataset.site, (st) => { const f = floorsOf(st).find(x => x.id === b.dataset.id); if (f?.map?.photoId) db.del('photos', f.map.photoId); st.etagen = floorsOf(st).filter(x => x.id !== b.dataset.id); });
    case 'planGo': closeJump(); return location.hash.startsWith('#/plan/') ? location.replace(`#/plan/${b.dataset.site}/${b.dataset.id}`) : (location.hash = `#/plan/${b.dataset.site}/${b.dataset.id}`);
    case 'planMenu': return planMenu(b.dataset.site, b.dataset.id);
    case 'planAdd': return planAdd(b.dataset.site, b.dataset.id);
    case 'planDelAsk': return planMenu(b.dataset.site, b.dataset.id, true);
    case 'planDel': return planRemove(b.dataset.site, b.dataset.id);
    case 'pvZoom': return +b.dataset.d > 0 ? planCtl?.zoomIn() : planCtl?.zoomOut();
    case 'pvRot': return planCtl?.rotate(+b.dataset.d);
    case 'pvNorth': return planCtl?.setRot(0);
    case 'pvFit': return planCtl?.fit();
    case 'pvKeys': return planKeys();
    case 'learnPick': return learnPick(b);
    case 'todoAdd': return todoAddSheet(b.dataset.ref, b.dataset.label, b.dataset.gid || null);
    case 'todoSave': return todoSave(b);
    case 'todoDone': return todoSetDone(b.dataset.id, true);
    case 'todoUndone': return todoSetDone(b.dataset.id, false);
    case 'todoDel': return todoDel(b.dataset.id);
    case 'secToggle': return secToggle(+b.dataset.step);
    case 'secCheck': { const i = +b.dataset.step; setMarked(i, !isMarked(i)); buzz(15); saveNow(); return refreshChrome(); }
    case 'set': return setAnswer(b.dataset.id, b.dataset.v);
    case 'linkGate': return linkGate(b.dataset.id);
    case 'toDupWarn': { const w = document.getElementById('dupWarn'); window.scrollTo({ top: w.getBoundingClientRect().top + scrollY - 70, behavior: 'smooth' }); return; }
    case 'clearSearch': { const f = b.dataset.for; if (f === 'homeSearch') { homeQuery = ''; await renderHome(); } else if (f === 'regSearch') { regQuery = ''; await rerenderDL(); } else if (f === 'kSearch') { kQuery = ''; await renderKunden(); } else if (f === 'oSearch') { oQuery = ''; await renderObjekte(); } else { visitQuery = ''; await renderVisit(); } return document.getElementById(b.dataset.for)?.focus(); }
    case 'sortBy': return setSort(b.dataset.k);
    case 'sortDir': { const s = getSort(); settings.set('visitSort', { k: s.k, d: -s.d }); return renderVisit(); }
    case 'clearSec': if (b.dataset.step) step = +b.dataset.step; return clearSection(step);
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
    case 'defectOpen': case 'defectClose': {
      const id = b.dataset.id;
      if (b.dataset.act === 'defectOpen') openDefects.add(id); else openDefects.delete(id);
      rerenderRow(id);
      if (b.dataset.act === 'defectOpen') document.querySelector(`textarea[data-note="${id}"]`)?.focus();
      return;
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
    case 'addRemark': insp.remarks = (insp.remarks?.trimEnd() ? insp.remarks.trimEnd() + '\n' : '') + b.dataset.v; saveNow(); return renderFinish();
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
    case 'guidePop': return openGuidePop(b.dataset.href);
    case 'inoteDel': {
      const key = b.dataset.key; saveINote(key, ''); openINotes.delete(key);
      const [st, id] = key.split(':'); const d = document.createElement('div'); d.innerHTML = noteSection(st, id, '');
      return b.closest('.inote-card').replaceWith(d.firstElementChild);
    }
    case 'lang': { const y = scrollY; if (insp) await saveNow(); setLang(LANG === 'en' ? 'de' : 'en'); await route(); return window.scrollTo(0, y); }
    case 'menuGo': { closeJump(); return (location.hash = b.dataset.href); }
    case 'askDel': {
      if (b.dataset.quick) { const p = await deletePlan('inspection', b.dataset.id); await runDelete(p); return rerenderAfterDelete(p); }
      return askDelete(b.dataset.kind, b.dataset.id);
    }
    case 'confirmDel': { closeJump(); const p = pendingDelete; pendingDelete = null; await runDelete(p); buzz([20, 40, 20]); await rerenderAfterDelete(p); return setTimeout(() => snack('Gelöscht.'), 250); }
    case 'cancelDel': pendingDelete = null; return closeJump();
    case 'pickSite': return pickSite(b.dataset.id);
    case 'pickCustomer': return pickCustomer(b.dataset.id);
    case 'addKnownGate': {
      await saveVisit();
      const g = await db.get('gates', b.dataset.id); if (!g) return;
      let p = editPair(visit);
      // Tür eines anderen Kunden an diesem Objekt: in das passende Paar, sonst ein neues Paar anlegen
      if (g.customerId && g.customerId !== p.customerId) {
        p = visit.pairs.find(x => x.siteId === g.siteId && x.customerId === g.customerId);
        if (!p) {
          const c = await db.get('customers', g.customerId) || {}, st = await db.get('sites', g.siteId) || {};
          p = { id: uid(), customerId: g.customerId, siteId: g.siteId, kunde: strip(c), objekt: strip(st) };
          visit.pairs.push(p); await saveVisit();
          setTimeout(() => snack(`Neues Paar im Termin: ${pairLabel(p)}`), 200);
        }
      }
      await addGateToVisit(g.id, undefined, p); buzz(); return renderVisitEdit();
    }
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
      const P = editPair(visit);
      for (const g of (await db.all('gates')).filter(g => g.siteId === P.siteId && (!g.customerId || g.customerId === P.customerId) && !items.some(i => i.gateId === g.id)).sort(byNr)) await addGateToVisit(g.id);
      buzz(); return renderVisitEdit();
    }
    case 'addNewGate': {
      ensurePairs(visit); await saveVisit();
      const p = pairForNew(visit, /\/edit$/.test(location.hash));
      if (!p) return askPairFor(b.dataset.kind || 'tor');
      const r = await addGateToVisit(null, b.dataset.kind || 'tor', p); return (location.hash = `#/p/${r.id}/0`);
    }
    case 'openSite': closeJump(); return (location.hash = `#/o/${b.dataset.id}`);
    case 'kundeDoors': settings.set('doorFilter', { ...DF0, kunde: b.dataset.id, group: 'objekt' }); return (location.hash = '#/tueren');
    case 'newKunde': { const c = { id: uid(), name: '' }; await db.put('customers', c); return (location.hash = `#/k/${c.id}`); }
    case 'newSiteFor': { const st = { id: uid(), customerId: b.dataset.id || null, ...(b.dataset.id ? { kundenIds: [b.dataset.id] } : {}) }; await db.put('sites', st); return (location.hash = `#/o/${st.id}`); }
    case 'siteKundeAdd': await ckChain; curSite = await db.get('sites', b.dataset.id); return openKundePicker('site');
    case 'siteKundeDel': {
      await ckChain; const st = await db.get('sites', doorScope); if (!st) return;
      st.kundenIds = (st.kundenIds || []).filter(k => k !== b.dataset.id);
      if (st.customerId === b.dataset.id) st.customerId = st.kundenIds[0] || null;
      await db.put('sites', st); return renderObjekt(st.id);
    }
    case 'openDoor': closeJump(); return (location.hash = `#/d/${b.dataset.id}`);
    case 'newDoorAsk': return newDoorAsk(b.dataset.kind);
    case 'newDoorGo': return newDoorGo(b.dataset.kind);
    case 'editSite': return editSite(b.dataset.id);
    case 'fltReset': setDF({ ...DF0, group: getDF().group }); selDoors = new Set(); return rerenderDL();
    case 'paperNew': await flushReg(); return newPaperProto(b.dataset.id, location.hash);
    case 'paperFor': if (visit && !insp) await saveVisit(); if (insp) await saveNow(); return paperForItem(b.dataset.id);
    case 'moveDoorsAsk': await flushReg(); return openKundePicker('doors', b.dataset.id ? [b.dataset.id] : [...selDoors]);
    case 'selClear': selDoors = new Set(); document.querySelectorAll('input[data-sel]').forEach(x => { x.checked = false; }); return updSelBar();
    case 'kpPick': return kpApply(b.dataset.id);
    case 'kpNew': { const name = document.getElementById('kpSearch')?.value.trim(); if (!name) return; const c = { id: uid(), name }; await db.put('customers', c); return kpApply(c.id); }
    case 'editKunde': return editKunde(b.dataset.id);
    case 'gdchoice': {
      const [g, k] = b.dataset.h.split('.'), grp = (curDoor.data ||= {})[g] ||= {};
      grp[k] = grp[k] === b.dataset.v ? '' : b.dataset.v;
      buzz(); await logDoorEdit(b.dataset.h); const y = scrollY; await renderDoor(curDoor.id); return window.scrollTo(0, y);
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
  if (t.id === 'homeSearch') { homeQuery = t.value; return rerenderKeepFocus(t.id, renderHome); }
  if (t.id === 'visitSearch') { visitQuery = t.value; return rerenderKeepFocus(t.id, renderVisit); }
  if (t.id === 'regSearch') { regQuery = t.value; return rerenderKeepFocus(t.id, rerenderDL); }
  if (t.id === 'kSearch') { kQuery = t.value; return rerenderKeepFocus(t.id, renderKunden); }
  if (t.id === 'oSearch') { oQuery = t.value; return rerenderKeepFocus(t.id, renderObjekte); }
  if (t.id === 'kpSearch') return drawKp(t.value);
  if (t.dataset.inote) return saveINote(t.dataset.inote, t.value);
  if (t.dataset.flname) { const [sid, fid] = t.dataset.flname.split(':'), val = t.value; flChain = flChain.then(async () => { const st = await db.get('sites', sid); const f = st?.etagen?.find(x => x.id === fid); if (f && val.trim()) { f.name = val.trim(); await db.put('sites', st); } }); return; }
  if (t.dataset.sel) { t.checked ? selDoors.add(t.dataset.sel) : selDoors.delete(t.dataset.sel); return updSelBar(); }
  if ((t.dataset.os === 'name' || t.dataset.os === 'strasse' || t.dataset.ck === 'name') && document.getElementById('scrT')) { const f = t.closest('.grid'); const v = t.dataset.ck ? t.value : (f.querySelector('[data-os="name"]')?.value || f.querySelector('[data-os="strasse"]')?.value); document.getElementById('scrT').textContent = v || (t.dataset.ck ? 'Neuer Kunde' : 'Neues Objekt'); }
  if (t.dataset.os) { const id = t.dataset.sid, k = t.dataset.os, val = t.value; ckChain = ckChain.then(async () => { const x = await db.get('sites', id); if (x) { x[k] = val; await db.put('sites', x); } }); return; }
  if (t.id === 'ndSite') document.getElementById('ndSiteNew').classList.toggle('hidden', !!t.value);
  if (t.id === 'ndKunde') document.getElementById('ndKundeNew').classList.toggle('hidden', !!t.value);
  if (t.dataset.gd && curDoor) { const [g, k] = t.dataset.gd.split('.'); ((curDoor.data ||= {})[g] ||= {})[k] = t.value; clearTimeout(doorTimer); doorTimer = setTimeout(() => { doorTimer = null; saveGate(curDoor); }, 400); return; }
  if (t.dataset.ck) { const id = t.dataset.cid, k = t.dataset.ck, val = t.value; ckChain = ckChain.then(async () => { const c = await db.get('customers', id); if (c) { c[k] = val; await db.put('customers', c); } }); return; }
  if (!insp && visit && t.dataset.vh) { const [g, k] = t.dataset.vh.split('.'); const P = editPair(ensurePairs(visit)); (P[g] ||= {})[k] = t.value; refreshPairChip(); return saveVisitSoon(); }
  if (!insp && visit && t.dataset.vf) { visit[t.dataset.vf] = t.value; return saveVisitSoon(); }
  if (!insp) return;
  if (t.dataset.h) {
    const [g, k] = t.dataset.h.split('.'); (insp.header[g] ||= {})[k] = t.value;
    if (g === tpl.unit.group && k === tpl.unit.nr) { clearTimeout(dupTimer); dupTimer = setTimeout(checkDupes, 350); }
    updChgNote(g, k);
    { // Titel oben (und am PC links) mitführen, die Seite wird nicht neu aufgebaut
      const u = unitOf(insp), bt = document.querySelector('.bar .bar-title .t-main'), nt = document.querySelector('.dn-title .dn-h');
      if (bt) bt.innerHTML = unitHead(u);
      if (nt) nt.innerHTML = unitHead(u);
    }
    return saveSoon();
  }
  if (t.dataset.note) { (insp.answers[t.dataset.note] ||= {}).note = t.value; return saveSoon(); }
  if (t.dataset.x) { (insp.answers[t.dataset.x] ||= {}).x = t.value; return saveSoon(); }
  if (t.dataset.f) { insp[t.dataset.f] = t.type === 'checkbox' ? t.checked : t.value; return saveSoon(); }
  if (t.dataset.sigName) { insp.sig[t.dataset.sigName].name = t.value; return saveSoon(); }
  if ('sigAbsent' in t.dataset) { insp.sig.ag.absent = t.checked; document.getElementById('agBox').classList.toggle('hidden', t.checked); return saveSoon(); }
});
let ckChain = Promise.resolve();
document.addEventListener('change', (e) => {
  if (e.target.dataset?.gd) logDoorEdit(e.target.dataset.gd);
  if (e.target.dataset?.etage) {
    const gid = e.target.dataset.etage, v = e.target.value;
    if (v === '__new') { e.target.value = (insp ? ctxEtage : curDoor?.etageId) || ''; const sid = insp ? insp.siteId : curDoor?.siteId; return askNewEtage(sid, gid); }
    return setDoorEtage(gid, v).then(() => { buzz(); if (!insp) { const y = scrollY; renderDoor(gid).then(() => window.scrollTo(0, y)); } });
  }
  if (e.target.dataset?.flt !== undefined) { const F = getDF(); F[e.target.dataset.flt] = e.target.value; if (e.target.dataset.flt === 'site') { F.kunde = ''; F.etage = ''; } setDF(F); selDoors = new Set(); return rerenderDL(); }
  if (e.target.id === 'ndSite' || e.target.id === 'ndKunde') e.target.dispatchEvent(new Event('input', { bubbles: true }));
  if (e.target.dataset?.sortSel !== undefined) { settings.set('visitSort', { k: e.target.value, d: 1 }); return renderVisit(); }
  if (e.target.dataset?.planup) return planUpload(e.target);
  const f = e.target.dataset?.photoFor;
  if (f && e.target.files?.[0]) { addPhoto(f, e.target.files[0]); e.target.value = ''; return; }
  if (e.target.type === 'checkbox') e.target.dispatchEvent(new Event('input', { bubbles: true })); });

// ---------- Tastenkürzel (für Tastatur am Rechner) ----------
const KEYS = [
  ['1 / O', 'o.B.'], ['2 / B', 'B. (Befund), danach direkt Notiz tippen'], ['3 / V', 'n.v. (Türen)'],
  ['↓ / J', 'nächste Zeile'], ['↑ / K', 'vorige Zeile'], ['N', 'Notiz zur Zeile'],
  ['→', 'nächster Abschnitt'], ['←', 'voriger Abschnitt'],
  ['A', 'Rest o.B.'], ['G', 'Abschnitt als geprüft markieren'], ['L', 'Wie letztes Mal'], ['P', 'Drucken / PDF'],
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
  if (k === '/') { const sb = document.getElementById('visitSearch') || document.getElementById('homeSearch') || document.getElementById('regSearch') || document.getElementById('kSearch') || document.getElementById('oSearch'); if (sb) { e.preventDefault(); sb.focus(); sb.select(); return; } }
  if (k === 'h' && !isGuide(location.hash)) {
    e.preventDefault();
    const gl = insp && (document.getElementById('r-' + kbCurId())?.querySelector('[data-act=guidePop]') || document.querySelector('.row.kb-cur [data-act=guidePop]'));
    return gl ? openGuidePop(gl.dataset.href) : (location.hash = '#/handbuch');
  }
  if (!insp || !tpl) return;
  const all = DESK && document.querySelector('main.dk-all');
  const inSection = all || (step > 0 && step < stepCount() - 1);
  const click = (sel) => { const el = document.querySelector(sel); if (el && !el.disabled) { el.click(); return true; } return false; };
  if (all) {
    if (k === 'ArrowRight') { e.preventDefault(); return go(stepBy(1)); }
    if (k === 'ArrowLeft') { e.preventDefault(); return go(stepBy(-1)); }
    const sec = kbRows()[kbIdx]?.closest('.dk-sec') || document.getElementById(`sec-${step}`);
    if (k === 'a' || k === 'l') { e.preventDefault(); const b = sec?.querySelector(`[data-act=${k === 'a' ? 'allOk' : 'asLast'}]`); if (b && !b.disabled) b.click(); return; }
  }
  if (k === 'ArrowRight') { e.preventDefault(); return click('.bottom [data-act=next], .bottom [data-act=finish], .bottom [data-act=nextInVisit], .bottom [data-act=nextGate]'); }
  if (k === 'ArrowLeft') { e.preventDefault(); return click('.bottom [data-act=prev]'); }
  if (k === 'p') { e.preventDefault(); saveNow(); return (location.hash = `#/druck/${insp.id}`); }
  if (k === 'g') { // Abschnitt als geprüft markieren / zurücknehmen
    const root = all ? (kbRows()[kbIdx]?.closest('.dk-sec') || document.getElementById(`sec-${step}`)) : document;
    const b = root?.querySelector('[data-act=secCheck]'); if (b && !b.disabled) { e.preventDefault(); b.click(); }
    return;
  }
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

// ---------- Sprache von überall umschalten ----------
// Jede Kopfzeile bekommt den DE/EN-Knopf (am PC hat die linke Leiste ihn schon, außer beim Plan im Vollbild).
function addLangBtns() {
  const sel = DESK ? 'header.pv-top' : 'header.bar, header.pv-top';
  document.querySelectorAll(sel).forEach(h => {
    if (h.querySelector('[data-act=lang]')) return;
    const b = document.createElement('button');
    b.className = h.matches('.pv-top') ? 'pv-b lang-btn' : 'icon-btn lang-btn';
    b.dataset.act = 'lang'; b.setAttribute('aria-label', 'Sprache'); b.title = 'Sprache / Language';
    b.textContent = LANG === 'en' ? 'DE' : 'EN';
    const more = [...h.children].reverse().find(x => /⋯/.test(x.textContent || ''));
    more ? h.insertBefore(b, more) : h.appendChild(b);
  });
}
new MutationObserver(addLangBtns).observe($app, { childList: true, subtree: true });

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
      <button class="dn-back" data-act="home">‹ ${insp.paper ? 'Zurück' : insp.visitId ? 'Zum Termin' : 'Übersicht'}</button>
      <div class="dn-title"><span class="dn-h">${unitHead(u)}</span><span>${esc(u.noun)} · ${esc(inspTitle(insp))}</span></div>
      ${sideSteps()}
      <div class="dn-foot"><a class="tb-btn sm" href="#/handbuch" title="Feldhandbuch">📖 Handbuch</a><button class="tb-btn sm" data-act="lang" title="Sprache">${LANG === 'en' ? 'DE' : 'EN'}</button></div>`;
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
    <a class="dn-item ${home ? 'on' : ''}" href="#/">▤ Termine</a>
    <a class="dn-item ${/^#\/k(\/|$)/.test(h) ? 'on' : ''}" href="#/k">👤 Kunden</a>
    <a class="dn-item ${/^#\/o(\/|$)/.test(h) ? 'on' : ''}" href="#/o">🏢 Objekte</a>
    <a class="dn-item ${/^#\/(tueren|d\/)/.test(h) ? 'on' : ''}" href="#/tueren">🚪 Türen und Tore</a>
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

function renderHomeDesk({ open, done, single, resume, all, visits }) {
  const sr = homeQuery.trim() ? searchResults(all, visits, homeQuery) : null;
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
      ${all.length ? searchBox('homeSearch', homeQuery, 'Tür suchen: Tür-Nr., Standort, Objekt …  ( / )') : ''}
    </header>
    <main class="dk-page">
      ${sr ? `<section class="dk-panel"><h2>Treffer <span class="muted">${sr.hits.length}</span></h2>${sr.hits.length ? `<table class="dt">
        <thead><tr><th>Nr.</th><th>Tor / Tür</th><th>Standort / Lage</th><th>Typ</th><th>Objekt</th><th>Kunde</th><th>Termin</th><th>Status</th></tr></thead><tbody>
        ${sr.hits.map(i => { const u = unitOf(i), v = sr.vOf(i), [cls, label] = itemState(i); return `<tr class="dt-click" data-act="open" data-id="${i.id}">
          <td><b>${esc(u.nr || '')}</b></td><td><span class="kind-tag ${kindOf(i)}">${esc(u.noun)}</span></td><td><b>${esc(u.standort || '–')}</b></td><td>${esc(u.typ || '')}</td>
          <td>${esc(inspTitle(i))}</td><td>${esc(i.header?.kunde?.name || '')}</td><td class="nw">${esc(v?.datum || i.datum || '')}</td>
          <td><span class="pill ${cls === 'maengel' ? 'red' : cls === 'fertig' ? 'green' : ''}">${esc(label)}</span></td></tr>`; }).join('')}</tbody></table>` : '<p class="dk-empty">Nichts gefunden.</p>'}</section>` : `
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
        </tbody></table></section>` : ''}`}
    </main>`;
}

async function renderVisitDesk() {
  const v = ensurePairs(visit), all = await visitItems(v);
  const colW = settings.get('colW', {}) || {};
  const multi = v.pairs.length > 1;
  const showAll = multi && v.filter === 'all';
  const items = showAll || !multi ? all : all.filter(i => pairOfItem(v, i).id === v.filter);
  const done = items.filter(i => i.status === 'done').length;
  const withDef = items.filter(i => i.status === 'done' && hasDefects(i)).length;
  const one = !multi ? v.pairs[0] : (showAll ? null : pairById(v, v.filter));
  const dups = dupSet(all), q = visitQuery.trim(), tN = await todoCounts();
  const sorted = (list) => { const r = sortItems(q ? list.filter(i => matchScore(i, q) > 0) : list, v); return q ? r.sort((a, b) => matchScore(b[0], q) - matchScore(a[0], q)) : r; };
  const tr = (i, n) => {
    const [cls, label] = itemState(i);
    const u = unitOf(i), h = i.header || {}, g = h.tor || h.grund || {};
    const m = defectCount(i);
    return `<tr class="dt-click st-${cls}" data-act="openItem" data-id="${i.id}">
      <td class="num muted">${n}</td>
      <td><span class="kind-tag ${TEMPLATES[i.templateId]?.kind}">${esc(u.noun)}</span></td>
      <td><b>${esc(u.standort || '–')}</b>${dups.has(i.id) ? ' ' + dupPill : ''}${i.status !== 'done' && tN.get(i.gateId) ? ' ' + todoPill(tN.get(i.gateId)) : ''}</td>
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
      ${noteSection('visits', v.id, v.intNote)}
      ${multi ? pairChips(v, all) : ''}
      <div class="dk-sum">
        ${one ? `<span>${esc([one.kunde?.name, [one.objekt?.name, one.objekt?.strasse, one.objekt?.plzOrt].filter(Boolean).join(', ')].filter(Boolean).join(' · '))}</span>` : `<span>${v.pairs.length} Paare aus Kunde und Objekt</span>`}
        ${items.length > 1 ? searchBox('visitSearch', visitQuery, 'Suchen: Tür-Nr., Standort …  ( / )') : ''}
        <span class="dk-sum-r">${progBar(done, items.length)} <b>${done} von ${items.length} fertig</b>${withDef ? ` · <b class="red">${withDef} mit Mängeln</b>` : ''}</span>
      </div>
      <section class="dk-panel">
        ${items.length ? `<table class="dt dt-items ${Object.keys(colW).length ? 'fixed' : ''}" ${Object.keys(colW).length ? `style="width:${Object.values(colW).reduce((a, b) => a + b, 0)}px"` : ''}>
          <thead><tr>${[['nr0', '#', 'num'], ['kind', 'Tor / Tür'], ['standort', 'Standort / Lage'], ['nr', 'Nr.'], ['typ', 'Typ'], ['hersteller', 'Hersteller'], ['bj', 'Bj.', 'num'], ...(showAll ? [['pair', 'Kunde · Objekt']] : []), ['status', 'Status'], ['maengel', 'Mängel', 'num']].map(([k, t, c]) => { const s = getSort(); const on = s.k === k; return `<th class="sortable ${c || ''} ${on ? 'on' : ''}" data-act="sortBy" data-k="${k}" ${colW[k] ? `style="width:${colW[k]}px"` : ''} title="Nach ${t === '#' ? 'Reihenfolge' : t} sortieren" aria-sort="${on ? (s.d === 1 ? 'ascending' : 'descending') : 'none'}">${t}<span class="sort-ind">${on ? (s.d === 1 ? ' ▲' : ' ▼') : ''}</span><span class="col-rs" data-col="${k}" title="Ziehen: Breite ändern · Doppelklick: alle Breiten zurücksetzen"></span></th>`; }).join('')}<th data-k="acts" ${colW.acts ? `style="width:${colW.acts}px"` : ''}></th></tr></thead>
          <tbody>${showAll
            ? v.pairs.map(p => { const its = all.filter(i => pairOfItem(v, i).id === p.id); return `<tr class="dt-group"><td colspan="11"><button class="link" data-act="filterPair" data-id="${p.id}">${esc(pairLabel(p))} ›</button> <span class="muted">${its.length}</span></td></tr>${sorted(its).map(([i, n]) => tr(i, n)).join('')}`; }).join('')
            : sorted(items).map(([i, n]) => tr(i, n)).join('') || `<tr><td colspan="11" class="muted">Keine Tür und kein Tor passt zur Suche.</td></tr>`}</tbody></table>`
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
    return `<div class="row drow info" id="r-${it.id}"><div class="dc-lbl">${esc(it.label)}${pinBtn('i:' + it.id, it.label)}${todoBox('i:' + it.id)}</div><div class="dc-in">${input}</div></div>`;
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
  const dOpen = s === 'b' && openDefects.has(it.id);
  const defect = dOpen ? `
    <div class="dc-defect">
      <textarea class="field" rows="2" data-note="${it.id}" placeholder="Mangel beschreiben, steht auf dem Ausdruck neben der Zeile">${esc(a.note)}</textarea>
      <div class="dc-defect-tools"><span class="chips">${tpl.defectChips.map(c => `<button class="chip" data-act="chipNote" data-id="${it.id}" data-v="${esc(c)}">${esc(c)}</button>`).join('')}</span>
      <span><label class="tb-btn sm">📷 Foto<input type="file" accept="image/*" data-photo-for="${it.id}" hidden></label> <button class="tb-btn sm" data-act="defectClose" data-id="${it.id}">▴ zuklappen</button></span></div>
      ${thumbsHTML(a.photos, it.id, true)}
    </div>` : '';
  return `<div class="row drow ${s || ''} ${!s && p.s ? 'has-prev' : ''} ${p.s === 'b' ? 'was-b' : ''}" id="r-${it.id}">
    <div class="dc-lbl">${esc(it.label)}${guideLink(it)}${pinBtn('i:' + it.id, it.label)}${extra ? ` ${extra}` : ''}
      ${p.s === 'b' ? `<div class="dc-prev">Letztes Mal B.${insp.prevDatum ? ` (${esc(insp.prevDatum)})` : ''}${p.note ? ': ' + esc(p.note) : ''}</div>` : ''}${todoBox('i:' + it.id)}</div>
    <div class="dc-st seg2 n${(tpl.states || ['ok', 'b']).length}" role="group">${states}</div>
    <div class="dc-note">${dOpen ? '<span class="muted small">siehe unten</span>' : `<input class="field xs" data-note="${it.id}" value="${esc(a.note)}" placeholder="${s === 'b' ? 'Mangel beschreiben' : p.note ? 'letztes Mal: ' + esc(p.note) : 'Notiz'}" autocomplete="off">${s === 'b' ? `<button class="tb-btn sm dc-more" data-act="defectOpen" data-id="${it.id}" title="Vorschläge und Foto">📷${a.photos?.length ? ' ' + a.photos.length : ''} ▾</button>` : ''}`}</div>
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

// ---------- Spaltenbreiten der Tor-/Türliste (Desktop): am rechten Rand des Spaltenkopfs ziehen ----------
document.addEventListener('pointerdown', (e) => {
  const h = e.target.closest('.dt-items .col-rs');
  if (!h) return;
  e.preventDefault();
  const table = h.closest('table'), th = h.closest('th');
  const ths = [...table.querySelectorAll('thead th')];
  // Beim ersten Ziehen die jetzigen Breiten festhalten, damit sich nur die gezogene Spalte ändert
  if (!table.classList.contains('fixed')) { ths.forEach(t => { t.style.width = t.getBoundingClientRect().width + 'px'; }); table.style.width = table.getBoundingClientRect().width + 'px'; table.classList.add('fixed'); }
  const x0 = e.clientX, w0 = th.getBoundingClientRect().width, t0 = table.getBoundingClientRect().width;
  document.body.classList.add('col-resizing');
  const move = (ev) => { const w = Math.max(32, Math.round(w0 + ev.clientX - x0)); th.style.width = w + 'px'; table.style.width = (t0 - w0 + w) + 'px'; };
  const up = () => {
    document.removeEventListener('pointermove', move); document.removeEventListener('pointerup', up);
    document.body.classList.remove('col-resizing');
    const w = {}; ths.forEach(t => { if (t.dataset.k) w[t.dataset.k] = Math.round(t.getBoundingClientRect().width); });
    settings.set('colW', w);
  };
  document.addEventListener('pointermove', move); document.addEventListener('pointerup', up);
});
document.addEventListener('dblclick', (e) => {
  if (!e.target.closest('.dt-items .col-rs')) return;
  settings.set('colW', {}); renderVisit();
});
