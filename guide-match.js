// Findet zu einem Prüfpunkt der Checkliste den passenden Abschnitt im Feldhandbuch.
// Die Überschriften im Handbuch (####) heißen wie die Zeilen auf dem Papierformular.
const norm = (s = '') => s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/ß/g, 'ss')
  .replace(/[^a-z0-9<>]+/g, ' ').replace(/\b(ggf|u|d|m|und|der|die|das|von|pruefen|prufen)\b/g, ' ').replace(/\s+/g, ' ').trim();
const words = (s) => new Set(norm(s).split(' ').filter(w => w.length > 1));
const cp = (a, b) => { let i = 0; while (i < a.length && a[i] === b[i]) i++; return i; };
function overlap(a, b) {
  const A = words(a), B = words(b);
  if (!A.size || !B.size) return 0;
  const same = (a, b) => a === b || (Math.min(a.length, b.length) >= 5 && (a.startsWith(b) || b.startsWith(a))) || cp(a, b) >= 8;
  let n = 0; for (const w of A) if ([...B].some(b => same(w, b))) n++;
  return n / Math.min(A.size, B.size);
}
export function matchGuide(index, pageId, sectionTitle, label) {
  const L = norm(label);
  if (!L) return null;
  let best = null, bestScore = 0;
  for (const e of index) {
    if (e.p !== pageId || e.l !== 4 || /^abb /.test(norm(e.t))) continue;
    const T = norm(e.t);
    let sc = T === L ? 3 : (T.startsWith(L) || L.startsWith(T)) ? 2.2 : overlap(label, e.t) >= 0.75 ? 1.4 + overlap(label, e.t) / 10 : 0;
    if (!sc) continue;
    sc += overlap(sectionTitle, e.s) * 0.8;
    if (sc > bestScore) { bestScore = sc; best = e; }
  }
  return best ? `#/handbuch/${best.p}/${best.a}` : null;
}
