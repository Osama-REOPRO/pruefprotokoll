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
