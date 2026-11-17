# Prüfprotokoll

Offline-fähige Web-App (PWA) zum Ausfüllen von Prüfprotokollen für kraftbetätigte Tore (ASR A1.7, DIN 14677) auf dem Handy.

- Alle Daten bleiben lokal auf dem Gerät (IndexedDB). Es gibt keinen Server.
- Jeder Tipp wird sofort gespeichert. Nach einer Unterbrechung geht es dort weiter, wo man aufgehört hat.
- Formulare sind reine Daten (`template-tore.js`). Weitere Formulare, z. B. für Türen, kommen als eigene Vorlage dazu.

Kein Build-Schritt: die Dateien werden direkt über GitHub Pages ausgeliefert.
Nach einer Änderung `VERSION` in `sw.js` erhöhen, damit installierte Apps das Update laden.
