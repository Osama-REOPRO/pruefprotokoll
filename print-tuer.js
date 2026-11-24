// Druckansicht: "Abnahme- / Inbetriebnahme- & Prüfprotokoll" für Türen, wie das Papierformular.
import { esc, box, mini, ink, pnote, printDefectLines, shadeRows } from './print-tore.js';

const SIG_AND_HEAD = {
  head: (title, angebot) => `
    <header class="phead">
      <div class="pco"><b>Hotz Torservice GmbH</b><br>Bitterfelder Straße 12<br>12681 Berlin<br><b>Tel:</b> +49 30 934 986 40<br><b>Notdienst:</b> +49 1738650030</div>
      <div class="ptitle">${esc(title)}${angebot ? `<div class="ink angebot">Bitte um Angebot</div>` : ''}</div>
      <div class="plogo">
        <img class="plogo-img" src="logo-hotz.jpg" alt="Hotz Torservice GmbH">
        <div class="hrb">Amtsgericht Bln-Charlottenburg HRB 168433 B</div>
      </div>
    </header>
    <div class="prule"></div>`,
  sig: (insp) => `
    <footer class="psig">
      <div><div class="psigval">${ink([insp.ort, insp.datum].filter(Boolean).join(' '))}</div><div class="psiglab">Ort, Datum</div></div>
      <div><div class="psigval">${insp.sig?.ag?.img ? `<img src="${insp.sig.ag.img}" alt="">` : ''}${insp.sig?.ag?.name ? `<span class="ink signame">${esc(insp.sig.ag.name)}</span>` : ''}</div><div class="psiglab">Unterschrift Auftraggeber</div></div>
      <div><div class="psigval">${insp.sig?.an?.img ? `<img src="${insp.sig.an.img}" alt="">` : ''}${insp.sig?.an?.name ? `<span class="ink signame">${esc(insp.sig.an.name)}</span>` : ''}</div><div class="psiglab">Unterschrift Auftragnehmer</div></div>
    </footer>`,
};

// Zeile mit drei Kästchen o.B. / B. / n.v.
function crow(label, a = {}, extraCls = '') {
  return `<tr class="pi ${extraCls}"><td class="pl">${pnote(a)}${label}</td><td class="pc">${box(a.s === 'ok')}</td><td class="pc">${box(a.s === 'b')}</td><td class="pc">${box(a.s === 'nv')}</td></tr>`;
}
const hrow = (title, cols = false) => `<tr class="ph"><th>${esc(title)}</th><td class="pc">${cols ? 'o.B.' : ''}</td><td class="pc">${cols ? 'B.' : ''}</td><td class="pc">${cols ? 'n.v.' : ''}</td></tr>`;
// Textzeile ohne Kästchen (Feststellanlage usw.)
const trow = (label, val, cls = 'b') => `<tr class="pt"><td colspan="4"><span class="${cls}">${esc(label)}${label && !cls.includes('nocolon') ? ':' : ''}</span> ${val ? ink(val) : ''}</td></tr>`;

export function printTuer(insp, tpl, photos = []) {
  const h = insp.header, ans = insp.answers;
  const k = h.kunde || {}, o = h.objekt || {}, t = h.tuer || {}, g = h.grund || {};
  const A = (id) => ans[id] || {};
  const X = (id) => A(id).x;
  const kundeLines = [k.name, k.zusatz, k.strasse, k.plzOrt].filter(Boolean);
  const objLines = [o.name, o.strasse, o.plzOrt].filter(Boolean);
  const pad = (arr, n) => [...arr, ...Array(Math.max(0, n - arr.length)).fill('')].slice(0, Math.max(n, arr.length));
  const remarkRows = pad(printDefectLines(insp, tpl), 10);
  const opt = (label, on) => `<span class="popt">${esc(label)} ${mini(on)}</span>`;

  const left = tpl.sections.slice(0, 9).map((sec, si) => {
    let rows = hrow(sec.title, si === 0); // erster Abschnitt trägt die Spaltenköpfe (wie auf Papier)
    for (const it of sec.items) {
      let label = esc(it.label);
      if (it.id === 'allg.schild') label = `${esc(it.label)} &nbsp; ja ${mini(X(it.id) === 'ja')} &nbsp; nein ${mini(X(it.id) === 'nein')}`;
      rows += crow(label, A(it.id));
    }
    return rows;
  }).join('');

  const right = `
    ${hrow('10. Elektrische Anbauteile', true)}
    ${crow('Elektr.Türöffner vorhanden prüfen ggf justieren', A('elektro.oeffner'))}
    ${crow('Drehflügelantrieb prüfen ggf. justieren', A('elektro.antrieb'))}
    ${trow('Typ', X('elektro.typ'), 'blue')}
    ${trow('Bedien-/ Ansteuerelemente', X('elektro.bedien'), 'blue b')}
    ${trow('', '')}
    <tr class="ph"><th colspan="4">11. Feststellanlage</th></tr>
    ${trow('Hersteller', X('fst.hersteller'))}
    ${trow('Typ', X('fst.typ'))}
    ${trow('Rauchmelder', '', 'blue b nocolon')}
    ${trow('Anzahl', X('fst.rm.anzahl'))}
    ${trow('Typ', X('fst.rm.typ'))}
    <tr class="pt"><td colspan="4"><span class="b">Anordnung gemäß DiBT:</span> &nbsp; ja ${mini(X('fst.rm.dibt') === 'ja')} &nbsp;&nbsp; nein ${mini(X('fst.rm.dibt') === 'nein')}</td></tr>
    ${trow('Handauslöser', '', 'blue b nocolon')}
    ${trow('Anzahl', X('fst.ha.anzahl'))}
    ${trow('Typ', X('fst.ha.typ'))}
    ${trow('Anordnung', X('fst.ha.anordnung'))}
    ${trow('Haltemagnet', '', 'blue b nocolon')}
    ${trow('Typ', X('fst.hm.typ'))}
    ${crow('<b>Befestigung</b>', A('fst.hm.befestigung'))}`;

  const page1 = `
  <section class="ppage ptuer">
    ${SIG_AND_HEAD.head(tpl.title, insp.angebot)}
    <table class="paddr">
      <tr><td><b>Objekt:</b> ${objLines[0] ? ink(objLines[0]) : ''}</td><td><b>Kunde:</b> ${kundeLines[0] ? ink(kundeLines[0]) : ''}</td></tr>
      ${[1, 2, 3].map(i => `<tr><td>${objLines[i] ? ink(objLines[i]) : ''}</td><td>${kundeLines[i] ? ink(kundeLines[i]) : ''}</td></tr>`).join('')}
      <tr><td><b>Standort/Lage:</b> ${t.standort ? ink(t.standort) : ''}</td><td><b>Tür-Nr.:</b> ${t.tuerNr ? ink(t.tuerNr) : ''}</td></tr>
    </table>
    <div class="popts">
      <div>${['Inbetriebnahme', 'Abnahme', 'Wartung'].map(x => opt(x, t.art === x)).join('')}</div>
      <div>${['Rohrrahmen-Türen', 'Stahlblechtüren', 'Holztür'].map(x => opt(x, t.bauart === x)).join('')}</div>
      <div>${['Brandschutztür', 'Rauchschutztür', 'Kombiniert RS/BS'].map(x => opt(x, t.funktion === x)).join('')}</div>
      <div>${opt('T 30', t.klasse === 'T30')}${opt('T 90', t.klasse === 'T90')}<span class="popt psonst">sonstige ${mini(t.klasse === 'sonstige')}<span class="pfill">${t.klasse === 'sonstige' && t.klasseSonst ? ink(t.klasseSonst) : ''}</span></span></div>
    </div>
    <div class="pgrund">
      <div class="pline pnone"><span class="plab blue b pul">Grunddaten Tür:</span></div>
      <div class="pline pnone"></div>
      <div class="pline pnone"></div>
      <div class="pline"><span class="plab blue b">Typ:</span><span class="pval">${g.typ ? ink(g.typ) : ''}</span></div>
      <div class="pline"><span class="plab blue b">Hersteller:</span><span class="pval">${g.hersteller ? ink(g.hersteller) : ''}</span></div>
      <div class="pline"><span class="plab blue b">Fabr.- Nr.:</span><span class="pval">${g.fabrNr ? ink(g.fabrNr) : ''}</span></div>
      <div class="pline"><span class="plab blue b">Baujahr:</span><span class="pval">${g.bj ? ink(g.bj) : ''}</span></div>
      <div class="pline"><span class="plab blue b">Anzahl d. Flügel:</span><span class="pval">${(g.fluegel || t.fluegel) ? ink(g.fluegel || t.fluegel) : ''}</span></div>
      <div class="pline pnone"></div>
    </div>
    <div class="plegend">o.B= ohne Befund &nbsp; B.= Befund &nbsp;&nbsp;&nbsp;&nbsp; n.v.= nicht vorhanden</div>

    <div class="pgrid">
      <div class="pleft"><table class="pchk p3">
        ${shadeRows(left)}</table></div>
      <div class="pright">
        <table class="pchk p3">${shadeRows(right)}</table>
        <div class="prem">
          <div class="premh">Bemerkungen/ Festgestellte Mängel:</div>
          ${remarkRows.map(r => `<div class="premrow">${r ? ink(r) : ''}</div>`).join('')}
        </div>
        <p class="pdisc small">${tpl.disclaimer.map(esc).join('<br>')}</p>
      </div>
    </div>
    ${SIG_AND_HEAD.sig(insp)}
  </section>`;

  const page2 = photos.length ? `
  <section class="ppage pphotos">
    <h2>Fotos zu festgestellten Mängeln</h2>
    <p class="psub">${esc([objLines.join(', '), t.standort, t.tuerNr && 'Tür-Nr. ' + t.tuerNr, insp.datum].filter(Boolean).join(' · '))}</p>
    <div class="pphgrid">${photos.map(p => `<figure><img src="${p.url}" alt=""><figcaption>${esc(p.caption)}</figcaption></figure>`).join('')}</div>
  </section>` : '';

  return page1 + page2;
}
