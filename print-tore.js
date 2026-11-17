// Druckansicht: bildet das Papierformular "Prüfprotokoll für kraftbetätigte Tore" auf A4 nach.
// Das Layout gehört zum Formular. Ein Türformular bekommt später eine eigene Druckdatei.

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Zeilen genau wie auf Papier: [art, text, itemId]
//   h = blaue fette Abschnittsüberschrift (mit o.B./B.-Spalte leer)
//   s = blaue Unterüberschrift
//   i = Prüfpunkt mit Kästchen
const LEFT = [
  ['h', 'Panzer/ Torblatt/Gitter', null, true],
  ['i', 'Zustand/ Verschleiß', 'panzer.zustand'],
  ['i', 'Seitenarretierung/Sturmanker/Sturmrollen', 'panzer.sturm'],
  ['i', 'Aufhängung/ Befestigungsschrauben', 'panzer.aufhaengung'],
  ['i', 'Scharniere', 'panzer.scharniere'],
  ['i', 'Schlupftür', 'panzer.schlupftuer'],
  ['h', 'Abrollsicherung'],
  ['s', 'Fangvorrichtung und E- Abschaltung'],
  ['i', 'Befestigung/ Zustand/Verschleiß/<br>Korrosion/Gängigkeit/bewegliche Teile', 'fangvorr.zustand', 'tall'],
  ['i', 'Zwangstrenner', 'fangvorr.zwangstrenner'],
  ['i', 'Schild, Vollständigkeit, Lesbarkeit', 'fangvorr.schild'],
  ['i', 'Passfeder', 'fangvorr.passfeder'],
  ['s', 'Federn'],
  ['i', 'Befestigung/ Zustand und Funktion', 'federn.befestigung'],
  ['i', 'Verschleiß/Korrosion', 'federn.verschleiss'],
  ['h', 'Kettenrad und Kette'],
  ['i', 'Kette, fluchten und Verschleiß', 'kette.fluchten'],
  ['i', 'Kettenspannung, ggf. Nachspannen', 'kette.spannung'],
  ['i', 'Kette säubern und schmieren', 'kette.schmieren'],
  ['i', 'Kettenschutz', 'kette.schutz'],
  ['i', 'Kettenräder; Verschleiß; fester Sitz', 'kette.raeder'],
  ['h', 'Schaltautomat und Steuergeräte'],
  ['i', 'Hauptschalter abschließbar/Netztrennung', 'steuerung.hauptschalter'],
  ['i', 'Motorschutz/Thermopile', 'steuerung.motorschutz'],
  ['i', 'ENDSCHALTER', 'steuerung.endschalter'],
  ['i', 'Klemmstellen', 'steuerung.klemmstellen'],
  ['i', 'Funktion Bedienelemente', 'steuerung.bedienelemente'],
  ['i', 'Schließkantensicherung', 'steuerung.schliesskante'],
  ['i', 'Tür- und Wandklappenüberwachung', 'steuerung.klappen'],
  ['i', 'Zwangstrenner am Fang', 'steuerung.zwangstrennerFang'],
  ['i', 'Einzugssicherung', 'steuerung.einzug'],
  ['i', 'Staulichtschranke', 'steuerung.lichtschranke'],
  ['h', 'Feststellanlage', null, true],
  ['f', 'Akku Typ/Bj./Zustand', 'feststell.akku'],
  ['f', 'Feststellanl.Typ/Hersteller', 'feststell.anlage'],
  ['f', 'Auslöseelemente Typ/Hersteller/Anzahl/Anordnung:', 'feststell.ausloese'],
];
const RIGHT = [
  ['h', 'Beschilderung', null, true],
  ['i', 'Typenschild', 'schilder.typenschild'],
  ['i', 'Hersteller- und Bedienschild, Hinweisschild', 'schilder.hinweis'],
  ['h', 'Antrieb'],
  ['i', 'Motor- ,Konsolenbefestigung', 'antrieb.befestigung'],
  ['i', 'Notentriegelung', 'antrieb.notentriegelung'],
  ['i', 'elektrische Verriegelung', 'antrieb.verriegelung'],
  ['i', 'NESDES', 'antrieb.endschalter'],
  ['i', 'Nothandbedienung', 'antrieb.nothand'],
  ['i', 'Geräusche und Dichtigkeit', 'antrieb.geraeusche'],
  ['h', 'Welle'],
  ['i', 'Schweißnähte Achszapfen/ Konsole', 'welle.schweiss'],
  ['i', 'Lager, Stellringe', 'welle.lager'],
  ['i', 'Befestigung der Lagerkonsole', 'welle.konsole'],
  ['h', 'Führungsschienen- und Laufschienen'],
  ['i', 'Befestigung, Zustand', 'schienen.befestigung'],
  ['i', 'Verschleiß, Schmierung', 'schienen.schmierung'],
  ['i', 'Einlauftrichter/- Einlauf', 'schienen.einlauf'],
  ['i', 'Führungs- und Laufrollen', 'schienen.rollen'],
  ['i', 'Seile/Seilrollen/Gurte/Förderkette/Zahnriemen', 'schienen.seile'],
  ['i', 'Gegengewicht/Gegengewichtskasten', 'schienen.gegengewicht'],
  ['i', 'Dämpfungsregler/ Freilauf', 'schienen.daempfung'],
  ['i', 'Anschlagdämpfer', 'schienen.anschlag'],
  ['i', 'Kunststoffeinlagen/ Dichtungen', 'schienen.dichtungen'],
  ['i', 'Wand- und Deckenklappen', 'schienen.klappen'],
];

const box = (on) => `<span class="pbox ${on ? 'on' : ''}"></span>`;
const mini = (on) => `<span class="pbox sm ${on ? 'on' : ''}"></span>`;
const ink = (v) => `<span class="ink">${esc(v)}</span>`;

function checklist(rows, ans) {
  return `<table class="pchk">${rows.map(([kind, text, id, withHead, opt]) => {
    if (kind === 'h') return `<tr class="ph"><th>${esc(text)}</th><td class="pc">${withHead ? 'o. B.' : ''}</td><td class="pc">${withHead ? 'B.' : ''}</td></tr>`;
    if (kind === 's') return `<tr class="ps"><th>${esc(text)}</th><td class="pc"></td><td class="pc"></td></tr>`;
    const a = ans[id] || {};
    let label = text;
    if (text === 'ENDSCHALTER') {
      const x = a.x || [];
      label = `<span class="split"><span>Endschalter ${mini(x.includes('Endschalter'))}</span><span>Not- Austaster ${mini(x.includes('Not-Austaster'))}</span></span>`;
    } else if (text === 'NESDES') {
      label = `Endschalter&nbsp; ${mini(a.x === 'NES')} NES &nbsp;&nbsp;&nbsp; ${mini(a.x === 'DES')} DES`;
    } else if (kind === 'f') {
      label = `<b class="blue">${esc(text)}</b> ${a.x ? ink(a.x) : ''}`;
    }
    return `<tr class="pi ${kind === 'f' ? 'pf' : ''} ${opt === 'tall' ? 'tall' : ''}"><td class="pl">${label}</td><td class="pc">${box(a.s === 'ok')}</td><td class="pc">${box(a.s === 'b')}</td></tr>`;
  }).join('')}</table>`;
}

function line(label, value, unit = '', cls = '') {
  return `<span class="pline ${cls}"><span class="plab">${label}</span><span class="pval">${value ? ink(value) : ''}</span>${unit ? `<span class="punit">${unit}</span>` : ''}</span>`;
}

export function printDefectLines(insp, tpl) {
  const items = tpl.sections.flatMap(s => s.items);
  const out = items.filter(it => insp.answers[it.id]?.s === 'b').map(it => `${it.label}: ${insp.answers[it.id].note || 'Mangel'}`);
  if (insp.remarks) out.push(insp.remarks);
  if (!out.length) out.push('Ohne Mängel');
  return out;
}

export function printTore(insp, tpl, photos = []) {
  const h = insp.header, ans = insp.answers;
  const k = h.kunde || {}, o = h.objekt || {}, t = h.tor || {}, an = h.antrieb || {}, f = h.fang || {};
  const kundeLines = [k.name, k.zusatz, k.strasse, k.plzOrt].filter(Boolean);
  const objLines = [o.name, o.strasse, o.plzOrt].filter(Boolean);
  const pad = (arr, n) => [...arr, ...Array(Math.max(0, n - arr.length)).fill('')].slice(0, Math.max(n, arr.length));
  const remarks = printDefectLines(insp, tpl);
  const remarkRows = pad(remarks, 6);

  const page1 = `
  <section class="ppage">
    <header class="phead">
      <div class="pco"><b>Hotz Torservice GmbH</b><br>Bitterfelder Straße 12<br>12681 Berlin<br><b>Tel:</b> +49 30 934 986 40<br><b>Notdienst:</b> +49 1738650030</div>
      <div class="ptitle">Prüfprotokoll für kraftbetätigte Tore<br>gemäß den Richtlinien ASR A 1.7 und DIN 14677
        ${insp.angebot ? `<div class="ink angebot">Bitte um Angebot</div>` : ''}</div>
      <div class="plogo">
        <div class="stripes"><i></i><i></i><i></i></div>
        <div class="hotz">HOTZ</div><div class="ts">TORSERVICE<sup>GmbH</sup></div>
        <div class="hrb">Amtsgericht Bln-Charlottenburg HRB 168433 B</div>
      </div>
    </header>
    <div class="prule"></div>

    <table class="paddr">
      <tr><td><b>Objekt:</b></td><td><b>Kunde:</b> ${kundeLines[0] ? ink(kundeLines[0]) : ''}</td></tr>
      ${pad(objLines, 4).map((l, i) => `<tr><td>${l ? ink(l) : ''}</td><td>${kundeLines[i + 1] ? ink(kundeLines[i + 1]) : ''}</td></tr>`).join('')}
      <tr><td><b>Standort/Lage:</b> ${t.standort ? ink(t.standort) : ''}</td><td></td></tr>
    </table>

    <div class="pdata">
      <div class="pcol">
        <div class="pcap">Bezeichnung</div>
        ${line('Typ', t.typ)}
        <span class="prow2">${line('Fabr.- Nr.', t.fabrNr)}${line('Bj.', t.bj, '', 'short')}</span>
        ${line('Hersteller', t.hersteller)}
        <span class="prow2">${line('Panzer Abmess.', t.abmessung)}${line('Gew.', t.gewicht, '', 'short')}</span>
      </div>
      <div class="pcol">
        <div class="pcap">Antrieb</div>
        ${line('Hersteller', an.antriebHersteller)}
        <span class="prow2">${line('Typ', an.antriebTyp)}${line('Leistung', an.leistung, 'kw', 'short')}</span>
        ${line('Antriebsdrehzahl', an.drehzahl)}
        <span class="prow2">${line('Betriebsspannung', an.spannung, 'V')}${line('', an.steuerspannung, an.steuerspannung ? 'V' : '', 'short')}</span>
      </div>
      <div class="pcol">
        <div class="pcap">Sicherung gegen Abstürzen des Panzers</div>
        ${line('Art der Fangvorr.', f.fangArt)}
        ${line('Hersteller', f.fangHersteller)}
        <span class="prow2">${line('Typ', f.fangTyp)}${line('Prüf-Nr.', f.fangPruefNr, '', 'short')}</span>
        <span class="prow2">${line('Fangkraft', f.fangkraft, 'N;')}${line('Fangmoment', f.fangmoment, 'Nm', 'short')}</span>
      </div>
    </div>

    <div class="pgrid">
      <div class="pleft">
        ${checklist(LEFT, ans)}
        <div class="pfree"></div>
      </div>
      <div class="pright">
        ${checklist(RIGHT, ans)}
        <div class="prem">
          <div class="premh">Bemerkungen/ Festgestellte Mängel:</div>
          ${remarkRows.map(r => `<div class="premrow">${r ? ink(r) : ''}</div>`).join('')}
        </div>
        <p class="pdisc">${tpl.disclaimer.map(esc).join('<br>')}</p>
      </div>
    </div>

    <footer class="psig">
      <div><div class="psigval">${ink([insp.ort, insp.datum].filter(Boolean).join(' '))}</div><div class="psiglab">Ort, Datum</div></div>
      <div><div class="psigval">${insp.sig?.ag?.img ? `<img src="${insp.sig.ag.img}" alt="">` : ''}${insp.sig?.ag?.name ? `<span class="ink signame">${esc(insp.sig.ag.name)}</span>` : ''}</div><div class="psiglab">Unterschrift Auftraggeber</div></div>
      <div><div class="psigval">${insp.sig?.an?.img ? `<img src="${insp.sig.an.img}" alt="">` : ''}${insp.sig?.an?.name ? `<span class="ink signame">${esc(insp.sig.an.name)}</span>` : ''}</div><div class="psiglab">Unterschrift Auftragnehmer</div></div>
    </footer>
  </section>`;

  // Fotos zu Mängeln (gibt es auf Papier nicht): nur wenn vorhanden, als eigene Seite
  const page2 = photos.length ? `
  <section class="ppage pphotos">
    <h2>Fotos zu festgestellten Mängeln</h2>
    <p class="psub">${esc([objLines.join(', '), t.standort, insp.datum].filter(Boolean).join(' · '))}</p>
    <div class="pphgrid">${photos.map(p => `<figure><img src="${p.url}" alt=""><figcaption>${esc(p.caption)}</figcaption></figure>`).join('')}</div>
  </section>` : '';

  return page1 + page2;
}
