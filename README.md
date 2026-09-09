# Frimp Führer

Ein Tampermonkey-Userscript für [frachtimperium.de](https://frachtimperium.de) (Speditions-Wirtschaftssimulator).

Baut auf `/game/active_tours.php` ein eigenständiges "Cockpit"-Dashboard, das:

- die komplette Fahrzeugflotte auf einen Blick zeigt (Karten + eine gemeinsame Zeitleiste "Tourenplan")
- die Frachtbörse durchsucht und für jedes Fahrzeug die wirtschaftlich beste Route berechnet (inkl. Diesel-/Maut-/Verschleißkosten, Lenkzeiten, Lieferfristen, Planungsfenster)
- Bündel (mehrere Teilladungen derselben Route) und Ketten-Touren (zwei Etappen über eine gemeinsame Zwischenstadt) automatisch findet
- Aufträge direkt per Klick annehmen (und bei Einzelfrachten auch einplanen) kann
- Konflikte zwischen Fahrzeugen auflöst, falls mehrere Fahrzeuge denselben Auftrag als "beste Option" hätten

## Installation

1. [Tampermonkey](https://www.tampermonkey.net/) installieren (Chrome/Firefox/Edge)
2. [frimp_fuehrer.user.js](https://raw.githubusercontent.com/Ob3s/frimp_fuehrer/main/frimp_fuehrer.user.js) öffnen – Tampermonkey bietet die Installation automatisch an
3. Danach installiert Tampermonkey Updates automatisch, sobald hier eine neue Version gepusht wird (`@updateURL`/`@downloadURL`)

## Hinweise

- Läuft ausschließlich auf `/game/active_tours.php`
- Keine externen Abhängigkeiten, `@grant none`
- Annehmen/Einplanen von Frachten sind echte, bindende Spielaktionen (Vertragsstrafe bei Nichtlieferung) – das Script fragt vor jeder solchen Aktion per Bestätigungsdialog nach
- Einige Annahmen (Maut, Verschleiß, Ø-Geschwindigkeit) sind noch nicht vollständig kalibriert, siehe Kommentare im Script

## Entwicklung – Versionierung

Tampermonkey erkennt ein verfügbares Update nur über eine geänderte `@version`
im Script-Header. Ein `pre-commit`-Hook (`.githooks/pre-commit`) erhöht die
Patch-Version deshalb automatisch bei jedem Commit, der
`frimp_fuehrer.user.js` verändert. Für einen bewussten Minor-/Major-
Sprung (z.B. `0.29.0` → `0.30.0`) einfach die `@version`-Zeile selbst im
Commit anpassen – der Hook erkennt das und bumpt dann nicht zusätzlich.

Einmalig nach jedem frischen `git clone` aktivieren:

```bash
git config core.hooksPath .githooks
```
