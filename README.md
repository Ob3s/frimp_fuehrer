# FrachtImperium Helper

Ein Tampermonkey-Userscript für das Browsergame [FrachtImperium](https://frachtimperium.de) (Speditions-Wirtschaftssimulator).

Baut auf `/game/active_tours.php` ein eigenständiges "Cockpit"-Dashboard, das:

- die komplette Fahrzeugflotte auf einen Blick zeigt (Karten + eine gemeinsame Zeitleiste "Tourenplan")
- die Frachtbörse durchsucht und für jedes Fahrzeug die wirtschaftlich beste Route berechnet (inkl. Diesel-/Maut-/Verschleißkosten, Lenkzeiten, Lieferfristen, Planungsfenster)
- Bündel (mehrere Teilladungen derselben Route) und Ketten-Touren (zwei Etappen über eine gemeinsame Zwischenstadt) automatisch findet
- Aufträge direkt per Klick annehmen (und bei Einzelfrachten auch einplanen) kann
- Konflikte zwischen Fahrzeugen auflöst, falls mehrere Fahrzeuge denselben Auftrag als "beste Option" hätten

## Installation

1. [Tampermonkey](https://www.tampermonkey.net/) installieren (Chrome/Firefox/Edge)
2. [frachtimperium-helper.user.js](https://raw.githubusercontent.com/Ob3s/frimp_fuehrer/main/frachtimperium-helper.user.js) öffnen – Tampermonkey bietet die Installation automatisch an
3. Danach installiert Tampermonkey Updates automatisch, sobald hier eine neue Version gepusht wird (`@updateURL`/`@downloadURL`)

## Hinweise

- Läuft ausschließlich auf `/game/active_tours.php`
- Keine externen Abhängigkeiten, `@grant none`
- Annehmen/Einplanen von Frachten sind echte, bindende Spielaktionen (Vertragsstrafe bei Nichtlieferung) – das Script fragt vor jeder solchen Aktion per Bestätigungsdialog nach
- Einige Annahmen (Maut, Verschleiß, Ø-Geschwindigkeit) sind noch nicht vollständig kalibriert, siehe Kommentare im Script
