// Sprache der Oberfläche: Deutsch (Standard) oder Englisch.
// Die App schreibt alle Texte auf Deutsch. Ist Englisch gewählt, übersetzt diese Datei die angezeigten Texte
// direkt im Bildschirm (Textknoten, Platzhalter, Beschriftungen). Gespeicherte Werte bleiben deutsch,
// und der Ausdruck (.ppage) wird nie übersetzt: das Papierformular bleibt deutsch.

const EN = {
  // Allgemein / Navigation
  'Prüfprotokolle': 'Inspection reports', 'Neuer Termin': 'New appointment', 'Termine': 'Appointments', 'Termin': 'Appointment',
  'Erledigt': 'Done', 'Einzelne Prüfungen': 'Single inspections', 'Weitermachen': 'Continue', 'Heute': 'Today',
  'Noch keine Termine. Im Büro einen Termin anlegen: Kunde, Objekt und die Tore eintragen. Vor Ort dann nur noch die Checkliste.':
    'No appointments yet. In the office, create an appointment: enter customer, site and the gates. On site you then only do the checklist.',
  'Alles wird nur auf diesem Handy gespeichert und funktioniert auch ohne Netz.': 'Everything is stored only on this phone and works offline.',
  'Schriftgröße': 'Text size', 'Darstellung': 'Appearance', 'Sprache': 'Language', 'Übersicht': 'Overview', 'Zur Übersicht': 'To overview',
  'Zum Termin': 'To appointment', 'Mehr': 'More', 'Abbrechen': 'Cancel', 'Schließen': 'Close', 'Löschen': 'Delete', 'Entfernen': 'Remove',
  '⇅ Termin empfangen (Datei öffnen)': '⇅ Receive appointment (open file)', '📤 Termin senden (an Handy / Laptop)': '📤 Send appointment (to phone / laptop)',
  'Neuer Termin übernommen.': 'New appointment received.', 'Nichts Neues, alles schon aktuell.': 'Nothing new, already up to date.', 'Nichts überschrieben: hier ist schon der neuere Stand.': 'Nothing overwritten: this device already has the newer version.',
  'Die Datei ist kein Termin aus dieser App.': 'This file is not an appointment from this app.',
  'Gesendet. Auf dem anderen Gerät „Termin empfangen“ tippen.': 'Sent. On the other device tap “Receive appointment”.',
  'Datei gespeichert. Per Mail, WhatsApp oder AirDrop an das andere Gerät schicken und dort „Termin empfangen“ tippen.': 'File saved. Send it to the other device by mail, WhatsApp or AirDrop and tap “Receive appointment” there.',
  'Offene Termine': 'Open appointments',
  'Tore': 'Gates',
  'Fortschritt': 'Progress',
  'Mängel': 'Defects',
  'Art': 'Type',
  'Nr.': 'No.',
  'Bj.': 'Year',
  'Status': 'Status',
  'Kunde · Objekt': 'Customer · Site',
  '✎ Termin bearbeiten': '✎ Edit appointment',
  '📤 Senden': '📤 Send',
  '🖨 Drucken': '🖨 Print',
  '‹ Zum Termin': '‹ To appointment',
  '‹ Übersicht': '‹ Overview',
  'Öffnen ›': 'Open ›',
  'siehe unten': 'see below',
  'Prüfpunkt': 'Check item',
  'Notiz (steht neben dem Kästchen)': 'Note (printed next to the box)',
  'Keine offenen Termine': 'No open appointments',
  '＋ Tor': '＋ Gate',
  '＋ Tür': '＋ Door',
  '⇅ Termin empfangen': '⇅ Receive appointment',
  '▤ Übersicht': '▤ Overview',
  '📖 Feldhandbuch': '📖 Field guide',
  'Termin senden': 'Send appointment',
  '📷 Foto': '📷 Photo',
  'Keine offenen Termine. Mit „＋ Neuer Termin“ anlegen oder eine Datei vom Handy empfangen (auch per Ziehen ins Fenster).': 'No open appointments. Create one with “＋ New appointment” or receive a file from the phone (you can also drag it into the window).',
  'Noch keine Tore oder Türen. Oben mit „＋ Tor“ oder „＋ Tür“ hinzufügen.': 'No gates or doors yet. Add them with “＋ Gate” or “＋ Door” above.',
  'Tor / Tür': 'Gate / door',
  'Feldhandbuch': 'Field guide', 'Handbuch': 'Guide', 'Kapitel': 'Chapters', 'Abschnitte': 'Sections',
  'Im Handbuch suchen (z. B. Feder, SKS, Luftspalt)': 'Search the guide (e.g. Feder, SKS, Luftspalt)',
  'Im Handbuch nachlesen': 'Read in the field guide', 'Nichts gefunden.': 'Nothing found.', 'Bild schließen': 'Close image',
  'Handbuch schließen': 'Close guide', 'Inhalt': 'Contents', 'Feldhandbuch Tore & Türen': 'Field guide gates & doors',
  'Antippen zum Vergrößern': 'Tap to enlarge', 'Handbuch öffnen': 'Open field guide',
  'Zurück': 'Back', 'Weiter': 'Next', 'Fertig': 'Done', 'Nächstes': 'Next', 'Zur Prüfung': 'Start inspection', 'Abschließen': 'Finish',
  'gespeichert': 'saved', 'Rückgängig': 'Undo', 'Gelöscht.': 'Deleted.', 'Nichts gefunden.': 'Nothing found.',
  'Was wird geprüft?': 'What is being inspected?', 'Prüfprotokoll kraftbetätigte Tore (ASR A1.7, DIN 14677)': 'Inspection report for power-operated gates (ASR A1.7, DIN 14677)',
  'Formular folgt, sobald das Türformular vorliegt': 'Form follows once the door form is available',
  'noch keine Tore': 'no gates yet', 'in Arbeit': 'in progress', 'offen': 'open', 'Noch keine Angaben': 'No details yet', 'Neue Prüfung': 'New inspection',
  'Neuer Termin ': 'New appointment',

  // Termin
  'Termin vorbereiten': 'Prepare appointment', 'Datum': 'Date', 'Bekanntes Objekt?': 'Known site?', 'Suchen: Kunde, Straße, Ort': 'Search: customer, street, city',
  'Tore und Türen in diesem Termin': 'Gates and doors in this appointment', 'Schon bekannt an diesem Objekt': 'Already known at this site',
  'Neues Tor': 'New gate', 'Neue Tür': 'New door', 'Tor': 'Gate', 'Tür': 'Door', 'Türen': 'Doors', 'Daten eintragen': 'Enter details',
  'Noch keine Tore oder Türen in diesem Termin.': 'No gates or doors in this appointment yet.', 'Termin bearbeiten': 'Edit appointment',
  'Termin löschen': 'Delete appointment', 'Alle Protokolle drucken': 'Print all reports', 'Protokoll drucken / PDF': 'Print report / PDF',
  'Alle Tore dieses Termins sind fertig.': 'All gates of this appointment are done.', 'Tor ohne Standort': 'Gate without location', 'Tür ohne Standort': 'Door without location',
  'ohne Standort': 'without location', 'Kopie': 'Copy', 'Nächstes Tor hier': 'Next gate here',

  // Kopf / Stammdaten
  'Stammdaten': 'Basic data', 'Kunde': 'Customer', 'Objekt': 'Site', 'Objekt (Bezeichnung)': 'Site (name)', 'Zusatz (z. B. c/o Hausverwaltung)': 'Addition (e.g. c/o property management)',
  'Straße, Nr.': 'Street, no.', 'PLZ Ort': 'Postcode, city', 'Standort / Lage': 'Location', 'Typ': 'Type', 'Fabr.-Nr.': 'Serial no.', 'Baujahr': 'Year built',
  'Hersteller': 'Manufacturer', 'Panzer Abmess. (B×H m)': 'Curtain size (W×H m)', 'Gewicht': 'Weight', 'Antrieb': 'Drive', 'Leistung': 'Power',
  'Antriebsdrehzahl': 'Drive speed', 'Betriebsspannung': 'Operating voltage', 'Steuerspannung': 'Control voltage',
  'Sicherung gegen Abstürzen des Panzers': 'Fall protection for the curtain', 'Art der Fangvorrichtung': 'Type of safety catch', 'Sperrklinke': 'Pawl',
  'Fangvorrichtung': 'Safety catch', 'Federbruchsicherung': 'Spring break protection', 'Prüf-Nr.': 'Test no.', 'Fangkraft': 'Catch force', 'Fangmoment': 'Catch torque',
  'Sektionaltor': 'Sectional door', 'Rolltor': 'Roller door', 'Schiebetor': 'Sliding gate', 'Stahlschiebetor': 'Steel sliding gate', 'Drehflügeltor': 'Swing gate',
  'Falttor': 'Folding door', 'Schnelllauftor': 'High-speed door',
  'z. B. Hofeinfahrt, EG Flur zum Büro': 'e.g. yard entrance, ground floor corridor to office', 'z. B. 1. OG Treppenhaus Nord': 'e.g. 1st floor north stairwell',
  'z. B. T30-2 WT': 'e.g. T30-2 WT', 'Tür-Nr.': 'Door no.', 'Anzahl der Flügel': 'Number of leaves', 'Art der Prüfung': 'Type of inspection',
  'Inbetriebnahme': 'Commissioning', 'Abnahme': 'Acceptance', 'Wartung': 'Maintenance', 'Bauart': 'Construction', 'Rohrrahmen-Türen': 'Tubular frame doors',
  'Stahlblechtüren': 'Sheet steel doors', 'Holztür': 'Wooden door', 'Funktion': 'Function', 'Brandschutztür': 'Fire door', 'Rauchschutztür': 'Smoke door',
  'Kombiniert RS/BS': 'Combined smoke/fire', 'Klasse': 'Class', 'sonstige': 'other', 'sonstige Klasse': 'other class', 'Grunddaten Tür': 'Door basic data',
  'Daten': 'Details', 'Daten bearbeiten': 'Edit details',
  'Kunde und Objekt kommen vom Termin:': 'Customer and site come from the appointment:',
  'Oder Daten unten prüfen und dann Abschnitt für Abschnitt bestätigen.': 'Or check the details below and confirm section by section.',
  'Daten vom letzten Mal übernommen. Nur prüfen, was sich geändert hat.': 'Details taken over from last time. Only check what has changed.',
  'Alle Häkchen, Angaben und Mängelbeschreibungen übernehmen und direkt zum Abschluss.': 'Take over all ticks, details and defect descriptions and go straight to finishing.',
  'Alles wie letztes Mal': 'Everything as last time', 'Wie letztes Mal': 'Same as last time', 'letztes Mal': 'last time',

  // Prüfzeilen
  'o.B.': 'OK', 'B.': 'Defect', 'n.v.': 'N/A', 'Rest o.B.': 'Rest OK', 'Geprüft': 'Checked', 'Leeren': 'Clear', 'Abschnitt geleert (Häkchen, Notizen, Fotos)': 'Section cleared (ticks, notes, photos)', 'Alle Häkchen, Notizen und Fotos dieses Abschnitts entfernen': 'Remove all ticks, notes and photos in this section', 'übernehmen': 'add', 'übernommen': 'added', 'Bemerkungen für das Protokoll': 'Remarks for the protocol', 'Punkte mit B. (die Notiz steht schon neben dem Kästchen). Bei Bedarf in die Bemerkungen übernehmen:': 'Rows marked defect (the note is already printed next to the box). Add to the remarks if needed:', 'Abschnitt als geprüft markieren': 'Mark section as checked', 'Check und weiter': 'Check and next', 'alle Punkte ausgefüllt': 'all rows filled', 'nochmal tippen zum Zurücknehmen': 'tap again to undo', 'nochmal klicken zum Zurücknehmen': 'click again to undo', 'Notiz': 'Note', 'Notiz zu dieser Zeile': 'Note for this row',
  'Mangel beschreiben, steht auf dem Ausdruck neben der Zeile': 'Describe the defect (printed next to the row)', 'Foto aufnehmen': 'Take photo', 'Foto löschen': 'Delete photo',
  'ja': 'yes', 'nein': 'no', 'trifft nicht zu': 'not applicable',
  'defekt': 'defective', 'verschlissen': 'worn', 'fehlt': 'missing', 'lose': 'loose', 'korrodiert': 'corroded', 'muss getauscht werden': 'must be replaced',
  'nachgestellt': 'readjusted', 'geschmiert': 'lubricated', 'Angebot folgt': 'quote to follow', 'schleift': 'grinds', 'beschädigt': 'damaged', 'gefettet': 'greased', 'justiert': 'adjusted',

  // Tor-Abschnitte
  'Panzer / Torblatt / Gitter': 'Curtain / door leaf / grille', 'Zustand / Verschleiß': 'Condition / wear', 'Seitenarretierung / Sturmanker / Sturmrollen': 'Side locks / wind anchors / wind rollers',
  'Aufhängung / Befestigungsschrauben': 'Suspension / fixing screws', 'Scharniere': 'Hinges', 'Schlupftür': 'Wicket door',
  'Abrollsicherung: Fangvorrichtung und E-Abschaltung': 'Unroll protection: safety catch and electrical cut-off',
  'Befestigung / Zustand / Verschleiß / Korrosion / Gängigkeit / bewegliche Teile': 'Fixing / condition / wear / corrosion / smooth running / moving parts',
  'Zwangstrenner': 'Positive-break switch', 'Schild, Vollständigkeit, Lesbarkeit': 'Label, completeness, legibility', 'Passfeder': 'Feather key',
  'Federn': 'Springs', 'Befestigung / Zustand und Funktion': 'Fixing / condition and function', 'Verschleiß / Korrosion': 'Wear / corrosion',
  'Kettenrad und Kette': 'Sprocket and chain', 'Kette, fluchten und Verschleiß': 'Chain, alignment and wear', 'Kettenspannung, ggf. Nachspannen': 'Chain tension, retension if needed',
  'Kette säubern und schmieren': 'Clean and lubricate chain', 'Kettenschutz': 'Chain guard', 'Kettenräder; Verschleiß; fester Sitz': 'Sprockets; wear; tight fit',
  'Schaltautomat und Steuergeräte': 'Control unit and switchgear', 'Hauptschalter abschließbar / Netztrennung': 'Lockable main switch / mains isolation',
  'Motorschutz / Thermopille': 'Motor protection / thermal switch', 'Endschalter / Not-Austaster': 'Limit switch / emergency stop', 'Endschalter': 'Limit switch',
  'Not-Austaster': 'Emergency stop', 'Klemmstellen': 'Terminals', 'Funktion Bedienelemente': 'Function of controls', 'Schließkantensicherung': 'Closing edge safety',
  'Tür- und Wandklappenüberwachung': 'Door and wall flap monitoring', 'Zwangstrenner am Fang': 'Positive-break switch at catch', 'Einzugssicherung': 'Draw-in protection',
  'Staulichtschranke': 'Light barrier', 'Feststellanlage': 'Hold-open system', 'Akku Typ / Bj. / Zustand': 'Battery type / year / condition',
  'z. B. YUASA 12V 17Ah, 2021': 'e.g. YUASA 12V 17Ah, 2021', 'Feststellanlage Typ / Hersteller': 'Hold-open system type / manufacturer', 'z. B. FHK-I': 'e.g. FHK-I',
  'Auslöseelemente Typ / Hersteller / Anzahl / Anordnung': 'Release devices type / manufacturer / number / arrangement', 'z. B. 2x ORM 130 A, HAT 2 Stück': 'e.g. 2x ORM 130 A, HAT 2 pcs',
  'Beschilderung': 'Signage', 'Typenschild': 'Type plate', 'Hersteller- und Bedienschild, Hinweisschild': 'Manufacturer and operating label, notice sign',
  'Motor-, Konsolenbefestigung': 'Motor and bracket fixing', 'Notentriegelung': 'Emergency release', 'Elektrische Verriegelung': 'Electric locking',
  'Nothandbedienung': 'Manual emergency operation', 'Geräusche und Dichtigkeit': 'Noise and tightness', 'Welle': 'Shaft',
  'Schweißnähte Achszapfen / Konsole': 'Welds axle journal / bracket', 'Lager, Stellringe': 'Bearings, collars', 'Befestigung der Lagerkonsole': 'Bearing bracket fixing',
  'Führungsschienen und Laufschienen': 'Guide rails and running rails', 'Befestigung, Zustand': 'Fixing, condition', 'Verschleiß, Schmierung': 'Wear, lubrication',
  'Einlauftrichter / Einlauf': 'Entry funnel / entry', 'Führungs- und Laufrollen': 'Guide and running rollers', 'Seile / Seilrollen / Gurte / Förderkette / Zahnriemen': 'Cables / pulleys / belts / conveyor chain / toothed belt',
  'Gegengewicht / Gegengewichtskasten': 'Counterweight / counterweight box', 'Dämpfungsregler / Freilauf': 'Damping regulator / freewheel', 'Anschlagdämpfer': 'End stop buffers',
  'Kunststoffeinlagen / Dichtungen': 'Plastic inserts / seals', 'Wand- und Deckenklappen': 'Wall and ceiling flaps',

  // Tür-Abschnitte
  '1. Allgemein': '1. General', 'Sichtkontrolle der Einbausituation': 'Visual check of installation', 'Schließfunktion prüfen': 'Check closing function',
  'Sichtkontrolle von Türblatt und Zarge': 'Visual check of door leaf and frame', 'Kennzeichnungsschild(er)': 'Identification plate(s)',
  '2. Schloss': '2. Lock', 'Schloss, Garnitur und Beschläge prüfen ggf. nachziehen': 'Check lock, handle set and fittings, tighten if needed',
  'Schließfunktion kontrollieren u. justieren': 'Check and adjust closing function', '3. Mitnehmerklappe (2 flg. Türen m. Panikausführung)': '3. Carry bar (double doors with panic hardware)',
  'Voreilung d. Gangflügels prüfen, nachstellen + fetten (Rolle <1mm)': 'Check active leaf lead, readjust + grease (roller <1mm)', 'Befestigung prüfen ggf. nachziehen': 'Check fixing, tighten if needed',
  '4. Bänder': '4. Hinges', 'Befestigung und Sitz/Flucht kontrollieren': 'Check fixing and seat/alignment', 'Banddorne fetten': 'Grease hinge pins',
  '5. Türblatt': '5. Door leaf', 'Sicherungsbolzen vorhanden und Sitz (fest)': 'Security bolts present and tight', '6. Schließmittel Türschließer': '6. Closing device: door closer',
  'Türschließerbefestigungen überprüfen ggf. nachziehen': 'Check door closer fixings, tighten if needed', 'Schließvorgang prüfen ggf. einstellen': 'Check closing sequence, adjust if needed',
  'Schließkraft u. -geschwindigkeit prüfen ggf. einstellen': 'Check closing force and speed, adjust if needed', 'Endschlag kontrollieren und ggf. einstellen': 'Check latching action, adjust if needed',
  'Schließfolgeregler prüfen ggf. einstellen': 'Check closing sequence selector, adjust if needed', 'Funktionskontrolle aus 30° und ggf. justieren': 'Function check from 30°, adjust if needed',
  '7. Schließmittel Federband (falls vorhanden)': '7. Closing device: spring hinge (if present)', 'Federband einstellen (Stahlblechtüren)': 'Adjust spring hinge (sheet steel doors)',
  'Federbanddorne fetten und spannen': 'Grease and tension spring hinge pins', '8. Luftspalte und Dichtungen': '8. Gaps and seals',
  'Umlaufende + mittige Luftspalte gemäß Zulassung prüfen': 'Check perimeter and centre gaps per approval', 'Zargen- und Bodendichtung auf Beschädigungen prüfen': 'Check frame and floor seals for damage',
  'Aufschäumende Einlagen prüfen': 'Check intumescent strips', 'Einschubbolzen d. Bodendichtung fetten + Funktion prüfen': 'Grease floor seal trigger pin + check function',
  'Türblatt/-blätter liegen an der Dichtung an': 'Door leaf/leaves rest against the seal', '9. Glaselemente': '9. Glazing',
  'Befestig. + Halteleisten überprüf. ggf. nachziehen': 'Check fixing + glazing beads, tighten if needed', 'Scheiben auf Einläufe u. Sprünge überprüfen': 'Check panes for runs and cracks',
  '10. Elektrische Anbauteile': '10. Electrical components', 'Elektr. Türöffner vorhanden prüfen ggf. justieren': 'Electric door opener present, check, adjust if needed',
  'Drehflügelantrieb prüfen ggf. justieren': 'Check swing door operator, adjust if needed', 'Bedien-/ Ansteuerelemente': 'Controls / triggering devices',
  '11. Feststellanlage': '11. Hold-open system', 'Rauchmelder': 'Smoke detectors', 'Anzahl': 'Number', 'Anordnung gemäß DiBT': 'Arrangement per DIBt',
  'Handauslöser': 'Manual release', 'Anordnung': 'Arrangement', 'Haltemagnet': 'Holding magnet', 'Befestigung': 'Fixing',

  // Abschluss
  'Abschluss': 'Finish', 'leer': 'empty', 'Bemerkungen / Festgestellte Mängel': 'Remarks / defects found', 'Weitere Bemerkungen': 'Further remarks',
  'z. B. Ohne Mängel': 'e.g. No defects', 'Ohne Mängel': 'No defects', 'Kunde bittet um Angebot': 'Customer requests a quote', 'Ort': 'Place',
  'Unterschrift Auftraggeber': 'Customer signature', 'Unterschrift Auftragnehmer (Prüfer)': 'Contractor signature (inspector)',
  'Niemand vor Ort zum Unterschreiben': 'Nobody on site to sign', 'Name (z. B. i.A. Müller)': 'Name (e.g. p.p. Müller)', 'Ihr Name': 'Your name',
  'Meine gespeicherte Unterschrift einsetzen': 'Use my saved signature', 'Hier mit dem Finger unterschreiben': 'Sign here with your finger',
  'Name und Unterschrift für nächste Prüfungen merken': 'Remember name and signature for next inspections', 'Protokoll ansehen / drucken / PDF': 'View / print report / PDF',
  'Dieses Protokoll löschen': 'Delete this report', 'Prüfung abgeschlossen und gespeichert.': 'Inspection finished and saved.', 'Prüfer': 'Inspector', 'Auftraggeber': 'Customer',
  'Die Prüfung wurde nach bestem Wissen und Gewissen durchgeführt. Für versteckte Mängel, die bei der Anwendung der erforderlichen Sorgfalt nicht zu erkennen sind, wird eine Haftung ausgeschlossen. Der Betreiber hat die Mängelbeseitigung umgehend zu veranlassen.':
    'The inspection was carried out to the best of our knowledge. No liability is accepted for hidden defects that cannot be detected with due care. The operator must arrange for defects to be remedied without delay. (The printed form stays in German.)',
  '* Die Prüfung und Wartung wurde nach besten Wissen und Gewissen durchgeführt. Für versteckte Mängel, die bei der Anwendung der erforderlichen Sorgfalt nicht zu erkennen sind, wird Haftung ausgeschlossen. ** Der Betreiber hat die Mängelbeseitigung umgehend zu veranlassen. Ausführung darf nur durch ein Fachunternehmen erfolgen.':
    '* The inspection and maintenance were carried out to the best of our knowledge. No liability is accepted for hidden defects that cannot be detected with due care. ** The operator must arrange for defects to be remedied without delay. Work may only be carried out by a specialist company. (The printed form stays in German.)',

  // Menüs / Löschen
  'Stammdaten ': 'Basic data', 'Kopie anlegen (gleiche Häkchen)': 'Make a copy (same ticks)', 'Drucken / PDF': 'Print / PDF', 'Protokoll löschen': 'Delete report',
  'Objekt löschen': 'Delete site', 'Kunde löschen': 'Delete customer', 'Nicht mehr vorschlagen (löschen)': 'Stop suggesting (delete)', 'Endgültig löschen': 'Delete permanently',
  'Das lässt sich nicht rückgängig machen.': 'This cannot be undone.', 'Tür / Tor': 'Door / gate', 'Tür / Tor löschen': 'Delete door / gate',
  'Sie wird nicht mehr vorgeschlagen. Frühere Protokolle in alten Terminen bleiben erhalten.': 'It will no longer be suggested. Earlier reports in old appointments are kept.',
  'Kunde löschen?': 'Delete customer?', 'Objekt löschen?': 'Delete site?', 'Termin löschen?': 'Delete appointment?', 'Protokoll löschen?': 'Delete report?', 'Tür / Tor löschen?': 'Delete door / gate?',

  // Tastenkürzel
  'Tastenkürzel': 'Keyboard shortcuts', 'B. (Befund), danach direkt Notiz tippen': 'Defect, then type the note right away', 'n.v. (Türen)': 'N/A (doors)',
  'nächste Zeile': 'next row', 'vorige Zeile': 'previous row', 'Notiz zur Zeile': 'note for the row', 'nächster Abschnitt': 'next section', 'voriger Abschnitt': 'previous section',
  'Feld verlassen / Fenster schließen': 'leave field / close window', 'diese Hilfe': 'this help', 'alle Kürzel': 'all shortcuts', 'Zeile ·': 'row ·', 'Abschnitt ·': 'section ·',
  'Gilt beim Ausfüllen der Prüfpunkte. In Textfeldern wird normal getippt, Esc springt zurück.': 'Works while filling in the check rows. In text fields you type normally, Esc jumps back.',
  'Drucken / PDF ': 'Print / PDF',

  // Druckansicht (Leiste, nicht das Formular)
  'Fotos zu festgestellten Mängeln': 'Photos of defects found',
  'Alle': 'All', 'Paar': 'Pair', 'Neues Paar': 'New pair', 'Neue Tür: für welchen Kunden / welches Objekt?': 'New door: for which customer / site?',
  'Neues Tor: für welchen Kunden / welches Objekt?': 'New gate: for which customer / site?', 'Weiteres Paar im Termin anlegen': 'Add another pair to the appointment',
  'Tore und Türen für dieses Paar': 'Gates and doors for this pair', 'Noch keine Tore oder Türen.': 'No gates or doors yet.', 'ändern': 'change',
  'Mehrere Kunden oder Objekte in diesem Termin? Mit „＋ Paar“ ein weiteres Paar aus Kunde und Objekt anlegen.': 'Several customers or sites in this appointment? Use "＋ Pair" to add another customer + site pair.',
  'Paar (weiterer Kunde / weiteres Objekt)': 'Pair (another customer / site)', 'Kunde / Objekt ändern': 'Change customer / site',
  'Kunde und Objekt bleiben gespeichert.': 'Customer and site stay saved.', 'Paar löschen?': 'Remove pair?',
  'Oder weitertippen: neuer Kunde': 'Or keep typing: new customer', 'Oder weitertippen: neues Objekt': 'Or keep typing: new site',
};

const RULES = [
  [/^🖨 Alle (\d+) drucken$/, (m) => `🖨 Print all ${m[1]}`],
  [/^(\d+) Paare aus Kunde und Objekt$/, (m) => `${m[1]} customer / site pairs`],
  [/^(\d+) mit Mängeln$/, (m) => `${m[1]} with defects`],
  [/^Letztes Mal B\.(.*)$/, (m) => `Last time B.${m[1]}`],
  [/^Termin aktualisiert \((\d+) Änderungen\)\.(.*)$/, (m) => `Appointment updated (${m[1]} changes).${m[2] ? ' ' + tr(m[2].trim()) : ''}`],
  [/^Neuer Termin übernommen\. (\d+) × war hier neuer und bleibt\.$/, (m) => `New appointment received. ${m[1]} × was newer here and was kept.`],
  [/^(.*?) ?(\d+) × war hier neuer und bleibt\.$/, (m) => `${m[1] ? tr(m[1]) + ' ' : ''}${m[2]} × was newer here and was kept.`],
  [/^Paar aus Termin entfernen: (.*)$/, (m) => `Remove pair from appointment: ${m[1]}`],
  [/^Zugeordnet: (.*)$/, (m) => `Assigned: ${m[1]}`],
  [/^Kunde \/ Objekt für diese (Tür|Tor)$/, (m) => `Customer / site for this ${m[1] === 'Tür' ? 'door' : 'gate'}`],
  [/^Dabei wird auch gelöscht: (.+)\. Kunde und Objekt bleiben gespeichert\.$/, (m) => `This also deletes: ${m[1].replace(/(\d+) Protokolle?/, (x, n) => `${n} report${n === '1' ? '' : 's'}`)}. Customer and site stay saved.`],
  [/^(\d+) von (\d+) fertig$/, (m) => `${m[1]} of ${m[2]} done`],
  [/^(\d+) von (\d+) Punkten$/, (m) => `${m[1]} of ${m[2]} items`],
  [/^(\d+) mit Mängeln$/, (m) => `${m[1]} with defects`],
  [/^(\d+) Mängel$/, (m) => `${m[1]} defect${m[1] === '1' ? '' : 's'}`],
  [/^fertig · (\d+) Mängel$/, (m) => `done · ${m[1]} defect${m[1] === '1' ? '' : 's'}`],
  [/^fertig · o\.B\.$/, () => 'done · OK'],
  [/^(\d+) auf o\.B\. gesetzt$/, (m) => `${m[1]} set to OK`],
  [/^(\d+) Punkte wie am (.+) übernommen\.$/, (m) => `${m[1]} items taken over from ${m[2] === 'letzten Termin' ? 'the last appointment' : m[2]}.`],
  [/^Nichts geändert seit (.+)\?$/, (m) => `Nothing changed since ${m[1] === 'letztem Mal' ? 'last time' : m[1]}?`],
  [/^Letztes Mal B\.(?: \((.+)\))?:?$/, (m) => `Defect last time${m[1] ? ` (${m[1]})` : ''}:`],
  [/^\(letztes Mal: (.*)\)$/, (m) => `(last time: ${m[1]})`],
  [/^letztes Mal: (.*)$/, (m) => `last time: ${m[1]}`],
  [/^Mehr zu (.+)$/, (m) => `More about ${tr(m[1])}`],
  [/^Kunde löschen: (.*)$/, (m) => `Delete customer: ${m[1]}`],
  [/^Objekt löschen: (.*)$/, (m) => `Delete site: ${m[1]}`],
  [/^(Tür|Tor) aus diesem Termin löschen$/, (m) => `Remove ${m[1] === 'Tür' ? 'door' : 'gate'} from this appointment`],
  [/^(Tür|Tor) nicht mehr vorschlagen$/, (m) => `Stop suggesting this ${m[1] === 'Tür' ? 'door' : 'gate'}`],
  [/^(Tür|Tor) duplizieren \(gleiche Häkchen\)$/, (m) => `Duplicate ${m[1] === 'Tür' ? 'door' : 'gate'} (same ticks)`],
  [/^Alle (\d+) Protokolle drucken \/ PDF$/, (m) => `Print all ${m[1]} reports / PDF`],
  [/^Dabei wird auch gelöscht: (.+)\.$/, (m) => `This also deletes: ${m[1].replace(/(\d+) Objekte?/, (x, n) => `${n} site${n === '1' ? '' : 's'}`).replace(/(\d+) Türen und Tore|(\d+) Tür \/ Tor/, (x, a, b) => `${a || b} door${(a || b) === '1' ? '' : 's'}/gate${(a || b) === '1' ? '' : 's'}`).replace(/(\d+) Termine?/, (x, n) => `${n} appointment${n === '1' ? '' : 's'}`).replace(/(\d+) Protokolle?/, (x, n) => `${n} report${n === '1' ? '' : 's'}`)}.`],
  [/^Gespeichert\. Ohne Unterschrift (.+), kann später ergänzt werden\.$/, (m) => `Saved. Without signature of ${m[1].replace('Auftraggeber', 'customer').replace('Prüfer', 'inspector').replace(' und ', ' and ')}; can be added later.`],
  [/^Kopie angelegt\. Bitte Standort(?: und (.+))? eintragen\.$/, (m) => `Copy created. Please enter location${m[1] ? ' and ' + tr(m[1]) : ''}.`],
  [/^(Tür|Tor) · (.+)$/, (m) => `${tr(m[1])} · ${tr(m[2])}`],
  [/^(\d+) Protokolle\. (.*)$/, (m) => `${m[1]} reports. ${tr(m[2])}`],
  [/^Vorschau im Format A4\. .*$/, () => 'A4 preview. To save as PDF, choose "Save as PDF" or "Share" in the print menu. The form stays in German.'],
  [/^(\d+) \/ (\d+) · (.*)$/, (m) => `${m[1]} / ${m[2]} · ${m[3]}`],
];

// Zeichen vorne/hinten (Symbole, Pfeile), die beim Nachschlagen weggelassen werden
const SPLIT = /^([\s＋+✎🗑⧉🖨✓✗↶↺‹📷⌨·]*)(.*?)([\s›‹✓▾?:·*]*)$/u;

export let LANG = 'de';
try { LANG = JSON.parse(localStorage.getItem('s.lang') || '"de"') || 'de'; } catch {}

export function tr(text) {
  if (LANG !== 'en' || !text) return text;
  if (EN[text]) return EN[text];
  const m = text.match(SPLIT);
  if (m && m[2]) {
    if (EN[m[2]]) return m[1] + EN[m[2]] + m[3];
    for (const [re, fn] of RULES) { const r = m[2].match(re); if (r) return m[1] + fn(r) + m[3]; }
  }
  for (const [re, fn] of RULES) { const r = text.match(re); if (r) return fn(r); }
  // Bausteine in zusammengesetzten Zeilen (z. B. "Tür · T30-2 · Tür-Nr. 1.UG14")
  let out = text;
  for (const [de, en] of SUBS) out = out.split(de).join(en);
  return out;
}
const SUBS = [['Tür-Nr.', 'Door no.'], ['zuletzt ', 'last '], ['Tür · ', 'Door · '], ['Tor · ', 'Gate · ']];

const ATTRS = ['placeholder', 'aria-label', 'title'];
function translateNode(root) {
  if (LANG !== 'en' || !root) return;
  if (root.nodeType === 3) { fixText(root); return; }
  if (root.nodeType !== 1 || root.closest?.('.ppage, .notr')) return;
  const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT, {
    acceptNode: (n) => n.nodeType === 1 && (n.classList.contains('ppage') || n.classList.contains('notr')) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT,
  });
  let n = root;
  do {
    if (n.nodeType === 3) fixText(n);
    else for (const a of ATTRS) { const v = n.getAttribute(a); if (v) { const t = tr(v.trim()); if (t !== v.trim()) n.setAttribute(a, t); } }
  } while ((n = w.nextNode()));
}
function fixText(node) {
  if (node.parentElement?.closest('.ppage, .notr, script, style')) return;
  const v = node.nodeValue, t = v.trim();
  if (!t) return;
  const out = tr(t);
  if (out !== t) node.nodeValue = v.replace(t, out);
}

let obs;
export function startI18n() {
  document.documentElement.lang = LANG;
  if (obs) obs.disconnect();
  if (LANG !== 'en') return;
  translateNode(document.body);
  obs = new MutationObserver((list) => {
    for (const m of list) {
      if (m.type === 'characterData') fixText(m.target);
      else if (m.type === 'attributes') translateNode(m.target.nodeType === 1 ? m.target : null);
      else m.addedNodes.forEach(translateNode);
    }
  });
  obs.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ATTRS });
}
export function setLang(l) {
  LANG = l === 'en' ? 'en' : 'de';
  try { localStorage.setItem('s.lang', JSON.stringify(LANG)); } catch {}
  startI18n();
}
