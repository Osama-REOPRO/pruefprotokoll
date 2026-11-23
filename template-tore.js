// Formular-Vorlage: "Prüfprotokoll für kraftbetätigte Tore gemäß ASR A1.7 und DIN 14677"
// Das Formular ist reine Daten. Weitere Formulare (z. B. Feuerschutztüren) werden als
// weitere Vorlage in derselben Form angelegt, ohne den App-Code zu ändern.
//
// Status je Prüfpunkt wie auf Papier: "ok" = o.B. (ohne Befund), "b" = B. (Befund/Mangel).
// Nicht angekreuzt bleibt leer, wie ein leeres Kästchen auf Papier.

export const TEMPLATE_TORE = {
  id: 'tore-asr-a17-din14677',
  version: 1,
  kind: 'tor',
  states: ['ok', 'b'],
  unit: { group: 'tor', noun: 'Tor', standort: 'standort', typ: 'typ', nr: 'fabrNr', nrLabel: 'Nr.' },
  title: 'Prüfprotokoll kraftbetätigte Tore',
  subtitle: 'ASR A1.7 und DIN 14677',

  // Stammdaten. "scope" sagt, wohin ein Feld gehört:
  // customer = Kunde, site = Objekt, gate = Tor (wird bei der nächsten Prüfung übernommen)
  header: [
    {
      id: 'kunde', title: 'Kunde', scope: 'customer', fields: [
        { key: 'name', label: 'Kunde', required: true },
        { key: 'zusatz', label: 'Zusatz (z. B. c/o Hausverwaltung)' },
        { key: 'strasse', label: 'Straße, Nr.' },
        { key: 'plzOrt', label: 'PLZ Ort' },
      ],
    },
    {
      id: 'objekt', title: 'Objekt', scope: 'site', fields: [
        { key: 'name', label: 'Objekt (Bezeichnung)' },
        { key: 'strasse', label: 'Straße, Nr.' },
        { key: 'plzOrt', label: 'PLZ Ort', required: true },
      ],
    },
    {
      id: 'tor', title: 'Tor', scope: 'gate', fields: [
        { key: 'standort', label: 'Standort / Lage', required: true, hint: 'z. B. Hofeinfahrt, EG Flur zum Büro' },
        { key: 'typ', label: 'Typ', suggest: ['Sektionaltor', 'Rolltor', 'Schiebetor', 'Stahlschiebetor', 'Drehflügeltor', 'Falttor', 'Schnelllauftor', 'T30', 'T90'] },
        { key: 'fabrNr', label: 'Fabr.-Nr.' },
        { key: 'bj', label: 'Baujahr', inputmode: 'numeric', half: true },
        { key: 'hersteller', label: 'Hersteller', half: true, suggest: ['Hörmann', 'Hotz', 'Novoferm', 'Teckentrup', 'Tousek'] },
        { key: 'abmessung', label: 'Panzer Abmess. (B x H in m)', inputmode: 'decimal', half: true },
        { key: 'gewicht', label: 'Gewicht', unit: 'kg', inputmode: 'decimal', half: true },
      ],
    },
    {
      id: 'antrieb', title: 'Antrieb', scope: 'gate', fields: [
        { key: 'antriebHersteller', label: 'Hersteller', half: true },
        { key: 'antriebTyp', label: 'Typ', half: true },
        { key: 'leistung', label: 'Leistung', unit: 'kW', inputmode: 'decimal', half: true },
        { key: 'drehzahl', label: 'Antriebsdrehzahl', inputmode: 'numeric', half: true },
        { key: 'spannung', label: 'Betriebsspannung', unit: 'V', inputmode: 'numeric', half: true, suggest: ['230', '400'] },
        { key: 'steuerspannung', label: 'Steuerspannung', unit: 'V', inputmode: 'numeric', half: true, suggest: ['24'] },
      ],
    },
    {
      id: 'fang', title: 'Sicherung gegen Abstürzen des Panzers', scope: 'gate', optional: true, fields: [
        { key: 'fangArt', label: 'Art der Fangvorrichtung', suggest: ['Sperrklinke', 'Fangvorrichtung', 'Federbruchsicherung'] },
        { key: 'fangHersteller', label: 'Hersteller', half: true },
        { key: 'fangTyp', label: 'Typ', half: true },
        { key: 'fangPruefNr', label: 'Prüf-Nr.', half: true },
        { key: 'fangkraft', label: 'Fangkraft', unit: 'N', inputmode: 'numeric', half: true },
        { key: 'fangmoment', label: 'Fangmoment', unit: 'Nm', inputmode: 'numeric', half: true },
      ],
    },
  ],

  // Prüfpunkte. "extra" = zusätzliche Angabe in der Zeile (Auswahl oder Text).
  sections: [
    { id: 'panzer', title: 'Panzer / Torblatt / Gitter', items: [
      { id: 'panzer.zustand', label: 'Zustand / Verschleiß' },
      { id: 'panzer.sturm', label: 'Seitenarretierung / Sturmanker / Sturmrollen' },
      { id: 'panzer.aufhaengung', label: 'Aufhängung / Befestigungsschrauben' },
      { id: 'panzer.scharniere', label: 'Scharniere' },
      { id: 'panzer.schlupftuer', label: 'Schlupftür' },
    ]},
    { id: 'fangvorr', title: 'Abrollsicherung: Fangvorrichtung und E-Abschaltung', items: [
      { id: 'fangvorr.zustand', label: 'Befestigung / Zustand / Verschleiß / Korrosion / Gängigkeit / bewegliche Teile' },
      { id: 'fangvorr.zwangstrenner', label: 'Zwangstrenner' },
      { id: 'fangvorr.schild', label: 'Schild, Vollständigkeit, Lesbarkeit' },
      { id: 'fangvorr.passfeder', label: 'Passfeder' },
    ]},
    { id: 'federn', title: 'Federn', items: [
      { id: 'federn.befestigung', label: 'Befestigung / Zustand und Funktion' },
      { id: 'federn.verschleiss', label: 'Verschleiß / Korrosion' },
    ]},
    { id: 'kette', title: 'Kettenrad und Kette', altTitles: ['Zahnstange'], items: [
      { id: 'kette.fluchten', label: 'Kette, fluchten und Verschleiß' },
      { id: 'kette.spannung', label: 'Kettenspannung, ggf. Nachspannen' },
      { id: 'kette.schmieren', label: 'Kette säubern und schmieren' },
      { id: 'kette.schutz', label: 'Kettenschutz' },
      { id: 'kette.raeder', label: 'Kettenräder; Verschleiß; fester Sitz' },
    ]},
    { id: 'steuerung', title: 'Schaltautomat und Steuergeräte', items: [
      { id: 'steuerung.hauptschalter', label: 'Hauptschalter abschließbar / Netztrennung' },
      { id: 'steuerung.motorschutz', label: 'Motorschutz / Thermopille' },
      { id: 'steuerung.endschalter', label: 'Endschalter / Not-Austaster', extra: { type: 'multi', options: ['Endschalter', 'Not-Austaster'] } },
      { id: 'steuerung.klemmstellen', label: 'Klemmstellen' },
      { id: 'steuerung.bedienelemente', label: 'Funktion Bedienelemente' },
      { id: 'steuerung.schliesskante', label: 'Schließkantensicherung' },
      { id: 'steuerung.klappen', label: 'Tür- und Wandklappenüberwachung' },
      { id: 'steuerung.zwangstrennerFang', label: 'Zwangstrenner am Fang' },
      { id: 'steuerung.einzug', label: 'Einzugssicherung' },
      { id: 'steuerung.lichtschranke', label: 'Staulichtschranke' },
    ]},
    { id: 'feststell', title: 'Feststellanlage', items: [
      { id: 'feststell.akku', label: 'Akku Typ / Bj. / Zustand', extra: { type: 'text', placeholder: 'z. B. YUASA 12V 17Ah, 2021' } },
      { id: 'feststell.anlage', label: 'Feststellanlage Typ / Hersteller', extra: { type: 'text', placeholder: 'z. B. FHK-I' } },
      { id: 'feststell.ausloese', label: 'Auslöseelemente Typ / Hersteller / Anzahl / Anordnung', extra: { type: 'text', placeholder: 'z. B. 2x ORM 130 A, HAT 2 Stück' } },
    ]},
    { id: 'schilder', title: 'Beschilderung', items: [
      { id: 'schilder.typenschild', label: 'Typenschild' },
      { id: 'schilder.hinweis', label: 'Hersteller- und Bedienschild, Hinweisschild' },
    ]},
    { id: 'antrieb', title: 'Antrieb', items: [
      { id: 'antrieb.befestigung', label: 'Motor-, Konsolenbefestigung' },
      { id: 'antrieb.notentriegelung', label: 'Notentriegelung' },
      { id: 'antrieb.verriegelung', label: 'Elektrische Verriegelung' },
      { id: 'antrieb.endschalter', label: 'Endschalter', extra: { type: 'single', options: ['NES', 'DES'] } },
      { id: 'antrieb.nothand', label: 'Nothandbedienung' },
      { id: 'antrieb.geraeusche', label: 'Geräusche und Dichtigkeit' },
    ]},
    { id: 'welle', title: 'Welle', items: [
      { id: 'welle.schweiss', label: 'Schweißnähte Achszapfen / Konsole' },
      { id: 'welle.lager', label: 'Lager, Stellringe' },
      { id: 'welle.konsole', label: 'Befestigung der Lagerkonsole' },
    ]},
    { id: 'schienen', title: 'Führungsschienen und Laufschienen', items: [
      { id: 'schienen.befestigung', label: 'Befestigung, Zustand' },
      { id: 'schienen.schmierung', label: 'Verschleiß, Schmierung' },
      { id: 'schienen.einlauf', label: 'Einlauftrichter / Einlauf' },
      { id: 'schienen.rollen', label: 'Führungs- und Laufrollen' },
      { id: 'schienen.seile', label: 'Seile / Seilrollen / Gurte / Förderkette / Zahnriemen' },
      { id: 'schienen.gegengewicht', label: 'Gegengewicht / Gegengewichtskasten' },
      { id: 'schienen.daempfung', label: 'Dämpfungsregler / Freilauf' },
      { id: 'schienen.anschlag', label: 'Anschlagdämpfer' },
      { id: 'schienen.dichtungen', label: 'Kunststoffeinlagen / Dichtungen' },
      { id: 'schienen.klappen', label: 'Wand- und Deckenklappen' },
    ]},
  ],

  // Schnellbausteine für Mängel (antippen statt tippen)
  defectChips: ['defekt', 'verschlissen', 'fehlt', 'lose', 'korrodiert', 'muss getauscht werden', 'nachgestellt', 'geschmiert', 'Angebot folgt'],

  disclaimer: [
    'Die Prüfung wurde nach bestem Wissen und Gewissen durchgeführt.',
    'Für versteckte Mängel, die bei der Anwendung der erforderlichen Sorgfalt nicht zu erkennen sind, wird eine Haftung ausgeschlossen.',
    'Der Betreiber hat die Mängelbeseitigung umgehend zu veranlassen.',
  ],
};
