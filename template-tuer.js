// Formular-Vorlage: "Abnahme- / Inbetriebnahme- & Prüfprotokoll" für Feuer- und Rauchschutztüren.
// Gleiche Form wie template-tore.js. Unterschied: drei Antworten je Prüfpunkt wie auf Papier
// (o.B. = ohne Befund, B. = Befund, n.v. = nicht vorhanden). Leer lassen ist weiterhin erlaubt.
import { TEMPLATE_TORE } from './template-tore.js';

const kunde = TEMPLATE_TORE.header.find(g => g.id === 'kunde');
const objekt = TEMPLATE_TORE.header.find(g => g.id === 'objekt');

export const TEMPLATE_TUER = {
  id: 'tuer-abnahme-pruefung',
  version: 1,
  kind: 'tuer',
  title: 'Abnahme- / Inbetriebnahme- & Prüfprotokoll',
  subtitle: 'Türen',
  states: ['ok', 'b', 'nv'],
  // Welche Felder ein Element in Listen beschreiben
  unit: { group: 'tuer', noun: 'Tür', standort: 'standort', typ: 'typ', nr: 'tuerNr', nrLabel: 'Tür-Nr.' },

  header: [
    kunde,
    objekt,
    {
      id: 'tuer', title: 'Tür', scope: 'gate', fields: [
        { key: 'standort', label: 'Standort / Lage', required: true, hint: 'z. B. 1. OG Treppenhaus Nord' },
        { key: 'tuerNr', label: 'Tür-Nr.', half: true },
        { key: 'fluegel', label: 'Anzahl der Flügel', inputmode: 'numeric', half: true, suggest: ['1', '2'] },
        { key: 'art', label: 'Art der Prüfung', type: 'choice', options: ['Inbetriebnahme', 'Abnahme', 'Wartung'], perInspection: true },
        { key: 'bauart', label: 'Bauart', type: 'choice', options: ['Rohrrahmen-Türen', 'Stahlblechtüren', 'Holztür'] },
        { key: 'funktion', label: 'Funktion', type: 'choice', options: ['Brandschutztür', 'Rauchschutztür', 'Kombiniert RS/BS'] },
        { key: 'klasse', label: 'Klasse', type: 'choice', options: ['T30', 'T90', 'sonstige'] },
        { key: 'klasseSonst', label: 'sonstige Klasse', showIf: ['klasse', 'sonstige'] },
      ],
    },
    {
      id: 'grund', title: 'Grunddaten Tür', scope: 'gate', fields: [
        { key: 'typ', label: 'Typ', hint: 'z. B. T30-2 WT' },
        { key: 'hersteller', label: 'Hersteller', half: true, suggest: ['Hörmann', 'Novoferm', 'Teckentrup', 'Schörghuber'] },
        { key: 'fabrNr', label: 'Fabr.-Nr.', half: true },
        { key: 'bj', label: 'Baujahr', inputmode: 'numeric', half: true },
      ],
    },
  ],

  sections: [
    { id: 'allg', title: '1. Allgemein', items: [
      { id: 'allg.einbau', label: 'Sichtkontrolle der Einbausituation' },
      { id: 'allg.schliess', label: 'Schließfunktion prüfen' },
      { id: 'allg.blatt', label: 'Sichtkontrolle von Türblatt und Zarge' },
      { id: 'allg.schild', label: 'Kennzeichnungsschild(er)', extra: { type: 'single', options: ['ja', 'nein'] } },
    ]},
    { id: 'schloss', title: '2. Schloss', items: [
      { id: 'schloss.beschlag', label: 'Schloss, Garnitur und Beschläge prüfen ggf. nachziehen' },
      { id: 'schloss.funktion', label: 'Schließfunktion kontrollieren u. justieren' },
    ]},
    { id: 'mitnehmer', title: '3. Mitnehmerklappe (2 flg. Türen m. Panikausführung)', items: [
      { id: 'mitnehmer.voreilung', label: 'Voreilung d. Gangflügels prüfen, nachstellen + fetten (Rolle <1mm)' },
      { id: 'mitnehmer.befestigung', label: 'Befestigung prüfen ggf. nachziehen' },
    ]},
    { id: 'baender', title: '4. Bänder', items: [
      { id: 'baender.sitz', label: 'Befestigung und Sitz/Flucht kontrollieren' },
      { id: 'baender.fetten', label: 'Banddorne fetten' },
    ]},
    { id: 'blatt', title: '5. Türblatt', items: [
      { id: 'blatt.bolzen', label: 'Sicherungsbolzen vorhanden und Sitz (fest)' },
    ]},
    { id: 'schliesser', title: '6. Schließmittel Türschließer', items: [
      { id: 'schliesser.befestigung', label: 'Türschließerbefestigungen überprüfen ggf. nachziehen' },
      { id: 'schliesser.vorgang', label: 'Schließvorgang prüfen ggf. einstellen' },
      { id: 'schliesser.kraft', label: 'Schließkraft u. -geschwindigkeit prüfen ggf. einstellen' },
      { id: 'schliesser.endschlag', label: 'Endschlag kontrollieren und ggf. einstellen' },
      { id: 'schliesser.folge', label: 'Schließfolgeregler prüfen ggf. einstellen' },
      { id: 'schliesser.30', label: 'Funktionskontrolle aus 30° und ggf. justieren' },
    ]},
    { id: 'federband', title: '7. Schließmittel Federband (falls vorhanden)', items: [
      { id: 'federband.einstellen', label: 'Federband einstellen (Stahlblechtüren)' },
      { id: 'federband.fetten', label: 'Federbanddorne fetten und spannen' },
    ]},
    { id: 'dicht', title: '8. Luftspalte und Dichtungen', items: [
      { id: 'dicht.luftspalt', label: 'Umlaufende + mittige Luftspalte gemäß Zulassung prüfen' },
      { id: 'dicht.zarge', label: 'Zargen- und Bodendichtung auf Beschädigungen prüfen' },
      { id: 'dicht.einlagen', label: 'Aufschäumende Einlagen prüfen' },
      { id: 'dicht.bolzen', label: 'Einschubbolzen d. Bodendichtung fetten + Funktion prüfen' },
      { id: 'dicht.anlage', label: 'Türblatt/-blätter liegen an der Dichtung an' },
    ]},
    { id: 'glas', title: '9. Glaselemente', items: [
      { id: 'glas.halteleisten', label: 'Befestig. + Halteleisten überprüf. ggf. nachziehen' },
      { id: 'glas.scheiben', label: 'Scheiben auf Einläufe u. Sprünge überprüfen' },
    ]},
    { id: 'elektro', title: '10. Elektrische Anbauteile', items: [
      { id: 'elektro.oeffner', label: 'Elektr. Türöffner vorhanden prüfen ggf. justieren' },
      { id: 'elektro.antrieb', label: 'Drehflügelantrieb prüfen ggf. justieren' },
      { id: 'elektro.typ', label: 'Typ', noStatus: true },
      { id: 'elektro.bedien', label: 'Bedien-/ Ansteuerelemente', noStatus: true },
    ]},
    { id: 'feststell', title: '11. Feststellanlage', items: [
      { id: 'fst.hersteller', label: 'Hersteller', noStatus: true },
      { id: 'fst.typ', label: 'Typ', noStatus: true },
      { heading: 'Rauchmelder' },
      { id: 'fst.rm.anzahl', label: 'Anzahl', noStatus: true, inputmode: 'numeric' },
      { id: 'fst.rm.typ', label: 'Typ', noStatus: true },
      { id: 'fst.rm.dibt', label: 'Anordnung gemäß DiBT', noStatus: true, choice: ['ja', 'nein'] },
      { heading: 'Handauslöser' },
      { id: 'fst.ha.anzahl', label: 'Anzahl', noStatus: true, inputmode: 'numeric' },
      { id: 'fst.ha.typ', label: 'Typ', noStatus: true },
      { id: 'fst.ha.anordnung', label: 'Anordnung', noStatus: true },
      { heading: 'Haltemagnet' },
      { id: 'fst.hm.typ', label: 'Typ', noStatus: true },
      { id: 'fst.hm.befestigung', label: 'Befestigung' },
    ]},
  ],

  defectChips: ['defekt', 'verschlissen', 'fehlt', 'lose', 'schleift', 'beschädigt', 'muss getauscht werden', 'nachgestellt', 'gefettet', 'justiert', 'Angebot folgt'],

  disclaimer: [
    '* Die Prüfung und Wartung wurde nach besten Wissen und Gewissen durchgeführt.',
    'Für versteckte Mängel, die bei der Anwendung der erforderlichen Sorgfalt nicht zu erkennen sind, wird Haftung ausgeschlossen.',
    '** Der Betreiber hat die Mängelbeseitigung umgehend zu veranlassen. Ausführung darf nur durch ein Fachunternehmen erfolgen.',
  ],
};
