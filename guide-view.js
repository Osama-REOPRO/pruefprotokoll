// Feldhandbuch: Kapitel lesen, suchen, Bilder vergrößern. Inhalt kommt aus guide/data.js
// (erzeugt mit tools/build-guide.py aus dem Obsidian-Vault) und funktioniert offline.
import { PAGES, INDEX } from './guide/data.js';
import { matchGuide } from './guide-match.js';

export { INDEX };
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const norm = (s = '') => s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/ß/g, 'ss');
const pageById = (id) => PAGES.find(p => p.id === id);
// Abschnitte für das Inhaltsverzeichnis: ## und ###, bei flachen Seiten auch ####
function tocOf(pid) {
  const all = INDEX.filter(e => e.p === pid);
  const top = all.filter(e => e.l === 2 || e.l === 3);
  return top.length > 2 ? top : all.filter(e => e.l >= 2 && e.l <= 4);
}

// Link zum Handbuch für eine Zeile der Checkliste (oder null)
const TPL_PAGE = { tor: 'tore', tuer: 'tueren' };
const linkCache = new Map();
export function guideHref(kind, sectionTitle, label) {
  const pid = TPL_PAGE[kind];
  if (!pid) return null;
  const k = `${pid}|${sectionTitle}|${label}`;
  if (!linkCache.has(k)) linkCache.set(k, matchGuide(INDEX, pid, sectionTitle, label));
  return linkCache.get(k);
}

let shownPage = null; // welche Seite gerade im DOM steht (Sprünge innerhalb einer Seite ohne Neuaufbau)
let lastQuery = '';

export function renderGuide($app, pid, anchor) {
  const page = pid && pageById(pid);
  if (!page) return renderIndex($app);
  if (shownPage !== pid || !document.querySelector('main.guide .gdoc')) {
    shownPage = pid;
    const i = PAGES.indexOf(page);
    const prev = PAGES[i - 1], next = PAGES[i + 1];
    const toc = tocOf(pid);
    const tocHTML = toc.map(e => `<a class="gtoc-a l${e.l}" href="#/handbuch/${pid}/${e.a}">${esc(e.t)}</a>`).join('');
    $app.innerHTML = `
      <header class="bar">
        <a class="icon-btn as-a" href="#/handbuch" aria-label="Feldhandbuch">‹</a>
        <div class="bar-title"><span class="small muted">Feldhandbuch</span><br><span class="t notr">${esc(page.short)}</span></div>
        ${toc.length > 2 ? '<button class="icon-btn" data-act="guideToc" aria-label="Abschnitte">☰</button>' : ''}
        <button class="icon-btn" data-act="guideClose" aria-label="Handbuch schließen">✕</button>
      </header>
      ${toc.length > 2 ? `<nav class="gtoc-side notr">${tocHTML}</nav>` : ''}
      <main class="guide ${toc.length > 2 ? 'has-toc' : ''}">
        <article class="gdoc notr">${page.html}</article>
        <nav class="gpager">
          ${prev ? `<a class="big-btn" href="#/handbuch/${prev.id}">‹ <span class="notr">${esc(prev.short)}</span></a>` : '<span></span>'}
          ${next ? `<a class="big-btn" href="#/handbuch/${next.id}"><span class="notr">${esc(next.short)}</span> ›</a>` : '<span></span>'}
        </nav>
      </main>`;
    document.title = `${page.short} · Feldhandbuch`;
  }
  markToc(anchor);
  if (anchor) {
    const el = document.getElementById(anchor);
    if (el) {
      // Bei Abbildungen die Überschrift darüber mit anzeigen
      let top = el;
      for (let s = el.previousElementSibling, i = 0; s && i < 3; s = s.previousElementSibling, i++) if (/^H[2-4]$/.test(s.tagName)) { top = s; break; }
      top.scrollIntoView({ block: 'start' });
      el.classList.remove('gflash'); void el.offsetWidth; el.classList.add('gflash');
    }
  }
}

function markToc(anchor) {
  document.querySelectorAll('.gtoc-a').forEach(a => a.classList.toggle('on', !!anchor && a.getAttribute('href').endsWith('/' + anchor)));
}

function renderIndex($app) {
  shownPage = null;
  const start = pageById('start');
  // Einleitung + "Alle Abbildungen" aus der Übersicht; die Inhaltsliste ersetzen die Kapitel-Knöpfe
  const intro = start.html.replace(/<h2 id="inhalt">[\s\S]*?(?=<h2 )/, '');
  const chapters = PAGES.filter(p => p.id !== 'start');
  $app.innerHTML = `
    <header class="bar">
      <button class="icon-btn" data-act="guideClose" aria-label="Zurück">‹</button>
      <div class="bar-title">Feldhandbuch</div>
    </header>
    <main class="guide">
      <input class="field gsearch" type="search" id="gsearch" value="${esc(lastQuery)}"
        placeholder="Im Handbuch suchen (z. B. Feder, SKS, Luftspalt)" autocomplete="off" enterkeyhint="search">
      <div id="gresults"></div>
      <div id="gindex">
        <section class="card"><h2>Kapitel</h2>
          ${chapters.map((p, i) => `<a class="list-row as-a" href="#/handbuch/${p.id}"><span class="notr"><strong>${i + 1} · ${esc(p.short)}</strong><br><span class="muted small">${esc(p.title.replace(/^[^–]*–\s*/, ''))}</span></span><span class="chev">›</span></a>`).join('')}
        </section>
        <article class="gdoc notr">${intro}</article>
      </div>
    </main>`;
  document.title = 'Feldhandbuch';
  const inp = document.getElementById('gsearch');
  inp.addEventListener('input', () => search(inp.value));
  if (lastQuery) search(lastQuery);
}

function search(q) {
  lastQuery = q;
  const box = document.getElementById('gresults'), idx = document.getElementById('gindex');
  const toks = norm(q).split(/\s+/).filter(t => t.length > 1);
  if (!toks.length) { box.innerHTML = ''; idx.classList.remove('hidden'); return; }
  idx.classList.add('hidden');
  const hits = [];
  for (const e of INDEX) {
    if (e.l < 2) continue;
    const t = norm(e.t), all = `${t} ${norm(e.s)} ${norm(e.x || '')}`;
    if (!toks.every(k => all.includes(k))) continue;
    const score = toks.reduce((n, k) => n + (t.includes(k) ? 3 : 0) + (norm(e.s).includes(k) ? 1 : 0), 0) + (e.l === 4 ? 0.5 : 0);
    hits.push({ e, score });
  }
  hits.sort((a, b) => b.score - a.score);
  const mark = (s) => { let h = esc(s); for (const k of toks) h = h.replace(new RegExp(`(${k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi'), '<mark>$1</mark>'); return h; };
  const snip = (x = '') => {
    const i = norm(x).indexOf(toks[0]);
    if (i < 0) return x.slice(0, 120);
    const a = Math.max(0, i - 50);
    return (a ? '…' : '') + x.slice(a, a + 140) + '…';
  };
  box.innerHTML = hits.length ? `<section class="card notr">${hits.slice(0, 40).map(({ e }) => `
    <a class="list-row as-a gres" href="#/handbuch/${e.p}/${e.a}"><span>
      <strong>${mark(e.t)}</strong><br>
      <span class="muted small">${esc(pageById(e.p).short)}${e.s ? ' · ' + esc(e.s) : ''}</span>
      ${e.x ? `<br><span class="small gsnip">${mark(snip(e.x))}</span>` : ''}
    </span><span class="chev">›</span></a>`).join('')}</section>`
    : '<p class="empty">Nichts gefunden.</p>';
}

// Inhaltsverzeichnis als Blatt (Handy)
export function openGuideToc(sheet) {
  const pid = shownPage;
  const toc = tocOf(pid);
  sheet.innerHTML = `<div class="sheet-inner">
    <div class="sheet-grab"></div>
    <h2 class="sheet-h">Abschnitte</h2>
    <div class="notr">${toc.map(e => `<a class="list-row as-a gtoc-row l${e.l}" href="#/handbuch/${pid}/${e.a}"><span>${esc(e.t)}</span><span class="chev">›</span></a>`).join('')}</div>
  </div>`;
  sheet.classList.add('show');
}

// Bild antippen: groß ansehen; nochmal antippen: in Originalgröße zum Verschieben
export function openZoom(img) {
  let z = document.getElementById('gzoom');
  if (!z) {
    z = document.createElement('div');
    z.id = 'gzoom';
    z.innerHTML = '<button class="icon-btn gzoom-x" data-act="zoomClose" aria-label="Bild schließen">✕</button><div class="gzoom-in"><img alt=""></div>';
    document.body.appendChild(z);
    z.querySelector('img').addEventListener('click', (e) => { e.stopPropagation(); z.classList.toggle('big'); });
    z.addEventListener('click', (e) => { if (e.target === z || e.target.classList.contains('gzoom-in')) closeZoom(); });
  }
  z.classList.remove('big');
  z.querySelector('img').src = img.currentSrc || img.src;
  z.classList.add('show');
}
export function closeZoom() { const z = document.getElementById('gzoom'); if (!z?.classList.contains('show')) return false; z.classList.remove('show'); return true; }

// ----- Handbuch als Popup: an Ort und Stelle, ohne die Seite zu verlassen -----
// Zeigt den Abschnitt zu einem Prüfpunkt: zuerst die Bilder (eigene und die verlinkten Abbildungen),
// dann die Erklärung. Schließen führt genau dorthin zurück, wo man war.
const pageDom = new Map();
function domOf(pid) {
  if (!pageDom.has(pid)) { const t = document.createElement('div'); t.innerHTML = pageById(pid)?.html || ''; pageDom.set(pid, t); }
  return pageDom.get(pid);
}
const lvl = (el) => /^H([1-6])$/.test(el?.tagName || '') ? +el.tagName[1] : 0;
// Ein Abschnitt: die Überschrift mit id=anchor und alles bis zur nächsten gleich hohen oder höheren Überschrift
function sectionOf(pid, anchor) {
  const root = domOf(pid);
  let h = root.querySelector(`[id="${CSS.escape(anchor)}"]`);
  if (!h) return null;
  // Abbildung direkt verlinkt: die Überschrift darüber nehmen
  if (!lvl(h)) { for (let s = h.previousElementSibling; s; s = s.previousElementSibling) if (lvl(s)) { h = s; break; } }
  const L = lvl(h) || 4, nodes = [];
  for (let n = h.nextElementSibling; n && !(lvl(n) && lvl(n) <= L); n = n.nextElementSibling) nodes.push(n);
  return { title: h.textContent, nodes };
}
function figureOf(pid, anchor) {
  const el = domOf(pid).querySelector(`[id="${CSS.escape(anchor)}"]`);
  return el?.matches('figure') ? el : el?.querySelector?.('figure');
}
export function guidePopHTML(href) {
  const m = String(href || '').match(/^#\/handbuch\/([^/]+)\/(.+)$/);
  if (!m) return null;
  const [, pid, anchor] = m, sec = sectionOf(pid, anchor);
  if (!sec) return null;
  const body = document.createElement('div');
  sec.nodes.forEach(n => body.appendChild(n.cloneNode(true)));
  // Bilder sammeln: eigene Abbildungen im Abschnitt und die, auf die er verweist
  const figs = [];
  body.querySelectorAll('figure').forEach(f => { figs.push({ html: f.querySelector('img')?.outerHTML || '', cap: '' }); f.remove(); });
  body.querySelectorAll('a[href^="#/handbuch/"]').forEach(a => {
    const [, p2, a2] = a.getAttribute('href').match(/^#\/handbuch\/([^/]+)\/(.+)$/) || [];
    const f = p2 && /^abb-/.test(a2) && figureOf(p2, a2);
    if (f && !figs.some(x => x.id === a2)) figs.push({ id: a2, html: f.querySelector('img')?.outerHTML || '', cap: a.textContent });
    a.setAttribute('data-gpop', a.getAttribute('href')); a.setAttribute('href', 'javascript:void 0');
  });
  // Die Zeile „Bild / drawing“ steht schon als Bild oben
  body.querySelectorAll('li').forEach(li => { if (/^Bild\s*\/\s*drawing/i.test(li.textContent.trim())) li.remove(); });
  const sub = body.querySelector('.gsub'); const subTxt = sub ? sub.textContent : ''; sub?.remove();
  const imgs = figs.map(f => `<figure class="gpop-fig">${f.html.replace('loading="lazy"', '').replace('<img ', '<img data-zoom ')}${f.cap ? `<figcaption>${esc(f.cap)}</figcaption>` : ''}</figure>`).join('');
  return `<div class="gpop notr">
    <div class="gpop-head"><div><b>${esc(sec.title)}</b>${subTxt ? `<span class="muted small">${esc(subTxt)}</span>` : ''}</div>
      <button class="icon-btn gpop-x" data-act="cancelDel" aria-label="Schließen">✕</button></div>
    ${imgs ? `<div class="gpop-figs gdoc">${imgs}</div>` : ''}
    <div class="gdoc gpop-body">${body.innerHTML}</div>
    <a class="big-btn gpop-more" href="${esc(href)}">📖 Im Handbuch weiterlesen ›</a>
  </div>`;
}
