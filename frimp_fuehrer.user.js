// ==UserScript==
// @name         Frimp Führer
// @namespace    noone.frimpfuehrer
// @version      0.31.0
// @description  Übersicht über Fuhrpark, Frachtbörse, Kredit & Personal-Wirtschaftlichkeit
// @author       NoOne
// @match        https://frachtimperium.de/*
// @grant        none
// @run-at       document-idle
// @updateURL    https://raw.githubusercontent.com/Ob3s/frimp_fuehrer/main/frimp_fuehrer.user.js
// @downloadURL  https://raw.githubusercontent.com/Ob3s/frimp_fuehrer/main/frimp_fuehrer.user.js
// ==/UserScript==

(function () {
  'use strict';

  // Manuell synchron zu @version oben zu halten - der pre-commit-Hook
  // (.githooks/pre-commit) bumpt beide zusammen, damit sie nie auseinanderlaufen.
  // Im Dashboard-Titel sichtbar, damit auf einen Blick erkennbar ist, ob
  // Tampermonkey wirklich die neueste Version geladen hat.
  const SCRIPT_VERSION = '0.31.0';

  // ============================================================
  // 1. KONFIGURATION – aus echtem HTML von /game/dispatch.php ermittelt
  //    Noch offen: Frachtbörse, Personal, Bank/Kredit, Fuhrpark-Übersicht
  // ============================================================
  const SELECTORS = {
    // --- Statusleiste (auf jeder Seite vorhanden) ---
    kontostandLink: '.fi-money-badge',        // hat Klasse .is-negative wenn im Minus
    kontostandValue: '.fi-money-badge strong', // Text z.B. "-3.035,92 €"
    statBadges: '.fi-stat-badge',              // mehrere; Text z.B. "Fahrzeuge 3" -> per Text matchen
    firmenname: '.fi-company-name',
    standort: '.fi-mini-pill strong',          // aktueller "Standort" der Firma (Startpunkt), NICHT der Fahrzeuge

    // --- Seite: /game/dispatch.php (pro Fahrzeug, ?vehicle_id=XXXX) ---
    vehicleSelect: 'select[name="vehicle_id"]',            // Optionen = alle Fahrzeuge mit IDs
    vehicleSelectedOption: 'select[name="vehicle_id"] option[selected]',
    vehicleStatusLine: '.vehicle-line-identity',
    vehicleStatusText: '.vehicle-line-identity > span:not(.return-append-preview)', // "Fahrzeug ist unterwegs · Ende der Planung: ... in ORT DE"
    vehicleFreeAtText: '.return-append-preview',            // "Fahrzeug frei am DATUM · von ORT"
    driverLiveContainer: '#driverLiveStatus',               // data-vehicle-id Attribut. ACHTUNG: im rohen Server-HTML nur ein
                                                             // hidden-Platzhalter ("Fahrerzeit wird geladen …") - die echten
                                                             // Werte füllt ausschließlich das eigene JS der Seite per fetch()
                                                             // auf driver_time_status.php nach, siehe Chat. Deshalb NICHT
                                                             // aus einem per fetch() geholten dispatch.php parsbar.
    driverLiveValues: '[data-driver-live-values]',
    phaseBlocks: '.phase-block',                            // Klassen: phase-loaded-drive / phase-empty-drive / phase-loading / phase-unloading / phase-pause / phase-shift-break
    phaseDetailGrid: '.phase-detail-grid',                  // Key-Value-Paare: Zeit/Auftrag/Route/Status/Phase
    dayRow: '.day-row',
    dayDate: '.day-card .date',
    ordersPool: '#dispatchOrderPool .order-card',           // angenommene Aufträge, die noch geplant werden müssen

    // --- Seite: Frachtbörse (freight-market.php) ---
    marketSummaryCard: '.cards .card',                 // Label+Value: "Offene Frachten gesamt", "Marktwert offen", "Ø Vergütung pro km"
    frachtboerseZeile: '.market-panel table tbody tr',
    frachtRoute: 'td:nth-child(1) .route',              // "Start → Ziel"
    frachtLaender: 'td:nth-child(1) .sub',              // "Land → Land"
    frachtAuftraggeber: 'td:nth-child(2)',              // Firmenname + "Auftrag #ID" in .sub
    frachtName: 'td:nth-child(3) strong',               // z.B. "Maisbruch"
    frachtAufbauSub: 'td:nth-child(3) .sub',            // z.B. "Getreidekipper"
    frachtKapazitaetBadges: 'td:nth-child(3) .badge',   // "Komplettladung" / "Teilladung"
    frachtAnforderungBadge: 'td:nth-child(4) .badge',   // benötigter Aufbau-Typ
    frachtEntfernung: 'td:nth-child(6)',                // "323 km" (reine Fracht-Distanz, NICHT Anfahrt!)
    frachtVerguetung: 'td:nth-child(7) .money',
    frachtPreisProKm: 'td:nth-child(7) .pricekm',
    frachtStrafe: 'td:nth-child(8) .penalty',
    frachtFrist: 'td:nth-child(9) .badge-deadline',     // "Lieferfrist: DD.MM.YYYY HH:MM"
    frachtJobIdInput: 'form input[name="job_id"]',
    frachtStellplaetzeBenoetigt: 'td:nth-child(5) .badge', // z.B. "16 Stellplätze" - Kapazitäts-Spalte
    // Filter-Formular (für spätere automatische Filter-Navigation, z.B. body_type=van)
    filterBodyTypeSelect: 'select[name="body_type"]',
    filterStartCountrySelect: 'select[name="start_country"]',
    filterDestCountrySelect: 'select[name="destination_country"]',

    // --- Seite: /game/pc.php (Marktpreise) ---
    dieselMarktpreis: '.diesel-main-price strong', // Text z.B. "2,159 €/L" - ändert sich täglich

    // --- Seite: Finanzen / Kredit (noch nicht analysiert) ---
    kreditZinssatz: null,
    kreditMaxHoehe: null,
    kreditLaufzeit: null,

    // --- Seite: /game/staff.php (Personal) ---
    staffRolle: '.role', // Text z.B. "Fahrer" / "Disponent" / "Mechaniker" - eine je Personal-Kachel

    // --- Seite: Fuhrpark-Übersicht (fuhrpark.php) ---
    fuhrparkCard: '.fleet-card',                      // ein Artikel pro Fahrzeug, data-vehicle-id
    fuhrparkAufliegerCard: '.fleet-card.is-trailer',   // Auflieger: eigene Karte, KEINE data-vehicle-id, aber dasselbe .fleet-plate-Kennzeichen wie die gekoppelte Zugmaschine
    fuhrparkTypBild: '.fleet-thumb img',               // alt-Attribut = Fahrzeugtyp, z.B. "Kleintransporter"
    fuhrparkName: '.fleet-name',
    fuhrparkKennzeichen: '.fleet-plate',
    fuhrparkCoupledLink: '.fleet-coupled-preview',      // Zugmaschine -> Auflieger-Link, href endet auf "#trailer-<id>" (die id des Auflieger-<article>)
    fuhrparkZustand: '.overall-condition',              // Verschleiß: <span>Zustand</span><div class="mini-fill good/warn/danger">…</div><span>86,6%</span>
    fuhrparkHuBadge: '.fi-inspection-due-badge',         // Hauptuntersuchung: Klasse --valid/--warning/--critical/--expired/--missing, title = "Nächste Hauptuntersuchung: DD.MM.YYYY – <status>"
    fuhrparkInfoZeilen: '.fleet-info > div',           // Label/Wert-Paare: Standort, Fahrer 1/2, Kilometer, Tank, Stellplätze, Nutzlast, Leer/zGG
  };

  // Phase-CSS-Klasse -> unser internes Phase-Typ-Enum
  const PHASE_CLASS_MAP = {
    'phase-loaded-drive': 'fahrt_beladen',
    'phase-empty-drive': 'leerfahrt',
    'phase-loading': 'laden',
    'phase-unloading': 'entladen',
    'phase-pause': 'pause',
    'phase-shift-break': 'schichtpause',
  };

  /**
   * Protokoll aller zusätzlichen Seitenaufrufe (fetch()) während EINES
   * "Beste Routen berechnen"-Laufs - wird in routenBerechnen() zurückgesetzt
   * und am Ende als kleine Diagnose-Zeile unter den Ergebnissen angezeigt
   * (Nutzerwunsch: sichtbar machen, was im Hintergrund geladen wurde und wie
   * lange es gedauert hat).
   * @type {{label: string, dauerMs: number, fehler: string|null}[]}
   */
  let fiAbrufProtokoll = [];

  /**
   * Lückenloses Abruf-Log: JEDER Seitenaufruf des Skripts (Frachtbörse, Fahrzeuge, Personal,
   * Kredite, Posteingang, Prüfstelle, Buchungen, Sync …) läuft über fiFetch und wird mit
   * Zeit, Methode, Adresse, Statuscode und Antwortzeit protokolliert. Nur Adresse - keine
   * Header (Token!) und keine Formularinhalte.
   * @type {{start: number, methode: string, url: string, ms: number|null, status: number|string|null}[]}
   */
  const fiAbrufLog = [];
  const fiAbrufHoerer = new Set();

  /**
   * Nichts doppelt abrufen: identische GET-Adressen desselben Servers innerhalb von 30 s werden
   * geteilt (laufende oder frische Antwort wird geklont zurückgegeben, kein neuer Seitenaufruf).
   * Jeder Schreibzugriff (POST: annehmen, einplanen, zurückgeben, Rückruf …) leert den Speicher,
   * damit danach garantiert frische Daten kommen. Geteilte Treffer zählt `fiAbrufGespart`.
   */
  const FI_GET_TTL_MS = 30000;
  // Fahrzeugpläne (dispatch.php) und Personal/Urlaub (staff.php) ändern sich nur durch eigene Buchungen
  // (-> POST leert den Speicher) bzw. selten - deshalb 10 Minuten geteilt, damit Seitenaufruf, "Routen berechnen"
  // und Datensammler denselben Abruf nutzen.
  const FI_GET_TTL_PLAENE_MS = 10 * 60 * 1000;
  const fiTtlFuer = adresse => (/\/game\/(dispatch|staff)\.php(\?|$)/.test(adresse) ? FI_GET_TTL_PLAENE_MS
    : (/\/game\/driver_time_status\.php/.test(adresse) ? 5 * 60 * 1000 : FI_GET_TTL_MS)); // Live-Fahrerzeiten: 5 Min. (Planung rechnet ohnehin mit Puffer)
  const fiGetSpeicher = new Map(); // url -> {zeit, promise}
  let fiAbrufGespart = 0;
  function fiGetSpeicherLeeren() { fiGetSpeicher.clear(); }

  async function fiFetch(url, opts) {
    const methode = String(opts?.method ?? 'GET').toUpperCase();
    const adresse = String(url);
    let sameOrigin = true;
    try { sameOrigin = new URL(adresse, location.origin).origin === location.origin; } catch (e) { /* relativ/ungültig: wie same-origin behandeln */ }

    if (methode === 'GET' && sameOrigin) {
      const treffer = fiGetSpeicher.get(adresse);
      if (treffer && Date.now() - treffer.zeit < fiTtlFuer(adresse)) {
        fiAbrufGespart++;
        fiAbrufHoerer.forEach(f => { try { f(); } catch (e) { /* ignorieren */ } });
        return (await treffer.promise).clone();
      }
    } else if (methode !== 'GET' && !opts?.fiLesend) {
      fiGetSpeicherLeeren(); // echter Schreibzugriff -> danach frische Daten
    }

    const t0 = performance.now();
    const eintrag = { start: Date.now(), methode, url: adresse, ms: null, status: null };
    fiAbrufLog.push(eintrag);
    if (fiAbrufLog.length > 3000) fiAbrufLog.shift();

    const anfrage = window.fetch(url, opts).then(res => { eintrag.status = res.status; return res; });
    if (methode === 'GET' && sameOrigin) {
      fiGetSpeicher.set(adresse, { zeit: Date.now(), promise: anfrage });
      anfrage.then(res => { if (!res.ok) fiGetSpeicher.delete(adresse); }, () => fiGetSpeicher.delete(adresse));
    }
    try {
      const res = await anfrage;
      return methode === 'GET' && sameOrigin ? res.clone() : res;
    } catch (e) {
      eintrag.status = 'Fehler';
      throw e;
    } finally {
      eintrag.ms = Math.round(performance.now() - t0);
      if (methode !== 'GET' && !opts?.fiLesend) fiGetSpeicherLeeren();
      fiAbrufHoerer.forEach(f => { try { f(); } catch (e) { /* Anzeige darf Abrufe nie stören */ } });
    }
  }

  /**
   * Führt einen fetch()-Aufruf aus und misst dabei die Dauer fürs
   * Abruf-Protokoll (siehe fiAbrufProtokoll). Fehler werden protokolliert,
   * aber weitergereicht - der Aufrufer entscheidet, wie er damit umgeht.
   * @template T
   * @param {string} label Kurzbeschreibung für die Diagnose-Anzeige
   * @param {() => Promise<T>} fetchAusfuehren
   * @returns {Promise<T>}
   */
  async function protokolliereAbruf(label, fetchAusfuehren) {
    const start = performance.now();
    let fehler = null;
    try {
      return await fetchAusfuehren();
    } catch (e) {
      fehler = e?.message || String(e);
      throw e;
    } finally {
      const dauerMs = Math.round(performance.now() - start);
      fiAbrufProtokoll.push({ label, dauerMs, fehler });
    }
  }

  // ============================================================
  // 2. DATENMODELL
  // ============================================================

  /**
   * @typedef {Object} Phase
   * @property {'leerfahrt'|'laden'|'entladen'|'fahrt_beladen'|'pause'|'schichtpause'} type
   * @property {Date} start
   * @property {Date} ende
   * @property {string} auftrag
   * @property {string} von
   * @property {string} bis
   * @property {'geplant'|'laufend'|string} status
   */

  /**
   * @typedef {Object} Vehicle
   * @property {string} id
   * @property {string} name
   * @property {boolean} istAusgewaehlt
   */

  /**
   * @typedef {Object} VehicleStatus
   * @property {string} vehicleId
   * @property {'unterwegs'|'frei'|string} rohStatus   // ungeparster Text, Zustände noch nicht vollständig bekannt
   * @property {string|null} planEndeOrt
   * @property {Date|null} planEndeZeit
   * @property {string|null} freiAbOrt                 // Ort, an dem Fahrzeug als nächstes frei wird -> wichtig für Anfahrt
   * @property {Date|null} freiAbZeit
   * @property {Phase[]} phasen
   */

  // ============================================================
  // 3. PARSER – funktionieren bereits mit dem echten HTML
  // ============================================================

  function parseKontostand() {
    const el = document.querySelector(SELECTORS.kontostandValue);
    if (!el) return null;
    const text = el.textContent.trim(); // "-3.035,92 €"
    const negativ = document.querySelector(SELECTORS.kontostandLink)?.classList.contains('is-negative') ?? text.trim().startsWith('-');
    const zahl = parseFloat(
      text.replace(/[^\d,-]/g, '').replace(/\./g, '').replace(',', '.')
    );
    return { text, wert: zahl, negativ };
  }

  /** Aktueller Standort der Firma (Berlin o.ä.) - Ziel für "Zurück zur Firma". */
  function parseFirmenstandort() {
    const el = document.querySelector(SELECTORS.standort);
    return el ? el.textContent.trim() : null;
  }

  function parseStatBadges() {
    const result = {};
    document.querySelectorAll(SELECTORS.statBadges).forEach(badge => {
      const strong = badge.querySelector('strong');
      if (!strong) return;
      const label = badge.textContent.replace(strong.textContent, '').trim();
      result[label] = parseInt(strong.textContent.trim(), 10);
    });
    return result; // z.B. { Fahrzeuge: 3, Auflieger: 0, Personal: 3 }
  }

  function parseVehicleList(root = document) {
    const select = root.querySelector(SELECTORS.vehicleSelect);
    if (!select) return [];
    return Array.from(select.options).map(opt => ({
      id: opt.value,
      name: opt.textContent.trim(),
      istAusgewaehlt: opt.selected,
    }));
  }

  /** Parst deutsches Datumsformat "DD.MM.YYYY HH:MM" zu Date */
  function parseDeDateTime(str) {
    const m = /(\d{2})\.(\d{2})\.(\d{4})\s+(\d{2}):(\d{2})/.exec(str || '');
    if (!m) return null;
    const [, dd, mm, yyyy, hh, min] = m;
    return new Date(`${yyyy}-${mm}-${dd}T${hh}:${min}:00`);
  }

  /**
   * Parst den Status-Text des aktuell ausgewählten Fahrzeugs.
   * @returns {VehicleStatus|null}
   */
  function parseCurrentVehicleStatus(root = document) {
    const select = root.querySelector(SELECTORS.vehicleSelect);
    const vehicleId = select ? select.value : null;
    if (!vehicleId) return null;

    // Bugfix: '.vehicle-line-identity > span:not(.return-append-preview)' matchte
    // vorher auch das Badge-Span "ausgewählt" (das kommt zuerst im DOM) statt des
    // eigentlichen Statustexts. Badge-Span (class="badge ...") gezielt ausschließen,
    // statt nach einem bestimmten Wortlaut zu suchen (der könnte je nach Zustand variieren).
    const identitySpans = Array.from(root.querySelectorAll(SELECTORS.vehicleStatusText));
    const statusEl = identitySpans.find(el => !el.classList.contains('badge')) || null;
    const freiEl = root.querySelector(SELECTORS.vehicleFreeAtText);

    const statusText = statusEl ? statusEl.textContent.trim() : '';
    // Beispiel: "Fahrzeug ist unterwegs · Ende der Planung: 07.09.2026 21:07 in Grevenbroich DE"
    // oder: "Fahrzeug macht Schichtpause · Ende der Planung: ..." / "Fahrzeug wird beladen · Ende der Planung: ..."
    const endeMatch = /Ende der Planung:\s*([\d.]+\s+[\d:]+)\s+in\s+([^\n]+?)(?:\s*·|$)/.exec(statusText);

    // NUR den kurzen Statusteil vor "· Ende der Planung" nehmen, nicht den
    // ganzen Satz - sonst landet z.B. "Fahrzeug macht Schichtpause · Ende der
    // Planung: 08.09.2026 18:40 in Rotterdam NL" komplett in der Status-Badge
    // und sprengt die Kartenoptik (siehe Bugreport).
    const kurzStatusMatch = /^Fahrzeug\s+(.+?)\s*·\s*Ende der Planung/.exec(statusText);
    const rohStatus = kurzStatusMatch
      ? kurzStatusMatch[1].trim()
      : (statusText.includes('unterwegs') ? 'unterwegs' : (statusText || 'unbekannt'));

    const freiText = freiEl ? freiEl.textContent.trim() : '';
    // Beispiel: "manuelle Aktionen hängen immer an letzte Phase an · Fahrzeug frei am 07.09.2026 21:07 · von Grevenbroich"
    const freiMatch = /Fahrzeug frei am\s+([\d.]+\s+[\d:]+)\s*·\s*von\s+([^\n]+)/.exec(freiText);

    return {
      vehicleId,
      rohStatus,
      planEndeOrt: endeMatch ? endeMatch[2].replace(/\s*DE\s*$/, '').trim() : null,
      planEndeZeit: endeMatch ? parseDeDateTime(endeMatch[1]) : null,
      freiAbOrt: freiMatch ? freiMatch[2].trim() : null,
      freiAbZeit: freiMatch ? parseDeDateTime(freiMatch[1]) : null,
      phasen: parsePhaseBlocks(root),
    };
  }

  /** @returns {Phase[]} */
  function parsePhaseBlocks(root = document) {
    const blocks = root.querySelectorAll(SELECTORS.phaseBlocks);
    const phasen = [];

    blocks.forEach(block => {
      const cssType = Object.keys(PHASE_CLASS_MAP).find(cls => block.classList.contains(cls));
      const type = cssType ? PHASE_CLASS_MAP[cssType] : 'unbekannt';

      const grid = block.querySelector(SELECTORS.phaseDetailGrid);
      if (!grid) return;

      // Grid ist eine Folge von <div class="k">Label</div><div>Wert</div>
      const divs = Array.from(grid.children);
      const kv = {};
      for (let i = 0; i < divs.length; i += 2) {
        const label = divs[i]?.textContent.trim();
        const value = divs[i + 1]?.textContent.trim();
        if (label) kv[label] = value;
      }

      const zeitMatch = /([\d.]+\s+[\d:]+)\s*[–-]\s*([\d.]+\s+[\d:]+)/.exec(kv['Zeit'] || '');
      const routeMatch = /(.+?)\s*→\s*(.+)/.exec(kv['Route'] || '');

      phasen.push({
        type,
        start: zeitMatch ? parseDeDateTime(zeitMatch[1]) : null,
        ende: zeitMatch ? parseDeDateTime(zeitMatch[2]) : null,
        auftrag: kv['Auftrag'] || null,
        von: routeMatch ? routeMatch[1].trim() : null,
        bis: routeMatch ? routeMatch[2].trim() : null,
        status: kv['Status'] || null,
      });
    });

    // Deduplizieren: wenn wir mehrere Tage einzeln nachladen (siehe
    // fetchAlleTagePhasen), können sich Seiten überschneiden und dieselbe
    // Phase mehrfach in den DOM-Ergebnissen auftauchen (führt zu doppelt
    // übereinanderliegenden Uhrzeiten in der Timeline, siehe Bugreport).
    // Eindeutigkeit über Typ + exakte Start-/Endzeit.
    const gesehen = new Set();
    const eindeutig = [];
    for (const p of phasen) {
      const schluessel = `${p.type}|${p.start?.getTime() ?? ''}|${p.ende?.getTime() ?? ''}`;
      if (gesehen.has(schluessel)) continue;
      gesehen.add(schluessel);
      eindeutig.push(p);
    }

    return eindeutig;
  }

  /**
   * Parst fremdes HTML sicher: setzt VOR dem Parsen eine explizite <base>-URL,
   * damit relative Pfade (Bilder/CSS/JS in der geladenen Seite) garantiert
   * gegen die echte Domain aufgelöst werden. Ohne das kann es in manchen
   * Browsern zu einem SecurityError kommen, weil <link>/<img>/<script> mit
   * relativen Pfaden ohne klare Basis fälschlich auf file:// aufgelöst
   * werden - wir wollen diese Ressourcen ohnehin nie laden, aber das
   * Aufsetzen der Basis verhindert den Fehlversuch von vornherein.
   */
  function safeParseHtml(html) {
    const mitBasis = /<head[\s>]/i.test(html)
      ? html.replace(/<head(\s[^>]*)?>/i, match => `${match}<base href="${location.origin}/">`)
      : `<base href="${location.origin}/">${html}`;
    return new DOMParser().parseFromString(mitBasis, 'text/html');
  }

  /**
   * Lädt die Dispositionsseite eines anderen Fahrzeugs per fetch() nach
   * und parst sie wie die aktuelle Seite. So bekommen wir eine
   * Flottenübersicht, ohne dass es eine eigene Übersichtsseite gibt
   * (active_tours.php ist Premium-only und liefert keine Details).
   *
   * WICHTIG (Bugfix, siehe Chat): Wir hängen jetzt IMMER ein explizites
   * ?date=HEUTE an. Ein echter HTML-Dump hat gezeigt, dass eine Anfrage MIT
   * Datum bereits eine ganze WOCHE an Tagen zurückliefert (alle Phasentypen
   * inkl. Leerfahrt/Laden/Entladen) - der Abruf OHNE Datum lieferte offenbar
   * weniger. Ein einziger Fetch reicht also für unser 48h-Fenster locker aus;
   * mehrere Tage einzeln nachzuladen war unnötig und hat die Duplikate
   * verursacht (dieselbe Wochenansicht mehrfach reingemischt).
   * @param {string} vehicleId
   * @param {string} [label] Für die Diagnose-Anzeige - z.B. der Fahrzeugname statt der reinen ID
   * @returns {Promise<VehicleStatus|null>}
   */
  async function fetchVehicleStatus(vehicleId, label = vehicleId) {
    try {
      return await protokolliereAbruf(`Fahrzeug-Status ${label} (dispatch.php)`, async () => {
        const heute = new Date();
        const datumIso = `${heute.getFullYear()}-${String(heute.getMonth() + 1).padStart(2, '0')}-${String(heute.getDate()).padStart(2, '0')}`;
        const url = `/game/dispatch.php?vehicle_id=${encodeURIComponent(vehicleId)}&date=${datumIso}`;
        const res = await fiFetch(url, { credentials: 'same-origin', cache: 'no-store' });
        if (!res.ok) return null;
        const html = await res.text();
        const doc = safeParseHtml(html);
        return parseCurrentVehicleStatus(doc);
      });
    } catch (e) {
      console.warn(`[FI-Helper] Fahrzeug ${vehicleId} konnte nicht geladen werden`, e);
      return null;
    }
  }

  /**
   * Holt den Status ALLER Fahrzeuge (aktuelles Fahrzeug direkt aus dem DOM,
   * die anderen per fetch()) und liefert eine sortierte Liste.
   *
   * Spart einen kompletten Fetch (Nutzerhinweis, siehe Chat): statt zuerst
   * NUR die Fahrzeugliste per bare fetch() zu holen und dann JEDES Fahrzeug
   * einzeln nachzuladen, liefert schon der ERSTE dispatch.php-Aufruf (mit
   * ?date=heute, ohne vehicle_id) sowohl die komplette Fahrzeugliste als
   * auch - nebenbei, weil der Server ohne vehicle_id auf das erste Fahrzeug
   * zeigt - dessen vollen Status inkl. Wochen-Phasen in EINER Antwort. Nur
   * die verbleibenden Fahrzeuge brauchen noch einen eigenen Fetch.
   * Falls diese Annahme mal nicht zutrifft (vorabStatus bleibt null), fällt
   * jedes Fahrzeug einfach auf den normalen Einzel-Fetch zurück - kein
   * Verhalten schlechter als vorher, nur potenziell kein Fetch gespart.
   * @returns {Promise<{name: string, status: VehicleStatus|null}[]>}
   */
  async function fetchFleetStatus(onListe = null, onFahrzeug = null) {
    const onDispatchPage = /\/game\/dispatch\.php/.test(location.pathname);
    let vehicles;
    let vorabStatus = null;

    if (onDispatchPage) {
      vehicles = parseVehicleList();
    } else {
      try {
        const heute = new Date();
        const datumIso = `${heute.getFullYear()}-${String(heute.getMonth() + 1).padStart(2, '0')}-${String(heute.getDate()).padStart(2, '0')}`;
        const ergebnis = await protokolliereAbruf('Fahrzeugliste + erstes Fahrzeug (dispatch.php)', async () => {
          const res = await fiFetch(`/game/dispatch.php?date=${datumIso}`, { credentials: 'same-origin', cache: 'no-store' });
          if (!res.ok) return { vehicles: [], status: null };
          const html = await res.text();
          const doc = safeParseHtml(html);
          return { vehicles: parseVehicleList(doc), status: parseCurrentVehicleStatus(doc) };
        });
        vehicles = ergebnis.vehicles;
        vorabStatus = ergebnis.status;
      } catch (e) {
        console.warn('[FI-Helper] Fahrzeugliste konnte nicht geladen werden', e);
        vehicles = [];
      }
    }

    if (!vehicles.length) return [];
    onListe?.(vehicles.map(v => v.name));

    const results = await Promise.all(
      vehicles.map(v => {
        // Jedes Fahrzeug meldet sich einzeln, sobald sein Plan da ist (Live-Aufbau der Anzeige)
        const melde = promise => promise.then(r => { try { onFahrzeug?.(v.name, r); } catch (e) { /* Anzeige darf Laden nie stören */ } return r; });
        // "Schon geladen, kein Fetch nötig" gilt für zwei Fälle: wir sind
        // wirklich auf dispatch.php UND das Fahrzeug ist dort ausgewählt,
        // ODER wir haben den Status schon aus dem Vorab-Fetch oben (die ID
        // passt zum vom Server default ausgewählten Fahrzeug).
        if (onDispatchPage && v.istAusgewaehlt) return melde(Promise.resolve(parseCurrentVehicleStatus()));
        if (vorabStatus && String(vorabStatus.vehicleId) === String(v.id)) return melde(Promise.resolve(vorabStatus));
        return melde(fetchVehicleStatus(v.id, v.name));
      })
    );

    return vehicles.map((v, i) => ({
      name: v.name,
      status: results[i],
    }));
  }

  /**
   * Fragt die Live-Fahrerzeit direkt beim Spiel-Backend ab (JSON),
   * genau der Endpunkt, den das Spiel selbst per fetch() nutzt.
   * @param {string|number} vehicleId
   */
  async function fetchLiveDriverStatus(vehicleId, label = vehicleId) {
    try {
      return await protokolliereAbruf(`Live-Fahrerstatus ${label} (driver_time_status.php)`, async () => {
        const res = await fiFetch(`/game/driver_time_status.php?vehicle_id=${encodeURIComponent(vehicleId)}`, {
          credentials: 'same-origin',
          cache: 'no-store',
          headers: { Accept: 'application/json' },
        });
        if (!res.ok) return null;
        const data = await res.json();
        return data?.ok ? data : null;
      });
    } catch (e) {
      console.warn('[FI-Helper] Live-Fahrerstatus nicht abrufbar', e);
      return null;
    }
  }

  // ============================================================
  // 4. FRACHTBÖRSE – funktioniert bereits mit dem echten HTML
  // ============================================================

  /**
   * @typedef {Object} FrachtAngebot
   * @property {string} jobId
   * @property {string} startOrt
   * @property {string} zielOrt
   * @property {string} startLand
   * @property {string} zielLand
   * @property {string} auftraggeber
   * @property {string} frachtName
   * @property {string} aufbauTyp          // z.B. "Getreidekipper", "Kleintransporter"
   * @property {string} kapazitaet         // "Komplettladung" | "Teilladung" | sonstiges
   * @property {number} entfernungKm       // NUR die Fracht-Strecke, nicht die Anfahrt!
   * @property {number} verguetungEuro
   * @property {number} preisProKm
   * @property {number} strafeEuro
   * @property {Date|null} lieferfrist
   */

  function parseMarketSummary() {
    const result = {};
    document.querySelectorAll(SELECTORS.marketSummaryCard).forEach(card => {
      const label = card.querySelector('.label')?.textContent.trim();
      const value = card.querySelector('.value')?.textContent.trim();
      if (label) result[label] = value;
    });
    return result; // z.B. { "Offene Frachten gesamt": "16.656", "Ø Vergütung pro km": "5,67 €/km" }
  }

  function parseGermanNumber(str) {
    if (!str) return null;
    const cleaned = str.replace(/[^\d,.-]/g, '').replace(/\./g, '').replace(',', '.');
    const n = parseFloat(cleaned);
    return Number.isFinite(n) ? n : null;
  }

  /** @returns {FrachtAngebot[]} */
  function parseFrachtboerse(root = document) {
    const rows = root.querySelectorAll(SELECTORS.frachtboerseZeile);
    const angebote = [];

    rows.forEach(row => {
      const routeText = row.querySelector(SELECTORS.frachtRoute)?.textContent.trim() || '';
      const [startOrt, zielOrt] = routeText.split('→').map(s => s?.trim());

      const laenderText = row.querySelector(SELECTORS.frachtLaender)?.textContent.trim() || '';
      const [startLand, zielLand] = laenderText.split('→').map(s => s?.trim());

      const auftraggeberCell = row.querySelector(SELECTORS.frachtAuftraggeber);
      const auftraggeberSub = auftraggeberCell?.querySelector('.sub')?.textContent.trim() || '';
      const auftraggeber = auftraggeberCell
        ? auftraggeberCell.textContent.replace(auftraggeberSub, '').trim()
        : '';

      const frachtName = row.querySelector(SELECTORS.frachtName)?.textContent.trim() || '';
      const aufbauTyp = row.querySelector(SELECTORS.frachtAufbauSub)?.textContent.trim() || '';
      const kapazitaet = row.querySelector(SELECTORS.frachtKapazitaetBadges)?.textContent.trim() || '';

      const entfernungText = row.querySelector(SELECTORS.frachtEntfernung)?.textContent.trim() || '';
      const entfernungKm = parseGermanNumber(entfernungText);

      const verguetungText = row.querySelector(SELECTORS.frachtVerguetung)?.textContent.trim() || '';
      const verguetungEuro = parseGermanNumber(verguetungText);

      const preisProKmText = row.querySelector(SELECTORS.frachtPreisProKm)?.textContent.trim() || '';
      const preisProKm = parseGermanNumber(preisProKmText);

      const strafeText = row.querySelector(SELECTORS.frachtStrafe)?.textContent.trim() || '';
      const strafeEuro = parseGermanNumber(strafeText);

      const fristText = row.querySelector(SELECTORS.frachtFrist)?.textContent.trim() || '';
      const fristMatch = /Lieferfrist:\s*([\d.]+\s+[\d:]+)/.exec(fristText);

      const jobId = row.querySelector(SELECTORS.frachtJobIdInput)?.value || null;

      // Stellplatz-Bedarf: "16 Stellplätze" -> 16 (parseGermanNumber filtert den Text automatisch raus)
      const stellplaetzeBenoetigt = parseGermanNumber(row.querySelector(SELECTORS.frachtStellplaetzeBenoetigt)?.textContent);

      angebote.push({
        jobId,
        startOrt: startOrt || null,
        zielOrt: zielOrt || null,
        startLand: startLand || null,
        zielLand: zielLand || null,
        auftraggeber,
        frachtName,
        aufbauTyp,
        kapazitaet,
        entfernungKm,
        verguetungEuro,
        preisProKm,
        strafeEuro,
        lieferfrist: fristMatch ? parseDeDateTime(fristMatch[1]) : null,
        stellplaetzeBenoetigt,
      });
    });

    return angebote;
  }

  /**
   * Filtert Angebote auf einen bestimmten Aufbau-Typ (z.B. "Kleintransporter").
   * Die Frachtbörse zeigt oft nur EINEN Frachttyp pro Seite, je nach Sortierung/Filter -
   * am zuverlässigsten ist es, direkt mit ?body_type=van zu filtern (siehe Filter-Formular).
   */
  function filtereNachAufbau(angebote, aufbauTyp) {
    return angebote.filter(a => a.aufbauTyp.toLowerCase().includes(aufbauTyp.toLowerCase()));
  }

  /**
   * Sicherheitsnetz für die Rückfracht-Suche: Der serverseitige "Ziel-Umkreis"-
   * Filter der Frachtbörse war beim Testen nachweislich nicht zuverlässig
   * (eine "nach Berlin"-Suche lieferte u.a. eine Fracht nach Kempten (Allgäu)
   * mit). Wir prüfen deshalb JEDES Angebot nochmal selbst gegen die echte
   * Zielstadt, statt dem Server blind zu vertrauen.
   * @param {FrachtAngebot[]} angebote
   * @param {string} zielStadt
   * @param {number} zielRadiusKm 0 = exakte Stadt, sonst Umkreis in km
   */
  function filtereNachZielstadt(angebote, zielStadt, zielRadiusKm = 0) {
    if (!zielStadt) return angebote;
    const zielStadtLower = zielStadt.toLowerCase();
    return angebote.filter(a => {
      if (!a.zielOrt) return false;
      if (a.zielOrt.toLowerCase() === zielStadtLower) return true;
      if (zielRadiusKm > 0) {
        const km = geschaetzteStrassenKm(a.zielOrt, zielStadt);
        return km !== null && km <= zielRadiusKm;
      }
      return false;
    });
  }

  // ============================================================
  // 4b. MEHRSEITEN-SCAN + FRISTEN-BEWERTUNG (freight-market.php)
  // ============================================================

  /**
   * Liest die verfügbaren Fahrzeugkategorien direkt aus dem Filter-Formular
   * der Seite aus - keine Hardcodierung, funktioniert auch wenn das Spiel
   * neue Kategorien hinzufügt.
   * @returns {{value: string, label: string}[]}
   */
  function parseBodyTypeOptions(root = document) {
    const select = root.querySelector(SELECTORS.filterBodyTypeSelect);
    if (!select) return [];
    return Array.from(select.options)
      .filter(opt => opt.value) // "Alle" (leerer value) ausschließen
      .map(opt => ({ value: opt.value, label: opt.textContent.trim() }));
  }

  /**
   * Holt die Fahrzeugkategorien per fetch() nach, egal auf welcher Seite man
   * gerade ist. Ändert sich praktisch nie (neue Kategorien nur bei einem
   * Spiel-Update) - deshalb in sessionStorage gecached, damit nicht mal ein
   * einfacher Seiten-Reload den Fetch wiederholt.
   */
  async function getBodyTypeOptionsAnywhere() {
    try {
      const gecached = window.sessionStorage.getItem('fi_bodytype_optionen');
      if (gecached) return JSON.parse(gecached);
    } catch (e) {}

    const onFreightMarket = /\/game\/freight-market\.php/.test(location.pathname);
    if (onFreightMarket) {
      const optionen = parseBodyTypeOptions(document);
      try { window.sessionStorage.setItem('fi_bodytype_optionen', JSON.stringify(optionen)); } catch (e) {}
      return optionen;
    }
    try {
      const res = await fiFetch('/game/freight-market.php', { credentials: 'same-origin', cache: 'no-store' });
      if (!res.ok) return [];
      const html = await res.text();
      const doc = safeParseHtml(html);
      const optionen = parseBodyTypeOptions(doc);
      try { window.sessionStorage.setItem('fi_bodytype_optionen', JSON.stringify(optionen)); } catch (e) {}
      return optionen;
    } catch (e) {
      console.warn('[FI-Helper] Fahrzeugkategorien konnten nicht geladen werden', e);
      return [];
    }
  }

  /** Extrahiert "Seite X / Y" aus dem Seitentext (robuster als ein fixer Selektor) */
  function parsePaginationInfo(doc) {
    const text = doc.body ? doc.body.textContent : '';
    const m = /Seite\s+(\d+)\s*\/\s*(\d+)/.exec(text);
    return m ? { currentPage: parseInt(m[1], 10), totalPages: parseInt(m[2], 10) } : null;
  }

  /**
   * Holt eine einzelne Frachtbörsen-Seite für eine Kategorie per fetch().
   * Sortierung nach €/km absteigend, damit bei einem Seiten-Limit die
   * vermutlich besten Angebote zuerst gescannt werden.
   * @param {{zielStadt?: string, zielRadiusKm?: number}} filter Optional: nur Frachten mit Ziel nahe zielStadt
   */
  async function fetchFreightMarketPage(bodyType, page, perPage = 100, filter = {}) {
    return protokolliereAbruf(`Frachtbörse Seite ${page} (freight-market.php, ${bodyType})`, async () => {
      let url = `/game/freight-market.php?body_type=${encodeURIComponent(bodyType)}&per_page=${perPage}&page=${page}&sort=price_km_desc`;
      if (filter.zielStadt) {
        url += `&destination_radius_city=${encodeURIComponent(filter.zielStadt)}&destination_radius_km=${filter.zielRadiusKm ?? 0}`;
      }
      const res = await fiFetch(url, { credentials: 'same-origin', cache: 'no-store' });
      if (!res.ok) return { angebote: [], pagination: null };
      const html = await res.text();
      const doc = safeParseHtml(html);
      return { angebote: parseFrachtboerse(doc), pagination: parsePaginationInfo(doc) };
    });
  }

  /**
   * Lädt ALLE Seiten einer Kategorie (bis maxPages als Sicherheitsdeckel).
   * @param {string} bodyType
   * @param {number} maxPages
   * @param {(status: string) => void} onProgress
   * @param {{zielStadt?: string, zielRadiusKm?: number}} filter
   * @returns {Promise<{angebote: FrachtAngebot[], gescannteSeiten: number, gesamtSeiten: number|null}>}
   */
  async function fetchAllOffersForBodyType(bodyType, maxPages = 500, onProgress = () => {}, filter = {}) {
    onProgress('Lade Seite 1 ...', null);
    const erste = await fetchFreightMarktPageSafe(bodyType, 1, filter);
    let alle = [...erste.angebote];
    const gesamtSeiten = erste.pagination ? erste.pagination.totalPages : 1;
    // maxPages ist nur noch ein Sicherheitsdeckel gegen Endlosschleifen - normalerweise werden ALLE Seiten geladen
    const zuLadendeSeiten = Math.min(gesamtSeiten, maxPages);
    onProgress(`Lade Seite 1 von ${zuLadendeSeiten} ...`, { seite: 1, gesamt: zuLadendeSeiten, angebote: alle.length });

    // restliche Seiten in Batches parallel laden, um den Server nicht zu fluten
    const BATCH_SIZE = 5;
    for (let start = 2; start <= zuLadendeSeiten; start += BATCH_SIZE) {
      const seiten = [];
      for (let p = start; p < Math.min(start + BATCH_SIZE, zuLadendeSeiten + 1); p++) {
        seiten.push(p);
      }
      const ergebnisse = await Promise.all(seiten.map(p => fetchFreightMarktPageSafe(bodyType, p, filter)));
      ergebnisse.forEach(e => { alle = alle.concat(e.angebote); });
      onProgress(`Lade Seiten ${seiten[0]}–${seiten[seiten.length - 1]} von ${zuLadendeSeiten} ...`, { seite: seiten[seiten.length - 1], gesamt: zuLadendeSeiten, angebote: alle.length });
    }

    return { angebote: alle, gescannteSeiten: zuLadendeSeiten, gesamtSeiten };
  }

  async function fetchFreightMarktPageSafe(bodyType, page, filter = {}) {
    try {
      return await fetchFreightMarketPage(bodyType, page, 100, filter);
    } catch (e) {
      console.warn(`[FI-Helper] Frachtbörse Seite ${page} fehlgeschlagen`, e);
      return { angebote: [], pagination: null };
    }
  }

  /**
   * Begründung, warum ein Auftrag noch nicht einplanbar ist - mit dem Zeitpunkt,
   * ab dem er es wird. Unterscheidet "liegt hinter dem Fensterende" von "liegt
   * im Sicherheitsabstand davor" (siehe aktuellerPlanungspuffer) und rundet die
   * Fensterlänge (kommt als Dezimalzahl, weil das Ende minutengenau vom Spiel
   * gelesen wird).
   */
  function baueEinplanbarHinweis(beladungsStartZeit, planungsfensterEnde) {
    const puffer = aktuellerPlanungspuffer();
    const fensterStunden = Math.round(PLANUNGSFENSTER_STUNDEN);
    const planbarAb = new Date(beladungsStartZeit.getTime() + puffer * 3600 * 1000 - PLANUNGSFENSTER_STUNDEN * 3600 * 1000);
    const hinterEnde = beladungsStartZeit.getTime() > planungsfensterEnde.getTime();
    const grund = hinterEnde
      ? `liegt hinter dem Ende des ${fensterStunden}-h-Planungsfensters (${planungsfensterEnde.toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' })})`
      : `liegt weniger als ${puffer.toFixed(1)} h vor dem Fensterende (${planungsfensterEnde.toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' })}) - zu knapp für die Schätzgenauigkeit`;
    return `Nächstmöglicher Beladungsstart (${beladungsStartZeit.toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' })}) ${grund} - einplanbar ab ca. ${planbarAb.toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' })}`;
  }

  /**
   * Fahrer-Restzeiten AM ZEITPUNKT, ab dem das Fahrzeug frei ist (nicht "jetzt").
   * Die Live-Werte (driver_time_status.php) gelten nur für jetzt; wird das
   * Fahrzeug erst in Stunden/Tagen frei, hängt der Zustand davon ab, was im
   * Dispositionsplan davor noch passiert (Fahrten, 45-min-Pausen, Schichtpause).
   * Deshalb wird der Zustand aus den Phasen des Fahrzeugs rekonstruiert:
   *  - Schichtuhr: seit dem Ende der letzten Schichtpause (Wanduhr; 15 h / 21 h)
   *  - Fahruhr: gefahrene Zeit seit der letzten Pause/Schichtpause (4,5 h / 9 h)
   * Ohne Pause im Plan wird vom Live-Wert ausgegangen und die bis dahin
   * geplante Zeit abgezogen. Ein explizit mitgegebener Zustand
   * (vehicleStatus.fahrerRestOverride, z.B. Ende einer Vor-Tour) hat Vorrang.
   */
  function holeRestzeiten(vehicleStatus, liveStatus, fahreranzahl) {
    if (vehicleStatus?.fahrerRestOverride) {
      const o = vehicleStatus.fahrerRestOverride;
      return { restLenkzeitStunden: o.restLenkzeitStunden, restSchichtzeitStunden: o.restSchichtzeitStunden, lenkzeitUngeprueft: false };
    }
    const liveLenk = liveStatus?.drivers?.[0]?.remaining_drive_seconds != null ? liveStatus.drivers[0].remaining_drive_seconds / 3600 : null;
    const liveSchicht = liveStatus?.drivers?.[0]?.remaining_shift_seconds != null ? liveStatus.drivers[0].remaining_shift_seconds / 3600 : null;
    const jetzt = Date.now();
    const freiAb = vehicleStatus?.freiAbZeit?.getTime() ?? jetzt;
    const phasen = (vehicleStatus?.phasen ?? []).filter(p => p.start && p.ende && p.ende.getTime() <= freiAb + 60000);
    if (freiAb <= jetzt + 5 * 60000 || !phasen.length) {
      return { restLenkzeitStunden: liveLenk, restSchichtzeitStunden: liveSchicht, lenkzeitUngeprueft: liveLenk === null || liveSchicht === null };
    }
    const regeln = LENKZEIT_REGELN[fahreranzahl] || LENKZEIT_REGELN[1];
    const endeMax = typen => phasen.filter(p => typen.includes(p.type)).reduce((m, p) => Math.max(m, p.ende.getTime()), 0) || null;
    const letzteSchicht = endeMax(['schichtpause']);
    const letztePause = endeMax(['pause', 'schichtpause']);

    let restSchicht = null;
    if (letzteSchicht) restSchicht = regeln.spaetestesSchichtendeStunden - (freiAb - letzteSchicht) / 3600000;
    else if (liveSchicht !== null) restSchicht = liveSchicht - (freiAb - jetzt) / 3600000;

    const ab = letztePause ?? jetzt;
    const gefahren = phasen
      .filter(p => p.type === 'leerfahrt' || p.type === 'fahrt_beladen')
      .reduce((sum, p) => sum + Math.max(0, p.ende.getTime() - Math.max(p.start.getTime(), ab)), 0) / 3600000;
    let restLenk = null;
    if (letztePause) restLenk = regeln.fahrzeitAmStueck - gefahren;
    else if (liveLenk !== null) restLenk = liveLenk - gefahren;

    const klemme = v => (v === null ? null : Math.max(0, v));
    restLenk = klemme(restLenk);
    restSchicht = klemme(restSchicht);
    return { restLenkzeitStunden: restLenk, restSchichtzeitStunden: restSchicht, lenkzeitUngeprueft: restLenk === null || restSchicht === null };
  }

  // ----- Prognose-Messung (Beladungsstart: Schätzung vs. Plan des Spiels) -----
  // Bei jeder Buchung wird der von uns vorhergesagte Beladungsstart mit dem
  // tatsächlich vom Spiel geplanten verglichen. Daraus ergibt sich der
  // Sicherheitsabstand zum Fensterende aus echten Messwerten statt einer
  // geschätzten Zahl (bis genug Messungen vorliegen: 3 h Standard).
  const PROGNOSE_LOG_KEY = 'fi_prognose_log_v1';
  function ladePrognoseLog() {
    try { return JSON.parse(window.localStorage.getItem(PROGNOSE_LOG_KEY) || '[]'); } catch (e) { return []; }
  }
  function speicherePrognose(eintrag) {
    const log = ladePrognoseLog();
    log.push(eintrag);
    while (log.length > 60) log.shift();
    try { window.localStorage.setItem(PROGNOSE_LOG_KEY, JSON.stringify(log)); } catch (e) { /* nur nicht speichern */ }
  }
  /** Sicherheitsabstand in Stunden: größte Verspätung des Spiels ggü. unserer Prognose der letzten 30 Messungen + 0,5 h (1-8 h); unter 8 Messungen: 3 h. */
  function aktuellerPlanungspuffer() {
    const log = ladePrognoseLog().slice(-30);
    if (log.length < 8) return 3;
    const spaeter = log.map(x => x.diffStunden).filter(x => x > 0);
    const maxSpaeter = spaeter.length ? Math.max(...spaeter) : 0;
    return Math.min(8, Math.max(1, maxSpaeter + 0.5));
  }
  /** Misst nach erfolgreichem Einplanen die Abweichung (positiv = Spiel startet später als unsere Prognose). */
  function messePrognose(status, fahrzeugName, planStart, prognoseBeladung) {
    try {
      if (!status?.phasen || !prognoseBeladung) return;
      const laden = status.phasen
        .filter(p => p.type === 'laden' && p.start && p.start.getTime() >= planStart.getTime() - 60000)
        .sort((a, b) => a.start - b.start)[0];
      if (!laden) return;
      const diffStunden = (laden.start.getTime() - prognoseBeladung.getTime()) / 3600000;
      speicherePrognose({ zeit: new Date().toISOString(), fahrzeug: fahrzeugName, prognose: prognoseBeladung.toISOString(), ist: laden.start.toISOString(), diffStunden: +diffStunden.toFixed(2) });
      console.log('[FI-Helper] Prognose-Messung:', fahrzeugName, 'Beladung Prognose', prognoseBeladung.toLocaleString('de-DE'), '- Spiel', laden.start.toLocaleString('de-DE'), `(${diffStunden >= 0 ? '+' : ''}${diffStunden.toFixed(1)} h)`);
    } catch (e) { console.warn('[FI-Helper] Prognose-Messung fehlgeschlagen', e); }
  }

  /**
   * Bewertet ein Frachtangebot für ein konkretes Fahrzeug inkl. Fristen-Check,
   * echter Lade-/Entladezeit-Formel UND exakter Lenkzeit-/Schichtpausen-
   * Simulation nach den offiziellen Spielregeln (1 vs. 2 Fahrer).
   * @param {FrachtAngebot} fracht
   * @param {VehicleStatus} vehicleStatus
   * @param {Object|null} liveStatus Rückgabe von fetchLiveDriverStatus() für dieses Fahrzeug
   * @param {string} aufbauTypLabel ECHTER Fahrzeugtyp (siehe FAHRZEUG_SPEZIFIKATIONEN)
   * @param {number|null} fahrzeugStellplaetze Aktuelle Stellplatzzahl des Fahrzeugs (inkl. ggf. Anhänger)
   * @returns {null | {
   *   anfahrtKm: number|null, gesamtStunden: number, ankunftZeit: Date|null,
   *   schaffbar: boolean|null, effektivProKm: number|null, deckungsbeitragEuro: number,
   *   lenkzeitHinweis: string|null, lenkzeitUngeprueft: boolean,
   *   kapazitaetOk: boolean|null, kapazitaetHinweis: string|null
   * }}
   */
  function bewerteFrachtFuerFahrzeug(fracht, vehicleStatus, liveStatus = null, aufbauTypLabel = 'Kleintransporter', fahrzeugStellplaetze = null, ladeKategorie = null) {
    if (!vehicleStatus || !vehicleStatus.freiAbOrt || !vehicleStatus.freiAbZeit) return null;
    if (!fracht.startOrt) return null;

    // Kapazitäts-Check: passt der Auftrag überhaupt auf das Fahrzeug?
    // null = eine der beiden Zahlen unbekannt -> nicht geprüft (nicht automatisch ausschließen)
    let kapazitaetOk = null;
    let kapazitaetHinweis = null;
    if (fracht.stellplaetzeBenoetigt != null && fahrzeugStellplaetze != null) {
      kapazitaetOk = fracht.stellplaetzeBenoetigt <= fahrzeugStellplaetze;
      if (!kapazitaetOk) {
        kapazitaetHinweis = `Benötigt ${fracht.stellplaetzeBenoetigt} Stellplätze, Fahrzeug hat nur ${fahrzeugStellplaetze}`;
      }
    }
    if (kapazitaetOk === false) return null; // passt schlicht nicht drauf, gar nicht erst als Kandidat werten

    const anfahrtKm = geschaetzteStrassenKm(vehicleStatus.freiAbOrt, fracht.startOrt);
    if (anfahrtKm === null) return null; // Stadt nicht in unserer Koordinatentabelle

    const fahrtKm = fracht.entfernungKm ?? 0;
    const gesamtFahrKm = anfahrtKm + fahrtKm;

    const fahreranzahl = liveStatus?.drivers?.length >= 2 ? 2 : 1;
    const { restLenkzeitStunden, restSchichtzeitStunden, lenkzeitUngeprueft } = holeRestzeiten(vehicleStatus, liveStatus, fahreranzahl);

    const spezifikation = holeFahrzeugSpezifikation(aufbauTypLabel);
    const { laden: ladeZeitStunden, entladen: entladeZeitStunden } = berechneLadeEntladeZeiten(fracht, spezifikation, fahreranzahl, fahrzeugStellplaetze, ladeKategorie);
    const geschwindigkeit = spezifikation.geschwindigkeitKmh ?? ZEIT_ANNAHMEN.avgGeschwindigkeitKmh;

    // Anfahrt ZUERST separat simulieren: der Beladungsstart ist freiAbZeit +
    // Anfahrtdauer (inkl. evtl. Pausen WÄHREND der Anfahrt selbst) - NICHT
    // einfach freiAbZeit. Das Spiel prüft das Planungsfenster gegen genau
    // diesen "nächstmöglichen Beladungsstart", nicht gegen freiAbZeit (Bugfix,
    // siehe Chat: eine lange Anfahrt kann das Fenster sprengen, obwohl das
    // Fahrzeug selbst rechtzeitig frei wird).
    const anfahrtSegment = [{ dauer: anfahrtKm / geschwindigkeit, istFahrt: true }];
    const anfahrtErgebnis = simuliereTourZeitplan(anfahrtSegment, fahreranzahl, restLenkzeitStunden, restSchichtzeitStunden);
    const beladungsStartZeit = new Date(vehicleStatus.freiAbZeit.getTime() + anfahrtErgebnis.gesamtStunden * 3600 * 1000);

    // Rest der Tour (Laden → Fahrt beladen → Entladen) knüpft nahtlos an den
    // Restzustand (Lenk-/Schichtzeit) der Anfahrt an.
    const restSegmente = [
      { dauer: ladeZeitStunden, istFahrt: false },
      { dauer: fahrtKm / geschwindigkeit, istFahrt: true },
      { dauer: entladeZeitStunden, istFahrt: false },
    ];
    const restErgebnis = simuliereTourZeitplan(restSegmente, fahreranzahl, anfahrtErgebnis.restPflichtpause, anfahrtErgebnis.restSchichtzeit);

    const gesamtStunden = anfahrtErgebnis.gesamtStunden + restErgebnis.gesamtStunden;
    const anzahlSchichtpausen = anfahrtErgebnis.anzahlSchichtpausen + restErgebnis.anzahlSchichtpausen;

    const lenkzeitHinweis = anzahlSchichtpausen > 0
      ? `${anzahlSchichtpausen}x Schichtpause (${LENKZEIT_REGELN[fahreranzahl].schichtpauseStunden}h, ${fahreranzahl} Fahrer) eingerechnet`
      : null;

    const ankunftZeit = new Date(vehicleStatus.freiAbZeit.getTime() + gesamtStunden * 3600 * 1000);
    const schaffbar = fracht.lieferfrist ? ankunftZeit <= fracht.lieferfrist : null; // null = Frist unbekannt/nicht geparst

    // Planungsfenster-Check: gegen den ECHTEN Beladungsstart prüfen, nicht
    // gegen freiAbZeit (Bugfix, siehe Chat - Fehlermeldung nannte explizit
    // "nächstmöglicher Beladungsstart").
    const planungsfensterEnde = new Date(Date.now() + PLANUNGSFENSTER_STUNDEN * 3600 * 1000);
    const einplanbar = beladungsStartZeit.getTime() + aktuellerPlanungspuffer() * 3600 * 1000 <= planungsfensterEnde.getTime();
    const einplanbarHinweis = einplanbar ? null : baueEinplanbarHinweis(beladungsStartZeit, planungsfensterEnde);

    // Anfahrt = LEER (kein Auftrag geladen), Fracht-Fahrt = BELADEN - unterschiedlicher Verbrauch!
    // Verschleiß fließt NICHT mehr ein - laut Tour-Abrechnungen im Spiel kostet
    // er pro Tour nichts (nur eine %-Zustandsanzeige, reale Kosten erst bei
    // einer künftigen Werkstatt-Reparatur, deren Konditionen unbekannt sind).
    const mautSatz = spezifikation.mautProKm ?? MAUT_SATZ_DEFAULT;
    const kostenAnfahrt = anfahrtKm * (dieselKostenProKm(false, spezifikation) + mautSatz);
    const kostenFahrt = fahrtKm * (dieselKostenProKm(true, spezifikation) + mautSatz);
    const deckungsbeitragEuro = (fracht.verguetungEuro ?? 0) - kostenAnfahrt - kostenFahrt;

    const effektivProKm = gesamtFahrKm > 0 ? deckungsbeitragEuro / gesamtFahrKm : null;
    // Leerfahrt-Anteil separat ausweisen - "gutes €/km" kann eine riesige
    // unbezahlte Anfahrt verschleiern, wenn die Fracht selbst lukrativ genug ist.
    const anfahrtAnteilProzent = gesamtFahrKm > 0 ? Math.round((anfahrtKm / gesamtFahrKm) * 100) : null;

    return {
      anfahrtKm, gesamtStunden, ankunftZeit, schaffbar, effektivProKm, deckungsbeitragEuro,
      kostenAnfahrt, anfahrtAnteilProzent, beladungsStartZeit,
      fahrerRestLenkEnde: restErgebnis.restPflichtpause, fahrerRestSchichtEnde: restErgebnis.restSchichtzeit,
      lenkzeitHinweis,
      lenkzeitUngeprueft,
      kapazitaetOk,
      kapazitaetHinweis,
      einplanbar,
      einplanbarHinweis,
    };
  }

  /**
   * Baut für jede Route (exakt gleicher Start- und Zielort) Bündel aus mehreren
   * Teilladungen, die zusammen unter die Stellplatzgrenze des Fahrzeugs passen.
   * Ökonomische Idee: Die Fahrt kostet nur einmal (Diesel/Maut/Verschleiß),
   * aber die Vergütung mehrerer Teilladungen addiert sich - das ist fast immer
   * deutlich lukrativer als eine einzelne Teilladung mit halbleerem Fahrzeug.
   * Greedy-Packstrategie: beste Vergütung pro Stellplatz zuerst einladen.
   * @param {FrachtAngebot[]} angebote
   * @param {number|null} fahrzeugStellplaetze
   * @returns {FrachtAngebot[][]} Liste von Bündeln (je mind. 2 Aufträge)
   */
  function baueBundlesFuerAlleRouten(angebote, fahrzeugStellplaetze) {
    if (!fahrzeugStellplaetze) return [];

    const gruppenNachRoute = new Map();
    angebote.forEach(f => {
      if (!f.startOrt || !f.zielOrt) return;
      if (f.kapazitaet !== 'Teilladung') return; // Komplettladungen sind schon voll, nichts zu bündeln
      if (!f.stellplaetzeBenoetigt) return;
      const key = `${f.startOrt}→${f.zielOrt}`;
      if (!gruppenNachRoute.has(key)) gruppenNachRoute.set(key, []);
      gruppenNachRoute.get(key).push(f);
    });

    const bundles = [];
    gruppenNachRoute.forEach(frachtenAufRoute => {
      if (frachtenAufRoute.length < 2) return; // ein einzelnes Angebot läuft schon separat mit, kein Bündel nötig

      const sortiertNachDichte = [...frachtenAufRoute].sort(
        (a, b) => (b.verguetungEuro / b.stellplaetzeBenoetigt) - (a.verguetungEuro / a.stellplaetzeBenoetigt)
      );
      const gepackt = [];
      let belegteStellplaetze = 0;
      for (const f of sortiertNachDichte) {
        if (belegteStellplaetze + f.stellplaetzeBenoetigt <= fahrzeugStellplaetze) {
          gepackt.push(f);
          belegteStellplaetze += f.stellplaetzeBenoetigt;
        }
      }
      if (gepackt.length >= 2) bundles.push(gepackt);
    });

    return bundles;
  }

  /**
   * Bewertet ein Bündel mehrerer Teilladungen auf derselben Route wie eine
   * einzelne "virtuelle Fracht" mit summierter Vergütung/Stellplätzen und der
   * FRÜHESTEN Lieferfrist aller enthaltenen Aufträge (da alle zusammen mit
   * derselben Ankunftszeit ausgeliefert werden). Nutzt intern dieselbe
   * Bewertungslogik wie eine normale Einzelfracht.
   */
  function bewerteBundleFuerFahrzeug(bundleFrachten, vehicleStatus, liveStatus, aufbauTypLabel, fahrzeugStellplaetze, ladeKategorie = null) {
    const erste = bundleFrachten[0];
    const verguetungGesamt = bundleFrachten.reduce((sum, f) => sum + (f.verguetungEuro ?? 0), 0);
    const stellplaetzeGesamt = bundleFrachten.reduce((sum, f) => sum + (f.stellplaetzeBenoetigt ?? 0), 0);
    const fruehesteFrist = bundleFrachten.reduce((min, f) => {
      if (!f.lieferfrist) return min;
      return (!min || f.lieferfrist < min) ? f.lieferfrist : min;
    }, null);

    const virtuelleFracht = {
      ...erste,
      verguetungEuro: verguetungGesamt,
      stellplaetzeBenoetigt: stellplaetzeGesamt,
      lieferfrist: fruehesteFrist,
      preisProKm: null, // pro Einzelauftrag nicht mehr aussagekräftig, siehe Bündel-Anzeige
    };

    const bewertung = bewerteFrachtFuerFahrzeug(virtuelleFracht, vehicleStatus, liveStatus, aufbauTypLabel, fahrzeugStellplaetze, ladeKategorie);
    return { fracht: virtuelleFracht, bewertung, bundleFrachten };
  }

  /**
   * Baut Ketten-Kandidaten (Etappe 1 → Zwischenstadt → Etappe 2 → Zielstadt)
   * AUS DEMSELBEN, bereits geladenen Angebots-Datensatz - kein zweiter Scan
   * nötig. Idee: Aus den Angeboten mit Ziel = Zielstadt ("Etappe 2") ziehen
   * wir die Startorte als mögliche Zwischenstädte, und suchen im GLEICHEN
   * Datensatz nach Angeboten, die genau dort enden ("Etappe 1"). Das geht nur,
   * weil der serverseitige Ziel-Filter der Frachtbörse ohnehin unzuverlässig
   * ist und der Scan de facto viele verschiedene Zielorte mitliefert (siehe
   * Chat) - wir verlassen uns aber nicht mehr darauf, sondern filtern beide
   * Etappen clientseitig selbst.
   * @param {FrachtAngebot[]} alleAngebote Alle Angebote der Kategorie (UNGEFILTERT nach Ziel)
   * @param {string} zielStadt
   * @param {number} zielRadiusKm 0 = exakte Stadt, sonst Umkreis (z.B. Potsdam bei Berlin)
   * @returns {{etappe1: FrachtAngebot, etappe2: FrachtAngebot, zwischenstadt: string}[]}
   */
  function baueKettenKandidaten(alleAngebote, zielStadt, zielRadiusKm = 0) {
    const etappe2Kandidaten = filtereNachZielstadt(alleAngebote, zielStadt, zielRadiusKm);
    if (!etappe2Kandidaten.length) return [];

    const zwischenstaedte = new Set(etappe2Kandidaten.map(a => a.startOrt).filter(Boolean));
    if (!zwischenstaedte.size) return [];

    const etappe1Kandidaten = alleAngebote.filter(a => a.zielOrt && zwischenstaedte.has(a.zielOrt));

    const ketten = [];
    etappe1Kandidaten.forEach(e1 => {
      etappe2Kandidaten
        .filter(e2 => e2.startOrt === e1.zielOrt && e2.jobId !== e1.jobId)
        .forEach(e2 => ketten.push({ etappe1: e1, etappe2: e2, zwischenstadt: e1.zielOrt }));
    });
    return ketten;
  }

  /**
   * Bewertet eine 2-Etappen-Kette für ein Fahrzeug: Anfahrt → Etappe 1 (Laden/
   * Fahrt/Entladen) → OHNE weitere Anfahrt direkt Etappe 2 (Laden/Fahrt/
   * Entladen), da beide Etappen exakt in derselben Zwischenstadt aneinander
   * anschließen. Beide Etappen brauchen ihre EIGENE Lieferfrist-Prüfung -
   * Etappe 1 wird ja unterwegs abgeliefert, bevor Etappe 2 überhaupt beginnt.
   * Nutzt simuliereTourZeitplan zweimal nacheinander, wobei der Restzustand
   * (Lenkzeit/Schichtzeit) von Etappe 1 nahtlos in Etappe 2 weiterläuft.
   */
  function bewerteKetteFuerFahrzeug(kette, vehicleStatus, liveStatus, aufbauTypLabel, fahrzeugStellplaetze, ladeKategorie = null) {
    const { etappe1, etappe2 } = kette;
    if (!vehicleStatus?.freiAbOrt || !vehicleStatus?.freiAbZeit) return null;
    if (!etappe1.startOrt || !etappe1.zielOrt || !etappe2.zielOrt) return null;

    // Kapazität: beide Etappen laufen NACHEINANDER, nicht gleichzeitig - müssen
    // also nur JEWEILS EINZELN unter die Stellplatzgrenze passen, nicht summiert.
    if (fahrzeugStellplaetze != null) {
      if (etappe1.stellplaetzeBenoetigt != null && etappe1.stellplaetzeBenoetigt > fahrzeugStellplaetze) return null;
      if (etappe2.stellplaetzeBenoetigt != null && etappe2.stellplaetzeBenoetigt > fahrzeugStellplaetze) return null;
    }

    const anfahrtKm = geschaetzteStrassenKm(vehicleStatus.freiAbOrt, etappe1.startOrt);
    if (anfahrtKm === null) return null;
    const fahrt1Km = etappe1.entfernungKm ?? 0;
    const fahrt2Km = etappe2.entfernungKm ?? 0;

    const fahreranzahl = liveStatus?.drivers?.length >= 2 ? 2 : 1;
    const { restLenkzeitStunden, restSchichtzeitStunden, lenkzeitUngeprueft } = holeRestzeiten(vehicleStatus, liveStatus, fahreranzahl);

    const spezifikation = holeFahrzeugSpezifikation(aufbauTypLabel);
    const zeiten1 = berechneLadeEntladeZeiten(etappe1, spezifikation, fahreranzahl, fahrzeugStellplaetze, ladeKategorie);
    const zeiten2 = berechneLadeEntladeZeiten(etappe2, spezifikation, fahreranzahl, fahrzeugStellplaetze, ladeKategorie);
    const geschwindigkeit = spezifikation.geschwindigkeitKmh ?? ZEIT_ANNAHMEN.avgGeschwindigkeitKmh;

    // Etappe 1: Anfahrt zuerst SEPARAT simulieren, um den echten Beladungsstart
    // zu ermitteln (dieselbe Korrektur wie bei Einzel-Frachten, siehe Chat).
    const anfahrtSegment = [{ dauer: anfahrtKm / geschwindigkeit, istFahrt: true }];
    const anfahrtErgebnis = simuliereTourZeitplan(anfahrtSegment, fahreranzahl, restLenkzeitStunden, restSchichtzeitStunden);
    const beladungsStartZeit = new Date(vehicleStatus.freiAbZeit.getTime() + anfahrtErgebnis.gesamtStunden * 3600 * 1000);

    const restSegmenteEtappe1 = [
      { dauer: zeiten1.laden, istFahrt: false },
      { dauer: fahrt1Km / geschwindigkeit, istFahrt: true },
      { dauer: zeiten1.entladen, istFahrt: false },
    ];
    const restEtappe1 = simuliereTourZeitplan(restSegmenteEtappe1, fahreranzahl, anfahrtErgebnis.restPflichtpause, anfahrtErgebnis.restSchichtzeit);
    const teil1 = {
      gesamtStunden: anfahrtErgebnis.gesamtStunden + restEtappe1.gesamtStunden,
      anzahlSchichtpausen: anfahrtErgebnis.anzahlSchichtpausen + restEtappe1.anzahlSchichtpausen,
      restPflichtpause: restEtappe1.restPflichtpause,
      restSchichtzeit: restEtappe1.restSchichtzeit,
    };
    const zwischenankunft = new Date(vehicleStatus.freiAbZeit.getTime() + teil1.gesamtStunden * 3600 * 1000);
    const etappe1Schaffbar = etappe1.lieferfrist ? zwischenankunft <= etappe1.lieferfrist : null;

    // Etappe 2: direkt weiter mit Laden → Fahrt 2 → Entladen (KEINE erneute
    // Anfahrt nötig, Etappe 1 endet exakt dort, wo Etappe 2 beginnt) -
    // Restzustand (Lenk-/Schichtzeit) von Etappe 1 läuft nahtlos weiter.
    const segmenteEtappe2 = [
      { dauer: zeiten2.laden, istFahrt: false },
      { dauer: fahrt2Km / geschwindigkeit, istFahrt: true },
      { dauer: zeiten2.entladen, istFahrt: false },
    ];
    const teil2 = simuliereTourZeitplan(segmenteEtappe2, fahreranzahl, teil1.restPflichtpause, teil1.restSchichtzeit);
    const ankunftZeit = new Date(zwischenankunft.getTime() + teil2.gesamtStunden * 3600 * 1000);
    const etappe2Schaffbar = etappe2.lieferfrist ? ankunftZeit <= etappe2.lieferfrist : null;

    // Beide Fristen müssen passen - schlägt eine fehl, gilt die ganze Kette als nicht schaffbar
    const schaffbar = (etappe1Schaffbar === false || etappe2Schaffbar === false)
      ? false
      : (etappe1Schaffbar === null && etappe2Schaffbar === null ? null : true);

    const gesamtStunden = teil1.gesamtStunden + teil2.gesamtStunden;
    const anzahlSchichtpausen = teil1.anzahlSchichtpausen + teil2.anzahlSchichtpausen;
    const lenkzeitHinweis = anzahlSchichtpausen > 0
      ? `${anzahlSchichtpausen}x Schichtpause (${LENKZEIT_REGELN[fahreranzahl].schichtpauseStunden}h, ${fahreranzahl} Fahrer) über beide Etappen eingerechnet`
      : null;

    // Kosten: Anfahrt LEER, beide Fracht-Etappen BELADEN - keine Leerfahrt
    // zwischen den Etappen, da sie exakt an derselben Stadt anschließen.
    // Verschleiß fließt NICHT mehr ein (siehe bewerteFrachtFuerFahrzeug).
    const mautSatz = spezifikation.mautProKm ?? MAUT_SATZ_DEFAULT;
    const kostenAnfahrt = anfahrtKm * (dieselKostenProKm(false, spezifikation) + mautSatz);
    const kostenFahrt1 = fahrt1Km * (dieselKostenProKm(true, spezifikation) + mautSatz);
    const kostenFahrt2 = fahrt2Km * (dieselKostenProKm(true, spezifikation) + mautSatz);
    const deckungsbeitragEuro = (etappe1.verguetungEuro ?? 0) + (etappe2.verguetungEuro ?? 0) - kostenAnfahrt - kostenFahrt1 - kostenFahrt2;

    const gesamtFahrKm = anfahrtKm + fahrt1Km + fahrt2Km;
    const effektivProKm = gesamtFahrKm > 0 ? deckungsbeitragEuro / gesamtFahrKm : null;
    const anfahrtAnteilProzent = gesamtFahrKm > 0 ? Math.round((anfahrtKm / gesamtFahrKm) * 100) : null;

    // Planungsfenster-Check: gegen den ECHTEN Beladungsstart prüfen, nicht
    // gegen freiAbZeit (Bugfix, siehe Chat).
    const planungsfensterEnde = new Date(Date.now() + PLANUNGSFENSTER_STUNDEN * 3600 * 1000);
    const einplanbar = beladungsStartZeit.getTime() + aktuellerPlanungspuffer() * 3600 * 1000 <= planungsfensterEnde.getTime();
    const einplanbarHinweis = einplanbar ? null : baueEinplanbarHinweis(beladungsStartZeit, planungsfensterEnde);

    return {
      anfahrtKm, gesamtStunden, ankunftZeit, schaffbar, effektivProKm, deckungsbeitragEuro,
      kostenAnfahrt, anfahrtAnteilProzent, beladungsStartZeit,
      lenkzeitHinweis, lenkzeitUngeprueft,
      kapazitaetOk: true, kapazitaetHinweis: null,
      einplanbar, einplanbarHinweis,
      zwischenankunft, etappe1Schaffbar, etappe2Schaffbar,
      fahrerRestLenkEnde: teil2.restPflichtpause, fahrerRestSchichtEnde: teil2.restSchichtzeit,
    };
  }

  /**
   * Baut für JEDE im Datensatz vorkommende Route (exakter Start→Ziel) eine
   * einzelne "Etappe" - ggf. schon ein Bündel aus mehreren Teilladungen
   * (gleiche Greedy-Packstrategie wie baueBundlesFuerAlleRouten, aber auch
   * für nur 1 Auftrag, da eine Etappe allein schon eine gültige Kette von
   * Länge 1 ist). Grundlage für die Mehrstufige-Ketten-Suche unten.
   * @returns {Map<string, {startOrt, zielOrt, frachten: FrachtAngebot[], verguetungGesamt: number, stellplaetzeGesamt: number, entfernungKm: number, fruehesteFrist: Date|null}>}
   */
  function baueLegsProRoute(angebote, fahrzeugStellplaetze) {
    const legs = new Map();
    if (!fahrzeugStellplaetze) return legs;

    const gruppenNachRoute = new Map();
    angebote.forEach(f => {
      if (!f.startOrt || !f.zielOrt || f.startOrt === f.zielOrt) return;
      if (f.kapazitaet !== 'Teilladung') return; // Komplettladungen laufen schon als Einzel-Kandidat
      if (!f.stellplaetzeBenoetigt) return;
      const key = `${f.startOrt}→${f.zielOrt}`;
      if (!gruppenNachRoute.has(key)) gruppenNachRoute.set(key, []);
      gruppenNachRoute.get(key).push(f);
    });

    gruppenNachRoute.forEach((frachtenAufRoute, key) => {
      const sortiertNachDichte = [...frachtenAufRoute].sort(
        (a, b) => (b.verguetungEuro / b.stellplaetzeBenoetigt) - (a.verguetungEuro / a.stellplaetzeBenoetigt)
      );
      const gepackt = [];
      let belegteStellplaetze = 0;
      for (const f of sortiertNachDichte) {
        if (belegteStellplaetze + f.stellplaetzeBenoetigt <= fahrzeugStellplaetze) {
          gepackt.push(f);
          belegteStellplaetze += f.stellplaetzeBenoetigt;
        }
      }
      if (gepackt.length === 0) return;
      const erste = gepackt[0];
      legs.set(key, {
        startOrt: erste.startOrt,
        zielOrt: erste.zielOrt,
        frachten: gepackt,
        verguetungGesamt: gepackt.reduce((s, f) => s + (f.verguetungEuro ?? 0), 0),
        stellplaetzeGesamt: belegteStellplaetze,
        entfernungKm: erste.entfernungKm ?? 0,
        fruehesteFrist: gepackt.reduce((min, f) => {
          if (!f.lieferfrist) return min;
          return (!min || f.lieferfrist < min) ? f.lieferfrist : min;
        }, null),
      });
    });

    return legs;
  }

  /**
   * Verkettet Leg-Kandidaten zu Mehrstufigen Ketten (2 bis maxEtappen Etappen):
   * jede Folge-Etappe muss exakt an der Zielstadt der vorherigen anschließen -
   * live im Tourenplaner bestätigt (siehe Chat, ZM01+Auflieger-Test): mehrere
   * angenommene Teilladungen lassen sich über Belade-/Entladereihenfolge frei
   * zu EINER Tour kombinieren, ohne Leerkilometer zwischen Abladen und
   * Neu-Beladen an derselben Stadt. Tiefensuche ab JEDEM Leg als Kettenstart,
   * um auch Ketten zu finden, die nicht an der aktuellen Fahrzeugposition
   * beginnen (die Anfahrt zur ersten Etappe wird separat bewertet).
   * @param {Map} legsProRoute Rückgabe von baueLegsProRoute
   * @param {number} maxEtappen Obergrenze gegen Kombinatorik-Explosion
   */
  function baueMehrstufigeKetten(legsProRoute, maxEtappen = 3) {
    const legsAbStadt = new Map();
    legsProRoute.forEach(leg => {
      if (!legsAbStadt.has(leg.startOrt)) legsAbStadt.set(leg.startOrt, []);
      legsAbStadt.get(leg.startOrt).push(leg);
    });

    const ketten = [];
    function erweitere(pfad, besuchteStaedte) {
      if (pfad.length >= 2) ketten.push([...pfad]);
      if (pfad.length >= maxEtappen) return;
      const letzteStadt = pfad[pfad.length - 1].zielOrt;
      (legsAbStadt.get(letzteStadt) || []).forEach(leg => {
        if (besuchteStaedte.has(leg.zielOrt)) return; // keine Zyklen
        pfad.push(leg);
        besuchteStaedte.add(leg.zielOrt);
        erweitere(pfad, besuchteStaedte);
        besuchteStaedte.delete(leg.zielOrt);
        pfad.pop();
      });
    }
    legsProRoute.forEach(startLeg => {
      erweitere([startLeg], new Set([startLeg.startOrt, startLeg.zielOrt]));
    });
    return ketten;
  }

  /**
   * Generalisiert bewerteKetteFuerFahrzeug auf eine beliebige Anzahl Etappen.
   * Anfahrt nur EINMAL vor der ersten Etappe, danach schließt jede weitere
   * Etappe nahtlos an (kein Leerkilometer). Jede Etappe braucht ihre EIGENE
   * Fristen-Prüfung gegen ihre jeweils früheste Lieferfrist (bei gebündelten
   * Etappen: die früheste aller enthaltenen Aufträge).
   */
  function bewerteMehrstufigeKetteFuerFahrzeug(etappen, vehicleStatus, liveStatus, aufbauTypLabel, fahrzeugStellplaetze, ladeKategorie = null) {
    if (!vehicleStatus?.freiAbOrt || !vehicleStatus?.freiAbZeit) return null;
    const erste = etappen[0];
    if (!erste.startOrt) return null;
    if (fahrzeugStellplaetze != null) {
      for (const etappe of etappen) {
        if (etappe.stellplaetzeGesamt > fahrzeugStellplaetze) return null;
      }
    }

    const anfahrtKm = geschaetzteStrassenKm(vehicleStatus.freiAbOrt, erste.startOrt);
    if (anfahrtKm === null) return null;

    const fahreranzahl = liveStatus?.drivers?.length >= 2 ? 2 : 1;
    const { restLenkzeitStunden, restSchichtzeitStunden, lenkzeitUngeprueft } = holeRestzeiten(vehicleStatus, liveStatus, fahreranzahl);

    const spezifikation = holeFahrzeugSpezifikation(aufbauTypLabel);
    const geschwindigkeit = spezifikation.geschwindigkeitKmh ?? ZEIT_ANNAHMEN.avgGeschwindigkeitKmh;

    const anfahrtSegment = [{ dauer: anfahrtKm / geschwindigkeit, istFahrt: true }];
    let lauf = simuliereTourZeitplan(anfahrtSegment, fahreranzahl, restLenkzeitStunden, restSchichtzeitStunden);
    const beladungsStartZeit = new Date(vehicleStatus.freiAbZeit.getTime() + lauf.gesamtStunden * 3600 * 1000);
    let uhrzeit = beladungsStartZeit;

    let gesamtStunden = lauf.gesamtStunden;
    let anzahlSchichtpausen = lauf.anzahlSchichtpausen;
    let gesamtFahrtKm = 0;
    let schaffbarGesamt = true;
    let alleFristenUnbekannt = true;
    const etappenErgebnisse = [];

    for (const etappe of etappen) {
      const fahrtKm = etappe.entfernungKm ?? 0;
      const zeiten = berechneLadeEntladeZeiten(
        { ...etappe.frachten[0], stellplaetzeBenoetigt: etappe.stellplaetzeGesamt },
        spezifikation, fahreranzahl, fahrzeugStellplaetze, ladeKategorie);
      const segmente = [
        { dauer: zeiten.laden, istFahrt: false },
        { dauer: fahrtKm / geschwindigkeit, istFahrt: true },
        { dauer: zeiten.entladen, istFahrt: false },
      ];
      lauf = simuliereTourZeitplan(segmente, fahreranzahl, lauf.restPflichtpause, lauf.restSchichtzeit);
      uhrzeit = new Date(uhrzeit.getTime() + lauf.gesamtStunden * 3600 * 1000);
      gesamtStunden += lauf.gesamtStunden;
      anzahlSchichtpausen += lauf.anzahlSchichtpausen;
      gesamtFahrtKm += fahrtKm;
      const schaffbar = etappe.fruehesteFrist ? uhrzeit <= etappe.fruehesteFrist : null;
      if (schaffbar !== null) alleFristenUnbekannt = false;
      if (schaffbar === false) schaffbarGesamt = false;
      etappenErgebnisse.push({ ankunftZeit: uhrzeit, schaffbar, startOrt: etappe.startOrt, zielOrt: etappe.zielOrt });
    }

    const ankunftZeit = uhrzeit;
    const schaffbar = !schaffbarGesamt ? false : (alleFristenUnbekannt ? null : true);

    const lenkzeitHinweis = anzahlSchichtpausen > 0
      ? `${anzahlSchichtpausen}x Schichtpause (${LENKZEIT_REGELN[fahreranzahl].schichtpauseStunden}h, ${fahreranzahl} Fahrer) über ${etappen.length} Etappen eingerechnet`
      : null;

    const mautSatz = spezifikation.mautProKm ?? MAUT_SATZ_DEFAULT;
    const kostenAnfahrt = anfahrtKm * (dieselKostenProKm(false, spezifikation) + mautSatz);
    const kostenFahrten = gesamtFahrtKm * (dieselKostenProKm(true, spezifikation) + mautSatz);
    const verguetungGesamt = etappen.reduce((s, e) => s + (e.verguetungGesamt ?? 0), 0);
    const deckungsbeitragEuro = verguetungGesamt - kostenAnfahrt - kostenFahrten;

    const gesamtFahrKm = anfahrtKm + gesamtFahrtKm;
    const effektivProKm = gesamtFahrKm > 0 ? deckungsbeitragEuro / gesamtFahrKm : null;
    const anfahrtAnteilProzent = gesamtFahrKm > 0 ? Math.round((anfahrtKm / gesamtFahrKm) * 100) : null;

    const planungsfensterEnde = new Date(Date.now() + PLANUNGSFENSTER_STUNDEN * 3600 * 1000);
    const einplanbar = beladungsStartZeit.getTime() + aktuellerPlanungspuffer() * 3600 * 1000 <= planungsfensterEnde.getTime();
    const einplanbarHinweis = einplanbar ? null : baueEinplanbarHinweis(beladungsStartZeit, planungsfensterEnde);

    return {
      anfahrtKm, gesamtStunden, ankunftZeit, schaffbar, effektivProKm, deckungsbeitragEuro,
      kostenAnfahrt, anfahrtAnteilProzent, beladungsStartZeit,
      lenkzeitHinweis, lenkzeitUngeprueft,
      kapazitaetOk: true, kapazitaetHinweis: null,
      einplanbar, einplanbarHinweis,
      etappenErgebnisse,
      fahrerRestLenkEnde: lauf.restPflichtpause, fahrerRestSchichtEnde: lauf.restSchichtzeit,
    };
  }

  /**
   * Findet für jedes Fahrzeug das beste (schaffbare) Angebot aus einer Angebotsliste.
   * @param {FrachtAngebot[]} angebote
   * @param {{name: string, status: VehicleStatus, live: Object|null, typ: string}[]} fleet
   *        fleet[i].typ = ECHTER Fahrzeugtyp aus fuhrpark.php (Fallback: gesuchte Kategorie)
   * @param {string|null} zielReferenzStadt Bei Rückfracht-Suche: die Zielstadt (z.B. "Berlin"),
   *        um einen Umweg-Faktor zu berechnen (Gesamtstrecke ÷ Luftlinie-Direktverbindung).
   *        Ohne das würden Angebote mit Ziel Berlin, aber Startort in die falsche
   *        Richtung (z.B. erst weit nach Süden), fälschlich als "guter Rückweg" durchgehen.
   */
  function findeBesteRoutenProFahrzeug(angebote, fleet, zielReferenzStadt = null, zielRadiusKm = 0, ketten = true) {
    // Umweg-Freigrenze: bis hierhin keine Strafe, das ist ein normaler
    // Schlenker. Darüber hinaus wird jeder weitere Prozentpunkt Umweg mit
    // STRAFE_PRO_UMWEG_PUNKT vom effektiven €/km abgezogen - kein hartes
    // Ausschlusskriterium mehr, sondern ein Mittelweg: eine Route mit gutem
    // €/km, aber großem Umweg, kann so trotzdem noch "die beste verfügbare"
    // sein, wenn nichts Besseres da ist - rutscht aber automatisch weit nach
    // unten, sobald eine vernünftigere Alternative existiert.
    const UMWEG_FREIGRENZE_PROZENT = 50;
    const STRAFE_PRO_UMWEG_PUNKT = 0.03; // €/km Abzug je Prozentpunkt Umweg über der Freigrenze

    // ZUSÄTZLICH zur Umweg-Strafe: eine riesige Leerfahrt (Anfahrt) kann bei
    // einer lukrativen Fracht durch ein gutes €/km-Gesamtergebnis verschleiert
    // werden, obwohl ein Fahrzeug fast 1000km leer fährt, bevor überhaupt
    // Geld verdient wird (siehe Chat, Turin→Brügge-Beispiel). Deshalb eine
    // EIGENE Strafe direkt auf die Anfahrt-km, unabhängig vom Umweg-Faktor -
    // gilt immer, nicht nur bei der Rückfracht-Suche.
    const ANFAHRT_FREIGRENZE_KM = 150; // bis hierhin normale Positionierungsfahrt, keine Strafe
    const STRAFE_PRO_ANFAHRT_KM = 0.01; // €/km Abzug je km Anfahrt über der Freigrenze

    // SCORE = NETTOGEWINN PRO KM (inkl. Anfahrt) abzüglich Umweg-/Anfahrt-Strafen.
    // (Zwischenzeitlich auf €/h umgestellt - Nutzer will €/km, 2026-10-20.)
    function kombinierterScore(bewertung) {
      const umweg = bewertung.umwegProzent ?? 0;
      const umwegStrafe = Math.max(0, umweg - UMWEG_FREIGRENZE_PROZENT) * STRAFE_PRO_UMWEG_PUNKT;
      const anfahrtStrafe = Math.max(0, (bewertung.anfahrtKm ?? 0) - ANFAHRT_FREIGRENZE_KM) * STRAFE_PRO_ANFAHRT_KM;
      return (bewertung.effektivProKm ?? -Infinity) - umwegStrafe - anfahrtStrafe;
    }

    // Bei Rückfracht-Suche dürfen Einzel-Routen und Bündel NUR Angebote mit
    // echtem Ziel = zielReferenzStadt berücksichtigen (der Server-Zielfilter
    // ist unzuverlässig, siehe Chat - deshalb hier clientseitig geprüft).
    // Ketten-Kandidaten brauchen dagegen den VOLLEN, ungefilterten Datensatz,
    // um Zwischenetappen mit anderen Zielorten zu finden.
    const angeboteFuerDirekt = zielReferenzStadt
      ? filtereNachZielstadt(angebote, zielReferenzStadt, zielRadiusKm)
      : angebote;

    return fleet.map(fahrzeugRoh => {
      const fahrzeug = mitUrlaubsRueckkehr(fahrzeugRoh);
      const direktKm = (zielReferenzStadt && fahrzeug.status?.freiAbOrt)
        ? geschaetzteStrassenKm(fahrzeug.status.freiAbOrt, zielReferenzStadt)
        : null;

      // Nur Komplettladungen sind automatisch buchbar (Teilladungen irrelevant) - spart bei
      // vollem Markt-Scan (alle Seiten) den Großteil der Rechenzeit.
      const einzelBewertungen = angeboteFuerDirekt
        .filter(a => a.kapazitaet === 'Komplettladung' && a.jobId)
        .map(fracht => {
          const bewertung = bewerteFrachtFuerFahrzeug(fracht, fahrzeug.status, fahrzeug.live, fahrzeug.verbrauchsTyp ?? fahrzeug.typ, fahrzeug.stellplaetze ?? null, fahrzeug.typ);
          if (bewertung && direktKm) {
            const gesamtFahrKm = bewertung.anfahrtKm + (fracht.entfernungKm ?? 0);
            bewertung.umwegProzent = Math.round(((gesamtFahrKm / direktKm) - 1) * 100);
          }
          return { fracht, bewertung, istBundle: false };
        })
        .filter(x => x.bewertung !== null);

      const bundleBewertungen = []; // Teilladungs-Bündel sind nicht automatisch buchbar

      // Ketten-Kandidaten (Etappe 1 → Zwischenstadt → Etappe 2 → Ziel) - nur
      // sinnvoll bei Rückfracht-Suche mit bekannter Zielstadt, siehe Chat:
      // kein zweiter Scan nötig, wir mischen einfach denselben Datensatz.
      // 🏠-Fahrzeuge suchen zusätzlich Ketten (2 Komplettladungen), die in der Firma enden
      const kettenZiel = !ketten ? null : (zielReferenzStadt || (fahrzeug.heimkehr ? (parseFirmenstandort() || 'Berlin') : null));
      const kettenRadius = zielReferenzStadt ? zielRadiusKm : 30;
      const kettenBewertungen = kettenZiel
        ? baueKettenKandidaten(angebote.filter(a => a.kapazitaet === 'Komplettladung' && a.jobId), kettenZiel, kettenRadius)
            .map(kette => {
              const bewertung = bewerteKetteFuerFahrzeug(kette, fahrzeug.status, fahrzeug.live, fahrzeug.verbrauchsTyp ?? fahrzeug.typ, fahrzeug.stellplaetze ?? null, fahrzeug.typ);
              if (bewertung && direktKm) {
                const gesamtFahrKm = bewertung.anfahrtKm + (kette.etappe1.entfernungKm ?? 0) + (kette.etappe2.entfernungKm ?? 0);
                bewertung.umwegProzent = Math.round(((gesamtFahrKm / direktKm) - 1) * 100);
              }
              // Synthetische "Fracht" für einheitliche Anzeige (Route/Vergütung über beide Etappen)
              const virtuelleFracht = {
                startOrt: kette.etappe1.startOrt,
                zielOrt: kette.etappe2.zielOrt,
                entfernungKm: (kette.etappe1.entfernungKm ?? 0) + (kette.etappe2.entfernungKm ?? 0),
                verguetungEuro: (kette.etappe1.verguetungEuro ?? 0) + (kette.etappe2.verguetungEuro ?? 0),
                frachtName: `${kette.etappe1.frachtName} + ${kette.etappe2.frachtName}`,
                lieferfrist: kette.etappe2.lieferfrist,
                jobId: null, // Ketten werden über die Einzel-Jobs von Etappe 1/2 angenommen, nicht als ein Klick
                preisProKm: null,
              };
              return { fracht: virtuelleFracht, bewertung, istKette: true, kette };
            })
            .filter(x => x.bewertung !== null)
        : [];

      const mehrstufigeKettenBewertungen = []; // Teilladungs-/Mehrstufen-Ketten sind nicht automatisch buchbar

      // Urlaub: nichts planen, das mit einem (beantragten) Urlaub eines Fahrers
      // des Fahrzeugs kollidiert (Tour + Heimfahrt muss vor Urlaubsbeginn enden).
      let urlaubHinweis = null;
      // NUR BUCHBARE Kandidaten: einplanbar (Planungsfenster samt Sicherheitsabstand),
      // Frist einhaltbar (unbekannte Frist zählt als einhaltbar), per Skript buchbar
      // (Einzel-Komplettladung oder Kette aus zwei Komplettladungen, deren Etappe 2
      // ebenfalls noch im Fenster startet - keine Teilladungen/Bündel). Alles andere
      // wird gar nicht erst berücksichtigt.
      const fensterEndeMs = Date.now() + PLANUNGSFENSTER_STUNDEN * 3600 * 1000;
      const istBuchbar = k => {
        const b = k.bewertung;
        if (!b || !b.einplanbar || b.schaffbar === false) return false;
        if (k.istBundle || k.istMehrstufigeKette) return false;
        if (k.istKette) {
          const beideKomplett = k.kette.etappe1.kapazitaet === 'Komplettladung' && k.kette.etappe2.kapazitaet === 'Komplettladung';
          const etappe2Passt = b.zwischenankunft && (b.zwischenankunft.getTime() + 2 * 3600 * 1000) <= fensterEndeMs;
          return beideKomplett && !!etappe2Passt && !!k.kette.etappe1.jobId && !!k.kette.etappe2.jobId;
        }
        return k.fracht?.kapazitaet === 'Komplettladung' && !!k.fracht?.jobId;
      };
      const bewertungen = [...einzelBewertungen, ...bundleBewertungen, ...kettenBewertungen, ...mehrstufigeKettenBewertungen]
        .filter(istBuchbar)
        .filter(k => {
          const grund = urlaubskonflikt(fahrzeug, k.fracht?.zielOrt, k.bewertung?.ankunftZeit);
          if (grund && !urlaubHinweis) urlaubHinweis = grund;
          return !grund;
        });

      // Fristen-Einhaltung bleibt eine WEICHE Präferenz - lieber eine knapp
      // verpasste Frist zeigen als gar nichts, das ist informativ statt gefährlich.
      const schaffbare = bewertungen.filter(x => x.bewertung.schaffbar !== false); // true ODER unbekannt (null)
      let kandidaten = schaffbare; // schaffbare == bewertungen (Fristen sind oben schon ausgeschlossen)

      // 🏠-Fahrzeug: die Leerfahrt vom Zielort zurück in die Firma gehört zur Tour.
      // Keine Einschränkung auf Heimziele - ein Auftrag bis Fulda + Rückfahrt wird
      // einfach entsprechend schlechter (oder bleibt trotzdem der beste).
      if (fahrzeug.heimkehr) {
        const heimat = parseFirmenstandort() || 'Berlin';
        const spezHeim = holeFahrzeugSpezifikation(fahrzeug.verbrauchsTyp ?? fahrzeug.typ);
        const leerKostenProKm = dieselKostenProKm(false, spezHeim) + (spezHeim.mautProKm ?? MAUT_SATZ_DEFAULT);
        kandidaten.forEach(k => {
          const b = k.bewertung;
          const ziel = k.fracht?.zielOrt;
          const heimKm = !ziel || ziel === heimat ? 0 : geschaetzteStrassenKm(ziel, heimat);
          const gesamtKm = (b.anfahrtKm ?? 0) + (k.fracht?.entfernungKm ?? 0);
          if (heimKm == null || !(gesamtKm > 0) || b.deckungsbeitragEuro == null) return;
          b.heimfahrtKm = heimKm;
          b.deckungsbeitragEuro -= heimKm * leerKostenProKm;
          b.effektivProKm = b.deckungsbeitragEuro / (gesamtKm + heimKm);
        });
      }

      kandidaten.forEach(k => { k.bewertung.kombiScore = kombinierterScore(k.bewertung); });
      kandidaten.sort((a, b) => b.bewertung.kombiScore - a.bewertung.kombiScore);

      // VORAUSSCHAU (maximale Effektivität = wenig Leerfahrt bei viel Profit):
      // Ein Auftrag, der das Fahrzeug in eine Sackgasse (z.B. hoher Norden)
      // schickt, sieht allein gut aus, erzwingt aber danach eine lange
      // Leerfahrt. Deshalb wird für die besten Kandidaten zusätzlich der beste
      // ANSCHLUSSauftrag ab dem Zielort gesucht und das Paar als Ganzes
      // bewertet: (Profit A + Profit B) / (alle km inkl. beider Anfahrten).
      // Gebucht wird weiterhin nur der erste Auftrag - der Anschluss wird
      // beim nächsten Durchlauf mit echtem Fahrzeugstand neu bestimmt.
      const LOOKAHEAD_TOP = 12;
      const FOLGE_PRUEFEN = 40;
      const FOLGE_MAX_ANFAHRT_KM = 600;
      const frischeLive = fahrzeug.live?.drivers
        ? { ...fahrzeug.live, drivers: fahrzeug.live.drivers.map(d => ({ ...d, remaining_drive_seconds: null, remaining_shift_seconds: null })) }
        : null;
      kandidaten = kandidaten.slice(0, LOOKAHEAD_TOP);
      kandidaten.forEach(k => {
        const basis = k.bewertung;
        if (fahrzeug.heimkehr) return; // Heimfahrt ist schon eingerechnet, kein Anschlussauftrag
        if (basis.effektivProKm == null || !(basis.gesamtStunden > 0) || !k.fracht?.zielOrt || !basis.ankunftZeit) return;
        const belegt = new Set(holeJobIdsVonKandidat(k));
        const folgeStatus = {
          ...fahrzeug.status, freiAbOrt: k.fracht.zielOrt, freiAbZeit: basis.ankunftZeit,
          fahrerRestOverride: (basis.fahrerRestLenkEnde != null && basis.fahrerRestSchichtEnde != null)
            ? { restLenkzeitStunden: basis.fahrerRestLenkEnde, restSchichtzeitStunden: basis.fahrerRestSchichtEnde } : undefined,
        };
        const gesamtKmErster = (basis.anfahrtKm ?? 0) + (k.fracht.entfernungKm ?? 0);

        const folgeKandidaten = [];
        angebote.forEach(f => {
          if (!f.startOrt || !f.jobId || f.kapazitaet !== 'Komplettladung' || belegt.has(f.jobId)) return;
          const anfahrt = geschaetzteStrassenKm(k.fracht.zielOrt, f.startOrt);
          if (anfahrt === null || anfahrt > FOLGE_MAX_ANFAHRT_KM) return;
          const kmGesamt = anfahrt + (f.entfernungKm ?? 0);
          if (kmGesamt <= 0) return;
          folgeKandidaten.push({ f, schaetzung: (f.verguetungEuro ?? 0) / kmGesamt });
        });
        folgeKandidaten.sort((a, b) => b.schaetzung - a.schaetzung);

        let besteFolge = null;
        folgeKandidaten.slice(0, FOLGE_PRUEFEN).forEach(({ f }) => {
          const bF = bewerteFrachtFuerFahrzeug(f, folgeStatus, frischeLive, fahrzeug.verbrauchsTyp ?? fahrzeug.typ, fahrzeug.stellplaetze ?? null, fahrzeug.typ);
          if (!bF || bF.schaffbar === false || bF.deckungsbeitragEuro == null) return;
          if (urlaubskonflikt(fahrzeug, f.zielOrt, bF.ankunftZeit, basis.ankunftZeit)) return;
          const paarKm = gesamtKmErster + bF.anfahrtKm + (f.entfernungKm ?? 0);
          if (paarKm <= 0) return;
          const paarEff = (basis.deckungsbeitragEuro + bF.deckungsbeitragEuro) / paarKm; // €/km über beide Aufträge
          if (!besteFolge || paarEff > besteFolge.paarEff) besteFolge = { fracht: f, bewertung: bF, paarEff };
        });

        if (besteFolge) {
          const strafen = basis.effektivProKm - basis.kombiScore; // Umweg-/Anfahrt-Strafen des ersten Auftrags bleiben erhalten
          basis.kombiScore = besteFolge.paarEff - strafen;
          basis.folge = besteFolge;
        }
      });
      kandidaten.sort((a, b) => b.bewertung.kombiScore - a.bewertung.kombiScore);

      return {
        fahrzeugName: fahrzeug.name,
        vehicleId: fahrzeug.status?.vehicleId ?? null,
        freiAbZeit: fahrzeug.status?.freiAbZeit ?? null,
        // Top 8 statt nur der eine "beste" - wird für die fahrzeugübergreifende
        // Konfliktlösung gebraucht (siehe loeseFahrzeugKonflikte): falls der
        // Top-Kandidat schon einem anderen, besser passenden Fahrzeug zugeteilt
        // wurde, greift der Nächstbeste aus dieser Liste.
        kandidatenRangliste: kandidaten.slice(0, 8),
        hatSchaffbareOption: schaffbare.length > 0,
        anzahlBewertet: bewertungen.length,
        urlaubHinweis,
      };
    });
  }

  /**
   * Extrahiert alle echten Job-IDs eines Kandidaten (Einzel-Fracht: 1 ID,
   * Bündel: mehrere, Kette: 2 - eine je Etappe).
   */
  function holeJobIdsVonKandidat(eintrag) {
    if (!eintrag) return [];
    if (eintrag.istBundle) return eintrag.bundleFrachten.map(f => f.jobId).filter(Boolean);
    if (eintrag.istKette) return [eintrag.kette.etappe1.jobId, eintrag.kette.etappe2.jobId].filter(Boolean);
    if (eintrag.istMehrstufigeKette) return eintrag.etappen.flatMap(e => e.frachten.map(f => f.jobId)).filter(Boolean);
    return eintrag.fracht.jobId ? [eintrag.fracht.jobId] : [];
  }

  /**
   * Löst Konflikte auf, wenn mehrere Fahrzeuge denselben Auftrag als "beste
   * Option" vorgeschlagen bekämen (nur EINES kann ihn wirklich annehmen -
   * siehe Chat: KT01 und KT02 bekamen beide "Brügge → Berlin" vorgeschlagen,
   * obwohl KT02 viel näher dran war). Greedy-Zuteilung: über ALLE Fahrzeuge
   * und deren Top-Kandidaten hinweg wird nach Score sortiert, und jeder
   * Auftrag geht an das Fahrzeug, das ihn am besten nutzen kann - andere
   * Fahrzeuge rutschen auf ihren nächstbesten konfliktfreien Kandidaten.
   * @param {ReturnType<typeof findeBesteRoutenProFahrzeug>} besteProFahrzeugRoh
   */
  function loeseFahrzeugKonflikte(besteProFahrzeugRoh) {
    // Alle (Fahrzeug, Kandidat)-Paare flach sammeln, nach Score sortiert
    const alleOptionen = [];
    besteProFahrzeugRoh.forEach((eintrag, fahrzeugIndex) => {
      eintrag.kandidatenRangliste.forEach((kandidat, rang) => {
        alleOptionen.push({ fahrzeugIndex, kandidat, rang });
      });
    });
    alleOptionen.sort((a, b) => (b.kandidat.bewertung.kombiScore ?? -Infinity) - (a.kandidat.bewertung.kombiScore ?? -Infinity));

    const belegteJobIds = new Set();
    const zugewiesenesFahrzeug = new Array(besteProFahrzeugRoh.length).fill(null);
    const zugewiesenerRang = new Array(besteProFahrzeugRoh.length).fill(null);

    for (const option of alleOptionen) {
      if (zugewiesenesFahrzeug[option.fahrzeugIndex]) continue; // Fahrzeug hat schon was
      const jobIds = holeJobIdsVonKandidat(option.kandidat);
      if (jobIds.some(id => belegteJobIds.has(id))) continue; // Auftrag schon vergeben
      zugewiesenesFahrzeug[option.fahrzeugIndex] = option.kandidat;
      zugewiesenerRang[option.fahrzeugIndex] = option.rang;
      jobIds.forEach(id => belegteJobIds.add(id));
    }

    return besteProFahrzeugRoh.map((eintrag, i) => ({
      fahrzeugName: eintrag.fahrzeugName,
      vehicleId: eintrag.vehicleId,
      freiAbZeit: eintrag.freiAbZeit,
      beste: zugewiesenesFahrzeug[i],
      // Verdrängt = ein anderes Fahrzeug hat den eigentlichen Top-Kandidaten bekommen
      verdraengt: zugewiesenerRang[i] != null && zugewiesenerRang[i] > 0,
      hatSchaffbareOption: eintrag.hatSchaffbareOption,
      anzahlBewertet: eintrag.anzahlBewertet,
      urlaubHinweis: eintrag.urlaubHinweis ?? null,
    }));
  }

  // ============================================================
  // 5. BERECHNUNGSLOGIK
  // ============================================================

  const ASSUMPTIONS = {
    // NUR EIN FALLBACK für den Fall, dass fetchDieselPreis() (siehe unten)
    // scheitert - der Preis wird laut Spiel TÄGLICH neu berechnet, deshalb
    // wird er bei jedem Dashboard-Aufbau live von /game/pc.php geholt und
    // überschreibt diesen Wert zur Laufzeit (siehe renderActiveToursDashboard).
    dieselPreisProLiter: 2.03,
  };

  /**
   * KORREKTUR (2026-09-10, siehe Chat): Maut ist NICHT länderabhängig, wie
   * ursprünglich aus nur 11 Touren vermutet - das war ein Zufall der kleinen
   * Stichprobe. Live aus 17 echten "Tour abgeschlossen"-Postfach-Nachrichten
   * nachgerechnet (Originalmeldung mit "LKW-Maut: X € (Y km x Z EUR/km)"):
   * Kleintransporter zahlen IMMER 0,00 €, auch auf einer Route nach Polen
   * (Mailand → Katowice, KT 01, Maut 0,00 €). Der Solo-LKW Plane zahlt IMMER
   * genau 0,30 €/km auf die GESAMTE Strecke, auch auf einer Route, die gar
   * nicht durch Polen führt (Hamburg → Kuopio/Finnland, PL 01, 546,00 € =
   * 1820 km × 0,30 €/km). Der Satz hängt also am FAHRZEUGTYP, nicht am Land -
   * siehe mautProKm je Kategorie in FAHRZEUG_SPEZIFIKATIONEN. Für die drei
   * Kategorien ohne eigene Tour-Belege (Containerchassis, Gefahrguttanker,
   * Getreidekipper, Kühlkoffer, Lebensmitteltanker) ist 0,30 €/km wie bei
   * allen anderen echten LKW eine unverifizierte Annahme (MAUT_SATZ_DEFAULT).
   */
  const MAUT_SATZ_DEFAULT = 0.30;

  /**
   * Fahrzeugtyp-spezifische Daten - Verbrauch, Tank UND Lade-System.
   * "ladeSystem: 'fix'" = fester Wert (empirisch aus echten Kleintransporter-
   * Touren bestätigt: Be-/Entladen dauert dort konstant 1h, unabhängig von
   * Stellplätzen - vermutlich weil Kleintransporter gar keine Palettenslots
   * nutzen, siehe fuhrpark.php: "Stellplätze: 0").
   * "ladeSystem: 'palette'" = folgt der offiziellen Formel aus dem Spiel-Wiki
   * (10min Grundzeit + 1,5min/Stellplatz, gerundet auf 5min, mit Mindestzeit).
   */
  const FAHRZEUG_SPEZIFIKATIONEN = {
    'Kleintransporter': {
      geschwindigkeitKmh: 90, // aus Spiel-Phasenplänen kalibriert, siehe ZEIT_ANNAHMEN
      tankinhaltLiter: 80,
      verbrauchLeerLPro100km: 9.0,
      verbrauchBeladenLPro100km: 12.0,
      ladeSystem: 'fix',
      ladeZeitFixStunden: 1,
      mautProKm: 0, // live bestätigt, auch auf einer Polen-Route (siehe MAUT_SATZ_DEFAULT-Kommentar)
    },
    'Kofferaufbau': { // = "Solo-LKW Koffer" im Truck-Katalog/Fuhrpark
      tankinhaltLiter: 300,
      verbrauchLeerLPro100km: 21.0,
      verbrauchBeladenLPro100km: 25.0,
      ladeSystem: 'palette',
      stellplaetzeGesamt: 18,
      mautProKm: MAUT_SATZ_DEFAULT, // noch kein eigener Tour-Beleg, Annahme wie Tautliner/Plane (beide "echte LKW")
    },
    'Tautliner / Plane': { // = "Solo-LKW Plane" im Truck-Katalog/Fuhrpark
      tankinhaltLiter: 300,
      verbrauchLeerLPro100km: 19.0,
      verbrauchBeladenLPro100km: 24.0,
      ladeSystem: 'palette',
      stellplaetzeGesamt: 18,
      mautProKm: MAUT_SATZ_DEFAULT, // live bestätigt, auch auf einer Route ganz ohne Polen (Hamburg -> Kuopio)
    },
    // Sattelzugmaschinen ziehen NUR einen Auflieger und haben selbst keine
    // Ladefläche/Stellplätze (siehe Chat) - deshalb hier bewusst KEIN
    // stellplaetzeGesamt. Die echte Stellplatzzahl kommt live vom
    // gekoppelten Auflieger (siehe parseFuhrparkDetails/fahrzeugStellplaetze)
    // und wird in berechneLadeZeitStunden bevorzugt genutzt. Werte aus dem
    // Truck-Katalog/Wiki, noch nicht an einer echten Tour verifiziert.
    'Standard-Sattelzugmaschine': {
      tankinhaltLiter: 600,
      verbrauchLeerLPro100km: 25.0,
      verbrauchBeladenLPro100km: 32.0,
      ladeSystem: 'palette',
      mautProKm: MAUT_SATZ_DEFAULT,
    },
    'Premium-Sattelzugmaschine': {
      tankinhaltLiter: 1200,
      verbrauchLeerLPro100km: 19.0,
      verbrauchBeladenLPro100km: 24.0,
      ladeSystem: 'palette',
      mautProKm: MAUT_SATZ_DEFAULT,
    },
  };

  /**
   * Der Fuhrpark (fuhrpark.php, alt-Attribut der Fahrzeugbilder) nennt
   * Fahrzeuge nach ihrem MODELLNAMEN ("Solo-LKW Plane"), die Frachtbörse
   * filtert aber nach FRACHTTYP-KATEGORIE ("Tautliner / Plane") - zwei
   * unterschiedliche Namensräume für dasselbe Fahrzeug. Ohne diese Übersetzung
   * wurde ein Solo-LKW Plane fälschlich als "falscher Typ" für Tautliner/
   * Plane-Fracht aussortiert. Noch unvollständig - weitere Modelle folgen,
   * sobald ich ihre Fuhrpark-Bezeichnung kenne.
   */
  const FAHRZEUGTYP_ZU_KATEGORIE = {
    'Solo-LKW Plane': 'Tautliner / Plane',
    'Solo-LKW Koffer': 'Kofferaufbau',
    'Kleintransporter': 'Kleintransporter',
  };

  function normalisiereFahrzeugtyp(rohTyp) {
    if (!rohTyp) return rohTyp;
    return FAHRZEUGTYP_ZU_KATEGORIE[rohTyp] || rohTyp;
  }

  const FAHRZEUG_SPEZIFIKATION_PLATZHALTER = {
    tankinhaltLiter: null,
    verbrauchLeerLPro100km: 25.0,   // grober Platzhalter für unbekannte LKW-Klassen, NICHT verifiziert
    verbrauchBeladenLPro100km: 32.0,
    ladeSystem: 'fix',
    ladeZeitFixStunden: 1,
    mautProKm: MAUT_SATZ_DEFAULT, // unbekannte Klasse ist eher ein echter LKW als ein Kleintransporter
  };

  function holeFahrzeugSpezifikation(aufbauTypLabel) {
    return FAHRZEUG_SPEZIFIKATIONEN[aufbauTypLabel] || FAHRZEUG_SPEZIFIKATION_PLATZHALTER;
  }

  /** Dieselkosten pro km für einen gegebenen Zustand (leer/beladen) und Fahrzeugtyp */
  function dieselKostenProKm(beladen, spezifikation) {
    const verbrauch = beladen ? spezifikation.verbrauchBeladenLPro100km : spezifikation.verbrauchLeerLPro100km;
    return (verbrauch / 100) * ASSUMPTIONS.dieselPreisProLiter;
  }

  /**
   * Lade-/Entladezeit in Stunden - offizielle Formel aus dem Spiel-Wiki:
   * 10min Grundzeit + 1,5min je Stellplatz, auf 5-Minuten-Schritte gerundet,
   * mit Mindestzeit 15min (1 Fahrer) / 10min (2 Fahrer).
   * Für "Kleintransporter" (kein Stellplatz-System) gilt stattdessen die
   * empirisch bestätigte feste 1h.
   * ANNAHME bei Palette-Fahrzeugen: "Komplettladung" nutzt die VOLLE
   * Stellplatzzahl des Fahrzeugs - die Frachtbörse zeigt uns die exakte
   * Stellplatzzahl pro Auftrag aktuell nicht.
   * @param {number|null} fahrzeugStellplaetze Echte, live gelesene Stellplatzzahl
   *   (bei Sattelzug-Kombis vom gekoppelten Auflieger, z.B. 34) - hat Vorrang
   *   vor dem statischen spezifikation.stellplaetzeGesamt, das für solche
   *   Kombis gar nicht gepflegt ist (siehe FAHRZEUG_SPEZIFIKATIONEN).
   */
  function berechneLadeZeitStunden(spezifikation, fahreranzahl, fahrzeugStellplaetze = null) {
    if (spezifikation.ladeSystem === 'fix') {
      return spezifikation.ladeZeitFixStunden;
    }
    const stellplaetze = fahrzeugStellplaetze ?? spezifikation.stellplaetzeGesamt ?? 0;
    const rohMinuten = 10 + 1.5 * stellplaetze;
    const gerundetMinuten = Math.round(rohMinuten / 5) * 5;
    const mindestMinuten = fahreranzahl >= 2 ? 10 : 15;
    return Math.max(gerundetMinuten, mindestMinuten) / 60;
  }

  /**
   * Lade-/Entladezeit je Auftrag (beide in Stunden). Aus den vom Spiel selbst
   * erzeugten Phasenplänen abgeleitet (2026-10-19):
   *  - Getreidekipper: Laden 30 min, Entladen 10 min.
   *  - Plane-Komplettladung: Laden 90 min (auch Solo-LKW); Entladen 60 min bei
   *    "palettiert"-Ware, sonst 90 min (5 von 5 Beobachtungen - Hypothese).
   *  - Teilladung: Wiki-Formel mit der Stellplatzzahl des AUFTRAGS (nicht des Fahrzeugs).
   *  - Kleintransporter: fest 1 h; alles Übrige wie bisher (Formel, Fahrzeug-Stellplätze).
   * @param {Object} fracht FrachtAngebot (oder Pseudo-Fracht mit kapazitaet/frachtName/stellplaetzeBenoetigt)
   * @param {string|null} ladeKategorie Frachtbörsen-Kategorie des Fahrzeugs (Auflieger-Typ), nicht der Zugmaschine
   */
  function berechneLadeEntladeZeiten(fracht, spezifikation, fahreranzahl, fahrzeugStellplaetze, ladeKategorie = null) {
    if (ladeKategorie === 'Getreidekipper') return { laden: 30 / 60, entladen: 10 / 60 };
    if (spezifikation.ladeSystem === 'fix') {
      const z = berechneLadeZeitStunden(spezifikation, fahreranzahl, fahrzeugStellplaetze);
      return { laden: z, entladen: z };
    }
    if (ladeKategorie === 'Tautliner / Plane' && fracht?.kapazitaet === 'Komplettladung') {
      return { laden: 1.5, entladen: /palettiert/i.test(fracht.frachtName ?? '') ? 1.0 : 1.5 };
    }
    const stellplaetze = fracht?.kapazitaet === 'Teilladung' && fracht.stellplaetzeBenoetigt
      ? fracht.stellplaetzeBenoetigt : fahrzeugStellplaetze;
    const z = berechneLadeZeitStunden(spezifikation, fahreranzahl, stellplaetze);
    return { laden: z, entladen: z };
  }

  /**
   * Parst /game/fuhrpark.php und liefert für jedes Fahrzeug:
   * - den ECHTEN Typ (aus dem alt-Attribut des Vorschaubilds - zuverlässiger
   *   als der Name, der ja frei umbenannt werden kann)
   * - die AKTUELLE Stellplatzzahl (berücksichtigt automatisch, ob gerade ein
   *   Anhänger angekoppelt ist - z.B. 18 solo, 36 mit passendem Anhänger)
   * - ob mindestens ein Fahrer zugewiesen ist (ohne Fahrer taucht das
   *   Fahrzeug NICHT in der Disposition auf und wird von uns sonst nirgends
   *   erfasst - das war der Grund für "mein neuer LKW wird nicht berücksichtigt")
   * - bei einer Sattelzugmaschine mit gekoppeltem Auflieger zusätzlich den
   *   ECHTEN Auflieger-Typ (siehe frachtKategorie unten - live verifiziert an
   *   "ZM 01"/"PL 02": Zugmaschine und Auflieger sind zwei EIGENE
   *   .fleet-card-Elemente mit identischem .fleet-plate-Kennzeichen, aber nur
   *   die Zugmaschine hat eine data-vehicle-id; der Auflieger taucht in
   *   dispatch.php gar nicht separat auf - für uns bleibt es EIN Fahrzeug,
   *   wie vom Nutzer gewünscht, nur mit zwei Spezifikations-Quellen: Diesel/
   *   Maut/Ladezeit richten sich nach der Zugmaschine (typ), die
   *   Frachtbörsen-Kompatibilität nach dem Auflieger (frachtKategorie).
   * @returns {Map<string, {typ: string, frachtKategorie: string|null, stellplaetze: number|null, hatFahrer: boolean, verschleiss: VerschleissInfo, auflieger: VerschleissInfo|null}>}
   */
  /**
   * @typedef {Object} VerschleissInfo
   * @property {number|null} zustandProzent
   * @property {string|null} zustandStufe    // 'good'/'ok'/'warn'/'danger' - Klassenname direkt vom Spiel, keine eigene Schwelle
   * @property {string|null} huDatum         // "DD.MM.YYYY"
   * @property {string|null} huStatus        // 'valid'/'warning'/'critical'/'expired'/'missing' - direkt aus der Spiel-CSS-Klasse
   */

  /** Liest Zustand-% und HU-Badge aus EINER Fahrzeug-/Auflieger-Karte. */
  function parseVerschleiss(card) {
    const zustandContainer = card.querySelector(SELECTORS.fuhrparkZustand);
    const zustandText = zustandContainer ? [...zustandContainer.querySelectorAll('span')].map(s => s.textContent.trim()).find(t => /%/.test(t)) : null;
    const zustandProzent = zustandText ? parseGermanNumber(zustandText) : null;
    const zustandStufe = zustandContainer?.querySelector('.mini-fill')?.className.replace('mini-fill', '').trim() || null;

    const huBadge = card.querySelector(SELECTORS.fuhrparkHuBadge);
    const huDatumMatch = /(\d{2}\.\d{2}\.\d{4})/.exec(huBadge?.getAttribute('title') || '');
    const huStufeMatch = /fi-inspection-due-badge--(\w+)/.exec(huBadge?.className || '');

    return {
      zustandProzent,
      zustandStufe,
      huDatum: huDatumMatch ? huDatumMatch[1] : null,
      huStatus: huStufeMatch ? huStufeMatch[1] : null,
    };
  }

  function parseFuhrparkDetails(root = document) {
    // Zugmaschine -> Auflieger-Zuordnung: NICHT über das Kennzeichen (siehe Chat,
    // 2026-09-28 - PL04 hatte ein anderes Kennzeichen als sein eigener Auflieger,
    // das Kennzeichen ist KEIN verlässlicher Schlüssel), sondern über den
    // expliziten "Auflieger ansehen"-Link auf der Zugmaschinen-Karte
    // (.fleet-coupled-preview, href endet auf "#trailer-<id>" = die id des
    // Auflieger-<article>). Fallback aufs Kennzeichen nur, falls dieser Link
    // mal fehlt (z.B. Markup-Änderung).
    const aufliegerTypNachId = new Map();
    const aufliegerTypNachKennzeichen = new Map();
    const aufliegerVerschleissNachId = new Map();
    root.querySelectorAll(SELECTORS.fuhrparkAufliegerCard).forEach(card => {
      const typ = card.querySelector(SELECTORS.fuhrparkTypBild)?.getAttribute('alt')?.trim();
      if (!typ) return;
      if (card.id) {
        aufliegerTypNachId.set(card.id, typ);
        aufliegerVerschleissNachId.set(card.id, parseVerschleiss(card));
      }
      const kennzeichen = card.querySelector(SELECTORS.fuhrparkKennzeichen)?.textContent.trim();
      if (kennzeichen) aufliegerTypNachKennzeichen.set(kennzeichen, typ);
    });

    const details = new Map();
    root.querySelectorAll(SELECTORS.fuhrparkCard).forEach(card => {
      const vehicleId = card.dataset.vehicleId;
      if (!vehicleId) return;
      const typ = card.querySelector(SELECTORS.fuhrparkTypBild)?.getAttribute('alt')?.trim() || null;
      const coupledHref = card.querySelector(SELECTORS.fuhrparkCoupledLink)?.getAttribute('href') || '';
      const trailerId = /#(trailer-[\w-]+)/.exec(coupledHref)?.[1] || null;
      const kennzeichen = card.querySelector(SELECTORS.fuhrparkKennzeichen)?.textContent.trim();
      const frachtKategorie = (trailerId && aufliegerTypNachId.get(trailerId))
        || (kennzeichen && aufliegerTypNachKennzeichen.get(kennzeichen))
        || null;

      let stellplaetze = null;
      let hatFahrer = false;
      card.querySelectorAll(SELECTORS.fuhrparkInfoZeilen).forEach(zeile => {
        const label = zeile.querySelector('span')?.textContent.trim();
        const wert = zeile.querySelector('strong')?.textContent.trim();
        if (label === 'Stellplätze' && wert) {
          const n = parseInt(wert.replace(/\D/g, ''), 10);
          stellplaetze = Number.isFinite(n) ? n : null;
        }
        if (label === 'Fahrer 1' && wert && wert !== '-') {
          hatFahrer = true;
        }
      });

      const verschleiss = parseVerschleiss(card);
      const auflieger = trailerId ? (aufliegerVerschleissNachId.get(trailerId) || null) : null;

      details.set(vehicleId, { typ, frachtKategorie, stellplaetze, hatFahrer, verschleiss, auflieger });
    });
    return details;
  }

  /**
   * Holt die Fuhrpark-Details per fetch() nach, egal auf welcher Seite man
   * gerade ist. Ändert sich nur beim Kauf/Verkauf von Fahrzeugen/Anhängern
   * oder neuer Fahrer-Zuweisung - deshalb gecached (30 Min., siehe
   * NEBEN_DATEN_CACHE_TTL_MS), im Gegensatz zum eigentlichen Fahrzeug-Status.
   * @param {boolean} erzwingeNeuladen Cache umgehen (🔄-Knopf)
   */
  async function fetchFuhrparkDetails(erzwingeNeuladen = false) {
    if (!erzwingeNeuladen && nebenDatenCacheIstFrisch(fuhrparkDetailsCache)) {
      return fuhrparkDetailsCache.daten;
    }
    try {
      const onFuhrparkPage = /\/game\/fuhrpark\.php/.test(location.pathname);
      const daten = onFuhrparkPage
        ? parseFuhrparkDetails()
        : await protokolliereAbruf('Fuhrpark (fuhrpark.php)', async () => {
            const res = await fiFetch('/game/fuhrpark.php', { credentials: 'same-origin', cache: 'no-store' });
            if (!res.ok) return new Map();
            const html = await res.text();
            const doc = safeParseHtml(html);
            return parseFuhrparkDetails(doc);
          });
      fuhrparkDetailsCache = { daten, zeitstempel: Date.now() };
      return daten;
    } catch (e) {
      console.warn('[FI-Helper] Fuhrpark-Details konnten nicht geladen werden', e);
      return fuhrparkDetailsCache?.daten ?? new Map();
    }
  }

  /** {wert: number, datumIso: string} - Diesel ändert sich laut Spiel nur täglich, siehe fetchDieselPreis. */
  let dieselPreisCache = null;

  /**
   * Holt den aktuellen Diesel-Marktpreis von /game/pc.php per fetch() nach.
   * Der Preis wird laut Spiel TÄGLICH neu berechnet - ein zweiter Abruf am
   * selben Kalendertag würde also garantiert denselben Wert liefern, deshalb
   * hier über den Kalendertag gecached (nicht über eine feste TTL). Fällt
   * auf den zuletzt bekannten ASSUMPTIONS-Wert zurück, falls der Abruf
   * scheitert.
   * @param {boolean} erzwingeNeuladen Cache umgehen (🔄-Knopf)
   * @returns {Promise<number|null>}
   */
  async function fetchDieselPreis(erzwingeNeuladen = false) {
    const heute = new Date();
    const datumIso = `${heute.getFullYear()}-${String(heute.getMonth() + 1).padStart(2, '0')}-${String(heute.getDate()).padStart(2, '0')}`;
    if (!erzwingeNeuladen && dieselPreisCache?.datumIso === datumIso) {
      return dieselPreisCache.wert;
    }
    try {
      const wert = await protokolliereAbruf('Dieselpreis (pc.php)', async () => {
        const onPcPage = /\/game\/pc\.php/.test(location.pathname);
        const doc = onPcPage ? document : safeParseHtml(await (await fiFetch('/game/pc.php', { credentials: 'same-origin', cache: 'no-store' })).text());
        const text = doc.querySelector(SELECTORS.dieselMarktpreis)?.textContent;
        return parseGermanNumber(text);
      });
      if (wert != null) dieselPreisCache = { wert, datumIso };
      return wert;
    } catch (e) {
      console.warn('[FI-Helper] Diesel-Marktpreis konnte nicht geladen werden', e);
      return dieselPreisCache?.wert ?? null;
    }
  }

  const ZEIT_ANNAHMEN = {
    // Kalibriert 2026-10-19 an den vom Spiel selbst erzeugten Phasenplänen
    // (reine Fahrzeit je Strecke, Pausen herausgerechnet, Strecke = unsere
    // geschaetzteStrassenKm): Standard-Sattelzugmaschine mit Plane/Getreide
    // 79,0 / 79,0 / 79,0 / 78,9 km/h, Kleintransporter 89,9 / 90,0 km/h.
    // Dieser Wert gilt für alle "echten LKW"; Kleintransporter siehe
    // geschwindigkeitKmh in FAHRZEUG_SPEZIFIKATIONEN.
    avgGeschwindigkeitKmh: 79,
  };

  /**
   * OFFIZIELLE Regel aus dem Spiel-Wiki (Disponentenregeln): Ohne Disponent
   * darf nur 24h im Voraus geplant werden - jeder weitere Disponent
   * erweitert das Fenster um 24h. `let` statt `const`, weil
   * aktualisierePlanungsfenster() den Wert bei jedem Dashboard-Aufbau aus
   * der echten Disponenten-Anzahl (staff.php) neu berechnet - 24 ist nur
   * der Fallback, falls der Abruf scheitert oder auf 0 Disponenten passt.
   */
  let PLANUNGSFENSTER_STUNDEN = 24;
  // Sicherheitsabstand zum Fensterende: siehe aktuellerPlanungspuffer() (aus Messungen).

  /**
   * Zählt die Disponenten in der Personalliste (/game/staff.php) - jede
   * Personal-Kachel hat ein `.role`-Element mit dem Rollentext ("Fahrer",
   * "Disponent", "Mechaniker", ...), siehe Chat/Nutzerhinweis. Ändert sich
   * nur beim Einstellen/Kündigen von Personal - deshalb gecached (30 Min.,
   * siehe NEBEN_DATEN_CACHE_TTL_MS).
   * @param {boolean} erzwingeNeuladen Cache umgehen (🔄-Knopf)
   * @returns {Promise<number>}
   */
  async function fetchDisponentenAnzahl(erzwingeNeuladen = false) {
    if (!erzwingeNeuladen && nebenDatenCacheIstFrisch(disponentenAnzahlCache)) {
      return disponentenAnzahlCache.anzahl;
    }
    try {
      const anzahl = await protokolliereAbruf('Disponenten (staff.php)', async () => {
        const onStaffPage = /\/game\/staff\.php/.test(location.pathname);
        const doc = onStaffPage ? document : safeParseHtml(await (await fiFetch('/game/staff.php', { credentials: 'same-origin', cache: 'no-store' })).text());
        const rollen = Array.from(doc.querySelectorAll(SELECTORS.staffRolle)).map(el => el.textContent.trim());
        return rollen.filter(r => r === 'Disponent').length;
      });
      disponentenAnzahlCache = { anzahl, zeitstempel: Date.now() };
      return anzahl;
    } catch (e) {
      console.warn('[FI-Helper] Disponenten-Anzahl konnte nicht geladen werden', e);
      return disponentenAnzahlCache?.anzahl ?? 0;
    }
  }

  /**
   * Berechnet PLANUNGSFENSTER_STUNDEN aus der echten Disponenten-Anzahl neu
   * (24h ohne Disponent, +24h je Disponent - siehe fetchDisponentenAnzahl).
   * Wird einmal pro "Beste Routen berechnen"-Lauf aufgerufen, BEVOR die
   * Routen bewertet werden (siehe routenBerechnen).
   * @param {boolean} erzwingeNeuladen Cache umgehen (🔄-Knopf)
   */
  let planungsfensterProbe = null; // {stunden, zeit, anzahl}: zuletzt vom Spiel gelesenes Fenster (rollend: Länge bleibt, Ende wandert mit der Uhr)
  async function aktualisierePlanungsfenster(erzwingeNeuladen = false) {
    const anzahlDisponenten = await fetchDisponentenAnzahl(erzwingeNeuladen);
    PLANUNGSFENSTER_STUNDEN = 24 * (1 + anzahlDisponenten);
    // Probe nur alle 30 Min. (oder bei geänderter Disponentenzahl / 🔄) - sonst die zuletzt gelesene Fensterlänge verwenden
    if (!erzwingeNeuladen && planungsfensterProbe && planungsfensterProbe.anzahl === anzahlDisponenten && Date.now() - planungsfensterProbe.zeit < 30 * 60 * 1000) {
      PLANUNGSFENSTER_STUNDEN = planungsfensterProbe.stunden;
      return;
    }

    // Exaktes Fensterende direkt vom Spiel: ein absichtlich unmöglicher
    // Planungsversuch (nicht existierende Auftrags-/Fahrzeug-ID, Start weit in
    // der Zukunft) wird mit "Maximal erlaubt bis TT.MM.JJJJ HH:MM" abgelehnt -
    // bucht und ändert nichts. Überschreibt die Berechnung aus der
    // Disponenten-Anzahl (die z.B. nach einer Einstellung veraltet wäre).
    try {
      const start = new Date(Date.now() + 240 * 3600 * 1000);
      const pad = n => String(n).padStart(2, '0');
      const datum = `${start.getFullYear()}-${pad(start.getMonth() + 1)}-${pad(start.getDate())}`;
      const res = await fiFetch('/game/plan_dispatch_order.php', {
        method: 'POST',
        fiLesend: true, // Probe mit Fantasie-IDs: ändert nichts im Spiel, darf den Abruf-Speicher nicht leeren
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ order_id: '999999999', partial_tour_id: '', vehicle_id: '999999999', planned_start_at: `${datum}T${pad(start.getHours())}:${pad(start.getMinutes())}`, view_date: datum }),
      });
      const doc = safeParseHtml(await res.text());
      const text = doc.querySelector('.flash.error')?.textContent ?? '';
      const m = /Maximal erlaubt bis (\d{2})\.(\d{2})\.(\d{4}) (\d{2}):(\d{2})/.exec(text);
      if (m) {
        const ende = new Date(+m[3], +m[2] - 1, +m[1], +m[4], +m[5]);
        const stunden = (ende.getTime() - Date.now()) / 3600000;
        if (stunden > 1 && stunden < 24 * 30) {
          PLANUNGSFENSTER_STUNDEN = stunden;
          planungsfensterProbe = { stunden, zeit: Date.now(), anzahl: anzahlDisponenten };
        }
      }
    } catch (e) {
      console.warn('[FI-Helper] Exaktes Planungsfenster nicht lesbar - Berechnung aus Disponenten-Anzahl bleibt', e);
    }
  }

  /**
   * OFFIZIELLE Lenkzeit-Regeln aus dem Spiel-Wiki (Disposition im Detail).
   * Komplett andere Werte je nachdem, ob 1 oder 2 Fahrer zugewiesen sind.
   */
  const LENKZEIT_REGELN = {
    1: { fahrzeitAmStueck: 4.5, pflichtpauseStunden: 0.75, maxFahrzeitJeSchicht: 9, schichtpauseStunden: 11, spaetestesSchichtendeStunden: 15 },
    2: { fahrzeitAmStueck: 9, pflichtpauseStunden: 0.75, maxFahrzeitJeSchicht: 18, schichtpauseStunden: 9, spaetestesSchichtendeStunden: 21 },
  };

  /**
   * Simuliert eine komplette Tour inkl. aller Pflichtpausen UND Schichtpausen
   * nach den ECHTEN Spielregeln - jetzt generalisiert auf eine BELIEBIGE
   * Segment-Liste (nicht mehr fest auf Anfahrt/Laden/Fahrt/Entladen begrenzt),
   * damit sich auch mehrstufige Ketten-Touren (Etappe 1 + Etappe 2) simulieren
   * lassen, indem man den Restzustand von Etappe 1 als Startwert für Etappe 2
   * weiterreicht (siehe bewerteKetteFuerFahrzeug).
   *
   * WICHTIGE KORREKTUR (validiert an echtem Beispiel, siehe Chat): Die
   * "spätestes Schichtende"-Regel (15h/21h) ist eine reine WANDUHR-Grenze -
   * sie läuft auch während Lade-/Entladezeiten weiter, nicht nur beim Fahren!
   * Nur die kurze 45-Minuten-Pflichtpause (nach 4,5h/9h) ist rein fahrzeitbasiert.
   *
   * @param {{dauer: number, istFahrt: boolean}[]} segmente
   * @param {number} fahreranzahl 1 oder 2
   * @param {number|null} restLenkzeitStunden Live "Restfahrzeit" (bis nächste 45-Min-Pflichtpause, NUR Fahrzeit)
   * @param {number|null} restSchichtzeitStunden Live "Rest-Schichtzeit" (Wanduhr bis Schichtpause, Fahrt+Laden)
   * @returns {{gesamtStunden: number, anzahlSchichtpausen: number, anzahlPflichtpausen: number, restPflichtpause: number, restSchichtzeit: number}}
   */
  function simuliereTourZeitplan(segmente, fahreranzahl, restLenkzeitStunden, restSchichtzeitStunden) {
    const regeln = LENKZEIT_REGELN[fahreranzahl] || LENKZEIT_REGELN[1];
    let gesamtStunden = 0;
    let anzahlSchichtpausen = 0;
    let anzahlPflichtpausen = 0;
    let bisPflichtpause = restLenkzeitStunden ?? regeln.fahrzeitAmStueck;
    let bisSchichtpause = restSchichtzeitStunden ?? regeln.spaetestesSchichtendeStunden;

    let iterationen = 0; // Sicherheitsdeckel gegen Endlosschleifen bei kaputten Eingabewerten
    for (const segment of segmente) {
      let rest = segment.dauer;
      while (rest > 1e-9 && iterationen < 1000) {
        iterationen++;
        // Fahrt-Segmente werden zusätzlich durch die kurze Pflichtpausen-Uhr begrenzt,
        // Lade-/Entlade-Segmente NUR durch die Schichtuhr.
        let limit = Math.min(rest, bisSchichtpause);
        if (segment.istFahrt) limit = Math.min(limit, bisPflichtpause);

        gesamtStunden += limit;
        rest -= limit;
        bisSchichtpause -= limit;
        if (segment.istFahrt) bisPflichtpause -= limit;

        if (rest <= 1e-9) break; // Segment fertig abgearbeitet

        if (bisSchichtpause <= 1e-9) {
          gesamtStunden += regeln.schichtpauseStunden;
          anzahlSchichtpausen++;
          bisPflichtpause = regeln.fahrzeitAmStueck;
          bisSchichtpause = regeln.spaetestesSchichtendeStunden;
        } else if (segment.istFahrt && bisPflichtpause <= 1e-9) {
          gesamtStunden += regeln.pflichtpauseStunden;
          anzahlPflichtpausen++;
          bisPflichtpause = regeln.fahrzeitAmStueck;
          // bisSchichtpause läuft unverändert weiter - nur die 45-Min-Pause wurde verbraucht
        }
      }
    }

    return { gesamtStunden, anzahlSchichtpausen, anzahlPflichtpausen, restPflichtpause: bisPflichtpause, restSchichtzeit: bisSchichtpause };
  }

  // ============================================================
  // 5b. STÄDTE-KOORDINATEN & ENTFERNUNGSSCHÄTZUNG
  //     Statische Tabelle als OFFLINE-FALLBACK, falls fetchStaedteDaten()
  //     mal fehlschlägt - im Normalfall wird sie beim Dashboard-Aufbau durch
  //     die echten Spieldaten aus /game/api/europe-map-data.php überschrieben
  //     (siehe fetchStaedteDaten weiter unten), inkl. aller vom Spiel neu
  //     hinzugefügten Städte. Kalibriert an zwei echten Frachtbörsen-Routen:
  //     Minden→Aachen (Luftlinie 258km, Spiel 323km) und
  //     Gent→Berlin (Luftlinie 685km, Spiel 860km) -> beide Faktor 1,25.
  // ============================================================
  // 3. Element je Stadt = Länder-Code (ISO 3166-1 alpha-2) - NICHT mehr für
  // die Maut gebraucht (die ist fahrzeugtyp-, nicht länderabhängig, siehe
  // MAUT_SATZ_DEFAULT), aber z.B. für Stadtnamen mit Länderkürzel nützlich.
  // 4. Element = Logistikfaktor der Stadt (aus der API, siehe Chat -
  // Bedeutung noch nicht geklärt, aber schon mal mitgespeichert).
  let CITY_COORDS = {'Dornbirn':[47.41,9.74,'AT'],'Graz':[47.07,15.44,'AT'],'Innsbruck':[47.27,11.39,'AT'],'Klagenfurt':[46.62,14.31,'AT'],'Linz':[48.31,14.29,'AT'],'Salzburg':[47.8,13.05,'AT'],'Sankt Pölten':[48.2,15.62,'AT'],'Villach':[46.61,13.86,'AT'],'Wels':[48.16,14.03,'AT'],'Wien':[48.21,16.37,'AT'],'Antwerpen':[51.22,4.4,'BE'],'Brügge':[51.21,3.22,'BE'],'Brüssel':[50.85,4.35,'BE'],'Charleroi':[50.41,4.44,'BE'],'Gent':[51.05,3.72,'BE'],'Leuven':[50.88,4.7,'BE'],'Lüttich':[50.63,5.57,'BE'],'Mechelen':[51.03,4.48,'BE'],'Mons':[50.45,3.95,'BE'],'Namur':[50.47,4.87,'BE'],'Brünn':[49.2,16.61,'CZ'],'Budweis':[48.97,14.47,'CZ'],'Hradec Králové':[50.21,15.83,'CZ'],'Liberec':[50.77,15.06,'CZ'],'Olmütz':[49.59,17.25,'CZ'],'Ostrava':[49.84,18.29,'CZ'],'Pardubice':[50.04,15.78,'CZ'],'Pilsen':[49.74,13.38,'CZ'],'Prag':[50.08,14.44,'CZ'],'Ústí nad Labem':[50.66,14.03,'CZ'],'Aachen':[50.78,6.08,'DE'],'Aalen':[48.84,10.09,'DE'],'Arnsberg':[51.4,8.05,'DE'],'Aschaffenburg':[49.98,9.15,'DE'],'Augsburg':[48.37,10.9,'DE'],'Bamberg':[49.9,10.9,'DE'],'Bayreuth':[49.95,11.58,'DE'],'Bergheim':[50.96,6.64,'DE'],'Bergisch Gladbach':[50.99,7.13,'DE'],'Berlin':[52.52,13.4,'DE'],'Bielefeld':[52.02,8.53,'DE'],'Bocholt':[51.84,6.61,'DE'],'Bochum':[51.48,7.22,'DE'],'Bonn':[50.74,7.1,'DE'],'Bottrop':[51.52,6.93,'DE'],'Brandenburg an der Havel':[52.41,12.55,'DE'],'Braunschweig':[52.27,10.52,'DE'],'Bremen':[53.08,8.81,'DE'],'Bremerhaven':[53.55,8.58,'DE'],'Castrop-Rauxel':[51.55,7.31,'DE'],'Celle':[52.62,10.08,'DE'],'Chemnitz':[50.83,12.92,'DE'],'Cottbus':[51.76,14.33,'DE'],'Delmenhorst':[53.05,8.63,'DE'],'Detmold':[51.94,8.88,'DE'],'Dinslaken':[51.57,6.74,'DE'],'Dormagen':[51.1,6.84,'DE'],'Dorsten':[51.66,6.96,'DE'],'Dortmund':[51.51,7.47,'DE'],'Dresden':[51.05,13.74,'DE'],'Duisburg':[51.43,6.76,'DE'],'Düren':[50.8,6.49,'DE'],'Düsseldorf':[51.23,6.78,'DE'],'Erfurt':[50.98,11.03,'DE'],'Erlangen':[49.6,11,'DE'],'Essen':[51.46,7.01,'DE'],'Esslingen am Neckar':[48.74,9.31,'DE'],'Flensburg':[54.78,9.44,'DE'],'Frankfurt am Main':[50.11,8.68,'DE'],'Freiburg im Breisgau':[47.99,7.85,'DE'],'Friedrichshafen':[47.65,9.48,'DE'],'Fulda':[50.56,9.68,'DE'],'Fürth':[49.48,10.99,'DE'],'Garbsen':[52.42,9.6,'DE'],'Gelsenkirchen':[51.52,7.1,'DE'],'Gera':[50.88,12.08,'DE'],'Gladbeck':[51.57,6.99,'DE'],'Göppingen':[48.7,9.65,'DE'],'Göttingen':[51.53,9.94,'DE'],'Greifswald':[54.1,13.39,'DE'],'Grevenbroich':[51.09,6.59,'DE'],'Gütersloh':[51.91,8.38,'DE'],'Hagen':[51.36,7.47,'DE'],'Halle (Saale)':[51.48,11.97,'DE'],'Hamburg':[53.55,9.99,'DE'],'Hamm':[51.68,7.82,'DE'],'Hanau':[50.13,8.92,'DE'],'Hannover':[52.37,9.73,'DE'],'Heidelberg':[49.41,8.69,'DE'],'Heilbronn':[49.14,9.22,'DE'],'Herford':[52.11,8.67,'DE'],'Herne':[51.54,7.22,'DE'],'Herten':[51.6,7.14,'DE'],'Hildesheim':[52.15,9.95,'DE'],'Hürth':[50.87,6.87,'DE'],'Ingolstadt':[48.76,11.42,'DE'],'Iserlohn':[51.38,7.7,'DE'],'Jena':[50.93,11.59,'DE'],'Kaiserslautern':[49.44,7.75,'DE'],'Karlsruhe':[49.01,8.4,'DE'],'Kassel':[51.31,9.5,'DE'],'Kempten (Allgäu)':[47.73,10.32,'DE'],'Kerpen':[50.87,6.7,'DE'],'Kiel':[54.32,10.14,'DE'],'Koblenz':[50.36,7.59,'DE'],'Köln':[50.94,6.96,'DE'],'Konstanz':[47.66,9.18,'DE'],'Krefeld':[51.34,6.58,'DE'],'Landshut':[48.54,12.15,'DE'],'Langenfeld (Rheinland)':[51.11,6.94,'DE'],'Leipzig':[51.34,12.37,'DE'],'Leverkusen':[51.03,6.99,'DE'],'Lippstadt':[51.68,8.35,'DE'],'Lübeck':[53.87,10.68,'DE'],'Lüdenscheid':[51.22,7.63,'DE'],'Ludwigsburg':[48.9,9.19,'DE'],'Ludwigshafen am Rhein':[49.48,8.45,'DE'],'Lüneburg':[53.25,10.41,'DE'],'Lünen':[51.62,7.53,'DE'],'Magdeburg':[52.13,11.64,'DE'],'Mainz':[50,8.27,'DE'],'Mannheim':[49.49,8.47,'DE'],'Marburg':[50.81,8.77,'DE'],'Marl':[51.66,7.09,'DE'],'Minden':[52.29,8.91,'DE'],'Moers':[51.45,6.63,'DE'],'Mönchengladbach':[51.19,6.44,'DE'],'Mülheim an der Ruhr':[51.43,6.88,'DE'],'München':[48.14,11.58,'DE'],'Münster':[51.96,7.63,'DE'],'Neu-Ulm':[48.4,10,'DE'],'Neubrandenburg':[53.56,13.26,'DE'],'Neuss':[51.2,6.69,'DE'],'Neuwied':[50.43,7.46,'DE'],'Norderstedt':[53.69,10.01,'DE'],'Nürnberg':[49.45,11.08,'DE'],'Oberhausen':[51.47,6.85,'DE'],'Offenbach am Main':[50.1,8.76,'DE'],'Offenburg':[48.47,7.94,'DE'],'Oldenburg':[53.14,8.21,'DE'],'Osnabrück':[52.28,8.05,'DE'],'Paderborn':[51.72,8.75,'DE'],'Pforzheim':[48.89,8.7,'DE'],'Plauen':[50.5,12.14,'DE'],'Potsdam':[52.4,13.06,'DE'],'Ratingen':[51.3,6.85,'DE'],'Recklinghausen':[51.61,7.2,'DE'],'Regensburg':[49.02,12.1,'DE'],'Remscheid':[51.18,7.19,'DE'],'Reutlingen':[48.49,9.21,'DE'],'Rheine':[52.28,7.44,'DE'],'Rosenheim':[47.86,12.13,'DE'],'Rostock':[54.09,12.14,'DE'],'Saarbrücken':[49.24,6.99,'DE'],'Salzgitter':[52.15,10.33,'DE'],'Schwäbisch Gmünd':[48.8,9.79,'DE'],'Schwerin':[53.63,11.42,'DE'],'Siegen':[50.87,8.02,'DE'],'Sindelfingen':[48.71,9,'DE'],'Solingen':[51.17,7.08,'DE'],'Stralsund':[54.31,13.09,'DE'],'Stuttgart':[48.78,9.18,'DE'],'Trier':[49.76,6.64,'DE'],'Troisdorf':[50.81,7.15,'DE'],'Tübingen':[48.52,9.06,'DE'],'Ulm':[48.4,9.99,'DE'],'Unna':[51.53,7.68,'DE'],'Velbert':[51.34,7.05,'DE'],'Viersen':[51.25,6.4,'DE'],'Villingen-Schwenningen':[48.06,8.46,'DE'],'Weimar':[50.98,11.33,'DE'],'Wesel':[51.66,6.62,'DE'],'Wiesbaden':[50.08,8.24,'DE'],'Wilhelmshaven':[53.53,8.11,'DE'],'Witten':[51.44,7.34,'DE'],'Wolfsburg':[52.42,10.79,'DE'],'Worms':[49.63,8.36,'DE'],'Wuppertal':[51.26,7.15,'DE'],'Würzburg':[49.79,9.93,'DE'],'Zwickau':[50.72,12.49,'DE'],'Aalborg':[57.05,9.92,'DK'],'Aarhus':[56.16,10.2,'DK'],'Esbjerg':[55.47,8.45,'DK'],'Horsens':[55.86,9.85,'DK'],'Kolding':[55.49,9.47,'DK'],'Kopenhagen':[55.68,12.57,'DK'],'Odense':[55.4,10.38,'DK'],'Randers':[56.46,10.04,'DK'],'Roskilde':[55.64,12.08,'DK'],'Vejle':[55.71,9.54,'DK'],'Alicante':[38.35,-0.48,'ES'],'Barcelona':[41.39,2.17,'ES'],'Bilbao':[43.26,-2.93,'ES'],'Madrid':[40.42,-3.7,'ES'],'Málaga':[36.72,-4.42,'ES'],'Murcia':[37.99,-1.13,'ES'],'Palma':[39.57,2.65,'ES'],'Sevilla':[37.39,-5.99,'ES'],'Valencia':[39.47,-0.38,'ES'],'Zaragoza':[41.65,-0.88,'ES'],'Espoo':[60.21,24.66,'FI'],'Helsinki':[60.17,24.94,'FI'],'Jyväskylä':[62.24,25.75,'FI'],'Kuopio':[62.89,27.68,'FI'],'Lahti':[60.98,25.66,'FI'],'Oulu':[65.01,25.47,'FI'],'Pori':[61.48,21.8,'FI'],'Tampere':[61.5,23.76,'FI'],'Turku':[60.45,22.27,'FI'],'Vantaa':[60.29,25.04,'FI'],'Angers':[47.47,-0.55,'FR'],'Bordeaux':[44.84,-0.58,'FR'],'Dijon':[47.32,5.04,'FR'],'Grenoble':[45.19,5.72,'FR'],'Le Havre':[49.49,0.11,'FR'],'Lille':[50.63,3.06,'FR'],'Lyon':[45.76,4.84,'FR'],'Marseille':[43.3,5.37,'FR'],'Montpellier':[43.61,3.88,'FR'],'Nantes':[47.22,-1.55,'FR'],'Nice':[43.71,7.26,'FR'],'Nîmes':[43.84,4.36,'FR'],'Paris':[48.86,2.35,'FR'],'Reims':[49.26,4.03,'FR'],'Rennes':[48.11,-1.68,'FR'],'Saint-Étienne':[45.44,4.39,'FR'],'Strasbourg':[48.58,7.75,'FR'],'Toulon':[43.12,5.93,'FR'],'Toulouse':[43.6,1.44,'FR'],'Villeurbanne':[45.77,4.88,'FR'],'Bari':[41.12,16.87,'IT'],'Bologna':[44.49,11.34,'IT'],'Florenz':[43.77,11.25,'IT'],'Genua':[44.41,8.93,'IT'],'Mailand':[45.46,9.19,'IT'],'Neapel':[40.85,14.27,'IT'],'Palermo':[38.12,13.36,'IT'],'Rom':[41.9,12.5,'IT'],'Turin':[45.07,7.69,'IT'],'Venedig':[45.44,12.32,'IT'],'Diekirch':[49.87,6.16,'LU'],'Differdingen':[49.52,5.89,'LU'],'Düdelingen':[49.48,6.09,'LU'],'Esch an der Alzette':[49.5,5.98,'LU'],'Ettelbrück':[49.85,6.1,'LU'],'Grevenmacher':[49.68,6.44,'LU'],'Luxemburg':[49.61,6.13,'LU'],'Mersch':[49.75,6.1,'LU'],'Remich':[49.54,6.37,'LU'],'Wiltz':[49.97,5.93,'LU'],'Almere':[52.35,5.26,'NL'],'Amsterdam':[52.37,4.9,'NL'],'Breda':[51.59,4.78,'NL'],'Den Haag':[52.08,4.31,'NL'],'Eindhoven':[51.44,5.48,'NL'],'Groningen':[53.22,6.57,'NL'],'Nijmegen':[51.84,5.85,'NL'],'Rotterdam':[51.92,4.48,'NL'],'Tilburg':[51.56,5.09,'NL'],'Utrecht':[52.09,5.12,'NL'],'Bergen':[60.39,5.32,'NO'],'Drammen':[59.74,10.2,'NO'],'Fredrikstad':[59.22,10.95,'NO'],'Kristiansand':[58.15,7.99,'NO'],'Oslo':[59.91,10.75,'NO'],'Sandnes':[58.85,5.74,'NO'],'Sarpsborg':[59.28,11.11,'NO'],'Stavanger':[58.97,5.73,'NO'],'Tromsø':[69.65,18.96,'NO'],'Trondheim':[63.43,10.39,'NO'],'Breslau':[51.11,17.04,'PL'],'Bydgoszcz':[53.12,18,'PL'],'Danzig':[54.35,18.65,'PL'],'Katowice':[50.26,19.02,'PL'],'Krakau':[50.06,19.94,'PL'],'Lublin':[51.25,22.57,'PL'],'Łódź':[51.76,19.46,'PL'],'Posen':[52.41,16.93,'PL'],'Stettin':[53.43,14.55,'PL'],'Warschau':[52.23,21.01,'PL'],'Göteborg':[57.71,11.97,'SE'],'Helsingborg':[56.05,12.69,'SE'],'Jönköping':[57.78,14.16,'SE'],'Linköping':[58.41,15.62,'SE'],'Malmö':[55.6,13,'SE'],'Norrköping':[58.59,16.19,'SE'],'Örebro':[59.27,15.21,'SE'],'Stockholm':[59.33,18.07,'SE'],'Uppsala':[59.86,17.64,'SE'],'Västerås':[59.61,16.55,'SE']};

  const ROAD_FACTOR = 1.25; // Straße ist im Schnitt ~25% länger als Luftlinie

  /**
   * Haversine-Distanz zwischen zwei Städten in km (Luftlinie).
   * @returns {number|null} null falls eine Stadt unbekannt ist
   */
  function luftlinieKm(stadtA, stadtB) {
    const a = CITY_COORDS[stadtA];
    const b = CITY_COORDS[stadtB];
    if (!a || !b) return null;
    const R = 6371;
    const dLat = (b[0] - a[0]) * Math.PI / 180;
    const dLon = (b[1] - a[1]) * Math.PI / 180;
    const lat1 = a[0] * Math.PI / 180;
    const lat2 = b[0] * Math.PI / 180;
    const sinDLat = Math.sin(dLat / 2);
    const sinDLon = Math.sin(dLon / 2);
    const h = sinDLat * sinDLat + Math.cos(lat1) * Math.cos(lat2) * sinDLon * sinDLon;
    const c = 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
    return R * c;
  }

  /**
   * Geschätzte Straßenentfernung in km (Luftlinie × Kalibrierfaktor).
   * @returns {number|null}
   */
  function geschaetzteStrassenKm(stadtA, stadtB) {
    const luft = luftlinieKm(stadtA, stadtB);
    return luft === null ? null : Math.round(luft * ROAD_FACTOR);
  }

  /**
   * Holt die echte Städte-Stammdatenliste des Spiels (Koordinaten,
   * Länder-Code, Logistikfaktor) von der API, die europe-map.php beim
   * Hover pro Stadt nachlädt (siehe Chat). Ersetzt/ergänzt die statische
   * CITY_COORDS-Fallback-Tabelle mit den Original-Werten des Spiels - kein
   * manuelles Abtippen/Kalibrieren von Koordinaten mehr nötig, und deckt
   * automatisch auch neu hinzugefügte Städte ab.
   * Gecached wie Fuhrpark/Disponenten (siehe NEBEN_DATEN_CACHE_TTL_MS) - die
   * Städteliste des Spiels ändert sich praktisch nie.
   * @param {boolean} erzwingeNeuladen Cache umgehen (🔄-Knopf)
   * @returns {Object<string, [number, number, string, number]>|null} Map Stadtname -> [lat, lng, countryCode, logistikfaktor], oder null bei Fehlschlag
   */
  async function fetchStaedteDaten(erzwingeNeuladen = false) {
    if (!erzwingeNeuladen && nebenDatenCacheIstFrisch(staedteDatenCache)) {
      return staedteDatenCache.daten;
    }
    try {
      const daten = await protokolliereAbruf('Städte-Stammdaten (europe-map-data.php)', async () => {
        const res = await fiFetch('/game/api/europe-map-data.php', { credentials: 'same-origin', cache: 'no-store', headers: { Accept: 'application/json' } });
        if (!res.ok) return null;
        const json = await res.json();
        if (!json?.ok || !Array.isArray(json.cities)) return null;
        const result = {};
        json.cities.forEach(c => {
          result[c.name] = [c.lat, c.lng, c.country_code, parseFloat(c.logistics_factor)];
        });
        return result;
      });
      if (!daten) return staedteDatenCache?.daten ?? null;
      staedteDatenCache = { daten, zeitstempel: Date.now() };
      return daten;
    } catch (e) {
      console.warn('[FI-Helper] Städte-Stammdaten konnten nicht geladen werden, nutze statische Fallback-Tabelle', e);
      return staedteDatenCache?.daten ?? null;
    }
  }

  function pruefeKredit(kreditsumme, zinssatzProJahr, erwarteterZusatzDeckungsbeitragProJahr) {
    const zinskosten = kreditsumme * zinssatzProJahr;
    const nettoGewinnProJahr = erwarteterZusatzDeckungsbeitragProJahr - zinskosten;
    return { lohnend: nettoGewinnProJahr > 0, nettoGewinnProJahr };
  }

  function pruefeZweiterFahrer(fixlohnProWoche, erwarteterDeckungsbeitragProTourEuro) {
    const benoetigteTourenProWoche =
      erwarteterDeckungsbeitragProTourEuro > 0
        ? fixlohnProWoche / erwarteterDeckungsbeitragProTourEuro
        : Infinity;
    return { benoetigteTourenProWoche };
  }

  // ============================================================
  // 6. OVERLAY-PANEL
  // ============================================================

  /**
   * Injiziert das Look&Feel des Panels (an den Spiel-eigenen Stil der
   * Tutorial-Box angelehnt: dunkler Verlauf, Gold-Akzente, Segoe UI).
   * WICHTIG: Fasst bewusst KEINE z-index-Werte der Seiten-eigenen Elemente
   * (Menü, Modals, Tutorial) mehr an - das hat mehrfach das Spiel-Layout
   * durcheinandergebracht, ohne die echten CSS-Regeln der Seite zu kennen.
   * Stattdessen bekommt unser eigenes Panel unten einen niedrigen z-index,
   * damit die Seite bei jedem Konflikt automatisch gewinnt.
   * Wird einmalig beim Start injiziert.
   */
  function injectZIndexOverrides() {
    if (document.getElementById('fi-helper-zindex-fix')) return;
    const style = document.createElement('style');
    style.id = 'fi-helper-zindex-fix';
    style.textContent = `
      .fi-badge-status {
        display: inline-block;
        padding: 3px 10px;
        border-radius: 999px;
        font-size: 11px;
        font-weight: 700;
        background: rgba(255,255,255,.08);
        border: 1px solid rgba(255,255,255,.14);
        vertical-align: middle;
        white-space: nowrap;
        flex-shrink: 0;
      }

      .fi-empty {
        font-size: 12px;
        color: #9aa5b8;
        font-style: italic;
        padding: 6px 0;
      }

      /* ====== Dashboard (active_tours.php - große, geräumige Ansicht) ====== */
      #fi-dashboard {
        font-family: "Segoe UI", Arial, sans-serif;
        color: #f8fafc;
        width: 100%;
        max-width: 100%;
        box-sizing: border-box;
        margin: 24px 0;
        overflow-x: hidden; /* mit min-width:0 auf der Timeline-Spur sollte hier nichts mehr überlaufen */
      }
      #fi-dashboard h2 {
        font-size: 18px;
        font-weight: 800;
        color: #fff6d9;
        margin: 0 0 8px;
        display: flex;
        align-items: center;
        gap: 10px;
      }
      #fi-dashboard h3 {
        font-size: 12px;
        text-transform: uppercase;
        letter-spacing: .08em;
        color: #ffd98a;
        font-weight: 800;
        margin: 14px 0 6px;
      }
      .fi-dash-pills { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 6px; }
      .fi-dash-pill {
        padding: 3px 10px;
        border-radius: 8px;
        background: rgba(255,255,255,.05);
        border: 1px solid rgba(255,255,255,.10);
        font-size: 12px;
        font-weight: 800;
      }
      .fi-dash-pill.is-warn { color: #ffb48a; border-color: rgba(255,154,107,.45); background: rgba(127,60,20,.18); }
      .fi-dash-pill.is-muted { color: #9aa5b8; }
      .fi-dash-pill.is-negative { color: #ffb3b3; border-color: rgba(248,113,113,.30); background: rgba(127,29,29,.16); }
      .fi-dash-pill.is-positive { color: #a9f7c4; border-color: rgba(134,239,172,.30); background: rgba(20,60,30,.20); }
      .fi-dash-grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(230px, 1fr));
        gap: 8px;
      }
      .fi-dash-card {
        padding: 10px 12px;
        border-radius: 10px;
        background: rgba(255,255,255,.045);
        border: 1px solid rgba(255,255,255,.09);
      }
      .fi-dash-card-title {
        font-size: 13px;
        font-weight: 800;
        color: #fff;
        margin-bottom: 4px;
        display: flex;
        align-items: center;
        justify-content: space-between;
        flex-wrap: wrap;
        gap: 6px 10px;
      }
      .fi-dash-card-title a { color: inherit; text-decoration: none; }
      .fi-dash-card-title a:hover { text-decoration: underline; }
      .fi-dash-row { font-size: 12.5px; color: #dbe2f0; margin-top: 2px; line-height: 1.4; }
      .fi-dash-row.fi-muted { color: #9aa5b8; }
      .fi-dash-row.fi-loc { color: #ffd98a; }
      .fi-dash-row.fi-warn { color: #ff9a6b; }
      .fi-dash-row.fi-good { color: #8ef2a8; }
      .fi-dash-row.fi-bad { color: #ff8a8a; }
      .fi-dash-controls {
        display: flex;
        gap: 8px;
        align-items: flex-end;
        flex-wrap: wrap;
        padding: 8px 10px;
        border-radius: 10px;
        background: rgba(255,255,255,.045);
        border: 1px solid rgba(255,255,255,.09);
        margin-bottom: 8px;
      }
      .fi-dash-field { display: flex; flex-direction: column; gap: 3px; font-size: 11.5px; color: #9aa5b8; }
      .fi-dash-select {
        padding: 5px 8px;
        border-radius: 8px;
        background: rgba(255,255,255,.06);
        border: 1px solid rgba(255,255,255,.16);
        color: #f8fafc;
        font-size: 12.5px;
        min-width: 160px;
      }
      .fi-dash-btn {
        padding: 6px 12px;
        border-radius: 8px;
        border: 1px solid rgba(255,217,138,.52);
        background: linear-gradient(180deg,#ffd98a,#f5b84b);
        color: #211404;
        font-weight: 800;
        font-size: 12.5px;
        cursor: pointer;
      }
      .fi-dash-btn:disabled { opacity: .55; cursor: default; }
      .fi-dash-btn-reload {
        padding: 5px 9px;
        border-radius: 8px;
        border: 1px solid rgba(255,255,255,.16);
        background: rgba(255,255,255,.07);
        color: #f8fafc;
        cursor: pointer;
        font-size: 12.5px;
      }
      .fi-dash-bundle-item { padding-left: 10px; font-size: 11.5px; color: #9aa5b8; margin-top: 1px; }
      .fi-dash-accept-btn {
        margin-top: 6px;
        padding: 3px 10px;
        border-radius: 7px;
        border: 1px solid rgba(255,217,138,.52);
        background: linear-gradient(180deg,#ffd98a,#f5b84b);
        color: #211404;
        font-weight: 800;
        font-size: 11.5px;
        cursor: pointer;
      }
      .fi-dash-accept-btn:disabled { opacity: .55; cursor: default; }
      /* Die Spiel-CSS erzwingt min-height:40px/Padding auf button/select/input - hier übersteuern */
      #fi-dashboard .fi-dash-btn,
      #fi-dashboard .fi-dash-btn-reload { min-height: 0 !important; height: 28px !important; padding: 0 10px !important; font-size: 12px !important; line-height: 1 !important; width: auto !important; }
      #fi-dashboard .fi-dash-select { min-height: 0 !important; height: 28px !important; padding: 0 8px !important; font-size: 12px !important; }
      #fi-dashboard .fi-dash-accept-btn { min-height: 0 !important; height: 22px !important; padding: 0 10px !important; font-size: 11.5px !important; line-height: 1 !important; width: auto !important; }
      #fi-dashboard input[type=checkbox] { min-height: 0 !important; width: 13px !important; height: 13px !important; margin: 0 4px 0 0 !important; }

      /* ====== Live-Konsole (Scan/Berechnung) - Transport-Look, nur transform/opacity (GPU) ====== */
      .fi-scan { grid-column: 1 / -1; padding: 10px 14px 12px; border-radius: 10px;
        border: 1px solid rgba(255,217,138,.28); background: rgba(255,255,255,.045); }
      .fi-scan-head { display: flex; justify-content: space-between; gap: 10px; font-size: 11px; letter-spacing: .1em; text-transform: uppercase; color: #ffd98a; font-weight: 800; }
      .fi-scan-stufe { color: #9aa5b8; letter-spacing: .02em; text-transform: none; font-weight: 600; text-align: right; }
      .fi-road { position: relative; height: 26px; margin: 8px 0 6px; border-radius: 6px; background: rgba(8,10,18,.75); border: 1px solid rgba(255,255,255,.08); overflow: hidden; }
      .fi-road-fill { position: absolute; left: 0; top: 0; bottom: 0; width: 2%; background: linear-gradient(90deg, rgba(245,184,75,.05), rgba(245,184,75,.32)); transition: width .3s; }
      .fi-road-dashes { position: absolute; left: 0; right: -40px; top: 12px; height: 2px; background: repeating-linear-gradient(90deg, rgba(255,217,138,.55) 0 14px, transparent 14px 28px); animation: fi-road 1s linear infinite; will-change: transform; }
      @keyframes fi-road { to { transform: translateX(-28px); } }
      .fi-road-ziel { position: absolute; right: 6px; top: 3px; font-size: 14px; opacity: .9; }
      .fi-road-start { position: absolute; left: 4px; top: 3px; font-size: 13px; opacity: .8; }
      .fi-truck { position: absolute; top: 1px; left: 0; font-size: 19px; line-height: 22px; transform: scaleX(-1); transition: left .3s; filter: drop-shadow(0 1px 2px rgba(0,0,0,.6)); }
      .fi-truck > span { display: inline-block; animation: fi-ruettel .35s ease-in-out infinite alternate; }
      @keyframes fi-ruettel { from { transform: translateY(0); } to { transform: translateY(-1.5px); } }
      .fi-scan-werte { display: flex; flex-wrap: wrap; gap: 2px 16px; font: 600 12px ui-monospace, Consolas, monospace; color: #9aa5b8; }
      .fi-scan-werte b { color: #ffd98a; }
      .fi-scan-chips { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 6px; }
      .fi-scan-chip { font: 700 10.5px ui-monospace, Consolas, monospace; padding: 2px 7px; border-radius: 5px; border: 1px solid rgba(255,255,255,.14); color: #6f7b90; }
      .fi-scan-chip.rechnet { color: #ffd98a; border-color: #f5b84b; animation: fi-puls .7s ease-in-out infinite alternate; }
      .fi-scan-chip.fertig { color: #8ef2a8; border-color: rgba(142,242,168,.55); background: rgba(20,60,30,.30); }
      .fi-scan-chip.leer { color: #6f7b90; opacity: .6; }
      @keyframes fi-puls { from { opacity: .5; } to { opacity: 1; } }
      .fi-scan-feed { margin-top: 6px; font: 600 11.5px ui-monospace, Consolas, monospace; color: #dbe2f0; display: flex; flex-direction: column; gap: 1px; }
      .fi-scan-feed > div { animation: fi-einflug .3s ease-out backwards; }
      .fi-scan-feed > div:nth-last-child(n+3) { opacity: .55; }
      .fi-scan.fi-scan-fertig * { animation-play-state: paused !important; }
      @keyframes fi-einflug { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: none; } }
      @keyframes fi-wachs { from { opacity: 0; transform: scaleX(0); } to { opacity: 1; transform: none; } }
      /* schrittweiser Aufbau: Karten und Tourenplan fliegen gestaffelt ein */
      .fi-einflug { animation: fi-einflug .4s ease-out backwards; animation-delay: calc(var(--i, 0) * 80ms); }
      .fi-aufbau .fi-dash-timeline-row { animation: fi-einflug .4s ease-out backwards; animation-delay: calc(var(--i, 0) * 70ms); }
      .fi-aufbau .fi-dash-phase-block { transform-origin: left center; animation: fi-wachs .5s ease-out backwards; animation-delay: calc(var(--i, 0) * 70ms + 150ms); }
      #fi-info-chips .fi-dash-pill { animation: fi-einflug .4s ease-out backwards; }
      /* Fahrzeugkarte "fährt ein": Einfahrt von links, Glanz-Sweep, LKW rollt über die Kante, Zeilen und Knopf folgen, €/km zählt hoch */
      .fi-karte { position: relative; overflow: hidden; animation: fi-einfahrt .6s cubic-bezier(.2,.9,.3,1.15) backwards; animation-delay: calc(var(--i, 0) * 120ms); }
      @keyframes fi-einfahrt { from { opacity: 0; transform: translateX(-52px) scale(.95); } 55% { opacity: 1; } to { opacity: 1; transform: none; } }
      .fi-karte::before { content: ''; position: absolute; top: 0; bottom: 0; left: 0; width: 35%; pointer-events: none; background: linear-gradient(100deg, transparent, rgba(255,217,138,.30), transparent);
        transform: translateX(-130%); animation: fi-glanz 1s ease-out both; animation-delay: calc(var(--i, 0) * 120ms + 380ms); }
      @keyframes fi-glanz { to { transform: translateX(480%); } }
      .fi-karte-lkw { position: absolute; top: 2px; left: -12%; font-size: 14px; font-style: normal; pointer-events: none; opacity: 0; transform: scaleX(-1);
        animation: fi-lkw 1s ease-in both; animation-delay: calc(var(--i, 0) * 120ms + 200ms); }
      @keyframes fi-lkw { 0% { left: -12%; opacity: 1; } 100% { left: 106%; opacity: 1; } }
      .fi-karte > div:nth-child(n+2) { animation: fi-einflug .4s ease-out backwards; }
      .fi-karte > div:nth-child(2) { animation-delay: calc(var(--i, 0) * 120ms + 420ms); }
      .fi-karte > div:nth-child(3) { animation-delay: calc(var(--i, 0) * 120ms + 540ms); }
      .fi-karte > div:nth-child(4) { animation-delay: calc(var(--i, 0) * 120ms + 660ms); }
      .fi-karte > div:nth-child(n+5) { animation-delay: calc(var(--i, 0) * 120ms + 780ms); }
      .fi-karte > button { animation: fi-knopf .5s cubic-bezier(.2,.9,.3,1.4) backwards; animation-delay: calc(var(--i, 0) * 120ms + 900ms); }
      @keyframes fi-knopf { from { opacity: 0; transform: scale(.7); } to { opacity: 1; transform: none; } }
      .fi-wartet, .fi-wartet * { animation-play-state: paused !important; }
      .fi-skel { position: absolute; inset: 3px 0; border-radius: 4px; background: rgba(255,255,255,.05); overflow: hidden; }
      .fi-skel::after { content: ''; position: absolute; top: 0; bottom: 0; left: 0; width: 25%; background: linear-gradient(90deg, transparent, rgba(255,217,138,.28), transparent); transform: translateX(-100%); animation: fi-shimmer 1.2s linear infinite; }
      @keyframes fi-shimmer { to { transform: translateX(400%); } }
      .fi-zeile-neu .fi-dash-phase-block { transform-origin: left center; animation: fi-wachs .5s ease-out backwards; }
      @media (prefers-reduced-motion: reduce) { .fi-lade *, .fi-cat-btn, .fi-karte, .fi-karte *, .fi-karte::before, .fi-scan *, .fi-skel::after, .fi-zeile-neu *, .fi-einflug, .fi-aufbau *, #fi-info-chips * { animation: none !important; } }

      /* ====== Abruf-Log (ganz unten, zugeklappt) ====== */
      #fi-dash-abrufe { margin-top: 10px; }
      .fi-abrufe > summary { cursor: pointer; font: 600 11px ui-monospace, Consolas, monospace; color: #6f7b90; list-style: none; }
      .fi-abrufe > summary::-webkit-details-marker { display: none; }
      .fi-abrufe[open] > summary { color: #9aa5b8; }
      .fi-abrufe-gruppen { display: flex; flex-wrap: wrap; gap: 2px 14px; margin: 6px 0; font: 600 11px ui-monospace, Consolas, monospace; color: #9aa5b8; }
      .fi-abrufe-gruppen b { color: #ffd98a; }
      .fi-abrufe-liste { max-height: 260px; overflow: auto; font: 11px ui-monospace, Consolas, monospace; color: #7f8aa0; line-height: 1.5; border-top: 1px solid rgba(255,255,255,.08); padding-top: 4px; }
      .fi-abrufe-url { color: #9aa5b8; word-break: break-all; }

      /* ====== Einnahmen je Tag über der Datumsachse ====== */
      .fi-ein-seg { position: absolute; top: 0; height: 16px; box-sizing: border-box; padding: 0 2px; text-align: center; white-space: nowrap; overflow: hidden;
        border-left: 1px solid rgba(142,242,168,.35); font: 700 11px/16px ui-monospace, Consolas, monospace; color: #8ef2a8; container-type: inline-size; }
      .fi-ein-seg .voll { display: none; }
      @container (min-width: 84px) { .fi-ein-seg .voll { display: inline; } .fi-ein-seg .kurz { display: none; } }

      /* ====== Frachtart-Buttons + Lade-Animation der Bedienleiste ====== */
      #fi-dashboard .fi-controls-laden > :not(.fi-lade) { display: none !important; }
      #fi-dashboard .fi-controls-bereit .fi-lade { display: none !important; }
      #fi-dashboard #fi-dash-load-btn, #fi-dashboard #fi-dash-bodytype { display: none !important; }
      .fi-lade { display: flex; align-items: center; gap: 12px; width: 100%; }
      .fi-lade .fi-road { flex: 1; margin: 0; }
      .fi-lade .fi-truck { animation: fi-fahrt 2.4s linear infinite; transition: none; left: -8%; }
      @keyframes fi-fahrt { from { left: -8%; } to { left: 100%; } }
      .fi-lade-text { font-size: 12px; color: #9aa5b8; white-space: nowrap; }
      .fi-cat-row { display: flex; flex-wrap: wrap; gap: 6px; }
      #fi-dashboard .fi-cat-btn { background: rgba(255,255,255,.07) !important; color: #ffd98a !important; border: 1px solid rgba(255,217,138,.5) !important; }
      #fi-dashboard .fi-cat-btn.is-aktiv { background: linear-gradient(180deg, #ffd98a, #f5b84b) !important; color: #211404 !important; }
      .fi-controls-bereit .fi-cat-btn { animation: fi-einflug .4s ease-out backwards; animation-delay: calc(var(--i, 0) * 90ms); }

      /* ====== Handy: Tourenplan seitlich wischbar, Fahrzeugnamen bleiben links stehen ====== */
      @media (max-width: 700px) {
        #fi-dash-timeline { overflow-x: auto; -webkit-overflow-scrolling: touch; padding-bottom: 4px; }
        #fi-dash-timeline .fi-dash-timeline-row { min-width: 680px; }
        #fi-dash-timeline .fi-dash-timeline-label { position: sticky; left: 0; z-index: 4; width: 100px; background: #0f1320; padding-right: 4px; }
        .fi-dash-controls { gap: 6px; }
        #fi-dashboard { padding-left: 0; padding-right: 0; }
      }

      /* ====== Timeline (mehrere Fahrzeuge auf einen Blick) ====== */
      .fi-dash-timeline-legend { display: flex; gap: 12px; flex-wrap: wrap; margin-bottom: 6px; font-size: 11px; color: #cbd5e1; }
      .fi-dash-timeline-legend span { display: inline-flex; align-items: center; gap: 6px; }
      .fi-dash-timeline-legend i { width: 12px; height: 12px; border-radius: 3px; display: inline-block; }
      .fi-dash-timeline-row { display: flex; align-items: center; gap: 8px; margin-bottom: 3px; }
      .fi-dash-timeline-label { width: 130px; flex-shrink: 0; font-size: 11px; font-weight: 700; display: flex; align-items: center; gap: 4px; }
      .fi-lbl-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      #fi-dashboard .fi-dash-timeline-label .fi-rueckruf-btn { flex-shrink: 0; min-height: 0 !important; height: 16px !important; width: auto !important; padding: 0 4px !important; font-size: 10px !important; line-height: 1 !important; border-radius: 4px; border: 1px solid rgba(255,255,255,.25); background: rgba(255,255,255,.08); color: #ffd98a; cursor: pointer; }
      #fi-dashboard .fi-rueckruf-btn:disabled { opacity: .5; cursor: default; }
      .fi-dash-timeline-label a { color: inherit; text-decoration: none; }
      .fi-dash-timeline-label a:hover { text-decoration: underline; }
      .fi-dash-timeline-track {
        position: relative;
        flex: 1;
        min-width: 0;
        height: 20px;
        background: rgba(255,255,255,.04);
        border-radius: 5px;
        border: 1px solid rgba(255,255,255,.08);
        overflow: hidden; /* Blöcke bleiben strikt in ihrer eigenen Zeile - Tooltips laufen jetzt über ein eigenes fixed-position JS-System, siehe initFiTooltipSystem() */
      }
      .fi-dash-phase-block {
        position: absolute;
        top: 2px;
        height: 16px; /* EXPLIZIT statt bottom:4px - garantiert, dass jeder Block exakt gleich hoch ist, egal wie schmal */
        border-radius: 3px;
        cursor: default;
        min-width: 6px; /* sonst sind kurze Lade-/Entladephasen (15-60 Min. auf 48h) praktisch unsichtbar */
        border-left: 1px solid rgba(0,0,0,.35); /* nur seitliche Trennlinien, kein Vollrahmen - der hat bei vielen dünnen Blöcken einen "Treppen"-Effekt verursacht */
        border-right: 1px solid rgba(0,0,0,.35);
        box-sizing: border-box;
        z-index: 1;
        display: flex;
        align-items: center;
        /* KEIN overflow:hidden hier - schneidet sonst den eigenen ::after-Tooltip mit ab */
      }
      .fi-dash-phase-time {
        font-size: 9px;
        line-height: 16px;
        font-weight: 700;
        color: rgba(0,0,0,.65);
        padding-left: 4px;
        white-space: nowrap;
        overflow: hidden;
        max-width: 100%;
        pointer-events: none;
      }
      .fi-dash-phase-block.phase-leerfahrt { background: #5b9bd5; }
      .fi-dash-phase-block.phase-laden, .fi-dash-phase-block.phase-entladen { background: #d4a94a; }
      .fi-dash-phase-block.phase-fahrt_beladen { background: #4caf7d; }
      .fi-dash-phase-block.phase-pause, .fi-dash-phase-block.phase-schichtpause { background: #c1554a; }
      .fi-dash-timeline-gridline {
        position: absolute;
        top: 0; bottom: 0;
        width: 1px;
        background: rgba(255,255,255,.07);
      }
      .fi-dash-timeline-gridline.is-day { background: rgba(255,217,138,.20); width: 1px; }
      .fi-dash-timeline-gridline.is-need {
        background: #ff5c5c;
        width: 2px;
        z-index: 3;
        box-shadow: 0 0 4px rgba(255,92,92,.6);
      }
      .fi-dash-timeline-tick {
        position: absolute;
        top: 0;
        transform: translateX(-50%);
        white-space: nowrap;
        font-size: 10.5px;
        color: #9aa5b8;
      }
      .fi-dash-timeline-tick.is-day { color: #ffd98a; font-weight: 700; }
      .fi-dash-timeline-tick.is-need {
        color: #ff5c5c;
        font-weight: 700;
        z-index: 3;
      }
      /* ====== Eigenes Tooltip-System - JETZT per JS mit position:fixed
         (siehe initFiTooltipSystem), NICHT mehr per CSS :hover::after.
         Grund: ein CSS-Tooltip als Kind-Pseudoelement wird von JEDEM
         overflow:hidden-Vorfahren mit abgeschnitten - genau das brauchen wir
         aber wieder auf der Zeitleisten-Spur, damit Blöcke sauber in ihrer
         eigenen Zeile bleiben (siehe Chat/Bugreport "nebeneinander, nicht
         untereinander"). Ein fixed-position-Element in <body> umgeht das. ====== */
      #fi-tooltip-box {
        position: fixed;
        display: none;
        background: #10151f;
        color: #f8fafc;
        border: 1px solid rgba(255,217,138,.4);
        border-radius: 10px;
        padding: 10px 12px;
        font-size: 12px;
        font-family: "Segoe UI", Arial, sans-serif;
        white-space: pre-line;
        line-height: 1.5;
        min-width: 220px;
        max-width: 320px;
        width: max-content;
        box-shadow: 0 10px 30px rgba(0,0,0,.5);
        z-index: 999999;
        pointer-events: none;
      }
    `;
    document.head.appendChild(style);
  }

  /**
   * Baut EINMALIG eine gemeinsame Tooltip-Box in <body> und verdrahtet
   * Event-Delegation (mouseover/mouseout auf document) für alle Elemente mit
   * data-fi-tip - egal wann/wie oft sie neu gerendert werden, da document
   * selbst nie neu gebaut wird. position:fixed + JS-Berechnung umgeht jedes
   * overflow:hidden eines Vorfahren (siehe Chat).
   */
  function initFiTooltipSystem() {
    if (document.getElementById('fi-tooltip-box')) return;
    const tip = document.createElement('div');
    tip.id = 'fi-tooltip-box';
    document.body.appendChild(tip);

    // Touch-Geräte (kein Hover): Tippen zeigt den Tooltip, ein zweites Tippen auf Links/Knöpfe führt sie aus,
    // Tippen daneben schließt ihn. Maus: wie bisher per Hover.
    const ohneHover = () => !!window.matchMedia?.('(hover: none)').matches;
    let aktivEl = null;

    const zeige = el => {
      const text = el.getAttribute('data-fi-tip');
      if (!text) return;
      tip.textContent = text;
      tip.style.display = 'block';
      const rect = el.getBoundingClientRect();
      let left = rect.left + rect.width / 2;
      // Grob am linken/rechten Bildschirmrand abfangen, damit die Box nicht abgeschnitten wird
      left = Math.max(160, Math.min(window.innerWidth - 160, left));
      tip.style.left = `${left}px`;
      // oberhalb des Elements; passt es dort nicht hin (Seitenrand oben), darunter
      if (rect.top - 8 - tip.offsetHeight < 4) {
        tip.style.top = `${rect.bottom + 8}px`;
        tip.style.transform = 'translate(-50%, 0)';
      } else {
        tip.style.top = `${rect.top - 8}px`;
        tip.style.transform = 'translate(-50%, -100%)';
      }
      aktivEl = el;
    };
    const verstecke = () => { tip.style.display = 'none'; aktivEl = null; };

    document.addEventListener('mouseover', (ev) => {
      if (ohneHover()) return; // Touch löst synthetische mouseover aus - dort zählt nur das Tippen
      const el = ev.target.closest('[data-fi-tip]');
      if (el) zeige(el);
    });

    document.addEventListener('mouseout', (ev) => {
      if (ohneHover()) return;
      const el = ev.target.closest('[data-fi-tip]');
      if (!el) return;
      if (el.contains(ev.relatedTarget)) return; // nur ausblenden, wenn wirklich verlassen
      verstecke();
    });

    document.addEventListener('click', (ev) => {
      if (!ohneHover()) return;
      const el = ev.target.closest('[data-fi-tip]');
      if (!el) { if (aktivEl) verstecke(); return; }
      if (aktivEl === el) { verstecke(); return; } // zweites Tippen: Aktion/Link ausführen lassen
      // erstes Tippen: nur Info zeigen, Link/Knopf noch nicht auslösen
      if (ev.target.closest('a, button')) { ev.preventDefault(); ev.stopImmediatePropagation(); }
      zeige(el);
    }, true);
  }

  /**
   * Berechnet gleichmäßige Zeitmarken (z.B. alle 6h) innerhalb eines Fensters -
   * gemeinsam genutzt für die Kopfzeilen-Beschriftung UND die dezenten
   * Gitterlinien in jeder Fahrzeug-Spur, damit beide exakt übereinander liegen.
   */
  function baueZeitAchsenTicks(fensterStartMs, fensterEndeMs, intervalStunden = 6) {
    const ticks = [];
    const start = new Date(fensterStartMs);
    start.setMinutes(0, 0, 0);
    while (start.getHours() % intervalStunden !== 0) start.setHours(start.getHours() + 1);
    const fensterDauerMs = fensterEndeMs - fensterStartMs;

    for (let t = start.getTime(); t < fensterEndeMs; t += intervalStunden * 3600 * 1000) {
      const pct = ((t - fensterStartMs) / fensterDauerMs) * 100;
      if (pct < 0 || pct > 100) continue;
      const d = new Date(t);
      const istMitternacht = d.getHours() === 0;
      const label = (istMitternacht ? d.toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit' }) + ' ' : '')
        + `${String(d.getHours()).padStart(2, '0')}:00`;
      ticks.push({ pct, label, istMitternacht });
    }
    return ticks;
  }

  /**
   * Baut die HTML-Segmente für EIN Fahrzeug-Zeitfenster (Jetzt-Marker + Phasen
   * als farbige Balken, wie im spieleigenen Dispositionsplan, PLUS dezente
   * Gitterlinien zur Zeitorientierung). Phasen, die teilweise außerhalb des
   * Fensters liegen, werden ans Fenster geclippt. Jeder Balken hat einen
   * eigenen, sofort erscheinenden Tooltip mit Route/Zeit/Auftrag (data-fi-tip).
   */
  function baueTimelineTrackHtml(phasen, fensterStartMs, fensterEndeMs, markerMs = null) {
    const fensterDauerMs = fensterEndeMs - fensterStartMs;
    let html = '';

    baueZeitAchsenTicks(fensterStartMs, fensterEndeMs).forEach(tick => {
      html += `<div class="fi-dash-timeline-gridline${tick.istMitternacht ? ' is-day' : ''}" style="left:${tick.pct.toFixed(2)}%"></div>`;
    });

    // Roter Marker: frühester Zeitpunkt, ab dem IRGENDEIN Fahrzeug der Flotte
    // ohne geplante Tour dastehen würde (siehe Chat) - auf JEDER Fahrzeugzeile
    // an derselben Stelle gezeichnet, damit es wie eine durchgehende Linie
    // über die ganze Flotte wirkt.
    if (markerMs != null && markerMs >= fensterStartMs && markerMs <= fensterEndeMs) {
      const markerPct = ((markerMs - fensterStartMs) / fensterDauerMs) * 100;
      html += `<div class="fi-dash-timeline-gridline is-need" style="left:${markerPct.toFixed(2)}%"></div>`;
    }

    (phasen || []).forEach(p => {
      if (!p.start || !p.ende) return;
      const startMs = Math.max(p.start.getTime(), fensterStartMs);
      const endeMs = Math.min(p.ende.getTime(), fensterEndeMs);
      if (endeMs <= startMs) return;

      const leftPct = ((startMs - fensterStartMs) / fensterDauerMs) * 100;
      const widthPct = ((endeMs - startMs) / fensterDauerMs) * 100;
      const phaseLabel = {
        leerfahrt: 'Leerfahrt', laden: 'Beladen', entladen: 'Entladen',
        fahrt_beladen: 'Fahrt beladen', pause: '45-Min-Pause', schichtpause: 'Schichtpause',
      }[p.type] || p.type;
      // Uhrzeiten IMMER an erster Stelle im Tooltip, gut lesbar auf zwei Zeilen
      const titel = `${p.start.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })} – ${p.ende.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })} (${p.start.toLocaleDateString('de-DE')})\n${phaseLabel}${p.auftrag ? ' · ' + p.auftrag : ''}${p.von && p.bis ? '\n' + p.von + ' → ' + p.bis : ''}`;

      // Bei ausreichend breiten Blöcken die Uhrzeit direkt sichtbar reinschreiben,
      // nicht nur im Tooltip - das war der eigentliche Wunsch ("Uhrzeiten fehlen").
      const zeitLabel = widthPct > 6
        ? `<span class="fi-dash-phase-time">${p.start.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}</span>`
        : '';

      html += `<div class="fi-dash-phase-block phase-${p.type}" style="left:${leftPct.toFixed(2)}%; width:${widthPct.toFixed(2)}%;" data-fi-tip="${titel.replace(/"/g, '&quot;')}">${zeitLabel}</div>`;
    });

    return html;
  }

  /**
   * Baut die Kopfzeile mit Uhrzeit-Beschriftung über allen Fahrzeug-Spuren
   * (an derselben Spaltenbreite ausgerichtet wie die Timeline-Zeilen selbst).
   */
  function baueTimelineLegendeHtml() {
    return `<div class="fi-dash-timeline-legend">
          <span><i style="background:#5b9bd5;"></i>Leerfahrt</span>
          <span><i style="background:#d4a94a;"></i>Laden / Entladen</span>
          <span><i style="background:#4caf7d;"></i>Fahrt beladen</span>
          <span><i style="background:#c1554a;"></i>Pause / Schichtpause</span>
          <span><i style="background:#ff5c5c;"></i>Nächster Planungsbedarf</span>
        </div>`;
  }

  /**
   * Zeile über der Datumsachse: je Kalendertag die erwarteten Einnahmen (netto) der an diesem Tag endenden,
   * bereits eingeplanten Touren. Schmale Tage zeigen "52k", breite die volle Zahl (Container-Query).
   */
  function baueEinnahmenZeileHtml(tage, fensterStartMs, fensterEndeMs) {
    if (!tage || !tage.size) return '';
    const dauer = fensterEndeMs - fensterStartMs;
    const segmente = [];
    const tag = new Date(fensterStartMs);
    tag.setHours(0, 0, 0, 0);
    for (let guard = 0; tag.getTime() < fensterEndeMs && guard < 14; guard++) {
      const von = tag.getTime();
      const bis = new Date(tag.getFullYear(), tag.getMonth(), tag.getDate() + 1).getTime();
      const l = Math.max(von, fensterStartMs), r = Math.min(bis, fensterEndeMs);
      const schluessel = tag.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' });
      const e = tage.get(schluessel);
      if (r > l && e) {
        const voll = `+${Math.round(e.netto).toLocaleString('de-DE')} €`;
        const kurz = `+${Math.round(e.netto / 1000)}k`;
        const tip = `${tag.toLocaleDateString('de-DE', { weekday: 'short' })} ${schluessel} · +${Math.round(e.netto).toLocaleString('de-DE')} € netto (${Math.round(e.brutto).toLocaleString('de-DE')} € brutto, ${e.touren} Tour${e.touren > 1 ? 'en' : ''})`;
        segmente.push(`<div class="fi-ein-seg" style="left:${(((l - fensterStartMs) / dauer) * 100).toFixed(2)}%; width:${(((r - l) / dauer) * 100).toFixed(2)}%;" data-fi-tip="${tip}"><span class="voll">${voll}</span><span class="kurz">${kurz}</span></div>`);
      }
      tag.setDate(tag.getDate() + 1);
    }
    if (!segmente.length) return '';
    const alle = [...tage.entries()].sort((a, b) => a[1].datum - b[1].datum)
      .map(([k, e]) => `${e.datum.toLocaleDateString('de-DE', { weekday: 'short' })} ${k} · +${Math.round(e.netto).toLocaleString('de-DE')} € netto`);
    const summe = [...tage.values()].reduce((a, e) => a + e.netto, 0);
    alle.push(`Summe: +${Math.round(summe).toLocaleString('de-DE')} € netto (nur eingeplante Touren, geschätzt)`);
    return `<div class="fi-dash-timeline-row" style="margin-bottom:2px;">
      <div class="fi-dash-timeline-label" data-fi-tip="${alle.join(String.fromCharCode(10)).replace(/"/g, '&quot;')}"><span class="fi-lbl-name" style="color:#8ef2a8;">💶 netto</span></div>
      <div class="fi-dash-timeline-track" style="height:16px; background:none; border:none; overflow:visible;">${segmente.join('')}</div>
    </div>`;
  }

  function baueTimelineKopfzeileHtml(fensterStartMs, fensterEndeMs, markerMs = null, markerLabel = '') {
    const ticks = baueZeitAchsenTicks(fensterStartMs, fensterEndeMs);
    let tickHtml = ticks.map(t => `<div class="fi-dash-timeline-tick${t.istMitternacht ? ' is-day' : ''}" style="left:${t.pct.toFixed(2)}%">${t.label}</div>`).join('');
    if (markerMs != null && markerMs >= fensterStartMs && markerMs <= fensterEndeMs) {
      const fensterDauerMs = fensterEndeMs - fensterStartMs;
      const markerPct = ((markerMs - fensterStartMs) / fensterDauerMs) * 100;
      tickHtml += `<div class="fi-dash-timeline-tick is-need" style="left:${markerPct.toFixed(2)}%; top:-16px;">⏰ ${markerLabel}</div>`;
    }
    return `<div class="fi-dash-timeline-row" style="margin-bottom:4px;">
      <div class="fi-dash-timeline-label"></div>
      <div class="fi-dash-timeline-track" style="height:20px; background:none; border:none; overflow:visible;">${tickHtml}</div>
    </div>`;
  }

  /**
   * Ergänzt jedes Flotten-Element um typ (Frachtbörsen-Kategorie), verbrauchsTyp
   * und Stellplätze. Bei Sattelzug-Kombis kommt die Kategorie vom gekoppelten
   * Auflieger (frachtKategorie), NICHT vom Zugmaschinen-Modell; ohne Auflieger
   * bleibt es beim eigenen Fahrzeugtyp. fallbackLabel greift, wenn nichts erkannt wurde.
   */
  /**
   * Frachtverträge (freight-contracts.php): Dauerverträge mit fester Strecke
   * ("Rahmenvertrag" normal, "Intensivvertrag" meist Bronze/Premium). Pro Vertrag
   * stehen auf der Karte: Strecke, €/km bzw. €/Stellplatz-km, Vergütung PRO
   * ABRUF, Abrufe pro Tag, Ziel (zu erfüllende Abrufe), Laufzeit, Bonus bei
   * Zielerreichung, Vertragsstrafe, benötigtes Setup und die Abrufregel
   * ("24 Stunden gültig · 3. Fehlabruf = Vertrag scheitert"). Neue Angebote
   * erscheinen täglich um 18:00 (ein normales + ggf. ein Premium-Angebot).
   * NICHT bekannt (kein aktiver Vertrag beobachtet): wie ein Abruf im Spiel
   * erscheint und ob "24 Stunden gültig" Annahme- oder Lieferfrist meint.
   */
  async function fetchFrachtvertraege() {
    const num = str => (str ? parseFloat(str.replace(/\./g, '').replace(',', '.')) : null);
    try {
      const res = await fiFetch('/game/freight-contracts.php', { credentials: 'same-origin', cache: 'no-store' });
      const doc = safeParseHtml(await res.text());
      return Array.from(doc.querySelectorAll('article.contract-card, article')).map(a => {
        // Geparstes (nicht angezeigtes) HTML hat kein Layout: innerText fügt keine
        // Leerzeichen zwischen Elementen ein -> Textknoten selbst mit Abstand verbinden.
        const knoten = []; const walker = doc.createTreeWalker(a, NodeFilter.SHOW_TEXT);
        while (walker.nextNode()) { const tx = walker.currentNode.textContent.trim(); if (tx) knoten.push(tx); }
        const t = knoten.join(' ').replace(/\s+/g, ' ').trim();
        const g = re => { const m = re.exec(t); return m ? m[1] : null; };
        const status = /Abgelaufen/.test(t) ? 'abgelaufen' : /Neues Angebot/.test(t) ? 'angebot' : 'sonstige';
        const route = /\d{2}:\d{2} (.+?) → (.+?) Strecke/i.exec(t);
        return {
          status,
          name: g(/((?:Rahmenvertrag|Intensivvertrag)[^·]*?)(?: · Rev|\s+Dauerkunde)/i) ?? g(/((?:Rahmenvertrag|Intensivvertrag)[^·]*)/i),
          tier: /^(Bronze|Silber|Gold)/.exec(t)?.[1] ?? null,
          gueltigBis: g(/bis (\d{2}\.\d{2}\.\d{4} \d{2}:\d{2})/i),
          von: route?.[1] ?? null, nach: route?.[2] ?? null,
          streckeKm: num(g(/STRECKE ([\d.]+) km/i)),
          preisProKm: num(g(/(?:KM-PREIS|STELLPLATZ-KM) ([\d,]+) €\/km/i)),
          stellplaetze: num(g(/LADUNG (\d+) Stellplätze/i)),
          setup: g(/BENÖTIGTES SETUP (.+?) LAUFZEIT/i),
          laufzeitTage: num(g(/LAUFZEIT (\d+) Tage/i)),
          abrufeProTag: num(g(/ABRUFE (\d+) pro Tag/i)),
          zielAbrufe: num(g(/ZIEL (\d+) Abrufe/i)),
          verguetungProAbruf: num(g(/VERGÜTUNG ([\d.,]+) €/i)),
          bonus: num(g(/BONUS ([\d.,]+) €/i)),
          strafe: num(g(/VERTRAGSSTRAFE ([\d.,]+) €/i)),
        };
      }).filter(v => v.status !== 'sonstige' || v.streckeKm);
    } catch (e) {
      console.warn('[FI-Helper] Frachtverträge konnten nicht geladen werden', e);
      return [];
    }
  }

  /** Kennzahlen eines Vertragsangebots + passende Flottenfahrzeuge (heuristisch über den Setup-Text). */
  function bewerteVertrag(v, fleet) {
    const umsatz = (v.verguetungProAbruf ?? 0) * (v.zielAbrufe ?? 0);
    const kmh = ZEIT_ANNAHMEN.avgGeschwindigkeitKmh;
    // Ein Fahrzeug fährt hin beladen, zurück leer; +25 % für Pausen, +3 h Laden/Entladen
    const zyklusTage = ((v.streckeKm ?? 0) * 2 / kmh * 1.25 + 3) / 24;
    const abrufeProFahrzeug = Math.max(1, Math.floor((v.laufzeitTage ?? 1) / zyklusTage));
    const fahrzeugBedarf = Math.ceil((v.zielAbrufe ?? 0) / abrufeProFahrzeug);
    const setupLower = (v.setup ?? '').toLowerCase();
    const passende = fleet.filter(f => {
      const typ = (f.typ ?? '').toLowerCase();
      const kern = typ.replace(/\s*\/\s*/g, ' ').split(' ')[0];
      return kern && setupLower.includes(kern);
    });
    return {
      umsatz, bonusAnteilProzent: umsatz ? (v.bonus ?? 0) / umsatz * 100 : null,
      eurProKm: v.streckeKm ? v.verguetungProAbruf / v.streckeKm : null,
      risikoFaktor: v.verguetungProAbruf ? (v.strafe ?? 0) / v.verguetungProAbruf : null,
      zyklusTage, fahrzeugBedarf, passende,
    };
  }

  /**
   * Urlaub der Fahrer (staff.php): pro Fahrer-Karte steht z.B.
   * "Urlaubsantrag offen · 27.10.–29.10.2026" (genehmigte Urlaube vermutlich
   * "Urlaub genehmigt · ..." - Text noch nicht beobachtet, deshalb allgemein
   * gelesen) plus das zugewiesene Fahrzeug ("Fahrzeug PL 01 · B-SAN 4 eingesetzt").
   * Regeln laut Posteingang: Ein Urlaub unterbricht KEINE bestehende Tour, bei
   * Überschneidung wird die Genehmigung abgelehnt, und am Urlaubsbeginn müssen
   * Fahrer UND Fahrzeug am Firmensitz sein. Beantragte (offene) Urlaube werden
   * vorsorglich wie genehmigte behandelt, damit eine spätere Genehmigung nie an
   * einer von uns geplanten Tour scheitert.
   * @returns {Promise<Map<string, {fahrer: string, von: Date, bis: Date, status: string}[]>>} Schlüssel = Fahrzeugname
   */
  async function fetchUrlaubsSperren() {
    const sperren = new Map();
    try {
      const res = await fiFetch('/game/staff.php', { credentials: 'same-origin', cache: 'no-store' });
      const doc = safeParseHtml(await res.text());
      doc.querySelectorAll('article').forEach(card => {
        const t = card.innerText.replace(/\s+/g, ' ').trim();
        const m = /Urlaub(?:santrag)?(?:\s+([A-Za-zäöüß]+))?\s*·\s*(\d{2})\.(\d{2})\.\s*[–-]\s*(\d{2})\.(\d{2})\.(\d{4})/.exec(t);
        const fz = /Fahrzeug\s+(.+?)\s+eingesetzt/.exec(t);
        if (!m || !fz) return;
        const jahrEnde = parseInt(m[6], 10);
        const jahrStart = parseInt(m[3], 10) > parseInt(m[5], 10) ? jahrEnde - 1 : jahrEnde;
        const von = new Date(jahrStart, parseInt(m[3], 10) - 1, parseInt(m[2], 10), 0, 0, 0);
        const bis = new Date(jahrEnde, parseInt(m[5], 10) - 1, parseInt(m[4], 10), 23, 59, 59);
        const fahrer = /^(.+?)\s+(?:Fahrer|Disponent)\b/.exec(t)?.[1] ?? 'Fahrer';
        const liste = sperren.get(fz[1].trim()) ?? [];
        liste.push({ fahrer, von, bis, status: m[1] ?? 'läuft' }); // laufender Urlaub steht als "Im Urlaub · ..." (ohne Statuswort)
        sperren.set(fz[1].trim(), liste);
      });
    } catch (e) {
      console.warn('[FI-Helper] Urlaubsdaten konnten nicht geladen werden', e);
    }
    return sperren;
  }

  /**
   * Genehmigt einen offenen Urlaubsantrag direkt aus dem Info-Feld (statt über den Posteingang): Die
   * Personal-Nachricht (inbox.php?filter=personnel) enthält das Formular "Urlaub genehmigen". Es wird zur
   * Laufzeit gelesen und samt seiner Felder (CSRF-Token, Nachricht, Aktion) abgeschickt. Läuft NUR auf
   * ausdrücklichen Klick des Nutzers. Das Spiel lehnt bei Überschneidung mit einer Tour selbst ab.
   * @returns {Promise<string>} Status laut Spiel ("Genehmigt", "Abgelehnt", ...)
   */
  async function genehmigeUrlaubsantrag(fahrer, von) {
    const datum = von.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });
    const nachrichtVon = (doc, knopf) => {
      let el = knopf ? knopf.parentElement : doc.body;
      const passt = e => /Urlaubsantrag/.test(e.textContent) && e.textContent.includes(fahrer)
        && e.textContent.replace(/\s+/g, '').includes(`Beginn${datum}`);
      while (el && !passt(el)) el = el.parentElement;
      return el;
    };
    const res = await fiFetch('/game/inbox.php?filter=personnel', { credentials: 'same-origin', cache: 'no-store' });
    const doc = safeParseHtml(await res.text());
    const knopf = [...doc.querySelectorAll('button')].find(b => /Urlaub genehmigen/i.test(b.textContent) && nachrichtVon(doc, b));
    if (!knopf) throw new Error('Antrag nicht mehr offen');
    const form = knopf.closest('form');
    if (!form) throw new Error('Formular nicht gefunden');
    const body = new URLSearchParams();
    new FormData(form).forEach((v, k) => { if (typeof v === 'string') body.append(k, v); });
    if (knopf.name) body.set(knopf.name, knopf.value);
    const ziel = new URL(knopf.getAttribute('formaction') || form.getAttribute('action') || '/game/inbox.php?filter=personnel', `${location.origin}/game/`).href;
    // fiLesend: die Genehmigung ändert weder Fahrzeugpläne noch Markt - der Speicher bleibt, nur Personal/Posteingang werden neu gelesen
    const r2 = await fiFetch(ziel, { method: 'POST', body, credentials: 'same-origin', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, fiLesend: true });
    fiGetSpeicher.delete('/game/staff.php');
    fiGetSpeicher.delete('/game/inbox.php?filter=personnel');
    const d2 = safeParseHtml(await r2.text());
    const fehler = d2.querySelector('.flash.error')?.textContent.replace(/\s+/g, ' ').trim();
    if (fehler) throw new Error(fehler);
    const nachricht = nachrichtVon(d2, null);
    return /Urlaubsantrag\s*(Genehmigt|Abgelehnt|Entscheidung offen)/i.exec((nachricht ?? d2.body).textContent.replace(/\s+/g, ' '))?.[1]
      ?? d2.querySelector('.flash.success')?.textContent.replace(/\s+/g, ' ').trim() ?? 'Genehmigt';
  }

  /**
   * Gehalt und Einstellungsdatum jedes Mitarbeiters (staff.php, gleicher Abruf wie die Urlaube -
   * der Zwischenspeicher liefert ihn ohne neue Anfrage).
   * @returns {Promise<{gehalt: number, seit: Date}[]>}
   */
  async function fetchPersonalGehaltsdaten() {
    const liste = [];
    try {
      const res = await fiFetch('/game/staff.php', { credentials: 'same-origin', cache: 'no-store' });
      const doc = safeParseHtml(await res.text());
      doc.querySelectorAll('article').forEach(card => {
        const t = card.textContent.replace(/\s+/g, ' ');
        const g = /Gehalt\s*([\d.]+,\d{2}) €/.exec(t);
        const m = /Im Team seit\s*(\d{2})\.(\d{2})\.(\d{4})/.exec(t);
        if (g && m) liste.push({ gehalt: parseFloat(g[1].replace(/\./g, '').replace(',', '.')), seit: new Date(+m[3], +m[2] - 1, +m[1]) });
      });
    } catch (e) {
      console.warn('[FI-Helper] Personaldaten konnten nicht geladen werden', e);
    }
    return liste;
  }

  /**
   * Voraussichtliche Gehaltsabrechnung zum Termin: Die Abrechnung am 28. gilt für den Kalendermonat des
   * Termins (28.10. -> "2026-10"). Wer VOR diesem Monat eingestellt wurde, bekommt das volle Gehalt, wer im
   * Monat eingestellt wurde, anteilig: (Tage im Monat - Einstellungstag + 1) / Tage im Monat (am 28.10.
   * auf den Cent bestätigt: 68.906,45 gerechnet vs. 68.906,46 gebucht). Wer erst nach dem Termin kommt, zählt nicht.
   * @returns {{summe: number, voll: number, anteilig: number}}
   */
  function prognostiziereGehaltsabrechnung(personal, termin) {
    const monatsanfang = new Date(termin.getFullYear(), termin.getMonth(), 1);
    const tageImMonat = new Date(termin.getFullYear(), termin.getMonth() + 1, 0).getDate();
    let summe = 0, voll = 0, anteilig = 0;
    personal.forEach(p => {
      if (p.seit > termin) return;
      voll += p.gehalt;
      const anteil = p.seit >= monatsanfang ? (tageImMonat - p.seit.getDate() + 1) / tageImMonat : 1;
      if (anteil < 1) anteilig++;
      summe += p.gehalt * anteil;
    });
    return { summe, voll, anteilig };
  }

  /**
   * Prüft, ob eine Tour mit einem bevorstehenden Urlaub kollidiert: Die Tour (Start bis Rückkehr samt
   * Heimfahrt, Schätzung mit 20 % Zuschlag für Pausen) darf den Urlaubszeitraum [Beginn 00:00 des
   * ersten Tages, Ende 23:59 des letzten Tages] nicht überschneiden - sie muss VOR Urlaubsbeginn am
   * Firmensitz zurück sein ODER erst NACH der Rückkehr des Fahrers starten. Bereits beendete Urlaube
   * zählen nicht.
   * @param {Date} [startZeit] Beginn der Tour (Standard: "frei ab" des Fahrzeugs)
   * @returns {string|null} Begründung, falls unzulässig
   */
  function urlaubskonflikt(fahrzeug, zielOrt, endeZeit, startZeit = fahrzeug.status?.freiAbZeit ?? new Date()) {
    const urlaube = (fahrzeug.urlaub ?? []).filter(u => u.bis > new Date());
    if (!urlaube.length || !endeZeit) return null;
    const daheim = new Date(endeZeit.getTime() + heimfahrtStunden(fahrzeug, zielOrt) * 3600 * 1000);
    const u = urlaube.find(x => startZeit < x.bis && daheim > x.von);
    return u ? `Urlaub ${u.fahrer} ${u.von.toLocaleDateString('de-DE')}-${u.bis.toLocaleDateString('de-DE')} (${u.status}) - Tour samt Heimfahrt wäre erst ${daheim.toLocaleString('de-DE')} zu Ende` : null;
  }

  /** Dauer einer Leerfahrt von `ort` zum Firmensitz (Strecken-Schätzung, 20 % Zuschlag für Pausen). */
  function heimfahrtStunden(fahrzeug, ort) {
    const heimat = parseFirmenstandort() || 'Berlin';
    const spez = holeFahrzeugSpezifikation(fahrzeug.verbrauchsTyp ?? fahrzeug.typ);
    const kmh = spez.geschwindigkeitKmh ?? ZEIT_ANNAHMEN.avgGeschwindigkeitKmh;
    const heimKm = ort && ort !== heimat ? geschaetzteStrassenKm(ort, heimat) : 0;
    return heimKm == null ? 0 : (heimKm / kmh) * 1.2;
  }

  /**
   * Liegt das "frei ab" eines Fahrzeugs MITTEN in einem Urlaub seines Fahrers (Fahrzeug steht, Fahrer fehlt),
   * muss das Fahrzeug erst zur Firma, um den Fahrer nach seiner Rückkehr abzuholen: die nächste Tour startet
   * dann AM FIRMENSITZ, frühestens am Tag der Rückkehr 00:00 bzw. wenn das Fahrzeug dort eintrifft (spätere
   * Zeit zählt), mit ausgeruhten Fahrern.
   */
  function mitUrlaubsRueckkehr(fahrzeug) {
    const frei = fahrzeug.status?.freiAbZeit;
    if (!frei) return fahrzeug;
    const u = (fahrzeug.urlaub ?? []).filter(x => x.bis > new Date()).find(x => frei >= x.von && frei <= x.bis);
    if (!u) return fahrzeug;
    const rueckkehr = u.bis.getTime() + 1000 + 5 * 60 * 1000; // Urlaub endet 23:59:59 - Start 5 Min. nach Mitternacht als Sicherheitsabstand
    const inFirma = frei.getTime() + heimfahrtStunden(fahrzeug, fahrzeug.status?.freiAbOrt) * 3600 * 1000;
    const regeln = LENKZEIT_REGELN[fahrzeug.live?.drivers?.length ?? 1] || LENKZEIT_REGELN[1];
    return {
      ...fahrzeug,
      heimkehr: false, // wird ohnehin zur Firma geholt, die Heimfahrt steckt schon im Startzeitpunkt
      status: {
        ...fahrzeug.status,
        freiAbOrt: parseFirmenstandort() || 'Berlin',
        freiAbZeit: new Date(Math.max(rueckkehr, inFirma)),
        fahrerRestOverride: { restLenkzeitStunden: regeln.fahrzeitAmStueck, restSchichtzeitStunden: regeln.spaetestesSchichtendeStunden },
      },
    };
  }

  /**
   * Urlaub macht jede Planung dieses Fahrzeugs im Planungsfenster unmöglich: Der Fahrer ist noch nicht zurück
   * und die Abholung in der Firma samt Rückkehr liegt hinter dem Fenster. Steht schon nach dem Lesen von
   * staff.php + Fahrzeugstand fest - dafür muss die Frachtbörse nicht gescannt werden.
   */
  function urlaubBlockiert(fahrzeug) {
    const angepasst = mitUrlaubsRueckkehr(fahrzeug);
    if (angepasst === fahrzeug) return false;
    return angepasst.status.freiAbZeit.getTime() + aktuellerPlanungspuffer() * 3600 * 1000 > Date.now() + PLANUNGSFENSTER_STUNDEN * 3600 * 1000;
  }

  /**
   * "Muss zurück in die Firma"-Anzeige (🏠), automatisch: Urlaub beginnt in <= 5
   * Tagen (Fahrer + Fahrzeug müssen dann am Firmensitz sein) bzw. HU kritisch/
   * Zustand schlecht (Werkstatt). Erlischt, sobald das Fahrzeug am Firmensitz
   * "frei ab" ist. Wirkung: die Bewertung rechnet die Leerfahrt vom Zielort
   * zurück zum Firmensitz mit ein (siehe findeBesteRoutenProFahrzeug).
   * @returns {{aktiv: boolean, grund: string|null, manuell: boolean}}
   */
  function bestimmeHeimkehr(vehicleId, freiAbOrt, urlaubListe, details) {
    const heimat = parseFirmenstandort() || 'Berlin';
    const amFirmensitz = !!freiAbOrt && freiAbOrt === heimat;
    let grund = null;
    if (!amFirmensitz) {
      const bald = Date.now() + 5 * 24 * 3600 * 1000;
      if ((urlaubListe ?? []).some(u => u.bis > new Date() && u.von.getTime() <= bald)) grund = 'Urlaub steht an';
      const schlecht = i => i && (['critical', 'expired', 'missing'].includes(i.huStatus) || i.zustandStufe === 'danger');
      if (!grund && (schlecht(details?.verschleiss) || schlecht(details?.auflieger))) grund = 'Werkstatt/HU';
    }
    return { aktiv: !!grund, grund, manuell: false };
  }

  /**
   * "Rückruf zur Firma" wie der Knopf in der Disposition: das Spiel hängt ans
   * Ende des Plans eine Leertour zum Firmensitz an (POST dispatch.php,
   * dispatch_action=return_to_base, vehicle_id).
   * @returns {Promise<string>} Meldung des Spiels
   */
  async function rufeFahrzeugZurueck(vehicleId) {
    const body = new URLSearchParams({ dispatch_action: 'return_to_base', vehicle_id: String(vehicleId) });
    const res = await fiFetch('/game/dispatch.php', {
      method: 'POST', body, credentials: 'same-origin', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    });
    const doc = safeParseHtml(await res.text());
    const fehler = doc.querySelector('.flash.error')?.textContent.replace(/\s+/g, ' ').trim();
    if (fehler) throw new Error(fehler);
    return doc.querySelector('.flash.success')?.textContent.replace(/\s+/g, ' ').trim() ?? 'Rückruf ausgelöst';
  }

  function baueFleetMitTyp(fleetMitLive, detailsMap, fallbackLabel, urlaubNachFahrzeug = new Map()) {
    return fleetMitLive.map(f => {
      const details = f.status?.vehicleId ? detailsMap.get(String(f.status.vehicleId)) : null;
      const typ = normalisiereFahrzeugtyp(details?.frachtKategorie || details?.typ) || fallbackLabel;
      const heim = bestimmeHeimkehr(f.status?.vehicleId, f.status?.freiAbOrt, urlaubNachFahrzeug.get(f.name), details);
      return {
        ...f,
        heimkehr: heim.aktiv,
        heimkehrGrund: heim.grund,
        typ,
        urlaub: urlaubNachFahrzeug.get(f.name) ?? [],
        verbrauchsTyp: normalisiereFahrzeugtyp(details?.typ) || typ,
        stellplaetze: details?.stellplaetze ?? holeFahrzeugSpezifikation(details?.frachtKategorie || details?.typ || fallbackLabel).stellplaetzeGesamt ?? null,
      };
    });
  }

  function fmtEuro(n) {
    return n.toLocaleString('de-DE', { style: 'currency', currency: 'EUR' });
  }

  /**
   * Baut die kleine Diagnose-Zeile unter den Ergebnissen: welche
   * zusätzlichen Seitenaufrufe für diesen "Beste Routen berechnen"-Lauf
   * gemacht wurden und wie lange jeder gedauert hat (Nutzerwunsch, siehe
   * Chat) - fiAbrufProtokoll wird in routenBerechnen() gesammelt.
   * @param {{label: string, dauerMs: number, fehler: string|null}[]} protokoll
   */
  function baueAbrufDiagnoseHtml(protokoll) {
    if (!protokoll.length) return '';
    const gesamtMs = protokoll.reduce((sum, e) => sum + e.dauerMs, 0);
    const zeilen = protokoll
      .map(e => e.fehler
        ? `❌ ${e.label} fehlgeschlagen nach ${e.dauerMs} ms (${e.fehler})`
        : `· ${e.label} geladen in ${e.dauerMs} ms`)
      .join('<br>');
    return `<div class="fi-dash-row fi-muted" style="grid-column: 1 / -1; font-size:10.5px; margin-top:16px; opacity:.75;">
      🔧 ${protokoll.length} zusätzliche Seitenaufrufe · ${gesamtMs} ms gesamt<br>${zeilen}
    </div>`;
  }

  /**
   * Cache für Frachtbörsen-Scans: pro Kategorie (+ Rückfracht-Filter) muss
   * nicht bei jedem Klick auf "Beste Routen berechnen" neu über 20 Seiten
   * gescannt werden - die Angebote ändern sich nicht sekündlich. Fahrzeug-/
   * Live-Daten werden trotzdem IMMER frisch geholt (siehe Klick-Handler).
   * @type {Map<string, {angebote: FrachtAngebot[], gescannteSeiten: number, gesamtSeiten: number|null, zeitstempel: number}>}
   */
  const marktScanCache = new Map();
  const MARKT_CACHE_TTL_MS = 10 * 60 * 1000; // 10 Minuten, danach gilt der Cache als abgelaufen
  const MARKT_CACHE_STORAGE_PREFIX = 'fi_markt_cache_v1_';

  /**
   * Der Scan-Cache überlebt jetzt auch Seitenwechsel (die reine Map im
   * Speicher ging bei jeder Navigation verloren -> alles wurde neu abgerufen).
   * Lesen: erst Speicher, dann localStorage; Datumsfelder werden wiederhergestellt.
   */
  function holeMarktCache(schluessel) {
    const imSpeicher = marktScanCache.get(schluessel);
    if (imSpeicher) return imSpeicher;
    try {
      const roh = window.localStorage.getItem(MARKT_CACHE_STORAGE_PREFIX + schluessel);
      if (!roh) return null;
      const eintrag = JSON.parse(roh, (k, v) => (k === 'lieferfrist' && typeof v === 'string' ? new Date(v) : v));
      marktScanCache.set(schluessel, eintrag);
      return eintrag;
    } catch (e) {
      return null;
    }
  }

  function speichereMarktCache(schluessel, eintrag) {
    marktScanCache.set(schluessel, eintrag);
    try {
      window.localStorage.setItem(MARKT_CACHE_STORAGE_PREFIX + schluessel, JSON.stringify(eintrag));
    } catch (e) {
      // Kontingent voll: alte Markt-Caches verwerfen und einmal neu versuchen, sonst nur im Speicher halten
      try {
        Object.keys(window.localStorage).filter(k => k.startsWith(MARKT_CACHE_STORAGE_PREFIX)).forEach(k => window.localStorage.removeItem(k));
        window.localStorage.setItem(MARKT_CACHE_STORAGE_PREFIX + schluessel, JSON.stringify(eintrag));
      } catch (e2) { /* nur im Speicher */ }
    }
  }

  /**
   * Cache für Daten, die sich erfahrungsgemäß selten ändern (Fuhrpark-
   * Zusammensetzung/Stellplätze, Anzahl Disponenten) - im Gegensatz zu
   * Fahrzeug-Status/Live-Fahrerdaten, die sich laufend ändern und deshalb
   * NIE gecached werden dürfen. 30 Minuten TTL, plus über den 🔄-Knopf
   * (erzwingeNeuladen) jederzeit manuell umgehbar.
   */
  const NEBEN_DATEN_CACHE_TTL_MS = 30 * 60 * 1000;
  let fuhrparkDetailsCache = null; // {daten: Map, zeitstempel}
  let disponentenAnzahlCache = null; // {anzahl, zeitstempel}
  let staedteDatenCache = null; // {daten: Object<string, [lat,lng,land,logistikfaktor]>, zeitstempel} - siehe fetchStaedteDaten

  function nebenDatenCacheIstFrisch(cacheEintrag) {
    return cacheEintrag && (Date.now() - cacheEintrag.zeitstempel) < NEBEN_DATEN_CACHE_TTL_MS;
  }

  /**
   * Cache-Schlüssel nur noch nach Kategorie - der Scan läuft jetzt IMMER
   * ungefiltert breit (kein serverseitiger Ziel-Filter mehr, siehe Chat: der
   * war unzuverlässig UND wir brauchen für Ketten-Touren ohnehin Angebote zu
   * verschiedenen Zielen aus demselben Datensatz). Rückfracht-Filterung und
   * Ketten-Bildung passieren komplett clientseitig aus diesem einen Scan.
   */
  function marktCacheSchluessel(bodyType) {
    return bodyType;
  }

  /**
   * Baut die Frachtbörsen-UI (Kategorie-Auswahl + Scan-Button + Ergebnisse).
   * Wird bei jedem Update-Tick aufgerufen, baut die UI aber nur EINMAL auf -
   * danach wird nur noch der Kopfbereich (Kontostand/Statistik) aktualisiert,
   * damit ein laufender Scan oder vorhandene Ergebnisse nicht überschrieben werden.
   */
  /**
   * Baut das große Dashboard auf /game/active_tours.php ("Tourenübersicht").
   * Diese Seite ist ohne Premium leer (nur Statistik-Zahlen + gesperrte
   * Meldung) - idealer Platz für eine geräumige, grafische Version des
   * Helfers, statt alles in die schmale 320px-Sidebar zu quetschen.
   * Ersetzt/verdeckt die "Premium-Feature"-Sperr-Meldung der Seite.
   */
  async function renderActiveToursDashboard() {
    if (document.getElementById('fi-dashboard')) return; // nur einmal aufbauen

    initFiTooltipSystem();

    // Fallback: erst der strikte Desktop-Selektor, dann ein lockerer (beliebige Tiefe) -
    // für den Fall, dass eine mobile Ansicht .wrap anders verschachtelt.
    let wrap = document.querySelector('body > .wrap') || document.querySelector('.wrap');
    if (!wrap) {
      console.error('[FI-Helper] Kein .wrap-Element auf der Seite gefunden - Dashboard kann nicht gebaut werden.');
      return;
    }

    // Die spieleigene "Premium-Feature"-Sperre ausblenden, unser Dashboard übernimmt den Platz
    const gesperrteMeldung = wrap.querySelector('.locked');
    if (gesperrteMeldung) gesperrteMeldung.style.display = 'none';

    const dashboard = document.createElement('div');
    dashboard.id = 'fi-dashboard';
    dashboard.innerHTML = `
      <h2>🚚 Frimp Führer <span style="font-size:12px; font-weight:700; color:#9aa5b8;">v${SCRIPT_VERSION}</span></h2>
      <div id="fi-dash-header" class="fi-dash-pills"><div class="fi-dash-pill">Lade …</div></div>
      <div id="fi-dash-zahlungen" class="fi-dash-pills"></div>

      <h3>Frachtbörse</h3>
      <div class="fi-dash-controls fi-controls-laden" id="fi-dash-controls">
        <div class="fi-lade"><div class="fi-road"><i class="fi-road-dashes"></i><span class="fi-truck"><span>🚚</span></span></div><span class="fi-lade-text">Lade Flotte und Frachtarten …</span></div>
        <div id="fi-dash-cats" class="fi-cat-row"></div>
        <select id="fi-dash-bodytype" style="display:none;"></select>
        <button type="button" id="fi-dash-load-btn" class="fi-dash-btn" style="display:none;">Routen berechnen</button>
        <button type="button" id="fi-dash-autofill-btn" class="fi-dash-btn" title="Nimmt für ALLE Fahrzeuge fortlaufend die besten Komplettladungen an und plant sie ein, bis das Planungsfenster voll ist">⚡ Alle befüllen</button>
        <button type="button" id="fi-dash-reload-btn" class="fi-dash-btn-reload" title="Cache umgehen und frisch laden">🔄</button>
      </div>
      <div id="fi-dash-results" class="fi-dash-grid"></div>

      <h3>Tourenplan</h3>
      <div id="fi-dash-timeline"><div class="fi-empty">Lade Tourenplan …</div></div>

      <div id="fi-dash-abrufe"></div>

    `;

    // Nach den Statistik-Karten einfügen, vor der (jetzt versteckten) Sperr-Meldung
    const statsSection = wrap.querySelector('.tour-stats');
    if (statsSection) statsSection.style.display = 'none'; // "Aktive/Angenommene/Erfüllte/Nicht erfüllte Touren" sind auf Wunsch entfallen
    if (statsSection && statsSection.nextSibling) {
      statsSection.parentNode.insertBefore(dashboard, statsSection.nextSibling);
    } else {
      wrap.appendChild(dashboard);
    }

    // Diesel-Marktpreis ändert sich laut Spiel täglich - einmal pro
    // Dashboard-Aufbau live abrufen und den Fallback in ASSUMPTIONS
    // überschreiben, damit alle Kostenrechnungen den aktuellen Preis nutzen.
    // Frachtarten (freight-market.php) starten SOFORT, parallel zu allem anderen - früher wurden sie erst
    // nach dem Laden der kompletten Flotte geholt (Dropdown erschien deshalb Sekunden später).
    const optionenPromise = getBodyTypeOptionsAnywhere();
    const [dieselPreisLive, staedteLive] = await Promise.all([fetchDieselPreis(), fetchStaedteDaten()]);
    if (dieselPreisLive != null) ASSUMPTIONS.dieselPreisProLiter = dieselPreisLive;
    // Echte Städte-Stammdaten (Koordinaten/Land/Logistikfaktor) über die
    // statische Fallback-Tabelle legen - siehe fetchStaedteDaten.
    if (staedteLive) CITY_COORDS = { ...CITY_COORDS, ...staedteLive };

    // --- Kopfbereich (Kontostand/Statistik) ---
    async function aktualisiereKopf() {
      // Info-Feld: Chips (Warnungen/Urlaubsantrag) füllt aktualisiereFlotte(); hier nur der Sync-Knopf
      const kopfEl = document.getElementById('fi-dash-header');
      if (!kopfEl) return;
      kopfEl.innerHTML = `<span id="fi-info-chips" style="display:contents;"></span><button type="button" id="fi-sync-pill" class="fi-dash-pill is-muted" style="cursor:pointer;" title="Mitschnitt in privates GitHub-Repo hochladen (PC und Handy zusammen auswerten)">${syncPillText()}</button>`;
      kopfEl.querySelector('#fi-sync-pill')?.addEventListener('click', () => { bedienSyncPill().catch(e => window.alert(`Sync: ${e.message}`)); });
    }
    await aktualisiereKopf();
    starteAbrufAnzeige();

    // Urlaubsantrag direkt genehmigen (Chip im Info-Feld)
    document.getElementById('fi-dashboard').addEventListener('click', async ev => {
      const knopf = ev.target.closest('.fi-urlaub-ok');
      if (!knopf || knopf.disabled) return;
      const vorher = knopf.innerHTML;
      knopf.disabled = true;
      knopf.textContent = '… genehmige';
      try {
        const status = await genehmigeUrlaubsantrag(knopf.dataset.fahrer, new Date(Number(knopf.dataset.von)));
        const ok = /genehmigt/i.test(status);
        knopf.classList.toggle('is-warn', false);
        knopf.classList.toggle('is-negative', !ok);
        knopf.textContent = ok ? `✓ Urlaub ${knopf.dataset.fahrer.split(' ').pop()} genehmigt` : `✗ ${status}`;
      } catch (e) {
        console.error('[FI-Helper] Urlaub genehmigen fehlgeschlagen', e);
        knopf.disabled = false;
        knopf.innerHTML = vorher;
        knopf.classList.add('is-negative');
        knopf.setAttribute('data-fi-tip', `Genehmigen fehlgeschlagen: ${e.message.replace(/"/g, '&quot;')}\nKlick versucht es erneut.`);
        knopf.insertAdjacentText('beforeend', ' ✗');
      }
    });

    // --- Mini-Übersicht: Kreditraten (je Tag gebündelt) + Gehalt, nur 7 Tage vorher ---
    // Reicht das Geld nicht, wird genau die Zahlung rot markiert, die nicht mehr gedeckt ist:
    // der Kontostand wird der Reihe nach (nach Fälligkeit) belastet; was noch passt, bleibt normal.
    async function aktualisiereZahlungen() {
      const el = document.getElementById('fi-dash-zahlungen');
      if (!el) return;
      const z = await fetchZahlungsplan();
      if (!z) return;
      const jetzt = Date.now();
      const eur = x => `${Math.round(x).toLocaleString('de-DE')} €`;
      const tip = t => t.replace(/"/g, '&quot;');

      // Gehalt: monatlich am Tag der letzten Buchung (beobachtet: 28. um 00:01), nächster Termin = Folgemonat
      let gehalt = null;
      if (z.gehalt != null) {
        const basis = z.letztesGehalt?.datum ?? null;
        const tag = basis ? basis.getDate() : 28;
        const std = basis ? [basis.getHours(), basis.getMinutes()] : [0, 1];
        let kand = new Date(new Date().getFullYear(), new Date().getMonth(), tag, std[0], std[1]);
        if (kand.getTime() <= jetzt) kand = new Date(kand.getFullYear(), kand.getMonth() + 1, tag, std[0], std[1]);
        gehalt = { art: 'gehalt', datum: kand, betrag: z.gehalt, tag, std, prognose: null };
        // Genauer als die Monatssumme der Bank: Neueinstellungen im Abrechnungsmonat werden anteilig abgerechnet
        const personal = await fetchPersonalGehaltsdaten();
        if (personal.length) {
          gehalt.prognose = prognostiziereGehaltsabrechnung(personal, kand);
          gehalt.betrag = gehalt.prognose.summe;
        }
      }

      // Alle anstehenden Zahlungen chronologisch durchrechnen
      const zahlungen = [
        ...z.raten.filter(r => r.faellig.getTime() > jetzt).map(r => ({ art: 'rate', datum: r.faellig, betrag: r.betrag, r })),
        ...(gehalt ? [gehalt] : []),
      ].sort((x, y) => x.datum - y.datum);
      let saldo = z.konto;
      zahlungen.forEach(p => {
        if (saldo == null) { p.fehlt = false; return; }
        if (saldo >= p.betrag) { saldo -= p.betrag; p.fehlt = false; } else { p.fehlt = true; p.luecke = p.betrag - saldo; }
      });

      const inTagen = d => Math.max(0, Math.ceil((d.getTime() - jetzt) / 86400000));
      const fehltText = p => (p.fehlt ? `\n✗ Geld fehlt: ${fmtEuro(p.luecke)} (verfügbar ${fmtEuro(Math.max(0, z.konto ?? 0))})` : '');
      let html = '';

      // Kreditraten je Fälligkeitstag
      const tage = new Map();
      zahlungen.filter(p => p.art === 'rate' && inTagen(p.datum) <= 7).forEach(p => {
        const k = p.datum.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' });
        const e = tage.get(k) ?? { summe: 0, liste: [], datum: p.datum };
        e.summe += p.betrag;
        e.liste.push(p);
        tage.set(k, e);
      });
      [...tage.entries()].forEach(([k, e], i) => {
        const zeilen = e.liste.map(p => `${p.fehlt ? '✗ ' : ''}Rate #${p.r.nr} · ${fmtEuro(p.betrag)} (Tilgung ${fmtEuro(p.r.tilgung)} · Zinsen ${fmtEuro(p.r.zinsen)}) · ${p.datum.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}${p.fehlt ? ` - Geld fehlt: ${fmtEuro(p.luecke)}` : ''}`);
        if (i === 0 && z.restschuld != null) zeilen.push(`Restschuld gesamt: ${fmtEuro(z.restschuld)}`);
        const fehlt = e.liste.some(p => p.fehlt);
        html += `<a class="fi-dash-pill${fehlt ? ' is-negative' : ''}" href="/game/bank.php" style="text-decoration:none;" data-fi-tip="${tip(zeilen.join('\n'))}">💳 ${k} · ${eur(e.summe)} <span style="${fehlt ? '' : 'color:#9aa5b8; '}font-weight:600;">in ${inTagen(e.datum)} T</span></a>`;
      });

      // Gehalt
      if (gehalt && inTagen(gehalt.datum) <= 7) {
        const tipText = [
          `Gehaltsabrechnung monatlich (abgebucht am ${gehalt.tag}. um ${String(gehalt.std[0]).padStart(2, '0')}:${String(gehalt.std[1]).padStart(2, '0')}).`,
          z.letztesGehalt ? `Zuletzt ${z.letztesGehalt.datum.toLocaleDateString('de-DE')}: ${fmtEuro(z.letztesGehalt.betrag)}.` : '',
          gehalt.prognose
            ? `Voller Monat: ${fmtEuro(gehalt.prognose.voll)}${gehalt.prognose.anteilig ? ` · ${gehalt.prognose.anteilig} Neueinstellung(en) dieses Monats anteilig` : ''}.`
            : `Aktuelle Monatsgehälter: ${fmtEuro(z.gehalt)} (die Abrechnung kann anteilig abweichen, z. B. bei Neueinstellungen).`,
        ].filter(Boolean).join('\n') + fehltText(gehalt);
        html += `<a class="fi-dash-pill${gehalt.fehlt ? ' is-negative' : ''}" href="/game/staff.php" style="text-decoration:none;" data-fi-tip="${tip(tipText)}">👥 ${gehalt.datum.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' })} · ${gehalt.prognose ? '' : '~'}${eur(gehalt.betrag)} <span style="${gehalt.fehlt ? '' : 'color:#9aa5b8; '}font-weight:600;">in ${inTagen(gehalt.datum)} T</span></a>`;
      }
      el.innerHTML = html;
    }
    aktualisiereZahlungen();

    // --- Flotte (große Karten statt schmaler Sidebar-Zeilen) ---
    // flotteFuerAuswahl: von aktualisiereFlotte() befüllt, damit die
    // Fahrzeug-Auswahl bei "Zurück zur Firma" ohne zusätzlichen Fetch
    // dieselben, schon geladenen Fahrzeugdaten nutzen kann (siehe Chat:
    // Fetch-Anzahl niedrig halten).
    let flotteFuerAuswahl = [];
    let flottenKategorien = null; // Frachtkategorien, die mit den vorhandenen Fahrzeugen bedient werden können
    let kategorienFertig = null;
    const kategorienPromise = new Promise(r => { kategorienFertig = r; });
    async function aktualisiereFlotte() {
      const infoEl = document.getElementById('fi-info-chips');
      if (!infoEl) return;
      // Beim ersten Aufbau: Zeilen erscheinen sofort als Platzhalter und füllen sich, sobald
      // der Plan des jeweiligen Fahrzeugs eintrifft - sichtbar erst, wenn der Bereich im Bild ist.
      const timelineVorab = document.getElementById('fi-dash-timeline');
      const erstesMal = !!timelineVorab && !timelineVorab.dataset.vorab;
      const vorabStart = Date.now();
      const vorabEnde = vorabStart + 48 * 3600 * 1000;
      const onListe = namen => {
        if (!erstesMal) return;
        timelineVorab.dataset.vorab = '1';
        if (!timelineVorab.dataset.gesehen) startWennSichtbar(timelineVorab);
        timelineVorab.classList.toggle('fi-aufbau', !timelineVorab.dataset.gesehen);
        timelineVorab.innerHTML = baueTimelineLegendeHtml() + baueTimelineKopfzeileHtml(vorabStart, vorabEnde, null, '') + namen.map((n, i) =>
          `<div class="fi-dash-timeline-row" style="--i:${i}" data-fz="${n.replace(/"/g, '&quot;')}"><div class="fi-dash-timeline-label"><span class="fi-lbl-name">🚐 ${n}</span></div><div class="fi-dash-timeline-track"><i class="fi-skel"></i></div></div>`).join('');
      };
      const onFahrzeug = (name, status) => {
        if (!erstesMal) return;
        const zeile = [...timelineVorab.querySelectorAll('.fi-dash-timeline-row')].find(z => z.dataset.fz === name);
        if (!zeile || !status) return;
        zeile.querySelector('.fi-dash-timeline-track').innerHTML = baueTimelineTrackHtml(status.phasen, vorabStart, vorabEnde, null);
        zeile.classList.add('fi-zeile-neu');
      };
      const [fleet, fuhrparkDetails] = await Promise.all([fetchFleetStatus(onListe, onFahrzeug), fetchFuhrparkDetails()]);
      flotteFuerAuswahl = fleet;
      flottenKategorien = new Set(baueFleetMitTyp(fleet, fuhrparkDetails, null).map(f => f.typ).filter(Boolean));
      kategorienFertig?.();

      // Diagnose-Log (siehe Chat): zeigt in der Konsole (F12), ob der neue
      // Code wirklich läuft und wie viele Phasen pro Fahrzeug ankommen -
      // hilft zu unterscheiden zwischen "Cache/alte Version noch aktiv" und
      // "Code läuft, aber liefert unerwartete Daten".
      console.log('[FI-Helper] v0.26.2 Timeline-Rohdaten:', fleet.map(f => ({
        name: f.name,
        vehicleId: f.status?.vehicleId ?? null,
        phasenAnzahl: f.status?.phasen?.length ?? 0,
        phasenTypen: [...new Set((f.status?.phasen ?? []).map(p => p.type))],
      })));

      // Info-Feld: nur was für die Planung zählt - Warnungen, offene Urlaubsanträge
      // (genehmigte Urlaube: 🌴 am Fahrzeug im Tourenplan; die Planung beachtet alle).
      const tipText = t => t.replace(/"/g, '&quot;');
      let html = '';
      const dispatchVehicleIds = new Set(fleet.map(f => String(f.status?.vehicleId ?? '')));
      const fehlendeFahrzeuge = Array.from(fuhrparkDetails.entries())
        .filter(([vehicleId, details]) => !details.hatFahrer && !dispatchVehicleIds.has(String(vehicleId)));
      if (fehlendeFahrzeuge.length) {
        html += `<a class="fi-dash-pill is-warn" href="/game/fuhrpark.php" style="text-decoration:none;" data-fi-tip="${tipText(fehlendeFahrzeuge.map(([, d]) => d.typ || 'Unbekannter Typ').join('\n'))}">⚠ ${fehlendeFahrzeuge.length} ohne Fahrer</a>`;
      }

      // Hauptuntersuchung + Verschleiß gegen die echten Mindestwerte der Prüfstelle:
      // HU-Chip nur bei Fälligkeit in <= 60 Tagen (orange), <= 30 Tage / überfällig (rot);
      // Verschleiß-Chip nur wenn ein Bauteil <= 10 Prozentpunkte über dem Mindestwert liegt (<= 0: defekt).
      const [pruef, kmProTag, tourRatenMap] = await Promise.all([fetchPruefstand(), fetchKmProTag(), fetchTourRaten()]);

      // Erwartete Einnahmen: Tageswerte (netto) werden im Tourenplan über dem Datum angezeigt
      const einnahmen = berechneErwarteteEinnahmen(fleet, tourRatenMap);
      if (pruef?.length) {
        const jetztMs = Date.now();
        const maxKmTag = kmProTag && kmProTag.size ? Math.max(...kmProTag.values()) : 1200;
        const eintraege = pruef.map(e => {
          const tage = e.huDatum ? Math.ceil((e.huDatum.getTime() - jetztMs) / 86400000) : null;
          // km/Tag: gemessen (7-Tage-Schnitt), Auflieger/unbekannt = schnellstes Fahrzeug; +25 % Sicherheit
          const kmTag = (kmProTag?.get(e.name) ?? maxKmTag) * 1.25;
          // Hochrechnung je Bauteil: Tage bis zum Mindestwert = Reserve (pp) / (pp pro km * km pro Tag)
          const teile = e.teile.map(t => {
            const rate = (VERSCHLEISS_PP_PRO_1000KM[t.name] ?? 0.55) / 1000; // pp je km
            const reserve = t.wert - t.min;
            return { name: t.name, reserve, tageBisGrenze: kmTag > 0 ? reserve / (rate * kmTag) : Infinity };
          });
          const knapp = teile.reduce((m, t) => (t.tageBisGrenze < m.tageBisGrenze ? t : m), { tageBisGrenze: Infinity, reserve: Infinity, name: '' });
          return { ...e, tage, knapp };
        });
        // Hauptuntersuchung: nur 7 Tage vorher (oder überfällig)
        const nachHU = eintraege.filter(e => e.tage != null && e.tage <= 7).sort((x, y) => x.tage - y.tage);
        if (nachHU.length) {
          const n = nachHU[0];
          const zeilen = nachHU.map(e => `${e.name} · HU ${e.huDatum.toLocaleDateString('de-DE')} (${e.tage < 0 ? `${-e.tage} T überfällig` : `in ${e.tage} T`})`);
          html += `<a class="fi-dash-pill ${n.tage <= 2 ? 'is-negative' : 'is-warn'}" href="/game/inspection-station.php" style="text-decoration:none;" data-fi-tip="${tipText(`Hauptuntersuchung (1.250 €) - nur am Firmensitz ohne Touren.\n` + zeilen.join('\n'))}">🔧 HU ${n.name.split(' ').slice(0, 2).join(' ')} in ${n.tage} T${nachHU.length > 1 ? ` (+${nachHU.length - 1})` : ''}</a>`;
        }
        // Verschleiß: nur wenn ein Bauteil in <= 7 Tagen den Mindestwert erreicht (oder schon darunter ist)
        const knappe = eintraege.filter(e => e.knapp.tageBisGrenze <= 7).sort((x, y) => x.knapp.tageBisGrenze - y.knapp.tageBisGrenze);
        if (knappe.length) {
          const defekt = knappe.some(e => e.knapp.reserve <= 0);
          const zeilen = knappe.map(e => `${e.name}: ${e.knapp.name} ${e.knapp.reserve <= 0 ? 'DEFEKT (unter Mindestwert)' : `+${e.knapp.reserve.toFixed(1).replace('.', ',')} pp Reserve, Grenze in ca. ${Math.max(1, Math.round(e.knapp.tageBisGrenze))} T`}`);
          const k0 = knappe[0];
          html += `<a class="fi-dash-pill ${defekt ? 'is-negative' : 'is-warn'}" href="/game/workshop.php" style="text-decoration:none;" data-fi-tip="${tipText(zeilen.join('\n'))}">⚠ ${k0.name.split(' ').slice(0, 2).join(' ')} ${k0.knapp.name}${k0.knapp.reserve <= 0 ? ' defekt' : ` in ~${Math.max(1, Math.round(k0.knapp.tageBisGrenze))} T`}${knappe.length > 1 ? ` (+${knappe.length - 1})` : ''}</a>`;
        }
      }

      // Urlaub: Hinweis NUR bei (noch) offenem Antrag; genehmigte -> 🌴 im Tourenplan
      const urlaubsSperren = await fetchUrlaubsSperren();
      const kurz = d => d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' });
      [...urlaubsSperren.entries()]
        .flatMap(([fzName, liste]) => liste.filter(u => u.bis > new Date() && /offen/i.test(u.status)).map(u => ({ fzName, ...u })))
        .forEach(u => {
          html += `<button type="button" class="fi-dash-pill is-warn fi-urlaub-ok" style="cursor:pointer;" data-fahrer="${u.fahrer}" data-von="${u.von.getTime()}" data-fi-tip="${tipText(`Urlaubsantrag ${u.fahrer} (${u.fzName.split(' · ')[0]}): ${u.von.toLocaleDateString('de-DE')}–${u.bis.toLocaleDateString('de-DE')}\nNoch offen - die Planung behandelt ihn schon wie genehmigt.\nKlick genehmigt den Antrag.`)}">🌴 Antrag ${u.fahrer.split(' ').pop()} · ${kurz(u.von)}–${kurz(u.bis)} · ✔ genehmigen</button>`;
        });

      // Die einzelnen Fahrzeugkarten sind auf Wunsch entfallen (die Timeline zeigt
      // alles); übrig bleibt die Warnung für Fahrzeuge ohne Fahrer plus die
      // Verschleiß/HU-Warnung oben.
      const kopfEl = infoEl.parentElement; // infoEl selbst ist display:contents (hat keine Box -> nicht beobachtbar)
      if (kopfEl && !kopfEl.dataset.gesehen) startWennSichtbar(kopfEl);
      infoEl.innerHTML = html;

      // --- Timeline: alle Fahrzeuge auf einen Blick (wie der spieleigene
      // Dispositionsplan, nur alle Fahrzeuge übereinander statt einzeln) ---
      const timelineEl = document.getElementById('fi-dash-timeline');
      if (timelineEl) {
        const fensterStartMs = Date.now();
        let fensterEndeMs = fensterStartMs + 48 * 3600 * 1000; // 48h-Fenster ab jetzt (ggf. verlängert, s.u.)

        // Frühester Zeitpunkt, ab dem IRGENDEIN Fahrzeug ohne geplante Tour
        // dastehen würde ("Ende der Planung" ist bereits das Ende des GESAMTEN
        // bekannten Plans, nicht nur der aktuellen Phase, siehe parseCurrentVehicleStatus) -
        // das ist genau der Zeitpunkt, ab dem spätestens neu disponiert werden muss.
        let naechsterPlanungsbedarf = null;
        fleet.forEach(entry => {
          const zeit = entry.status?.freiAbZeit;
          if (!zeit) return;
          if (!naechsterPlanungsbedarf || zeit < naechsterPlanungsbedarf.zeit) {
            naechsterPlanungsbedarf = { zeit, name: entry.name, ort: entry.status.freiAbOrt };
          }
        });
        // Der Marker darf nie aus dem Fenster fallen: liegt der früheste Planungsbedarf
        // hinter den 48h (typisch, wenn alle Fahrzeuge bis ans Planungsfenster
        // verplant sind), wird das Fenster bis kurz dahinter verlängert; liegt er
        // schon in der Vergangenheit (Fahrzeug steht bereits), sitzt er am linken Rand.
        let markerMs = naechsterPlanungsbedarf ? naechsterPlanungsbedarf.zeit.getTime() : null;
        if (markerMs != null) {
          if (markerMs > fensterEndeMs) fensterEndeMs = Math.min(markerMs + 4 * 3600 * 1000, fensterStartMs + 120 * 3600 * 1000);
          if (markerMs < fensterStartMs) markerMs = fensterStartMs;
        }
        const markerLabel = naechsterPlanungsbedarf
          ? `${naechsterPlanungsbedarf.zeit.toLocaleString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })} · ${naechsterPlanungsbedarf.name}`
          : '';

        let timelineHtml = baueTimelineLegendeHtml();

        if (!fleet.length) {
          timelineHtml += '<div class="fi-empty">Keine Fahrzeuge gefunden.</div>';
        } else {
          // Ein einzelner Fetch (mit ?date=heute, siehe fetchVehicleStatus)
          // liefert bereits eine ganze Woche an Tagen - kein Mehrfach-Nachladen
          // mehr nötig (das hat vorher nur Duplikate erzeugt, siehe Chat).
          timelineHtml += baueEinnahmenZeileHtml(einnahmen.tage, fensterStartMs, fensterEndeMs);
          timelineHtml += baueTimelineKopfzeileHtml(fensterStartMs, fensterEndeMs, markerMs, markerLabel);
          fleet.forEach((entry, zeilenIndex) => {
            const vehicleId = entry.status?.vehicleId;
            const urlaubFz = (urlaubsSperren.get(entry.name) ?? []).filter(u => u.bis > new Date());
            const heim = bestimmeHeimkehr(vehicleId, entry.status?.freiAbOrt, urlaubFz, fuhrparkDetails.get(String(vehicleId)));
            const symbol = heim.aktiv ? '🏠' : (urlaubFz.length ? '🌴' : '🚐');
            const urlaubTip = [
              heim.aktiv ? `🏠 muss zurück in die Firma (${heim.grund})` : '',
              ...urlaubFz.map(u => `🌴 Urlaub ${u.fahrer} (${u.status}): ${u.von.toLocaleDateString('de-DE')}–${u.bis.toLocaleDateString('de-DE')}`),
            ].filter(Boolean).join('\n');
            const heimatOrt = parseFirmenstandort() || 'Berlin';
            const zeigeRueckruf = !!vehicleId && !!entry.status?.freiAbOrt && entry.status.freiAbOrt !== heimatOrt;
            const rueckrufHtml = zeigeRueckruf
              ? `<button type="button" class="fi-rueckruf-btn" data-vid="${vehicleId}" data-fi-tip="Rückruf zur Firma: Leertour nach ${heimatOrt} hinten an den Plan hängen">🏠↩</button>`
              : '';
            const labelInhalt = `<span class="fi-lbl-name">${symbol} ${vehicleId ? `<a href="/game/dispatch.php?vehicle_id=${encodeURIComponent(vehicleId)}">${entry.name}</a>` : entry.name}</span>${rueckrufHtml}`;
            const trackInhalt = baueTimelineTrackHtml(entry.status?.phasen, fensterStartMs, fensterEndeMs, markerMs);
            timelineHtml += `<div class="fi-dash-timeline-row" style="--i:${zeilenIndex}">
              <div class="fi-dash-timeline-label"${urlaubTip ? ` data-fi-tip="${tipText(urlaubTip)}"` : ''}>${labelInhalt}</div>
              <div class="fi-dash-timeline-track">${trackInhalt}</div>
            </div>`;
          });
        }
        // Aufbau-Animation nur, solange der Bereich noch nie im Bild war (danach kein Flackern)
        if (!timelineEl.dataset.gesehen) startWennSichtbar(timelineEl);
        timelineEl.classList.toggle('fi-aufbau', !timelineEl.dataset.gesehen);
        timelineEl.innerHTML = timelineHtml;
        timelineEl.querySelectorAll('.fi-rueckruf-btn').forEach(btn => {
          btn.addEventListener('click', async () => {
            btn.disabled = true;
            btn.textContent = '…';
            try {
              await rufeFahrzeugZurueck(btn.dataset.vid);
              await aktualisiereFlotte();
            } catch (e) {
              console.error('[FI-Helper] Rückruf fehlgeschlagen', e);
              btn.textContent = '⚠';
              btn.setAttribute('data-fi-tip', `Rückruf fehlgeschlagen: ${e.message}`);
              btn.disabled = false;
            }
          });
        });
      }
    }
    // Flotte lädt weiter im Hintergrund; die Bedienleiste wird bereit, sobald Frachtarten UND Flottenkategorien da sind
    const flotteLaeuft = aktualisiereFlotte().catch(e => console.error('[FI-Helper] Flotte laden fehlgeschlagen', e)).finally(() => kategorienFertig?.());
    await kategorienPromise;

    // --- Frachtart-Buttons: nur Kategorien, die die vorhandenen Fahrzeuge bedienen können ---
    const bodyTypeSelect = document.getElementById('fi-dash-bodytype'); // bleibt als (unsichtbarer) Wertespeicher für die Berechnung
    const options = await optionenPromise;
    options.forEach(opt => {
      const el = document.createElement('option');
      el.value = opt.value;
      el.textContent = opt.label;
      bodyTypeSelect.appendChild(el);
    });
    let letzteWahl = null;
    try { letzteWahl = window.sessionStorage.getItem('fi_last_bodytype'); } catch (e) {}
    if (letzteWahl && options.some(o => o.value === letzteWahl)) bodyTypeSelect.value = letzteWahl;
    bodyTypeSelect.addEventListener('change', () => {
      try { window.sessionStorage.setItem('fi_last_bodytype', bodyTypeSelect.value); } catch (e) {}
    });
    {
      const bedienbar = options.filter(o => flottenKategorien?.has(o.label));
      const sichtbar = bedienbar.length ? bedienbar : options; // Fallback: alles, falls kein Typ erkannt wurde
      if (sichtbar.length && !sichtbar.some(o => o.value === bodyTypeSelect.value)) bodyTypeSelect.value = sichtbar[0].value;
      const catsEl = document.getElementById('fi-dash-cats');
      catsEl.innerHTML = sichtbar.map((o, i) => `<button type="button" class="fi-dash-btn fi-cat-btn" data-value="${o.value}" style="--i:${i}">${o.label}</button>`).join('');
      const markiereAktiv = () => catsEl.querySelectorAll('.fi-cat-btn').forEach(b => b.classList.toggle('is-aktiv', b.dataset.value === bodyTypeSelect.value && !!letzteWahl));
      catsEl.querySelectorAll('.fi-cat-btn').forEach(btn => btn.addEventListener('click', () => {
        bodyTypeSelect.value = btn.dataset.value;
        bodyTypeSelect.dispatchEvent(new Event('change'));
        letzteWahl = btn.dataset.value;
        markiereAktiv();
        routenBerechnen(false);
      }));
      markiereAktiv();
      // fertig geladen: Lade-Animation weg, Bedienelemente fliegen ein (erst wenn im Bild)
      const controls = document.getElementById('fi-dash-controls');
      startWennSichtbar(controls);
      controls.classList.remove('fi-controls-laden');
      controls.classList.add('fi-controls-bereit');
    }

    // --- Routen berechnen (nutzt denselben Cache + dieselbe Bewertungslogik wie die Sidebar) ---
    const loadBtn = document.getElementById('fi-dash-load-btn');
    const reloadBtn = document.getElementById('fi-dash-reload-btn');
    new MutationObserver(() => document.querySelectorAll('.fi-cat-btn').forEach(b => { b.disabled = loadBtn.disabled; }))
      .observe(loadBtn, { attributes: true, attributeFilter: ['disabled'] });
    const resultsEl = document.getElementById('fi-dash-results');
    resultsEl.addEventListener('animationstart', ev => {
      const karte = ev.target;
      if (ev.animationName !== 'fi-einfahrt' || !karte.classList?.contains('fi-karte')) return;
      if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
      const zahl = karte.querySelector('.fi-eurkm');
      const ziel = parseFloat(zahl?.dataset.ziel);
      if (!zahl || !Number.isFinite(ziel)) return;
      const t0 = performance.now();
      const schritt = jetzt => {
        const p = Math.min(1, (jetzt - t0) / 900);
        zahl.textContent = `${(ziel * (1 - Math.pow(1 - p, 3))).toFixed(2).replace('.', ',')} €/km`;
        if (p < 1) requestAnimationFrame(schritt);
      };
      requestAnimationFrame(schritt);
    });
    // "Zurück zur Firma"-Filter ist entfallen (Rückruf per Knopf im Tourenplan, siehe rufeFahrzeugZurueck)
    const onlyReturnCb = { checked: false };
    const returnVehicleSelect = { value: '' };
    const returnRadiusInput = { value: '0' };

    async function routenBerechnen(erzwingeNeuladen) {
      if (erzwingeNeuladen) fiGetSpeicherLeeren(); // 🔄 = wirklich frisch laden
      const bodyType = bodyTypeSelect.value;
      if (!bodyType) {
        resultsEl.innerHTML = '<div class="fi-empty">Bitte zuerst eine Kategorie wählen.</div>';
        return;
      }
      const firmenStandort = onlyReturnCb.checked ? parseFirmenstandort() : null;
      const rueckfrachtFilter = onlyReturnCb.checked && firmenStandort
        ? { zielStadt: firmenStandort, zielRadiusKm: parseInt(returnRadiusInput.value, 10) || 0, nurVehicleId: returnVehicleSelect.value || null }
        : {};

      loadBtn.disabled = true;
      reloadBtn.disabled = true;
      const originalText = loadBtn.textContent;
      loadBtn.textContent = 'Lade …';
      const kategorieVorab = bodyTypeSelect.selectedOptions[0]?.textContent ?? '';
      const konsole = baueScanKonsole(resultsEl, `Frachtbörse · ${kategorieVorab}`);
      konsole.stufe('Starte …');
      delete resultsEl.dataset.gesehen;
      startWennSichtbar(resultsEl);
      resultsEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

      // Protokoll für die Diagnose-Anzeige zurücksetzen - sammelt ab hier
      // jeden zusätzlichen Seitenaufruf dieses Laufs (siehe protokolliereAbruf).
      fiAbrufProtokoll = [];

      try {
        // Diesel-Marktpreis (Tages-Cache) + Disponenten-Anzahl (30-Min-Cache) -
        // beide unabhängig vom Frachtbörsen-Cache, aber selbst gecached (siehe
        // NEBEN_DATEN_CACHE_TTL_MS) und über den 🔄-Knopf erzwingbar neu ladbar.
        const dieselPreisLive = await fetchDieselPreis(erzwingeNeuladen);
        if (dieselPreisLive != null) ASSUMPTIONS.dieselPreisProLiter = dieselPreisLive;
        const staedteLive = await fetchStaedteDaten(erzwingeNeuladen);
        if (staedteLive) CITY_COORDS = { ...CITY_COORDS, ...staedteLive };
        await aktualisierePlanungsfenster(erzwingeNeuladen);

        // Kein Server-Zielfilter mehr (siehe Chat: unzuverlässig UND wir
        // brauchen für Ketten-Touren ohnehin einen breiten, ungefilterten
        // Datensatz) - Ziel-Filterung und Ketten-Bildung passieren komplett
        // clientseitig in findeBesteRoutenProFahrzeug aus EINEM Scan.
        // Flotte + Urlaube VOR der Frachtbörse: Fahrzeuge, die wegen Urlaub gar nicht planbar sind, stehen
        // damit schon fest. Bleibt kein planbares Fahrzeug übrig, wird die Frachtbörse nicht gescannt.
        const kategorieLabel = options.find(o => o.value === bodyType)?.label ?? bodyType;
        const { fleetMitLive, detailsMap } = await ladeFlotteMitLive(konsole, erzwingeNeuladen);
        const fleet = baueFleetMitTyp(fleetMitLive, detailsMap, kategorieLabel, await fetchUrlaubsSperren());
        const urlaubsFahrzeuge = fleet.filter(f => f.typ === kategorieLabel && urlaubBlockiert(f));
        const kompatibleFleetVollstaendig = fleet.filter(f => f.typ === kategorieLabel && !urlaubsFahrzeuge.includes(f));
        const marktUebersprungen = !kompatibleFleetVollstaendig.length;

        const cacheKey = marktCacheSchluessel(bodyType);
        const cacheEintrag = holeMarktCache(cacheKey);
        const cacheIstFrisch = cacheEintrag && (Date.now() - cacheEintrag.zeitstempel) < MARKT_CACHE_TTL_MS;

        let marktErgebnis;
        let ausCache = false;
        if (marktUebersprungen) {
          marktErgebnis = { angebote: [], gescannteSeiten: 0, gesamtSeiten: 0 };
        } else if (cacheIstFrisch && !erzwingeNeuladen) {
          marktErgebnis = cacheEintrag;
          ausCache = true;
          konsole.stufe('Markt aus Zwischenspeicher');
          konsole.markt(kategorieVorab, { seite: marktErgebnis.gescannteSeiten ?? 1, gesamt: marktErgebnis.gescannteSeiten ?? 1, angebote: marktErgebnis.angebote.length });
          konsole.fortschritt(0.6);
        } else {
          marktErgebnis = await fetchAllOffersForBodyType(bodyType, 500, (status, info) => {
            konsole.stufe(status);
            if (info) { konsole.markt(kategorieVorab, info); konsole.fortschritt(0.6 * info.seite / Math.max(1, info.gesamt)); }
          });
          speichereMarktCache(cacheKey, { ...marktErgebnis, zeitstempel: Date.now() });
        }

        konsole.fortschritt(0.62);
        const { angebote, gescannteSeiten, gesamtSeiten } = marktErgebnis;

        // WICHTIG: passende bleibt bewusst UNGEFILTERT nach Zielort - die
        // Ketten-Suche braucht genau diese Breite, um Zwischenetappen zu
        // finden. Die eigentliche Ziel-Filterung für Direkt-Routen und
        // Bündel passiert jetzt INNERHALB findeBesteRoutenProFahrzeug.
        const passende = filtereNachAufbau(angebote, kategorieLabel);
        const inkompatibleFleet = fleet.filter(f => f.typ !== kategorieLabel);
        // "Zurück zur Firma" schränkt die Suche auf genau das gewählte
        // Fahrzeug ein, statt wie sonst alle kompatiblen Fahrzeuge zu prüfen.
        const kompatibleFleet = rueckfrachtFilter.nurVehicleId
          ? kompatibleFleetVollstaendig.filter(f => String(f.status?.vehicleId) === String(rueckfrachtFilter.nurVehicleId))
          : kompatibleFleetVollstaendig;

        // Nur WARNUNGEN anzeigen (kein Cache-/Anzahl-/Seiten-Gerede)
        let infoHtml = urlaubsFahrzeuge.map(f => `<div class="fi-dash-row fi-muted">⏭ ${f.name.split(' · ')[0]}: übersprungen wegen Urlaub</div>`).join('');
        if (onlyReturnCb.checked && !firmenStandort) {
          infoHtml += `<div class="fi-dash-row fi-warn">⚠ Firmenstandort konnte nicht ermittelt werden - "Zurück zur Firma" wird ignoriert.</div>`;
        }
        if (rueckfrachtFilter.nurVehicleId && !kompatibleFleet.length && kompatibleFleetVollstaendig.length) {
          infoHtml += `<div class="fi-dash-row fi-warn">⚠ Gewähltes Fahrzeug passt nicht zur Kategorie "${kategorieLabel}".</div>`;
        }
        if (rueckfrachtFilter.zielStadt) {
          const zielTreffer = filtereNachZielstadt(passende, rueckfrachtFilter.zielStadt, rueckfrachtFilter.zielRadiusKm ?? 0).length;
          if (zielTreffer === 0) infoHtml += `<div class="fi-dash-row fi-warn">🎯 Keine Angebote mit Ziel "${rueckfrachtFilter.zielStadt}"${rueckfrachtFilter.zielRadiusKm > 0 ? ` (±${rueckfrachtFilter.zielRadiusKm} km)` : ''}.</div>`;
        }
        // Maßgeblich ist die Spezifikation der tatsächlich fahrenden Fahrzeuge
        // (Zugmaschine bei Sattelzug-Kombis), nicht der Name der Frachtkategorie.
        const ohneSpezifikation = [...new Set(kompatibleFleet.map(f => f.verbrauchsTyp ?? f.typ))].filter(t => !FAHRZEUG_SPEZIFIKATIONEN[t]);
        if (ohneSpezifikation.length) {
          infoHtml += `<div class="fi-dash-row fi-warn">⚠ Für "${ohneSpezifikation.join('", "')}" noch keine echten Verbrauchsdaten - Kostenschätzung nutzt Platzhalter.</div>`;
        }
        if (inkompatibleFleet.length) {
          console.log(`[FI-Helper] ${inkompatibleFleet.length} Fahrzeug(e) übersprungen (anderer Typ): ${inkompatibleFleet.map(f => f.name).join(', ')}`);
        }

        let html = infoHtml ? `<div class="fi-dash-card" style="grid-column: 1 / -1;">${infoHtml}</div>` : '';

        if (marktUebersprungen) {
          konsole.ende('Fertig');
          if (!urlaubsFahrzeuge.length) html += '<div class="fi-empty">Kein Fahrzeug mit passendem Typ für diese Kategorie gefunden.</div>';
        } else if (!passende.length) {
          html += '<div class="fi-empty">Keine passenden Angebote gefunden.</div>';
        } else if (!kompatibleFleet.length) {
          html += '<div class="fi-empty">Kein Fahrzeug mit passendem Typ für diese Kategorie gefunden.</div>';
        } else {
          const besteProFahrzeugRoh = await berechneBesteRouten(passende, kompatibleFleet, rueckfrachtFilter.zielStadt || null, rueckfrachtFilter.zielRadiusKm ?? 0, konsole);
          konsole.ende('Fertig');
          // Fahrzeuge ohne buchbaren Auftrag (nicht einplanbar, Frist nicht zu halten, Urlaub, ...) werden ausgeblendet
          const besteProFahrzeug = loeseFahrzeugKonflikte(besteProFahrzeugRoh).filter(e => e.beste);
          if (!besteProFahrzeug.length) html += '<div class="fi-empty">Kein Fahrzeug einplanbar.</div>';
          else html = `<div style="grid-column: 1 / -1;"><button type="button" class="fi-dash-btn fi-cat-fill" data-kategorie="${kategorieLabel}">⚡ Alle ${kategorieLabel} befüllen</button></div>` + html;
          besteProFahrzeug.forEach((eintrag, kartenIndex) => {
            const titel = eintrag.vehicleId
              ? `<a href="/game/dispatch.php?vehicle_id=${encodeURIComponent(eintrag.vehicleId)}">🚐 ${eintrag.fahrzeugName}</a>`
              : `🚐 ${eintrag.fahrzeugName}`;
            const { fracht, bewertung, istKette, kette } = eintrag.beste;
            const eurProKm = bewertung.effektivProKm != null ? bewertung.effektivProKm.toFixed(2).replace('.', ',') : '–';
            html += `<div class="fi-dash-card fi-karte" style="--i:${kartenIndex}"><div class="fi-dash-card-title"><span>${titel}</span><span class="fi-eurkm" data-ziel="${bewertung.effektivProKm ?? ''}" style="font-size:17px; color:#ffd98a;">${eurProKm} €/km</span></div>`;
            html += `<div class="fi-dash-row"><strong>${fracht.startOrt} → ${fracht.zielOrt}</strong> (${fracht.entfernungKm ?? '?'} km)</div>`;
            if (istKette) {
              html += `<div class="fi-dash-bundle-item">↳ ${kette.etappe1.startOrt} → ${kette.etappe1.zielOrt} · ${kette.etappe1.entfernungKm} km · ${fmtEuro(kette.etappe1.verguetungEuro ?? 0)}</div>`;
              html += `<div class="fi-dash-bundle-item">↳ ${kette.etappe2.startOrt} → ${kette.etappe2.zielOrt} · ${kette.etappe2.entfernungKm} km · ${fmtEuro(kette.etappe2.verguetungEuro ?? 0)}</div>`;
            }
            html += `<div class="fi-dash-row fi-muted">${istKette ? '2 Etappen' : fracht.frachtName} · ${fmtEuro(fracht.verguetungEuro ?? 0)} · Leerfahrt ${Math.round(bewertung.anfahrtKm)} km${bewertung.heimfahrtKm > 0 ? ` · 🏠 Heimfahrt ${Math.round(bewertung.heimfahrtKm)} km` : ''}</div>`;

            if (istKette) {
              html += `<button type="button" class="fi-dash-accept-btn fi-kette-btn"
                data-job-a="${kette.etappe1.jobId}" data-job-b="${kette.etappe2.jobId}"
                data-vehicle-id="${eintrag.vehicleId}" data-frei-ab="${eintrag.freiAbZeit.toISOString()}" data-beladung="${bewertung.beladungsStartZeit.toISOString()}"
                data-route-a="${kette.etappe1.startOrt} → ${kette.etappe1.zielOrt}" data-route-b="${kette.etappe2.startOrt} → ${kette.etappe2.zielOrt}"
                data-fahrzeug="${eintrag.fahrzeugName}"
              >Einplanen</button>`;
            } else {
              html += `<button type="button" class="fi-dash-accept-btn fi-accept-btn"
                data-job-id="${fracht.jobId}" data-vehicle-id="${eintrag.vehicleId}"
                data-frei-ab="${eintrag.freiAbZeit.toISOString()}" data-beladung="${bewertung.beladungsStartZeit.toISOString()}"
                data-route="${fracht.startOrt} → ${fracht.zielOrt}" data-fahrzeug="${eintrag.fahrzeugName}"
              >Einplanen</button>`;
            }
            html += `<i class="fi-karte-lkw">🚚</i></div>`;
          });
        }

        resultsEl.innerHTML = html;
        verdrahteAnnehmenButtons(resultsEl);
      } catch (e) {
        console.error('[FI-Helper] Fehler beim Dashboard-Scan', e);
        resultsEl.innerHTML = `<div class="fi-dash-row fi-bad">Fehler beim Laden: ${e.message}</div>`;
      } finally {
        loadBtn.disabled = false;
        reloadBtn.disabled = false;
        loadBtn.textContent = originalText;
        console.log('[FI-Helper] Abrufe dieses Laufs:', fiAbrufProtokoll);
      }
    }

    loadBtn.addEventListener('click', () => routenBerechnen(false));
    reloadBtn.addEventListener('click', () => routenBerechnen(true));

    // --- Alle Fahrzeuge automatisch befüllen ---
    const autofillBtn = document.getElementById('fi-dash-autofill-btn');
    let autofillLaeuft = false;
    let autofillAbbruch = false;
    let autofillKategorie = null; // gesetzt vom "Alle <Frachtart> befüllen"-Knopf: nur Fahrzeuge dieser Kategorie
    let befuellPlan = null; // zuletzt berechneter Plan, wartet auf "Touren bestätigen"
    resultsEl.addEventListener('click', ev => {
      if (ev.target.closest('.fi-bestaetigen')) bucheBefuellPlan();
    });
    resultsEl.addEventListener('click', ev => {
      const b = ev.target.closest('.fi-cat-fill');
      if (!b) return;
      autofillKategorie = b.dataset.kategorie;
      autofillBtn.click();
    });

    async function bucheBefuellPlan() {
      if (autofillLaeuft || !befuellPlan?.length) return;
      const plan = befuellPlan;
      befuellPlan = null;
      autofillLaeuft = true;
      autofillAbbruch = false;
      const originalText = autofillBtn.textContent;
      autofillBtn.textContent = '⏹ Stopp';
      loadBtn.disabled = true;
      reloadBtn.disabled = true;
      resultsEl.innerHTML = '<div id="fi-autofill-konsole" style="grid-column: 1 / -1;"></div><div id="fi-autofill-log" style="grid-column: 1 / -1;"></div>';
      const logEl = document.getElementById('fi-autofill-log');
      const konsole = baueScanKonsole(document.getElementById('fi-autofill-konsole'), 'Touren buchen');
      delete resultsEl.dataset.gesehen;
      startWennSichtbar(resultsEl);
      resultsEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      const log = (text, klasse = 'fi-muted') => { logEl.insertAdjacentHTML('beforeend', `<div class="fi-dash-row ${klasse}">${text}</div>`); };
      try {
        const erg = await fuehreBefuellPlanAus({
          plan,
          log,
          abgebrochen: () => autofillAbbruch,
          fortschritt: ({ schritt, gesamt, text }) => {
            konsole.stufe(`Schritt ${schritt}/${gesamt} · ${text} …`);
            konsole.fortschritt(schritt / gesamt);
            if (!autofillAbbruch) autofillBtn.textContent = `⏹ Stopp · ${schritt}/${gesamt}`;
          },
        });
        konsole.fortschritt(1);
        konsole.ende('Fertig');
        log(`<strong>Fertig:</strong> ${erg.gebucht} von ${plan.length} Touren eingeplant · ${fmtEuro(erg.summe)}${erg.fehler ? ` · ${erg.fehler} fehlgeschlagen` : ''}`, erg.fehler ? 'fi-warn' : 'fi-good');
      } catch (e) {
        console.error('[FI-Helper] Plan buchen fehlgeschlagen', e);
        log(`Fehler: ${e.message}`, 'fi-bad');
        konsole.ende('Fehler');
      } finally {
        autofillLaeuft = false;
        autofillBtn.textContent = originalText;
        loadBtn.disabled = false;
        reloadBtn.disabled = false;
        fiGetSpeicherLeeren();
        await aktualisiereFlotte();
      }
    }

    autofillBtn.addEventListener('click', async () => {
      if (autofillLaeuft) {
        autofillKategorie = null;
        autofillAbbruch = true;
        autofillBtn.textContent = 'Stoppe nach aktuellem Schritt …';
        return;
      }
      const nurKategorie = autofillKategorie;
      autofillKategorie = null;
      const trocken = true; // "Alle befüllen" berechnet nur - gebucht wird erst nach "Touren bestätigen"
      befuellPlan = null;

      autofillLaeuft = true;
      autofillAbbruch = false;
      const originalText = autofillBtn.textContent;
      autofillBtn.textContent = '⏹ Stopp';
      loadBtn.disabled = true;
      reloadBtn.disabled = true;
      resultsEl.innerHTML = '<div id="fi-autofill-konsole" style="grid-column: 1 / -1;"></div><div id="fi-autofill-log" style="grid-column: 1 / -1;"></div>';
      const logEl = document.getElementById('fi-autofill-log');
      const konsole = baueScanKonsole(document.getElementById('fi-autofill-konsole'), `Alle ${nurKategorie ?? 'Fahrzeuge'} befüllen`);
      delete resultsEl.dataset.gesehen;
      startWennSichtbar(resultsEl);
      resultsEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      const zeigeFortschritt = ({ runde, schritt, gesamt, text }) => {
        konsole.stufe(`Runde ${runde} · Schritt ${schritt}/${gesamt} · ${text} …`);
        konsole.fortschritt(schritt / gesamt);
        if (!autofillAbbruch) autofillBtn.textContent = `⏹ Stopp · ${schritt}/${gesamt}`;
      };
      const log = (text, klasse = 'fi-muted') => {
        logEl.insertAdjacentHTML('beforeend', `<div class="fi-dash-row ${klasse}">${text}</div>`);
      };

      try {
        const ergebnis = await befuelleFlotteAutomatisch({
          nurKategorie,
          options,
          log,
          abgebrochen: () => autofillAbbruch,
          trocken,
          fortschritt: zeigeFortschritt,
          konsole,
        });
        konsole.fortschritt(1);
        konsole.ende('Fertig');
        if (ergebnis.plan?.length) {
          befuellPlan = ergebnis.plan;
          log(`<strong>${ergebnis.plan.length} Touren berechnet</strong> · ${fmtEuro(ergebnis.summeEuro)}`, 'fi-good');
          logEl.insertAdjacentHTML('beforeend', `<div class="fi-dash-row" style="margin-top:8px;"><button type="button" class="fi-dash-btn fi-bestaetigen">✅ Touren bestätigen (${ergebnis.plan.length} · ${fmtEuro(ergebnis.summeEuro)})</button></div>`);
        } else {
          log('Nichts einplanbar.', 'fi-muted');
        }
      } catch (e) {
        console.error('[FI-Helper] Automatisches Befüllen fehlgeschlagen', e);
        log(`Fehler: ${e.message}`, 'fi-bad');
        konsole.ende('Fehler');
      } finally {
        autofillLaeuft = false;
        autofillBtn.textContent = originalText;
        loadBtn.disabled = false;
        reloadBtn.disabled = false;
        await aktualisiereFlotte();
      }
    });
  }

  /**
   * Animationen starten erst, wenn das Element wirklich im Bild ist: bis dahin trägt es
   * `fi-wartet` (CSS pausiert alle Animationen darin, Elemente stehen im Startzustand).
   * Sobald es zu sehen ist, wird die Klasse entfernt und `data-gesehen` gesetzt.
   */
  const sichtbarkeitsBeobachter = (typeof IntersectionObserver !== 'undefined')
    ? new IntersectionObserver(eintraege => {
        eintraege.forEach(e => {
          if (!e.isIntersecting) return;
          e.target.classList.remove('fi-wartet');
          e.target.dataset.gesehen = '1';
          sichtbarkeitsBeobachter.unobserve(e.target);
        });
      }, { threshold: 0.1 })
    : null;
  function startWennSichtbar(el) {
    if (!el || !sichtbarkeitsBeobachter) { if (el) el.dataset.gesehen = '1'; return; }
    el.classList.add('fi-wartet');
    sichtbarkeitsBeobachter.observe(el);
  }

  /** Flotte laden und dabei live in der Konsole zeigen, was eintrifft (Pläne, Fahrerzeiten, Fuhrpark). */
  async function ladeFlotteMitLive(konsole, erzwingeNeuladen) {
    const kurz = n => n.split(' · ')[0];
    konsole?.stufe('Fahrzeugpläne laden …');
    const fleetRoh = await fetchFleetStatus(
      namen => konsole?.fahrzeuge(namen.map(kurz)),
      name => { konsole?.fahrzeugStatus(kurz(name), 'rechnet', 'Plan ✓'); konsole?.fund(`📡 ${kurz(name)} · Plan geladen`); },
    );
    konsole?.stufe('Fahrerzeiten & Fuhrpark laden …');
    const [fleetMitLive, detailsMap] = await Promise.all([
      Promise.all(fleetRoh.map(async f => {
        const live = f.status?.vehicleId ? await fetchLiveDriverStatus(f.status.vehicleId, f.name) : null;
        konsole?.fahrzeugStatus(kurz(f.name), 'fertig', live ? 'Fahrerzeit ✓' : 'Plan ✓');
        return { ...f, live };
      })),
      fetchFuhrparkDetails(erzwingeNeuladen),
    ]);
    return { fleetMitLive, detailsMap };
  }

  /**
   * Prüfstelle (inspection-station.php): je Fahrzeug UND Auflieger die Hauptuntersuchung
   * (Intervall 12 Monate, "Fällig am") und die Bauteilprüfung mit den echten Mindestwerten
   * des Spiels (Reifen 20 %, Bremsen 20 %, Kupplung 25 %, Motor 40 %, Fahrgestell 45 %;
   * "Ein Bauteil unter seinem Mindestwert bedeutet defekt"). HU nur am Firmensitz ohne Touren
   * (1.250 €). Reserve = Zustand - Mindestwert in Prozentpunkten.
   * @returns {Promise<{name:string, istAuflieger:boolean, huDatum:Date|null, standort:string, teile:{name:string, wert:number, min:number}[]}[]|null>}
   */
  let pruefstandCache = null;
  async function fetchPruefstand() {
    if (pruefstandCache && Date.now() - pruefstandCache.zeit < 10 * 60 * 1000) return pruefstandCache.daten;
    try {
      const res = await fiFetch('/game/inspection-station.php', { credentials: 'same-origin', cache: 'no-store' });
      if (!res.ok) return null;
      const doc = safeParseHtml(await res.text());
      const zahl = t => parseFloat(t.replace(/\./g, '').replace(',', '.'));
      const daten = [...doc.querySelectorAll('.inspection-card')].map(c => {
        const text = c.textContent.replace(/\s+/g, ' ').trim();
        const istAuflieger = /Anhänger|Auflieger/i.test(c.querySelector('.inspection-card__type')?.textContent ?? '');
        const h2 = c.querySelector('h2')?.textContent.trim() ?? '?';
        const serial = c.querySelector('.fi-license-plate__serial')?.textContent.trim();
        const hu = /Fällig am\s*(\d{2})\.(\d{2})\.(\d{4})/.exec(text);
        const teile = [...c.querySelectorAll('tbody tr')].map(r => {
          const x = [...r.children].map(e => e.textContent.replace(/\s+/g, ' ').trim());
          return { name: (x[0] ?? '').split(' ')[0], wert: zahl(x[1] ?? ''), min: zahl(x[2] ?? '') };
        }).filter(t => Number.isFinite(t.wert) && Number.isFinite(t.min));
        return {
          name: istAuflieger && serial ? `${h2} ${serial}` : h2,
          istAuflieger,
          huDatum: hu ? new Date(+hu[3], +hu[2] - 1, +hu[1]) : null,
          standort: /Standort\s*([^]+?)\s*(?:Aktuelle|$)/.exec(text)?.[1] ?? '',
          teile,
        };
      });
      pruefstandCache = { zeit: Date.now(), daten };
      return daten;
    } catch (e) {
      console.warn('[FI-Helper] Prüfstelle konnte nicht geladen werden', e);
      return null;
    }
  }

  /**
   * Verschleiß pro 1000 km in Prozentpunkten - aus 120 abgeschlossenen Touren (Tourmeldungen im
   * Posteingang: "Verschleiss: Reifen 74,85 % -> 74,75 %") gemessen, für Zugmaschine, Solo-LKW
   * und Kleintransporter identisch, linear in den gefahrenen km (Leer- und Lastfahrt gleich).
   */
  const VERSCHLEISS_PP_PRO_1000KM = { Reifen: 0.55, Bremsen: 0.48, Kupplung: 0.40, Motor: 0.20, Fahrgestell: 0.10 };

  /**
   * Gefahrene km pro Tag je Fahrzeug (Schnitt der letzten 7 Tage) aus den Tourmeldungen
   * (inbox.php?filter=dispatch, neueste zuerst). 20 Min. gecached.
   * @returns {Promise<Map<string, number>|null>} Fahrzeugname ("GE 05") -> km/Tag
   */
  let kmProTagCache = null;
  let tourRaten = new Map(); // Fahrzeugname -> {last, brutto, ergebnis, bruttoMitErgebnis} (7 Tage)
  /** €/Lastkm und Netto-Quote je Fahrzeug aus den Tourmeldungen der letzten 7 Tage (gemeinsamer Abruf mit km/Tag). */
  async function fetchTourRaten() {
    await fetchKmProTag();
    return tourRaten;
  }
  async function fetchKmProTag() {
    if (kmProTagCache && Date.now() - kmProTagCache.zeit < 20 * 60 * 1000) return kmProTagCache.daten;
    try {
      const grenze = Date.now() - 7 * 86400000;
      const summe = new Map();
      const raten = new Map();
      const zahl = t => parseFloat(t.replace(/\./g, '').replace(',', '.'));
      let weiter = true;
      for (let seite = 1; seite <= 8 && weiter; seite++) {
        const res = await fiFetch(`/game/inbox.php?filter=dispatch&page=${seite}`, { credentials: 'same-origin', cache: 'no-store' });
        if (!res.ok) break;
        const karten = [...safeParseHtml(await res.text()).querySelectorAll('article.message-card')];
        if (!karten.length) break;
        karten.forEach(a => {
          const t = a.textContent.replace(/\s+/g, ' ');
          const dm = /Empfangen am (\d{2})\.(\d{2})\.(\d{4}) (\d{2}):(\d{2})/.exec(t);
          if (!dm) return;
          if (new Date(+dm[3], +dm[2] - 1, +dm[1], +dm[4], +dm[5]).getTime() < grenze) { weiter = false; return; }
          if (!/Tour abgeschlossen/.test(t)) return;
          const fz = /Gefahren mit:\s*(\S+ \d+)\s*·/.exec(t);
          const km = /Gesamtstrecke:\s*(\d+) km/.exec(t);
          if (fz && km) summe.set(fz[1], (summe.get(fz[1]) ?? 0) + +km[1]);
          const lk = /Lastfahrt:\s*(\d+) km/.exec(t);
          const br = /Frachtverguetung brutto:\s*([\d.,]+) €/.exec(t);
          const erg = /Ergebnis nach Diesel und Maut:\s*(-?[\d.,]+) €/.exec(t);
          if (fz && lk && br && zahl(br[1]) > 0) {
            const r = raten.get(fz[1]) ?? { last: 0, brutto: 0, ergebnis: 0, bruttoMitErgebnis: 0 };
            r.last += +lk[1];
            r.brutto += zahl(br[1]);
            if (erg) { r.ergebnis += zahl(erg[1]); r.bruttoMitErgebnis += zahl(br[1]); }
            raten.set(fz[1], r);
          }
        });
      }
      const daten = new Map([...summe.entries()].map(([k, v]) => [k, v / 7]));
      kmProTagCache = { zeit: Date.now(), daten };
      tourRaten = raten;
      return daten;
    } catch (e) {
      console.warn('[FI-Helper] km/Tag konnten nicht ermittelt werden', e);
      return null;
    }
  }

  /** Lesbarer Name einer abgerufenen Seite (für Gruppierung und Liste im Abruf-Log). */
  function abrufName(url) {
    let u;
    try { u = new URL(url, location.origin); } catch (e) { return 'Sonstige'; }
    if (u.host !== location.host) return u.host.includes('github') ? 'GitHub-Sync' : u.host;
    const pfad = u.pathname.split('/').pop();
    const karte = {
      'freight-market.php': 'Frachtbörse', 'dispatch.php': 'Fahrzeugpläne', 'fuhrpark.php': 'Fuhrpark', 'staff.php': 'Personal',
      'recruitment.php': 'Personalbörse', 'bank.php': 'Bank / Kredite', 'account_statement.php': 'Kontoauszug', 'inbox.php': 'Posteingang',
      'inspection-station.php': 'Prüfstelle', 'driver_time_status.php': 'Fahrerzeiten', 'pc.php': 'PC (Dieselpreis)',
      'europe-map-data.php': 'Städtedaten', 'freight-contracts.php': 'Frachtverträge', 'truck-catalog.php': 'Fahrzeugkatalog',
      'accept_freight_job.php': 'Auftrag annehmen', 'plan_dispatch_order.php': 'Auftrag einplanen',
      'return_dispatch_order_to_market.php': 'Auftrag zurückgeben', 'office.php': 'Büro', 'active_tours.php': 'Tourenübersicht',
    };
    return karte[pfad] ?? pfad;
  }

  /** Zugeklappte Abruf-Zeile ganz unten im Dashboard: Summe oben, Gruppen + jede einzelne Seite darunter. */
  function starteAbrufAnzeige() {
    const el = document.getElementById('fi-dash-abrufe');
    if (!el || el.dataset.aktiv) return;
    el.dataset.aktiv = '1';
    el.innerHTML = `<details class="fi-abrufe"><summary></summary><div class="fi-abrufe-body"></div></details>`;
    const details = el.querySelector('details');
    const summary = el.querySelector('summary');
    const body = el.querySelector('.fi-abrufe-body');
    const zeit = ms => ms >= 10000 ? `${(ms / 1000).toFixed(1).replace('.', ',')} s` : `${ms.toLocaleString('de-DE')} ms`;
    const esc = t => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;');
    const render = () => {
      const jetzt = Date.now();
      // aktive Zeit = Vereinigung aller Abruf-Intervalle (parallele Abrufe zählen nicht doppelt)
      const iv = fiAbrufLog.map(a => [a.start, a.start + (a.ms ?? (jetzt - a.start))]).sort((x, y) => x[0] - y[0]);
      let aktiv = 0, ende = -Infinity, anfang = 0;
      iv.forEach(([a, b]) => { if (a > ende) { aktiv += ende - anfang > 0 ? ende - anfang : 0; anfang = a; ende = b; } else if (b > ende) ende = b; });
      if (ende > anfang) aktiv += ende - anfang;
      summary.textContent = `🔎 ${fiAbrufLog.length.toLocaleString('de-DE')} Seiten aufgerufen in ${zeit(Math.round(aktiv))}`;
      if (!details.open) return;
      const gruppen = new Map();
      fiAbrufLog.forEach(a => {
        const g = gruppen.get(abrufName(a.url)) ?? { n: 0, ms: 0 };
        g.n++; g.ms += a.ms ?? 0;
        gruppen.set(abrufName(a.url), g);
      });
      const kopf = [...gruppen.entries()].sort((x, y) => y[1].n - x[1].n).map(([n, g]) => `<span><b>${esc(n)}</b> ${g.n}× · ${zeit(g.ms)}</span>`).join('');
      const liste = fiAbrufLog.slice().reverse().map(a => {
        let u; try { u = new URL(a.url, location.origin); } catch (e) { u = { host: '', pathname: a.url, search: '' }; }
        const ziel = (u.host && u.host !== location.host ? u.host : '') + u.pathname + u.search;
        const t = new Date(a.start);
        const uhr = `${t.toLocaleTimeString('de-DE')}.${String(t.getMilliseconds()).padStart(3, '0')}`;
        return `<div>${uhr} · ${a.methode} · ${esc(abrufName(a.url))} · <span class="fi-abrufe-url">${esc(ziel)}</span> · ${a.ms == null ? '…' : a.ms + ' ms'} · ${a.status ?? '…'}</div>`;
      }).join('');
      body.innerHTML = `<div class="fi-abrufe-gruppen">${kopf}</div><div class="fi-abrufe-liste">${liste}</div>`;
    };
    let geplant = null;
    const planeRender = () => { if (geplant) return; geplant = setTimeout(() => { geplant = null; render(); }, 400); };
    fiAbrufHoerer.add(planeRender);
    details.addEventListener('toggle', render);
    render();
  }

  /**
   * Erwartete Einnahmen aus den bereits eingeplanten Touren: Jede Entladung (Phase "entladen") in der
   * Zukunft schließt einen Auftrag ab; gutgeschrieben wird zum Entladeende. Route = letzte
   * "Fahrt beladen"-Phase desselben Auftrags davor; Vergütung = Strecke (Spiel-Formel) x Ø-€/Lastkm
   * des Fahrzeugs (7 Tage, sonst Flottenschnitt); netto = brutto x Ø-Quote nach Diesel und Maut.
   * @returns {{tage: Map<string, {brutto: number, netto: number, touren: number, datum: Date}>, brutto: number, netto: number, touren: number}}
   */
  function berechneErwarteteEinnahmen(fleet, raten) {
    const gesamt = [...raten.values()].reduce((a, r) => ({ last: a.last + r.last, brutto: a.brutto + r.brutto, erg: a.erg + r.ergebnis, bm: a.bm + r.bruttoMitErgebnis }), { last: 0, brutto: 0, erg: 0, bm: 0 });
    const schnittRate = gesamt.last > 0 ? gesamt.brutto / gesamt.last : null;
    const schnittQuote = gesamt.bm > 0 ? gesamt.erg / gesamt.bm : 0.9;
    const jetzt = Date.now();
    const tage = new Map();
    let brutto = 0, netto = 0, touren = 0;
    fleet.forEach(entry => {
      const kurz = entry.name.split(' · ')[0];
      const r = raten.get(kurz);
      const rate = r && r.last > 0 ? r.brutto / r.last : schnittRate;
      const quote = r && r.bruttoMitErgebnis > 0 ? r.ergebnis / r.bruttoMitErgebnis : schnittQuote;
      if (!rate) return;
      const phasen = [...(entry.status?.phasen ?? [])].filter(p => p.start && p.ende).sort((a, b) => a.start - b.start);
      phasen.forEach((p, i) => {
        if (p.type !== 'entladen' || p.ende.getTime() <= jetzt) return;
        let route = null;
        for (let j = i - 1; j >= 0 && !route; j--) {
          if (phasen[j].type === 'fahrt_beladen' && phasen[j].auftrag === p.auftrag && phasen[j].von && phasen[j].bis) route = phasen[j];
        }
        const km = route ? geschaetzteStrassenKm(route.von, route.bis) : null;
        if (!km) return;
        const b = km * rate;
        const n = b * quote;
        const schluessel = p.ende.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' });
        const tag = tage.get(schluessel) ?? { brutto: 0, netto: 0, touren: 0, datum: p.ende };
        tag.brutto += b; tag.netto += n; tag.touren++;
        tage.set(schluessel, tag);
        brutto += b; netto += n; touren++;
      });
    });
    return { tage, brutto, netto, touren };
  }

  /**
   * Zahlungsplan: geplante Kreditraten aus bank.php (Fälligkeit, Betrag, Tilgung/Zinsen),
   * Monatsgehälter, Restschuld, Kontostand - plus die letzte Gehaltsbuchung aus dem Kontoauszug
   * (account_statement.php, category=salary, mit from/to - ohne Zeitraum zeigt er nur den
   * laufenden Monat!). Beobachtet: "Gehaltsabrechnung fuer 2026-09" am 28.09.2026 00:01
   * (33.711,67 €) -> Gehälter werden monatlich am 28. um 00:01 abgebucht.
   */
  async function fetchZahlungsplan() {
    try {
      const res = await fiFetch('/game/bank.php', { credentials: 'same-origin', cache: 'no-store' });
      if (!res.ok) return null;
      const doc = safeParseHtml(await res.text());
      const zahl = t => parseFloat(t.replace(/\./g, '').replace(',', '.'));
      const raten = [];
      doc.querySelectorAll('tr').forEach(tr => {
        const t = tr.textContent.replace(/\s+/g, ' ').trim();
        const m = /Kreditrate #(\d+)\s*Tilgung ([\d.,]+) € · Zinsen ([\d.,]+) €\s*(\d{2})\.(\d{2})\.(\d{4}) (\d{2}):(\d{2})\s*scheduled\s*([\d.,]+) €/.exec(t);
        if (m) raten.push({ nr: +m[1], tilgung: zahl(m[2]), zinsen: zahl(m[3]), faellig: new Date(+m[6], +m[5] - 1, +m[4], +m[7], +m[8]), betrag: zahl(m[9]) });
      });
      const text = (doc.body.textContent || '').replace(/\s+/g, ' ');
      const nimm = re => { const m = re.exec(text); return m ? zahl(m[1]) : null; };

      // Letzte Gehaltsbuchung (letzte 120 Tage)
      let letztesGehalt = null;
      try {
        const iso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        const von = new Date(Date.now() - 120 * 86400000);
        const r2 = await fiFetch(`/game/account_statement.php?from=${iso(von)}&to=${iso(new Date())}&category=salary`, { credentials: 'same-origin', cache: 'no-store' });
        const d2 = safeParseHtml(await r2.text());
        d2.querySelectorAll('tbody tr').forEach(tr => {
          const c = [...tr.children].map(x => x.textContent.replace(/\s+/g, ' ').trim());
          const m = /^(\d{2})\.(\d{2})\.(\d{4}) (\d{2}):(\d{2})$/.exec(c[0] ?? '');
          if (!m || c[1] !== 'Gehalt') return;
          const datum = new Date(+m[3], +m[2] - 1, +m[1], +m[4], +m[5]);
          if (!letztesGehalt || datum > letztesGehalt.datum) letztesGehalt = { datum, betrag: Math.abs(zahl((c[4] ?? '0').replace(/[^\d.,]/g, ''))) };
        });
      } catch (e) { /* Gehaltstermin bleibt dann ohne Datum */ }
      return {
        letztesGehalt,
        raten: raten.sort((a, b) => a.faellig - b.faellig),
        gehalt: nimm(/Monatliche Gehälter\s*([\d.,]+) €/),
        restschuld: nimm(/Aktuelle Restschuld\s*([\d.,]+) €/),
        konto: nimm(/Kontostand\s*(-?[\d.,]+) €/),
      };
    } catch (e) {
      console.warn('[FI-Helper] Zahlungsplan konnte nicht geladen werden', e);
      return null;
    }
  }

  /**
   * Live-Konsole für Scan/Berechnung: Radar-Animation (reines CSS), Fortschrittsbalken,
   * Zähler und je Fahrzeug ein Chip (wartet → rechnet → fertig mit €/km).
   * Alle Aufrufe sind billig (Text/Klassen); Animationen laufen auf der GPU.
   */
  function baueScanKonsole(container, titel) {
    container.innerHTML = `<div class="fi-scan">
      <div class="fi-scan-head"><span class="fi-scan-titel"></span><span class="fi-scan-stufe"></span></div>
      <div class="fi-road"><i class="fi-road-fill"></i><i class="fi-road-dashes"></i><span class="fi-road-start">🏢</span><span class="fi-road-ziel">🏁</span><span class="fi-truck"><span>🚚</span></span></div>
      <div class="fi-scan-werte"></div>
      <div class="fi-scan-chips"></div>
      <div class="fi-scan-feed"></div>
    </div>`;
    const wurzel = container.querySelector('.fi-scan');
    const q = sel => wurzel.querySelector(sel);
    q('.fi-scan-titel').textContent = titel;
    const werte = new Map();
    const chips = new Map();
    let angeboteAngezeigt = 0;
    let tween = null;
    const zeigeFund = text => {
      const feed = q('.fi-scan-feed');
      const zeile = document.createElement('div');
      zeile.textContent = text;
      feed.appendChild(zeile);
      while (feed.children.length > 4) feed.removeChild(feed.firstChild);
    };
    const setzeWert = (k, html) => {
      let el = werte.get(k);
      if (!el) { el = document.createElement('span'); werte.set(k, el); q('.fi-scan-werte').appendChild(el); }
      el.innerHTML = html;
    };
    return {
      stufe: text => { q('.fi-scan-stufe').textContent = text; },
      fortschritt: anteil => {
        const pct = Math.max(2, Math.min(100, Math.round(anteil * 100)));
        q('.fi-road-fill').style.width = `${pct}%`;
        q('.fi-truck').style.left = `calc(${pct}% - 26px)`;
      },
      fund: zeigeFund,
      markt: (label, info) => {
        if (!info) return;
        setzeWert('seiten', `Seiten <b>${info.seite}/${info.gesamt}</b>`);
        if (info.seite > 1 && info.angebote !== angeboteAngezeigt) zeigeFund(`📦 Seite ${info.seite}/${info.gesamt} · ${info.angebote.toLocaleString('de-DE')} Angebote`);
        // Zähler hochzählen (kurzer rAF-Tween, ~12 Frames) statt hart springen
        const ziel = info.angebote;
        const start = angeboteAngezeigt;
        let n = 0;
        cancelAnimationFrame(tween);
        const schritt = () => {
          n++;
          angeboteAngezeigt = Math.round(start + (ziel - start) * Math.min(1, n / 12));
          setzeWert('angebote', `Angebote <b>${angeboteAngezeigt.toLocaleString('de-DE')}</b>`);
          if (n < 12) tween = requestAnimationFrame(schritt);
        };
        tween = requestAnimationFrame(schritt);
      },
      fahrzeuge: namen => {
        q('.fi-scan-chips').innerHTML = '';
        chips.clear();
        namen.forEach(n => {
          const c = document.createElement('span');
          c.className = 'fi-scan-chip';
          c.textContent = n;
          q('.fi-scan-chips').appendChild(c);
          chips.set(n, c);
        });
      },
      fahrzeugStatus: (name, zustand, text = '') => {
        const c = chips.get(name);
        if (!c) return;
        c.className = `fi-scan-chip ${zustand}`;
        c.textContent = text ? `${name} · ${text}` : name;
      },
      wert: setzeWert,
      ende: text => { if (text) q('.fi-scan-stufe').textContent = text; wurzel.classList.add('fi-scan-fertig'); cancelAnimationFrame(tween); },
    };
  }

  const naechsterFrame = () => new Promise(r => {
    let fertig = false;
    const los = () => { if (!fertig) { fertig = true; r(); } };
    requestAnimationFrame(los);
    setTimeout(los, 60); // Hintergrund-Tab: rAF pausiert
  });

  /**
   * Bewertet die Flotte fahrzeugweise (statt in einem Rutsch), damit die Konsole
   * live zeigt, welches Fahrzeug gerade rechnet und was es bisher Bestes fand.
   * Ergebnis identisch zu findeBesteRoutenProFahrzeug(angebote, flotte, ...).
   */
  async function berechneBesteRouten(angebote, flotte, zielStadt, radius, konsole = null, { ketten = true, balken = true } = {}) {
    const kurz = f => f.name.split(' · ')[0];
    konsole?.stufe(`Berechne ${angebote.length.toLocaleString('de-DE')} Angebote × ${flotte.length} Fahrzeuge`);
    konsole?.fahrzeuge(flotte.map(kurz));
    const ergebnis = [];
    for (let i = 0; i < flotte.length; i++) {
      const f = flotte[i];
      konsole?.fahrzeugStatus(kurz(f), 'rechnet');
      await naechsterFrame();
      const [e] = findeBesteRoutenProFahrzeug(angebote, [f], zielStadt, radius, ketten);
      ergebnis.push(e);
      const km = e?.kandidatenRangliste?.[0]?.bewertung?.effektivProKm;
      konsole?.fahrzeugStatus(kurz(f), km != null ? 'fertig' : 'leer', km != null ? `${km.toFixed(2).replace('.', ',')} €/km` : '–');
      const top = e?.kandidatenRangliste?.[0];
      konsole?.fund(top
        ? `🚚 ${kurz(f)} → ${top.fracht.startOrt} → ${top.fracht.zielOrt} · ${km.toFixed(2).replace('.', ',')} €/km`
        : `🚚 ${kurz(f)} – nichts einplanbar`);
      if (balken) konsole?.fortschritt(0.65 + 0.35 * ((i + 1) / flotte.length));
    }
    return ergebnis;
  }

  /**
   * Befüllt ALLE Fahrzeuge fortlaufend mit Aufträgen: pro Runde wird für jede
   * Fahrzeugkategorie der Markt gescannt, die beste konfliktfreie Komplettladung
   * je Fahrzeug bestimmt, verbindlich angenommen und eingeplant; danach werden
   * die Fahrzeugstände frisch geladen (neues "frei ab") und die nächste Runde
   * beginnt - bis kein Fahrzeug mehr etwas Passendes im Planungsfenster findet.
   * Bewusst NUR Komplettladungen (Einzelaufträge): Teilladungen/Ketten brauchen
   * den Tourenplaner, dessen Request noch nicht erfasst ist.
   * @param {{options: {value: string, label: string}[], log: Function, abgebrochen: Function, trocken?: boolean}} param
   */
  async function befuelleFlotteAutomatisch({ options, log, abgebrochen, trocken = false, fortschritt = () => {}, konsole = null, nurKategorie = null }) {
    const MAX_RUNDEN = 15;
    let simulierteFlotte = null;
    let anzahlAngenommen = 0;
    let summeEuro = 0;
    const plan = []; // berechnete Buchungen (Reihenfolge = Reihenfolge der Ausführung), siehe fuehreBefuellPlanAus

    const dieselPreisLive = await fetchDieselPreis(false);
    if (dieselPreisLive != null) ASSUMPTIONS.dieselPreisProLiter = dieselPreisLive;
    const staedteLive = await fetchStaedteDaten(false);
    if (staedteLive) CITY_COORDS = { ...CITY_COORDS, ...staedteLive };
    await aktualisierePlanungsfenster(false);

    // Markt je Kategorie EINMAL frisch scannen; angenommene/fehlgeschlagene
    // Jobs werden lokal aus dem Pool entfernt statt neu zu scannen.
    const marktPools = new Map(); // kategorieLabel -> FrachtAngebot[] (nur Komplettladungen)
    const letztesFreiAb = new Map(); // vehicleId -> "frei ab" (ms) zum Zeitpunkt der letzten Beplanung
    const urlaubGeloggt = new Set();
    const gesperrteFahrzeuge = new Set(); // Fahrzeuge, bei denen Annehmen/Einplanen scheiterte - nicht erneut versuchen (sonst häufen sich unverplante Aufträge)

    for (let runde = 1; runde <= MAX_RUNDEN; runde++) {
      if (abgebrochen()) { log('⏹ Vom Nutzer gestoppt.', 'fi-warn'); break; }

      // Fortschritt: Schritte der laufenden Runde (Gesamtzahl wächst, sobald bekannt)
      let schritt = 0;
      let schritteGesamt = 1;
      const melde = text => { schritt++; fortschritt({ runde, schritt, gesamt: schritteGesamt, text }); };
      melde('Fahrzeugstand laden');

      // Trockenlauf: Fahrzeugstand nur EINMAL laden und danach lokal
      // fortschreiben (nichts wird gebucht, "frei ab" wandert virtuell).
      let fleet;
      if (trocken && simulierteFlotte) {
        fleet = simulierteFlotte;
      } else {
        const { fleetMitLive, detailsMap } = await ladeFlotteMitLive(konsole, false); // Speicher nutzen: gleiche Daten wie die Frachtart-Berechnung
        fleet = baueFleetMitTyp(fleetMitLive, detailsMap, null, await fetchUrlaubsSperren())
          .filter(f => f.typ && f.status?.vehicleId && f.status?.freiAbOrt && f.status?.freiAbZeit);
        if (trocken) simulierteFlotte = fleet;
      }

      // Sicherheitsnetz: hat ein zuletzt beplantes Fahrzeug sein "frei ab"
      // NICHT nach hinten verschoben, wurde der Auftrag zwar angenommen, aber
      // nicht wirklich eingeplant - sofort abbrechen statt weitere Aufträge
      // ins Leere anzunehmen.
      const nichtVerschoben = trocken ? [] : fleet.filter(f => {
        const vorher = letztesFreiAb.get(String(f.status.vehicleId));
        return vorher != null && f.status.freiAbZeit.getTime() <= vorher;
      });
      if (nichtVerschoben.length) {
        log(`⚠ Abbruch: Bei ${nichtVerschoben.map(f => f.name).join(', ')} hat sich das "frei ab" nach dem Einplanen nicht verschoben - bitte in der Disposition prüfen, ob die Aufträge wirklich eingeplant wurden.`, 'fi-bad');
        break;
      }

      fleet = fleet.filter(f => !gesperrteFahrzeuge.has(String(f.status.vehicleId)));
      // Urlaub: Fahrzeuge, die im Planungsfenster nicht startklar werden, gar nicht erst für den Markt-Scan vormerken
      fleet = fleet.filter(f => {
        if (!urlaubBlockiert(f)) return true;
        const id = String(f.status.vehicleId);
        if (!urlaubGeloggt.has(id) && (!nurKategorie || f.typ === nurKategorie)) {
          urlaubGeloggt.add(id);
          log(`⏭ ${f.name.split(' · ')[0]}: übersprungen wegen Urlaub`, 'fi-muted');
        }
        return false;
      });
      const kategorien = [...new Set(fleet.map(f => f.typ))].filter(k => !nurKategorie || k === nurKategorie);
      const zuweisungen = [];
      schritteGesamt += kategorien.length + 1;

      for (const label of kategorien) {
        melde(`Markt ${label}`);
        const option = options.find(o => o.label === label);
        if (!option) { if (runde === 1) log(`Keine Frachtbörsen-Kategorie für "${label}" gefunden - übersprungen.`, 'fi-warn'); continue; }

        if (!marktPools.has(label)) {
          let markt = holeMarktCache(marktCacheSchluessel(option.value));
          if (!(markt && (Date.now() - markt.zeitstempel) < MARKT_CACHE_TTL_MS)) {
            markt = await fetchAllOffersForBodyType(option.value, 500, (t, info) => { konsole?.markt(label, info); });
            speichereMarktCache(marktCacheSchluessel(option.value), { ...markt, zeitstempel: Date.now() });
          }
          const pool = filtereNachAufbau(markt.angebote, label).filter(a => a.kapazitaet === 'Komplettladung' && a.jobId);
          marktPools.set(label, pool);
        }
        const pool = marktPools.get(label);
        const kompatibleFleet = fleet.filter(f => f.typ === label);
        if (!pool.length || !kompatibleFleet.length) continue;

        const beste = loeseFahrzeugKonflikte(await berechneBesteRouten(pool, kompatibleFleet, null, 0, konsole, { ketten: false, balken: false }));
        beste.forEach(eintrag => {
          const k = eintrag.beste;
          if (!k || !k.fracht.jobId) return;
          const b = k.bewertung;
          if (!b.einplanbar) return; // Planungsfenster für dieses Fahrzeug voll
          if (b.schaffbar === false) return;
          if (b.kapazitaetOk === false) return;
          if (!(b.effektivProKm > 0)) return; // einzige Untergrenze: kein Verlustgeschäft
          zuweisungen.push({ label, eintrag, kandidat: k });
        });
      }

      melde('Berechnen');
      schritteGesamt += zuweisungen.length;
      if (!zuweisungen.length) break;

      for (const z of zuweisungen) {
        if (abgebrochen()) break;
        const { fracht, bewertung } = z.kandidat;
        const fahrzeugName = z.eintrag.fahrzeugName;
        const freiAbVorher = z.eintrag.freiAbZeit;
        melde(`${trocken ? 'Prüfe' : 'Buche'} ${fahrzeugName.split(' · ')[0]}`);
        try {
          const beschreibung = `${fahrzeugName.split(' · ')[0]}: ${fracht.startOrt} → ${fracht.zielOrt} · ${fmtEuro(fracht.verguetungEuro ?? 0)} · ${bewertung.effektivProKm.toFixed(2).replace('.', ',')} €/km · Leerfahrt ${Math.round(bewertung.anfahrtKm)} km${bewertung.heimfahrtKm > 0 ? ` · 🏠 ${Math.round(bewertung.heimfahrtKm)} km` : ''}`;
          if (trocken) {
            const f = fleet.find(x => String(x.status.vehicleId) === String(z.eintrag.vehicleId));
            f.status = { ...f.status, freiAbZeit: bewertung.ankunftZeit, freiAbOrt: fracht.zielOrt };
            log(`▸ ${beschreibung}`, 'fi-good');
            plan.push({
              vehicleId: z.eintrag.vehicleId, fahrzeugName, jobId: fracht.jobId, verguetung: fracht.verguetungEuro ?? 0,
              beschreibung, freiAbMs: freiAbVorher.getTime(), beladungMs: bewertung.beladungsStartZeit.getTime(),
            });
          } else {
            await nimmFrachtAnUndPlaneEin(fracht.jobId, z.eintrag.vehicleId, freiAbVorher, bewertung.beladungsStartZeit, fahrzeugName);
            letztesFreiAb.set(String(z.eintrag.vehicleId), freiAbVorher.getTime());
            log(`✅ ${beschreibung}`, 'fi-good');
          }
          anzahlAngenommen++;
          summeEuro += fracht.verguetungEuro ?? 0;
        } catch (e) {
          log(`❌ ${fahrzeugName}: ${fracht.startOrt} → ${fracht.zielOrt} fehlgeschlagen: ${e.message}`, 'fi-bad');
          gesperrteFahrzeuge.add(String(z.eintrag.vehicleId));
          console.error('[FI-Helper] Befüllen: Fehler bei', fracht, e);
        }
        // Job in jedem Fall aus dem lokalen Pool nehmen (angenommen ODER fehlgeschlagen)
        const pool = marktPools.get(z.label);
        marktPools.set(z.label, pool.filter(a => a.jobId !== fracht.jobId));
      }
    }

    return { anzahlAngenommen, summeEuro, plan };
  }

  /**
   * Bucht einen zuvor berechneten Befüll-Plan (ohne die Frachtbörse neu zu laden): je Eintrag annehmen +
   * einplanen (alles oder nichts je Auftrag). Folgebuchungen desselben Fahrzeugs starten am echten "frei ab"
   * nach der vorherigen Buchung. Scheitert eine Buchung (z. B. Auftrag inzwischen vergeben), werden die
   * restlichen Touren dieses Fahrzeugs übersprungen, alle anderen Fahrzeuge laufen weiter.
   */
  async function fuehreBefuellPlanAus({ plan, log, fortschritt, abgebrochen }) {
    let gebucht = 0, fehler = 0, summe = 0;
    const gesperrt = new Map(); // vehicleId -> Grund ('urlaub' = stillschweigend überspringen)
    const echtesFreiAb = new Map();
    for (let i = 0; i < plan.length; i++) {
      if (abgebrochen()) { log('⏹ Vom Nutzer gestoppt.', 'fi-warn'); break; }
      const z = plan[i];
      const kurz = z.fahrzeugName.split(' · ')[0];
      fortschritt({ schritt: i + 1, gesamt: plan.length, text: `Buche ${kurz}` });
      if (gesperrt.has(String(z.vehicleId))) {
        if (gesperrt.get(String(z.vehicleId)) !== 'urlaub') log(`⏭ ${kurz}: übersprungen (vorherige Buchung dieses Fahrzeugs scheiterte)`, 'fi-muted');
        continue;
      }
      const freiAb = echtesFreiAb.get(String(z.vehicleId)) ?? new Date(z.freiAbMs);
      try {
        await nimmFrachtAnUndPlaneEin(z.jobId, z.vehicleId, freiAb, new Date(z.beladungMs), z.fahrzeugName);
        gebucht++;
        summe += z.verguetung;
        log(`✅ ${z.beschreibung}`, 'fi-good');
        if (plan.slice(i + 1).some(x => String(x.vehicleId) === String(z.vehicleId))) {
          const st = await fetchVehicleStatus(z.vehicleId);
          if (!st?.freiAbZeit || st.freiAbZeit.getTime() <= freiAb.getTime()) {
            gesperrt.set(String(z.vehicleId), 'frei-ab');
            log(`⚠ ${kurz}: neues "frei ab" nicht lesbar - weitere Touren dieses Fahrzeugs übersprungen`, 'fi-warn');
          } else {
            echtesFreiAb.set(String(z.vehicleId), st.freiAbZeit);
          }
        }
      } catch (e) {
        if (/Urlaub/i.test(e.message)) { // Spiel lehnt wegen Urlaub eines Fahrers ab: kein Fehler, nur übersprungen
          gesperrt.set(String(z.vehicleId), 'urlaub');
          log(`⏭ ${kurz}: übersprungen wegen Urlaub`, 'fi-muted');
          continue;
        }
        fehler++;
        gesperrt.set(String(z.vehicleId), 'fehler');
        log(`❌ ${kurz}: ${z.beschreibung.split(' · ')[0].replace(/^[^:]+: /, '')} fehlgeschlagen: ${e.message}`, 'fi-bad');
        console.error('[FI-Helper] Plan-Buchung fehlgeschlagen', z, e);
      }
    }
    return { gebucht, fehler, summe };
  }

  /**
   * Verdrahtet "Annehmen"-Buttons in einem gegebenen Container - gemeinsam
   * genutzt von der Sidebar-Frachtbörsenansicht UND dem großen Dashboard.
   */
  function verdrahteAnnehmenButtons(container) {
    container.querySelectorAll('.fi-accept-btn').forEach(btn => {
      if (btn.dataset.fiWired) return;
      btn.dataset.fiWired = '1';
      btn.addEventListener('click', async () => {
        const { jobId, vehicleId, freiAb, route, fahrzeug, beladung } = btn.dataset;
        btn.disabled = true;
        const original = btn.textContent;
        btn.textContent = 'Wird eingeplant …';
        try {
          await nimmFrachtAnUndPlaneEin(jobId, vehicleId, new Date(freiAb), beladung ? new Date(beladung) : null, fahrzeug);
          btn.textContent = '✅ Angenommen & eingeplant';
          btn.style.background = '#2f6f3f';
          btn.style.color = '#fff';
        } catch (e) {
          console.error('[FI-Helper] Annehmen/Einplanen fehlgeschlagen', e);
          btn.textContent = original;
          btn.disabled = false;
          window.alert(`Fehler: ${e.message}`);
        }
      });
    });

    container.querySelectorAll('.fi-kette-btn').forEach(btn => {
      if (btn.dataset.fiWired) return;
      btn.dataset.fiWired = '1';
      btn.addEventListener('click', async () => {
        const d = btn.dataset;
        btn.disabled = true;
        const original = btn.textContent;
        btn.textContent = 'Wird eingeplant …';
        try {
          await nimmKetteAnUndPlaneEin(d.jobA, d.jobB, d.vehicleId, new Date(d.freiAb), d.beladung ? new Date(d.beladung) : null, d.fahrzeug);
          btn.textContent = '✅ Beide Etappen angenommen & eingeplant';
          btn.style.background = '#2f6f3f';
          btn.style.color = '#fff';
        } catch (e) {
          console.error('[FI-Helper] Kette annehmen/einplanen fehlgeschlagen', e);
          btn.textContent = original;
          btn.disabled = false;
          window.alert(`Fehler: ${e.message}`);
        }
      });
    });

  }

  /**
   * Nimmt eine Fracht an (ohne Einplanen) - reine accept_freight_job.php-Anfrage.
   * ACHTUNG: Antwortstruktur nicht vollständig verifiziert, siehe Hinweis unten.
   * @param {string} jobId
   * @returns {Promise<Object>} Die rohe Server-Antwort (payload)
   */
  async function nimmFrachtNurAn(jobId) {
    const acceptForm = new FormData();
    acceptForm.append('job_id', String(jobId));
    acceptForm.append('ajax', '1');

    const acceptRes = await fiFetch('/game/accept_freight_job.php', {
      method: 'POST',
      body: acceptForm,
      credentials: 'same-origin',
      headers: { Accept: 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
      redirect: 'manual',
    });

    let acceptPayload = null;
    try { acceptPayload = await acceptRes.json(); } catch (e) { /* keine JSON-Antwort */ }

    console.log('[FI-Helper] accept_freight_job.php Antwort:', acceptRes.status, acceptPayload);

    if (!acceptRes.ok || !acceptPayload || acceptPayload.ok !== true) {
      throw new Error((acceptPayload && acceptPayload.message) || `Annahme fehlgeschlagen (HTTP ${acceptRes.status}) - siehe Konsole (F12) für Details`);
    }

    return acceptPayload;
  }

  /**
   * Nimmt eine Fracht an UND hängt sie sofort hinten an die Tourenplanung des
   * Fahrzeugs an. ACHTUNG: Die genaue Antwortstruktur von accept_freight_job.php
   * ist NICHT verifiziert (nur der AJAX-Aufrufstil aus dem seiteneigenen
   * Favoriten-Sammel-Skript übernommen) - bei Fehlern bitte die Browser-Konsole
   * (F12) prüfen und mir die Ausgabe schicken, dann justieren wir nach.
   * @param {string} jobId
   * @param {string} vehicleId
   * @param {Date} freiAbZeit Geplanter Startzeitpunkt (frühestmöglich = Fahrzeug frei ab)
   */
  // ----- Annehmen / Einplanen / Zurückrollen --------------------------------
  // Grundlage für "alles oder nichts" (siehe Chat 2026-10-19): Das Spiel erlaubt
  // (a) die kostenlose Rückgabe eines angenommenen, noch ungeplanten Auftrags
  // innerhalb von 15 Minuten (max. 3 kostenlose Rückgaben je 24 h, danach 15 %
  // Gebühr bis 60 min) über return_dispatch_order_to_market.php und (b) das
  // Entfernen einer eingeplanten, noch nicht gestarteten Tour über
  // dispatch.php (dispatch_action=cancel_planned_order) - der Auftrag liegt
  // danach wieder ungeplant im Pool. Daraus lässt sich jede Buchung bei einem
  // Fehlschlag vollständig rückgängig machen.

  async function holePoolOrderIds(vehicleId) {
    const res = await fiFetch(`/game/dispatch.php?vehicle_id=${encodeURIComponent(vehicleId)}`, { credentials: 'same-origin', cache: 'no-store' });
    const doc = safeParseHtml(await res.text());
    return Array.from(doc.querySelectorAll(SELECTORS.ordersPool)).map(c => c.dataset.orderId).filter(Boolean);
  }

  /** Nimmt einen Auftrag an und liefert die neue Order-ID (aus der Antwort oder per Pool-Differenz). */
  async function nimmAnUndHoleOrderId(jobId, vehicleId) {
    const poolVorher = new Set(await holePoolOrderIds(vehicleId));
    const payload = await nimmFrachtNurAn(jobId);
    let orderId = payload.order_id || payload.dispatch_order_id || payload.id || null;
    if (!orderId) {
      const neu = (await holePoolOrderIds(vehicleId)).filter(id => !poolVorher.has(id));
      orderId = neu.length === 1 ? neu[0] : null;
    }
    if (!orderId) {
      throw new Error('Auftrag wurde angenommen, aber die neue Order-ID ist nicht eindeutig zu bestimmen.');
    }
    return String(orderId);
  }

  /** Plant einen angenommenen Auftrag ein und prüft die Antwort des Spiels strikt (Flash-Fehler/Pool). */
  async function planeOrderEin(orderId, vehicleId, startZeit) {
    const pad = n => String(n).padStart(2, '0');
    const startDatum = `${startZeit.getFullYear()}-${pad(startZeit.getMonth() + 1)}-${pad(startZeit.getDate())}`;
    const planForm = new URLSearchParams();
    planForm.append('order_id', orderId);
    planForm.append('partial_tour_id', '');
    planForm.append('vehicle_id', String(vehicleId));
    planForm.append('planned_start_at', `${startDatum}T${pad(startZeit.getHours())}:${pad(startZeit.getMinutes())}`);
    planForm.append('view_date', startDatum);

    // Das Spiel antwortet auch bei Ablehnung mit Redirect + Flash-Meldung
    // (div.flash.error) - Redirect folgen und Meldung lesen.
    const planRes = await fiFetch('/game/plan_dispatch_order.php', {
      method: 'POST',
      body: planForm,
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    });
    const planDoc = safeParseHtml(await planRes.text());
    const fehler = planDoc.querySelector('.flash.error')?.textContent.replace(/\s+/g, ' ').trim();
    const nochImPool = Array.from(planDoc.querySelectorAll(SELECTORS.ordersPool)).some(c => c.dataset.orderId === String(orderId));
    console.log('[FI-Helper] plan_dispatch_order.php Antwort:', planRes.status, { orderId, fehler, nochImPool });
    if (fehler || nochImPool) {
      throw new Error(fehler || 'Auftrag liegt nach dem Einplanen weiterhin unverplant im Pool');
    }
  }

  /** Gibt einen angenommenen, ungeplanten Auftrag an die Frachtbörse zurück (kostenlos in den ersten 15 Minuten). */
  async function gibAuftragZurueck(orderId, vehicleId) {
    const body = new URLSearchParams({
      dispatch_order_id: String(orderId),
      return_to: `/game/dispatch.php?date=${new Date().toISOString().slice(0, 10)}&vehicle_id=${vehicleId}`,
      reason: 'Rückgabe aus der Disposition',
    });
    const res = await fiFetch('/game/return_dispatch_order_to_market.php', {
      method: 'POST', body, credentials: 'same-origin', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    });
    const doc = safeParseHtml(await res.text());
    const fehler = doc.querySelector('.flash.error')?.textContent.replace(/\s+/g, ' ').trim();
    const nochImPool = Array.from(doc.querySelectorAll(SELECTORS.ordersPool)).some(c => c.dataset.orderId === String(orderId));
    if (fehler || nochImPool) throw new Error(fehler || 'Auftrag liegt nach der Rückgabe weiterhin im Pool');
    return doc.querySelector('.flash.success')?.textContent.replace(/\s+/g, ' ').trim() ?? 'zurückgegeben';
  }

  /** Entfernt eine eingeplante (noch nicht gestartete) Tour wieder aus dem Plan - der Auftrag liegt danach wieder im Pool. */
  async function entferneEingeplanteTour(orderId, vehicleId) {
    const body = new URLSearchParams({ dispatch_action: 'cancel_planned_order', dispatch_order_id: String(orderId), vehicle_id: String(vehicleId) });
    const res = await fiFetch('/game/dispatch.php', {
      method: 'POST', body, credentials: 'same-origin', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    });
    const doc = safeParseHtml(await res.text());
    const fehler = doc.querySelector('.flash.error')?.textContent.replace(/\s+/g, ' ').trim();
    const imPool = Array.from(doc.querySelectorAll(SELECTORS.ordersPool)).some(c => c.dataset.orderId === String(orderId));
    if (fehler || !imPool) throw new Error(fehler || 'Tour wurde nicht aus dem Plan entfernt (Auftrag nicht im Pool)');
  }

  /**
   * Macht eine begonnene Buchung rückgängig: erst eingeplante Touren aus dem
   * Plan nehmen (in umgekehrter Reihenfolge), dann ALLE angenommenen Aufträge
   * zurückgeben. Sammelt Fehler, statt beim ersten abzubrechen.
   * @returns {Promise<string[]>} Liste der Rollback-Probleme (leer = vollständig zurückgerollt)
   */
  async function rolleBuchungZurueck({ geplant = [], angenommen = [], vehicleId }) {
    const probleme = [];
    for (const orderId of [...geplant].reverse()) {
      try { await entferneEingeplanteTour(orderId, vehicleId); }
      catch (e) { probleme.push(`Tour #${orderId} nicht aus dem Plan entfernt: ${e.message}`); }
    }
    for (const orderId of angenommen) {
      if (probleme.some(pr => pr.includes(`#${orderId} `))) continue; // noch eingeplant -> Rückgabe unmöglich
      try { await gibAuftragZurueck(orderId, vehicleId); }
      catch (e) { probleme.push(`Auftrag #${orderId} nicht zurückgegeben: ${e.message}`); }
    }
    return probleme;
  }

  function rollbackFehlertext(grund, probleme, anzahl) {
    return probleme.length
      ? `${grund} - ROLLBACK UNVOLLSTÄNDIG, bitte manuell prüfen: ${probleme.join(' | ')}`
      : `${grund} - es wurde nichts gebucht (${anzahl} Auftrag/Aufträge kostenlos zurückgerollt).`;
  }

  /**
   * Nimmt EINEN Auftrag an und plant ihn ein - alles oder nichts: scheitert das
   * Einplanen, wird der Auftrag sofort zurückgegeben.
   */
  async function nimmFrachtAnUndPlaneEin(jobId, vehicleId, freiAbZeit, prognoseBeladung = null, fahrzeugName = String(vehicleId)) {
    const orderId = await nimmAnUndHoleOrderId(jobId, vehicleId);
    try {
      await planeOrderEin(orderId, vehicleId, freiAbZeit);
    } catch (e) {
      const probleme = await rolleBuchungZurueck({ angenommen: [orderId], vehicleId });
      throw new Error(rollbackFehlertext(`Einplanen abgelehnt: ${e.message}`, probleme, 1));
    }
    if (prognoseBeladung) messePrognose(await fetchVehicleStatus(vehicleId), fahrzeugName, freiAbZeit, prognoseBeladung);
    return { orderId };
  }

  /**
   * Nimmt zwei Komplettladungen an und plant sie HINTEREINANDER auf dasselbe
   * Fahrzeug - ALLES ODER NICHTS:
   *  1. beide Aufträge annehmen (so sind beide gesichert, bevor geplant wird)
   *  2. Etappe 1 einplanen, neues "frei ab" lesen (das Spiel hängt manuelle
   *     Aktionen an die letzte Phase an), Etappe 2 genau dort einplanen
   *  3. scheitert IRGENDETWAS: eingeplante Touren aus dem Plan nehmen und
   *     beide Aufträge zurückgeben (kostenlos in den ersten 15 Minuten)
   * Ergebnis: entweder beide Etappen eingeplant - oder gar nichts gebucht.
   */
  async function nimmKetteAnUndPlaneEin(jobId1, jobId2, vehicleId, freiAbZeit, prognoseBeladung = null, fahrzeugName = String(vehicleId)) {
    const angenommen = [];
    const geplant = [];
    try {
      angenommen.push(await nimmAnUndHoleOrderId(jobId1, vehicleId));
      angenommen.push(await nimmAnUndHoleOrderId(jobId2, vehicleId));

      await planeOrderEin(angenommen[0], vehicleId, freiAbZeit);
      geplant.push(angenommen[0]);

      const status = await fetchVehicleStatus(vehicleId);
      messePrognose(status, fahrzeugName, freiAbZeit, prognoseBeladung);
      const frei2 = status?.freiAbZeit ?? null;
      if (!frei2 || frei2.getTime() <= freiAbZeit.getTime()) {
        throw new Error('Das neue "frei ab" des Fahrzeugs nach Etappe 1 konnte nicht eindeutig gelesen werden');
      }

      await planeOrderEin(angenommen[1], vehicleId, frei2);
      geplant.push(angenommen[1]);
      return { orderIds: [...angenommen] };
    } catch (e) {
      const probleme = await rolleBuchungZurueck({ geplant, angenommen, vehicleId });
      throw new Error(rollbackFehlertext(`Kette abgelehnt: ${e.message}`, probleme, angenommen.length));
    }
  }

  // ============================================================
  // 6b. PERSONALBÖRSE (recruitment.php) - BEWERBER AUF EINE ZAHL REDUZIERT
  //     Die spieleigene "Eignung"-Prozentzahl bewertet nur die QUALITÄT eines
  //     Bewerbers und ignoriert das Gehalt komplett. Live beobachtet: zwei
  //     Fahrer-Bewerber (Lena Rossi 85% Eignung, Hakan Kaya 51% Eignung)
  //     verlangten praktisch dasselbe Gehalt (2.600 € / 2.700 €) - nach
  //     Eignung allein sieht man diese Ungleichheit nicht. PERSONALWERT holt
  //     das Gehalt mit rein: Eignungspunkte pro 1.000 € Monatsgehalt. Die
  //     Einstellgebühr fließt NICHT zusätzlich ein - sie ist live IMMER exakt
  //     20% des Monatsgehalts (Fahrer wie Disponent), ein fixer Faktor
  //     ändert nie die Rangfolge zwischen Bewerbern.
  // ============================================================
  // Layout-Update des Spiels (2026-10-15): Karten heißen jetzt
  // article.card.fi-person-card (Kopf/Fakten-Container umbenannt), "Eignung"
  // heißt jetzt "Zuverlässigkeit" (.fi-person-reliability), das Gehalt steht in
  // .fi-person-terms, die Freischaltung unter "Weitere Angaben". Die alten
  // Selektoren bleiben als Fallback erhalten.
  const PERSONALBOERSE_SELEKTOREN = {
    karte: 'article.card',
    name: '.name',
    rolle: '.role',
    eignung: '.fi-person-reliability strong, .card-head .score strong',
    fact: '.fi-person-terms > div, .fi-person-detail-grid > div, .facts .fact',
    badgeAnker: '.fi-person-terms, .facts',
    statBueroLevel: '.stats .stat',
  };

  /** @returns {{card: Element, name: string|null, rolle: string|null, eignung: number|null, gehalt: number|null, freischaltungLevel: number, gesperrt: boolean}} */
  function parsePersonalKarte(card) {
    const name = card.querySelector(PERSONALBOERSE_SELEKTOREN.name)?.textContent.trim() ?? null;
    const rolle = card.querySelector(PERSONALBOERSE_SELEKTOREN.rolle)?.textContent.trim() ?? null;
    const eignungText = card.querySelector(PERSONALBOERSE_SELEKTOREN.eignung)?.textContent.trim() ?? '';
    const eignung = eignungText ? parseFloat(eignungText.replace('%', '').replace(',', '.')) : null;

    const facts = {};
    card.querySelectorAll(PERSONALBOERSE_SELEKTOREN.fact).forEach(f => {
      const label = f.querySelector('span')?.textContent.trim();
      const wert = f.querySelector('strong')?.textContent.trim();
      if (label) facts[label] = wert;
    });
    const gehaltText = facts['Gehalt'] ?? facts['Monatsgehalt'] ?? '';
    const gehalt = gehaltText ? parseFloat(gehaltText.replace(/[^\d,-]/g, '').replace(/\./g, '').replace(',', '.')) : null;
    const freischaltungMatch = (facts['Freischaltung'] ?? '').match(/(\d+)/);
    const freischaltungLevel = freischaltungMatch ? parseInt(freischaltungMatch[1], 10) : 1;

    return { card, name, rolle, eignung, gehalt, freischaltungLevel, gesperrt: card.classList.contains('locked') };
  }

  /** @returns {number|null} Zuverlässigkeits-/Eignungspunkte pro 1.000 € Monatsgehalt, oder null falls Wert/Gehalt fehlt */
  function berechnePersonalWert(kandidat) {
    if (kandidat.eignung == null || !kandidat.gehalt) return null;
    return (kandidat.eignung / kandidat.gehalt) * 1000;
  }

  function holeAktuellesBueroLevel() {
    const stat = Array.from(document.querySelectorAll(PERSONALBOERSE_SELEKTOREN.statBueroLevel))
      .find(el => /Büro-Level/i.test(el.querySelector('span')?.textContent ?? ''));
    const text = stat?.querySelector('strong')?.textContent ?? '';
    const n = parseInt(text, 10);
    return Number.isFinite(n) ? n : null;
  }

  function injectPersonalboerseStyles() {
    if (document.getElementById('fi-personal-styles')) return;
    const style = document.createElement('style');
    style.id = 'fi-personal-styles';
    style.textContent = `
      .fi-personal-wert {
        display: inline-flex; align-items: baseline; gap: 4px;
        font-size: 11px; font-weight: 700; color: #ffd98a;
        background: rgba(255,217,138,.12); border-radius: 6px;
        padding: 2px 8px; margin-top: 6px;
      }
      .fi-personal-wert.fi-gesperrt { color: #9aa5b8; background: rgba(154,165,184,.12); }
      .fi-personal-wert small { font-weight: 600; color: #9aa5b8; }
    `;
    document.head.appendChild(style);
  }

  /**
   * Baut für jede Bewerber-Karte auf recruitment.php den PERSONALWERT-Badge
   * und sortiert die Karten im gemeinsamen .grid-Container danach neu (beste
   * Werte zuerst, noch nicht freigeschaltete Bewerber - Büro-Level zu
   * niedrig - ans Ende, da ohnehin nicht einstellbar). Läuft einmalig beim
   * Laden - die Seite lädt bei jedem Filter/Sortierwechsel ohnehin komplett
   * neu (siehe URL-Query-Parameter ?role=...), kein SPA-Rerendering.
   */
  function initPersonalboerseWertung() {
    const karten = Array.from(document.querySelectorAll(PERSONALBOERSE_SELEKTOREN.karte));
    if (!karten.length) return;
    injectPersonalboerseStyles();
    injectZIndexOverrides(); // enthält auch die Tooltip-Box-Styles
    initFiTooltipSystem();   // Tooltips (Hover am PC, Tippen am Handy)

    const aktuellesBueroLevel = holeAktuellesBueroLevel();
    const kandidaten = karten.map(parsePersonalKarte).map(k => ({
      ...k,
      wert: berechnePersonalWert(k),
      gesperrt: k.gesperrt || (aktuellesBueroLevel != null && k.freischaltungLevel > aktuellesBueroLevel),
    }));

    kandidaten.forEach(k => {
      const badge = document.createElement('div');
      badge.className = 'fi-personal-wert' + (k.gesperrt ? ' fi-gesperrt' : '');
      badge.setAttribute('data-fi-tip', 'Zuverlässigkeit (früher: Eignung) in Prozentpunkten pro 1.000 € Monatsgehalt - hoher Wert = viel für wenig Gehalt');
      badge.textContent = k.wert != null ? `⭐ ${k.wert.toFixed(1)} ` : '⭐ –';
      const small = document.createElement('small');
      small.textContent = k.gesperrt ? `🔒 ab Büro-Level ${k.freischaltungLevel}` : '/ 1.000 € Gehalt';
      badge.appendChild(small);
      k.card.querySelector(PERSONALBOERSE_SELEKTOREN.badgeAnker)?.insertAdjacentElement('afterend', badge)
        ?? k.card.appendChild(badge);
    });

    const grid = karten[0].parentElement;
    kandidaten
      .slice()
      .sort((a, b) => {
        if (a.gesperrt !== b.gesperrt) return a.gesperrt ? 1 : -1;
        return (b.wert ?? -Infinity) - (a.wert ?? -Infinity);
      })
      .forEach(k => grid.appendChild(k.card));

    console.log('[FI-Helper] Personalwert berechnet für', kandidaten.length, 'Bewerber:',
      kandidaten.map(k => `${k.name} (${k.rolle}): ${k.wert?.toFixed(1) ?? '?'}${k.gesperrt ? ' [gesperrt]' : ''}`));
  }

  // ============================================================
  // 6c. FAHRZEUGHÄNDLER (truck-catalog.php) - FEHLENDE FAHRZEUGE ERGÄNZEN
  //     Der Händler zeigt nur ein rotierendes Teil-Angebot (z.B. mal nur
  //     Kleintransporter) - für den vom Nutzer gewünschten Gesamtüberblick
  //     ergänzt diese Funktion alle 15 laut offiziellem Wiki existierenden
  //     Fahrzeuge/Anhänger/Sattelzugmaschinen/Auflieger
  //     (hilfe.frachtimperium.de/books/fuhrpark-fahrzeuge/chapter/fahrzeuge,
  //     jede Seite hat eine Spec-Grafik mit allen Werten) als zusätzliche
  //     Kacheln - optisch identisch zu den echten Händler-Kacheln (gleiche
  //     CSS-Klassen: .fleet-card.dealer-card, .fleet-info, .dealer-price),
  //     aber klar als "📖 Referenz (Wiki)" markiert und OHNE echte Kaufen/
  //     Leasen-Formulare (dafür bräuchte es eine echte inventory_id, die es
  //     für nicht im Angebot befindliche Fahrzeuge nicht gibt - ein Klick
  //     darf hier NIE einen echten Kauf/Leasing-Request auslösen).
  // ============================================================
  // Bild-Basis der Wiki-Galerie - jede Fahrzeugseite hat ein eigenes, NICHT
  // schematisch aus dem Seiten-Slug ableitbares Dateinamen-Schema (z.B.
  // "tautliner-plane.png" bei Slug "tautlinerplane", "containerchassi.png"
  // ohne "s" bei Slug "containerchassis") - deshalb jede Datei einzeln per
  // Live-Abruf der jeweiligen Wiki-Seite verifiziert, nicht geraten.
  const WIKI_BILD_BASIS = 'https://hilfe.frachtimperium.de/uploads/images/gallery/2026-06/scaled-1680-/';
  const WIKI_FAHRZEUG_KATALOG = [
    { name: 'Kleintransporter', typ: 'Fahrzeug', bild: 'fi-kleintransporter.png', aufbau: 'Kleintransporter', tankinhaltLiter: 80, verbrauchLeer: 9.0, verbrauchBeladen: 12.0, preisNeu: 35000, preisGebraucht: 18000, level: 1, fahrer: ['Führerschein B'] },
    { name: 'Solo-LKW Koffer', typ: 'Fahrzeug', bild: 'fi-solo-lkw-koffer.png', aufbau: 'Koffer', stellplaetze: 18, tankinhaltLiter: 300, verbrauchLeer: 21.0, verbrauchBeladen: 25.0, anhaengerMoeglich: 'Koffer-Anhänger', preisNeu: 95000, preisGebraucht: 55000, level: 2, fahrer: ['Führerschein C', 'Solo-LKW'] },
    { name: 'Koffer-Anhänger', typ: 'Anhänger', bild: 'fi-koffer-anhanger.png', stellplaetze: 18, preisNeu: 38000, preisGebraucht: null, level: 6, koppelbarMit: ['Solo-LKW Koffer'] },
    { name: 'Solo-LKW Kühlkoffer', typ: 'Fahrzeug', bild: 'fi-solo-lkw-kuhlkoffer.png', aufbau: 'Kühlkoffer', stellplaetze: 18, tankinhaltLiter: 300, verbrauchLeer: 24.0, verbrauchBeladen: 28.0, anhaengerMoeglich: 'Kühler-Anhänger', preisNeu: 125000, preisGebraucht: 75000, level: 3, fahrer: ['Führerschein C', 'Solo-LKW', 'Kühlung'] },
    { name: 'Kühler-Anhänger', typ: 'Anhänger', bild: 'fi-kuhler-anhanger.png', stellplaetze: 18, preisNeu: 46000, preisGebraucht: null, level: 7, koppelbarMit: ['Solo-LKW Kühlkoffer'], fahrer: ['Kühlung'] },
    { name: 'Solo-LKW Plane', typ: 'Fahrzeug', bild: 'fi-solo-lkw-plane.png', aufbau: 'Plane', stellplaetze: 18, tankinhaltLiter: 300, verbrauchLeer: 19.0, verbrauchBeladen: 24.0, anhaengerMoeglich: 'Plane Anhänger', preisNeu: null, preisGebraucht: null, levelText: 'Nur durch das Tutorial' },
    { name: 'Plane Anhänger', typ: 'Anhänger', bild: 'fi-plane-anhanger.png', stellplaetze: 18, preisNeu: 34000, preisGebraucht: null, level: 10, koppelbarMit: ['Solo-LKW Plane'] },
    { name: 'Standard-Sattelzugmaschine', typ: 'Zugmaschine', bild: 'fi-standard-sattelzugmaschine.png', tankinhaltLiter: 600, verbrauchLeer: 25.0, verbrauchBeladen: 32.0, preisNeu: 135000, preisGebraucht: 75000, level: 4, fahrer: ['Führerschein CE', 'SZM'], koppelbarMit: ['Tautliner/Plane', 'Kühlauflieger', 'Lebensmitteltanker', 'Gefahrguttanker', 'Containerchassis', 'Getreidekipper'] },
    { name: 'Premium-Sattelzugmaschine', typ: 'Zugmaschine', bild: 'fi-premium-sattelzugmaschine.png', tankinhaltLiter: 1200, verbrauchLeer: 19.0, verbrauchBeladen: 24.0, preisNeu: 185000, preisGebraucht: 115000, level: 5, fahrer: ['Führerschein CE', 'SZM'], koppelbarMit: ['Tautliner/Plane', 'Kühlauflieger', 'Lebensmitteltanker', 'Gefahrguttanker', 'Containerchassis', 'Getreidekipper'] },
    { name: 'Tautliner/Plane', typ: 'Auflieger', bild: 'fi-tautliner-plane.png', stellplaetze: 34, preisNeu: 42000, preisGebraucht: 24000, level: 4, koppelbarMit: ['Standard-Sattelzugmaschine', 'Premium-Sattelzugmaschine'] },
    { name: 'Kühlauflieger', typ: 'Auflieger', bild: 'fi-kuhlauflieger.png', stellplaetze: 33, preisNeu: 72000, preisGebraucht: 44000, level: 5, koppelbarMit: ['Standard-Sattelzugmaschine', 'Premium-Sattelzugmaschine'], fahrer: ['Kühlung'] },
    { name: 'Lebensmitteltanker', typ: 'Auflieger', bild: 'fi-lebensmitteltanker.png', preisNeu: 95000, preisGebraucht: 60000, level: 6, koppelbarMit: ['Standard-Sattelzugmaschine', 'Premium-Sattelzugmaschine'], fahrer: ['Tanker'] },
    { name: 'Gefahrguttanker', typ: 'Auflieger', bild: 'fi-gefahrguttanker.png', preisNeu: 135000, preisGebraucht: 85000, level: 7, koppelbarMit: ['Standard-Sattelzugmaschine', 'Premium-Sattelzugmaschine'], fahrer: ['Tanker', 'Gefahrgut (ADR)'] },
    { name: 'Getreidekipper', typ: 'Auflieger', bild: 'fi-getreidekipper.png', preisNeu: 49000, preisGebraucht: 33000, level: 8, koppelbarMit: ['Standard-Sattelzugmaschine', 'Premium-Sattelzugmaschine'], zulGesamtgewichtT: 36, nutzlastT: 30, leergewichtT: 6 },
    { name: 'Containerchassis', typ: 'Auflieger', bild: 'fi-containerchassi.png', kapazitaet: '1× 40 Fuß oder 2× 20 Fuß', preisNeu: 25890, preisGebraucht: 15000, level: 9, koppelbarMit: ['Standard-Sattelzugmaschine', 'Premium-Sattelzugmaschine'], zulGesamtgewichtT: 40, nutzlastT: 36, leergewichtT: 4 },
  ];

  function fmtEuroKatalog(n) {
    return n == null ? '–' : n.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';
  }

  function injectFahrzeughaendlerStyles() {
    if (document.getElementById('fi-haendler-styles')) return;
    const style = document.createElement('style');
    style.id = 'fi-haendler-styles';
    style.textContent = `
      /* .fleet-thumb (echte Klasse) liefert schon Flex/Zentrierung/Padding -
         .fi-referenz-thumb ergänzt nur den Farbton, die Bildgröße kommt
         allein aus der Bild-Breite (kein fixes height - das würde bei
         diesem breiteren 3:2-Wiki-Bild sonst wieder zu groß/verzerrt). */
      .fi-referenz-karte { border: 1px dashed rgba(255,217,138,.4) !important; opacity: .92; }
      /* WICHTIG: die echte .is-open-Klasse (nötig, damit .dealer-info sichtbar
         ist - ohne sie steht es auf display:none) bringt beim echten Händler
         auch "grid-column: span 2" mit (Karte wird beim Aufklappen doppelt so
         breit, damit die Detail-Tabelle Platz hat). Für unsere Referenz-
         Kacheln, die IMMER offen sind, wollen wir aber die normale 1-Spalten-
         Breite - deshalb hier gezielt zurückgesetzt (siehe Chat: Nutzer hat
         die doppelte Breite zu Recht bemängelt). */
      .fi-referenz-karte.is-open { grid-column: auto !important; }
      /* .fleet-info ist im echten CSS fix auf 3 Spalten ausgelegt - passt nur
         bei der (dort üblichen) doppelten Breite. Bei unserer normalen
         1-Spalten-Breite quetscht das sonst jede Zeile auf ~100px und lässt
         Labels mehrzeilig umbrechen, was die Kachel unnötig hoch macht
         (siehe Chat: Nutzer wollte auch die Höhe passend). 2 Spalten passen
         bei 352px Kartenbreite gut und halbieren die Zeilenzahl gegenüber 1. */
      .fi-referenz-karte .fleet-info { grid-template-columns: repeat(2, 1fr) !important; }
      .fi-referenz-thumb { background: rgba(255,255,255,.04); }
      .fi-referenz-thumb img { width: 100%; height: auto; display: block; }
      .fi-referenz-badge { background: rgba(255,217,138,.18); color: #ffd98a; }
    `;
    document.head.appendChild(style);
  }

  function baueReferenzKarteHtml(fz) {
    const zeilen = [];
    if (fz.aufbau) zeilen.push(['Aufbau', fz.aufbau]);
    if (fz.stellplaetze != null) zeilen.push(['Palettenstellplätze', String(fz.stellplaetze)]);
    if (fz.kapazitaet) zeilen.push(['Kapazität', fz.kapazitaet]);
    if (fz.tankinhaltLiter != null) zeilen.push(['Tankinhalt', `${fz.tankinhaltLiter} L`]);
    if (fz.verbrauchLeer != null) zeilen.push(['Verbrauch leer', `${fz.verbrauchLeer.toFixed(2)} L / 100 km`]);
    if (fz.verbrauchBeladen != null) zeilen.push(['Verbrauch beladen', `${fz.verbrauchBeladen.toFixed(2)} L / 100 km`]);
    if (fz.typ === 'Zugmaschine') zeilen.push(['Auflieger nötig', 'Ja']);
    if (fz.anhaengerMoeglich) zeilen.push(['Anhänger möglich', fz.anhaengerMoeglich]);
    if (fz.zulGesamtgewichtT != null) zeilen.push(['Zul. Gesamtgewicht', `${fz.zulGesamtgewichtT} t`]);
    if (fz.nutzlastT != null) zeilen.push(['Nutzlast', `${fz.nutzlastT} t`]);
    if (fz.koppelbarMit) zeilen.push(['Koppelbar mit', fz.koppelbarMit.join(', ')]);
    if (fz.fahrer?.length) zeilen.push(['Fahrer-Spezialisierung', fz.fahrer.join(' + ')]);
    zeilen.push(['Preis Neu', fmtEuroKatalog(fz.preisNeu)]);
    if (fz.preisGebraucht !== undefined) zeilen.push(['Preis Gebraucht', fmtEuroKatalog(fz.preisGebraucht)]);

    const zeilenHtml = zeilen.map(([l, v]) => `<div><span>${l}</span><strong>${v}</strong></div>`).join('');
    const levelBadge = fz.levelText ?? `Händler ab Level ${fz.level}`;

    return `
      <article class="fleet-card dealer-card is-open fi-referenz-karte">
        <div class="fleet-thumb fi-referenz-thumb"><img src="${WIKI_BILD_BASIS}${fz.bild}" alt="${fz.name}" loading="lazy"></div>
        <div class="fleet-main">
          <div class="fleet-title-row">
            <div class="fleet-title"><div class="fleet-name">${fz.name}</div></div>
            <div class="fleet-status">
              <span class="badge">${fz.typ}</span>
              <span class="badge fi-referenz-badge">📖 Referenz (Wiki)</span>
              <span class="badge">${levelBadge}</span>
            </div>
          </div>
          <div class="dealer-bottom">
            <div class="mini-note">Aktuell nicht im Angebot des Händlers - Werte aus dem Wiki, kein Kauf/Leasing möglich.</div>
          </div>
          <div class="dealer-info">
            <div class="fleet-info">${zeilenHtml}</div>
          </div>
        </div>
      </article>`;
  }

  /**
   * Ergänzt alle Fahrzeugtypen, die der Händler GERADE NICHT im Angebot hat
   * (Vergleich per Fahrzeugname gegen die tatsächlich angezeigten Karten),
   * als Referenz-Kacheln aus WIKI_FAHRZEUG_KATALOG. Respektiert den
   * "Fahrzeuge"/"Auflieger"-Filter der Seite (URL-Parameter ?type=...) -
   * der "Nur neu"/"Nur gebraucht"-Filter wird bewusst ignoriert, da er auf
   * echte Lagerbestände zielt und auf Referenz-Kacheln ohnehin nicht passt.
   */
  function ergaenzeFehlendeFahrzeuge() {
    const grid = document.querySelector('.dealer-grid');
    if (!grid) return;

    const vorhandene = new Set(Array.from(grid.querySelectorAll('.fleet-name')).map(el => el.textContent.trim()));
    const typFilter = new URLSearchParams(location.search).get('type');
    const passtZuFilter = fz => {
      if (typFilter === 'vehicle') return fz.typ === 'Fahrzeug' || fz.typ === 'Zugmaschine';
      if (typFilter === 'trailer') return fz.typ === 'Anhänger' || fz.typ === 'Auflieger';
      return true;
    };

    const fehlende = WIKI_FAHRZEUG_KATALOG.filter(fz => !vorhandene.has(fz.name) && passtZuFilter(fz));
    if (!fehlende.length) return;

    injectFahrzeughaendlerStyles();
    grid.insertAdjacentHTML('beforeend', fehlende.map(baueReferenzKarteHtml).join(''));
    console.log(`[FI-Helper] ${fehlende.length} Referenz-Kachel(n) ergänzt (nicht im aktuellen Händler-Angebot):`, fehlende.map(f => f.name));
  }

  // ============================================================
  // 6e. DATENSAMMLER - Pläne mitschneiden und gegen die Realität halten
  //     Ziel (Nutzeridee 2026-10-20): eine Woche lang festhalten, WIE das
  //     Spiel Touren plant (Phasen mit Start/Ende/Strecke) und danach mit dem
  //     abgleichen, WIE gefahren wurde (Abschlussmeldungen im Posteingang:
  //     echte Leer-/Lastkilometer, Diesel, Maut, Verschleiß). Daraus lassen
  //     sich Geschwindigkeiten, Lade-/Pausenregeln und echte Distanzen
  //     ableiten statt sie zu schätzen. Die Dispositionsseite zeigt vergangene
  //     Phasen NICHT mehr - ohne Mitschnitt ist die Plan-Historie verloren.
  //     Speicher: IndexedDB "frimp-log" (Seiten-Origin, per Konsole/Skript
  //     auslesbar):
  //       phasen  - jede je gesehene Phase (key = Fahrzeug|Typ|Start|Ende|von|bis)
  //                 mit firstSeen/lastSeen; verschwindet sie VOR ihrem Ende,
  //                 wurde sie umgeplant/entfernt (ausgang "verworfen"), sonst
  //                 "abgeschlossen"
  //       touren  - Abschlussmeldungen "Tour abgeschlossen" (Auftrag-ID, km, Diesel, ...)
  //       snapshots - Zeitpunkte der Mitschnitte (Fahrzeuge mit "frei ab")
  //     Läuft auf jeder Spielseite, höchstens alle 25 Minuten.
  // ============================================================
  const SAMMLER_DB_NAME = 'frimp-log';
  const SAMMLER_INTERVALL_MS = 25 * 60 * 1000;
  const SAMMLER_ZEIT_KEY = 'fi_sammler_letzter_lauf';

  function oeffneSammlerDb() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(SAMMLER_DB_NAME, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        db.createObjectStore('phasen', { keyPath: 'key' });
        db.createObjectStore('touren', { keyPath: 'auftragId' });
        db.createObjectStore('snapshots', { keyPath: 'zeit' });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  function idbAlle(db, store) {
    return new Promise((resolve, reject) => {
      const req = db.transaction(store, 'readonly').objectStore(store).getAll();
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  function idbSchreibe(db, store, eintraege) {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(store, 'readwrite');
      const st = tx.objectStore(store);
      eintraege.forEach(e => st.put(e));
      tx.oncomplete = () => resolve(eintraege.length);
      tx.onerror = () => reject(tx.error);
    });
  }

  /** Text eines geparsten (nicht angezeigten) Elements mit Leerzeichen zwischen den Textknoten. */
  function textMitAbstand(el) {
    const teile = [];
    const walker = el.ownerDocument.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const t = walker.currentNode.textContent.trim();
      if (t) teile.push(t);
    }
    return teile.join(' ').replace(/\s+/g, ' ').trim();
  }

  async function sammlePlanSnapshot(db) {
    const jetzt = Date.now();
    const flotte = await fetchFleetStatus();
    const abgerufene = new Set(flotte.filter(f => f.status?.vehicleId).map(f => String(f.status.vehicleId)));
    const alle = await idbAlle(db, 'phasen');
    const offene = new Map(alle.filter(p => !p.geschlossen).map(p => [p.key, p]));
    const gesehen = new Set();
    const zuSchreiben = [];

    flotte.forEach(f => {
      const vid = f.status?.vehicleId;
      if (!vid) return;
      (f.status.phasen ?? []).forEach(p => {
        if (!p.start || !p.ende) return;
        const key = `${vid}|${p.type}|${p.start.getTime()}|${p.ende.getTime()}|${p.von ?? ''}|${p.bis ?? ''}`;
        gesehen.add(key);
        const bekannt = offene.get(key);
        if (bekannt) {
          bekannt.lastSeen = jetzt;
          bekannt.seen = (bekannt.seen ?? 1) + 1;
          zuSchreiben.push(bekannt);
        } else {
          zuSchreiben.push({
            key, vehicleId: String(vid), fahrzeug: f.name, type: p.type,
            start: p.start.getTime(), ende: p.ende.getTime(), von: p.von ?? null, bis: p.bis ?? null,
            auftrag: p.auftrag ?? null, status: p.status ?? null,
            firstSeen: jetzt, lastSeen: jetzt, seen: 1, geschlossen: false,
          });
        }
      });
    });

    // Verschwundene Phasen (nur bei Fahrzeugen, deren Abruf geklappt hat)
    offene.forEach(p => {
      if (gesehen.has(p.key) || !abgerufene.has(p.vehicleId)) return;
      p.geschlossen = true;
      p.geschlossenAm = jetzt;
      p.ausgang = p.ende <= jetzt + 60000 ? 'abgeschlossen' : 'verworfen';
      zuSchreiben.push(p);
    });

    await idbSchreibe(db, 'phasen', zuSchreiben);
    await idbSchreibe(db, 'snapshots', [{
      zeit: jetzt,
      fahrzeuge: flotte.filter(f => f.status?.vehicleId).map(f => ({
        vehicleId: String(f.status.vehicleId), name: f.name,
        freiAbOrt: f.status.freiAbOrt ?? null, freiAbZeit: f.status.freiAbZeit?.getTime() ?? null, status: f.status.rohStatus ?? null,
        phasen: (f.status.phasen ?? []).length,
      })),
    }]);
    return zuSchreiben.length;
  }

  function parseTourMeldung(artikel) {
    const t = textMitAbstand(artikel);
    const zahl = s => (s == null ? null : parseFloat(String(s).replace(/\./g, '').replace(',', '.')));
    const g = re => { const m = re.exec(t); return m ? m : null; };
    const auftrag = g(/Auftrag #(\d+) erfüllt/);
    if (!auftrag) return null;
    const empf = g(/Empfangen am (\d{2})\.(\d{2})\.(\d{4}) (\d{2}):(\d{2})/);
    const maut = g(/LKW-Maut: ([\d.,]+) € \(([\d.,]+) km x ([\d.,]+) EUR\/km\)/);
    const tank = g(/Automatisch getankt: ([\d.,]+) L fuer ([\d.,]+) €/);
    const stand = g(/Kilometerstand: ([\d.]+) km -> ([\d.]+) km/);
    const route = g(/Route: (.+?) -> (.+?) Leerfahrt:/);
    return {
      auftragId: auftrag[1],
      empfangen: empf ? new Date(+empf[3], +empf[2] - 1, +empf[1], +empf[4], +empf[5]).getTime() : null,
      ware: g(/Tour abgeschlossen: (.+?) Empfangen/)?.[1] ?? null,
      fahrzeug: g(/Gefahren mit: (.+?) →/)?.[1] ?? null,
      von: route?.[1] ?? null, nach: route?.[2] ?? null,
      leerKm: zahl(g(/Leerfahrt: ([\d.,]+) km/)?.[1]),
      lastKm: zahl(g(/Lastfahrt: ([\d.,]+) km/)?.[1]),
      gesamtKm: zahl(g(/Gesamtstrecke: ([\d.,]+) km/)?.[1]),
      dieselVerbrauchL: zahl(g(/Dieselverbrauch: ([\d.,]+) L/)?.[1]),
      getanktL: zahl(tank?.[1]), tankEuro: zahl(tank?.[2]),
      mautEuro: zahl(maut?.[1]), mautKm: zahl(maut?.[2]), mautSatz: zahl(maut?.[3]),
      verguetungBrutto: zahl(g(/Frachtverguetung brutto: ([\d.,]+) €/)?.[1]),
      puenktlich: /Puenktlich geliefert/.test(t),
      ergebnisEuro: zahl(g(/Ergebnis nach Diesel und Maut: ([\d.,]+) €/)?.[1]),
      kmVorher: zahl(stand?.[1]), kmNachher: zahl(stand?.[2]),
      verschleiss: {
        reifen: zahl(g(/Reifen: [\d.,]+ % -> [\d.,]+ % \(([-\d.,]+) %\)/)?.[1]),
        bremsen: zahl(g(/Bremsen: [\d.,]+ % -> [\d.,]+ % \(([-\d.,]+) %\)/)?.[1]),
        kupplung: zahl(g(/Kupplung: [\d.,]+ % -> [\d.,]+ % \(([-\d.,]+) %\)/)?.[1]),
        motor: zahl(g(/Motor: [\d.,]+ % -> [\d.,]+ % \(([-\d.,]+) %\)/)?.[1]),
      },
      erfasst: Date.now(),
    };
  }

  async function sammleTourMeldungen(db) {
    const bekannte = new Set((await idbAlle(db, 'touren')).map(t => String(t.auftragId)));
    let neu = 0;
    for (let seite = 1; seite <= 40; seite++) {
      const res = await fiFetch(`/game/inbox.php?filter=dispatch&page=${seite}`, { credentials: 'same-origin', cache: 'no-store' });
      if (!res.ok) break;
      const doc = safeParseHtml(await res.text());
      const artikel = Array.from(doc.querySelectorAll('article'));
      if (!artikel.length) break;
      const touren = artikel.map(parseTourMeldung).filter(t => t && !bekannte.has(t.auftragId));
      if (!touren.length) break; // nur noch Bekanntes -> fertig
      touren.forEach(t => bekannte.add(t.auftragId));
      neu += await idbSchreibe(db, 'touren', touren);
    }
    return neu;
  }

  // ----- Sync in ein privates GitHub-Repo (PC UND Handy auswerten) -----
  // Jedes Gerät hat seine eigene IndexedDB. Damit ich (Claude) alles gemeinsam
  // auswerten kann, lädt jedes Gerät neue Daten als kleine JSON-Datei in das
  // PRIVATE Repo Ob3s/frimp_daten (daten/<geraet>/<zeitstempel>.json). Nötig ist
  // ein Fine-grained-Token mit Schreibrecht NUR auf dieses Repo, einmal je Gerät
  // über den "☁ Sync"-Knopf im Dashboard eingegeben; es bleibt nur im localStorage
  // dieses Browsers. Ohne Token wird nichts hochgeladen.
  const SYNC_REPO = 'Ob3s/frimp_daten';
  const SYNC_TOKEN_KEY = 'fi_sync_token';
  const SYNC_STAND_KEY = 'fi_sync_stand';
  const SYNC_STATUS_KEY = 'fi_sync_status';
  const SYNC_GERAET_KEY = 'fi_geraet_id';

  function holeGeraetId() {
    let id = window.localStorage.getItem(SYNC_GERAET_KEY);
    if (!id) {
      const mobil = /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent);
      id = `${mobil ? 'handy' : 'pc'}-${Math.random().toString(36).slice(2, 6)}`;
      window.localStorage.setItem(SYNC_GERAET_KEY, id);
    }
    return id;
  }
  function setzeSyncStatus(ok, text) {
    try { window.localStorage.setItem(SYNC_STATUS_KEY, JSON.stringify({ zeit: Date.now(), ok, text })); } catch (e) { /* egal */ }
  }
  function holeSyncStatus() {
    try { return JSON.parse(window.localStorage.getItem(SYNC_STATUS_KEY) || 'null'); } catch (e) { return null; }
  }
  function utf8ZuBase64(text) {
    const bytes = new TextEncoder().encode(text);
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(bin);
  }

  /** Lädt alles seit dem letzten Sync hoch (Phasen nur wenn neu oder inzwischen abgeschlossen/verworfen). */
  async function syncZuGithub(db) {
    const token = window.localStorage.getItem(SYNC_TOKEN_KEY);
    if (!token) return { uebersprungen: true };
    const stand = parseInt(window.localStorage.getItem(SYNC_STAND_KEY) || '0', 10);
    const jetzt = Date.now();
    const [phasen, touren, snapshots] = await Promise.all([idbAlle(db, 'phasen'), idbAlle(db, 'touren'), idbAlle(db, 'snapshots')]);
    const neuePhasen = phasen.filter(p => p.firstSeen > stand || (p.geschlossenAm ?? 0) > stand);
    const neueTouren = touren.filter(t => t.erfasst > stand);
    const neueSnaps = snapshots.filter(x => x.zeit > stand);
    // Prognose-Messungen (Beladungsstart: Schätzung vs. Spiel) - beim ersten Mal der ganze Bestand, danach nur Neues
    const prognoseKomplett = !window.localStorage.getItem('fi_prognose_sync_v1');
    const neuePrognosen = ladePrognoseLog().filter(x => prognoseKomplett || Date.parse(x.zeit) > stand);
    if (!neuePhasen.length && !neueTouren.length && !neueSnaps.length && !neuePrognosen.length) return { hochgeladen: 0 };

    const geraet = holeGeraetId();
    const stuecke = [];
    const MAX = 1500; // Einträge je Datei (hält jede Datei klar unter ~1 MB)
    for (let i = 0; i < Math.max(neuePhasen.length, neueTouren.length, neueSnaps.length, 1); i += MAX) {
      stuecke.push({
        geraet, von: stand, bis: jetzt, teil: stuecke.length + 1,
        phasen: neuePhasen.slice(i, i + MAX), touren: neueTouren.slice(i, i + MAX), snapshots: neueSnaps.slice(i, i + MAX),
        prognosen: i === 0 ? neuePrognosen : [],
      });
    }
    for (const stueck of stuecke) {
      const pfad = `daten/${geraet}/${new Date(jetzt).toISOString().replace(/[:.]/g, '-')}-${stueck.teil}.json`;
      const res = await fiFetch(`https://api.github.com/repos/${SYNC_REPO}/contents/${pfad}`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: `sync ${geraet}`, content: utf8ZuBase64(JSON.stringify(stueck)) }),
      });
      if (!res.ok) {
        const grund = res.status === 401 || res.status === 403 ? 'Token ungültig/ohne Schreibrecht' : res.status === 404 ? 'Repo nicht gefunden (Token-Rechte?)' : `HTTP ${res.status}`;
        throw new Error(grund);
      }
    }
    window.localStorage.setItem(SYNC_STAND_KEY, String(jetzt));
    window.localStorage.setItem('fi_prognose_sync_v1', '1');
    return { hochgeladen: neuePhasen.length + neueTouren.length + neueSnaps.length + neuePrognosen.length };
  }

  /** Klick auf den "☁ Sync"-Pill im Dashboard: Token eingeben/ändern oder sofort synchronisieren. */
  async function bedienSyncPill() {
    const hat = !!window.localStorage.getItem(SYNC_TOKEN_KEY);
    if (hat && window.confirm('Jetzt synchronisieren?\n\n(Abbrechen = Token ändern oder entfernen)')) {
      await starteDatensammler(true);
      return;
    }
    const eingabe = window.prompt(
      `GitHub-Token (Fine-grained, NUR Repo ${SYNC_REPO}, Contents: Read and write) für dieses Gerät eingeben.\n` +
      'Leer lassen und OK = Token entfernen, Abbrechen = nichts ändern.', '');
    if (eingabe === null) return;
    if (eingabe.trim()) {
      window.localStorage.setItem(SYNC_TOKEN_KEY, eingabe.trim());
      await starteDatensammler(true);
    } else {
      window.localStorage.removeItem(SYNC_TOKEN_KEY);
      setzeSyncStatus(false, 'aus');
    }
  }

  function syncPillText() {
    const hat = !!window.localStorage.getItem(SYNC_TOKEN_KEY);
    const st = holeSyncStatus();
    if (!hat) return '☁ Sync: aus (Token fehlt)';
    if (!st) return `☁ Sync: bereit (${holeGeraetId()})`;
    const zeit = new Date(st.zeit).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
    return st.ok ? `☁ Sync ✓ ${zeit} (${holeGeraetId()})` : `☁ Sync ⚠ ${st.text}`;
  }

  async function starteDatensammler(erzwingen = false) {
    try {
      if (!window.indexedDB || (!erzwingen && document.visibilityState === 'hidden')) return;
      const letzter = parseInt(window.localStorage.getItem(SAMMLER_ZEIT_KEY) || '0', 10);
      if (!erzwingen && Date.now() - letzter < SAMMLER_INTERVALL_MS) return;
      window.localStorage.setItem(SAMMLER_ZEIT_KEY, String(Date.now())); // sofort setzen: andere Tabs überspringen
      const db = await oeffneSammlerDb();
      const phasen = await sammlePlanSnapshot(db);
      const touren = await sammleTourMeldungen(db);
      console.log(`[FI-Helper] Datensammler: ${phasen} Phasen-Einträge aktualisiert, ${touren} neue Tourmeldungen`);
      try {
        const sync = await syncZuGithub(db);
        if (!sync.uebersprungen) {
          setzeSyncStatus(true, `${sync.hochgeladen} Einträge`);
          console.log(`[FI-Helper] Sync: ${sync.hochgeladen} Einträge hochgeladen`);
        }
      } catch (e) {
        setzeSyncStatus(false, e.message);
        console.warn('[FI-Helper] Sync fehlgeschlagen', e);
      }
      const pill = document.getElementById('fi-sync-pill');
      if (pill) pill.textContent = syncPillText();
    } catch (e) {
      console.warn('[FI-Helper] Datensammler fehlgeschlagen', e);
    }
  }

  // ============================================================
  // FUHRPARK-LISTE (fuhrpark.php): Karten -> kompakte Liste, Handlungsbedarf oben
  // ============================================================
  /**
   * Ersetzt das Kartenraster durch zwei Listen (Fahrzeuge, Auflieger). Oben stehen Fahrzeuge mit
   * Handlungsbedarf (Sattelzugmaschine ohne Auflieger, Fahrer 1/2 nicht zugewiesen, beide fehlen =
   * ganz oben) bzw. nicht gekoppelte Auflieger. Ein Klick auf eine Zeile klappt die ORIGINAL-Karte
   * darunter auf (Fahrer zuweisen, Auflieger koppeln, Werkstatt … bleiben unverändert nutzbar).
   * Schlägt der Aufbau fehl, bleibt das Kartenraster unangetastet.
   */
  function baueFuhrparkListe() {
    const karten = [...document.querySelectorAll('.fleet-card')];
    if (!karten.length || document.getElementById('fi-fuhrpark-liste')) return;

    const text = c => c.textContent.replace(/\s+/g, ' ').trim();
    const nat = (a, b) => a.localeCompare(b, 'de', { numeric: true });
    const esc = t => String(t ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;');

    const daten = karten.map(card => {
      const t = text(card);
      const istFahrzeug = !!card.querySelector('form[action*="fleet_assign_driver"]');
      const name = card.querySelector('.fleet-name')?.textContent.trim() ?? '?';
      const typ = card.querySelector('img')?.getAttribute('alt') ?? '';
      const heading = card.querySelector('.fleet-heading-line')?.textContent.replace(/\s+/g, ' ').trim() ?? '';
      const gekoppeltPlate = /Gekoppelt:\s*(.+)$/.exec(heading)?.[1]?.trim() ?? null;
      const fahrer = [1, 2].map(slot => {
        const form = [...card.querySelectorAll('form[action*="fleet_assign_driver"]')].find(f => String(f.querySelector('[name=driver_slot]')?.value) === String(slot));
        const sel = form?.querySelector('select[name=employee_id]');
        if (!sel || !sel.value) return null;
        return sel.selectedOptions[0]?.textContent.split('·')[0].trim() || null;
      });
      const kennzeichen = istFahrzeug ? null : (/Kennzeichen\s*(.+?)\s+Status/.exec(t)?.[1]?.trim() ?? null);
      const status = card.querySelector('.fleet-status')?.textContent.replace(/\s+/g, ' ').trim() ?? '';
      return {
        card, raster: card.closest('.fleet-grid') ?? card.parentElement, istFahrzeug, name, typ, gekoppeltPlate, fahrer, kennzeichen, status,
        braucheAuflieger: istFahrzeug && /über Auflieger/i.test(t) && !gekoppeltPlate,
        standort: /Standort\s*(.+?)\s*Hauptuntersuchung/.exec(t)?.[1]?.trim() ?? '',
        km: /Kilometer\s*([\d.]+)\s*km/.exec(t)?.[1] ?? '',
        zustand: /Zustand\s*([\d,]+)\s*%/.exec(t)?.[1] ?? '',
        hu: /Nächste HU\s*(\d{2}\.\d{2}\.\d{4})/.exec(t)?.[1] ?? '',
        huStufe: card.querySelector('[class*="fi-inspection-due-badge--"]')?.className.match(/badge--(\w+)/)?.[1] ?? '',
        verplant: /verplant/i.test(status),
        gekoppeltTrailer: !istFahrzeug && /gekoppelt/i.test(status),
      };
    });

    const fahrzeuge = daten.filter(d => d.istFahrzeug);
    const auflieger = daten.filter(d => !d.istFahrzeug);
    if (!fahrzeuge.length) return; // unbekanntes Layout -> Karten behalten

    // welcher Auflieger hängt an welchem Fahrzeug (über das Kennzeichen)
    const zugVonPlate = new Map(fahrzeuge.filter(f => f.gekoppeltPlate).map(f => [f.gekoppeltPlate, f.name]));
    fahrzeuge.forEach(f => {
      f.probleme = [];
      if (f.braucheAuflieger) f.probleme.push('Auflieger fehlt');
      if (!f.fahrer[0] && !f.fahrer[1]) f.probleme.push('beide Fahrer fehlen');
      else if (!f.fahrer[0]) f.probleme.push('Fahrer 1 fehlt');
      else if (!f.fahrer[1]) f.probleme.push('Fahrer 2 fehlt');
      f.score = (f.braucheAuflieger ? 4 : 0) + (!f.fahrer[0] && !f.fahrer[1] ? 4 : (!f.fahrer[0] || !f.fahrer[1] ? 2 : 0));
    });
    fahrzeuge.sort((a, b) => b.score - a.score || nat(a.name, b.name));
    auflieger.forEach(a => { a.zug = zugVonPlate.get(a.kennzeichen) ?? null; a.score = a.zug ? 0 : 1; });
    auflieger.sort((a, b) => b.score - a.score || nat(a.typ, b.typ) || nat(a.kennzeichen ?? '', b.kennzeichen ?? ''));

    const huZelle = d => d.hu ? `<span class="fi-fp-hu fi-fp-hu--${esc(d.huStufe)}">${esc(d.hu.slice(0, 6) + d.hu.slice(8))}</span>` : '–';
    const zustandZelle = d => d.zustand ? `${esc(d.zustand)} %` : '–';
    const fz = n => n ? esc(n) : '<span class="fi-fp-fehlt">fehlt</span>';

    const zeileFahrzeug = f => `<tr class="fi-fp-zeile${f.score ? ' fi-fp-achtung' : ''}" data-i="${daten.indexOf(f)}">
      <td><b>${esc(f.name)}</b>${f.probleme.length ? `<div class="fi-fp-probleme">⚠ ${esc(f.probleme.join(' · '))}</div>` : ''}</td>
      <td>${esc(f.typ)}</td><td>${fz(f.fahrer[0])}</td><td>${fz(f.fahrer[1])}</td>
      <td>${f.gekoppeltPlate ? esc(f.gekoppeltPlate) : (/über Auflieger/i.test(text(f.card)) ? '<span class="fi-fp-fehlt">fehlt</span>' : '–')}</td>
      <td>${esc(f.standort)}</td><td class="fi-fp-zahl">${esc(f.km)}</td><td class="fi-fp-zahl">${zustandZelle(f)}</td><td>${huZelle(f)}</td><td>${f.verplant ? 'verplant' : 'frei'}</td><td class="fi-fp-pfeil">▾</td></tr>`;
    const zeileAuflieger = a => `<tr class="fi-fp-zeile${a.score ? ' fi-fp-achtung' : ''}" data-i="${daten.indexOf(a)}">
      <td><b>${esc(a.typ || a.name)}</b>${a.score ? '<div class="fi-fp-probleme">⚠ an kein Fahrzeug gekoppelt</div>' : ''}</td>
      <td>${esc(a.kennzeichen ?? '–')}</td><td>${a.zug ? esc(a.zug) : '<span class="fi-fp-fehlt">frei</span>'}</td>
      <td>${esc(a.standort)}</td><td class="fi-fp-zahl">${zustandZelle(a)}</td><td>${huZelle(a)}</td><td>${a.verplant ? 'verplant' : 'frei'}</td><td class="fi-fp-pfeil">▾</td></tr>`;

    const kopfFahrzeug = '<thead><tr><th>Fahrzeug</th><th>Typ</th><th>Fahrer 1</th><th>Fahrer 2</th><th>Auflieger</th><th>Standort</th><th>km</th><th>Zustand</th><th>HU</th><th>Status</th><th></th></tr></thead>';
    const kopfAuflieger = '<thead><tr><th>Auflieger</th><th>Kennzeichen</th><th>An Fahrzeug</th><th>Standort</th><th>Zustand</th><th>HU</th><th>Status</th><th></th></tr></thead>';
    const wrapFz = document.createElement('div');
    wrapFz.id = 'fi-fuhrpark-liste';
    wrapFz.innerHTML = `<table class="fi-fp-tabelle">${kopfFahrzeug}<tbody>${fahrzeuge.map(zeileFahrzeug).join('')}</tbody></table>`;
    const wrapAufl = auflieger.length ? document.createElement('div') : null;
    if (wrapAufl) wrapAufl.innerHTML = `<table class="fi-fp-tabelle fi-fp-auflieger">${kopfAuflieger}<tbody>${auflieger.map(zeileAuflieger).join('')}</tbody></table>`;

    // Original-Karten bleiben im Dokument (versteckt) und werden beim Aufklappen unter die Zeile verschoben
    const style = document.createElement('style');
    style.textContent = `
      #fi-fuhrpark-liste { margin: 8px 0 24px; }
      .fi-fp-tabelle { width: 100%; border-collapse: collapse; margin-bottom: 18px; font-size: 12.5px; color: #dbe2f0; }
      .fi-fp-tabelle th { text-align: left; font-size: 11px; letter-spacing: .08em; text-transform: uppercase; color: #ffd98a; padding: 4px 8px; border-bottom: 1px solid rgba(255,217,138,.3); }
      .fi-fp-tabelle td { padding: 4px 8px; border-bottom: 1px solid rgba(255,255,255,.06); vertical-align: top; }
      .fi-fp-zeile { cursor: pointer; }
      .fi-fp-zeile:hover td { background: rgba(255,255,255,.05); }
      .fi-fp-achtung td { background: rgba(245,184,75,.10); }
      .fi-fp-achtung td:first-child { box-shadow: inset 3px 0 0 #f5b84b; }
      .fi-fp-probleme { color: #ffb48a; font-size: 11px; margin-top: 1px; }
      .fi-fp-fehlt { color: #ff8a8a; font-weight: 700; }
      .fi-fp-zahl { text-align: right; font-variant-numeric: tabular-nums; }
      .fi-fp-pfeil { color: #6f7b90; text-align: right; width: 18px; }
      .fi-fp-hu--warning { color: #ffb48a; } .fi-fp-hu--critical, .fi-fp-hu--expired, .fi-fp-hu--missing { color: #ff8a8a; font-weight: 700; }
      .fi-fp-detail > td { padding: 8px 0; background: rgba(0,0,0,.15); }
    `;
    document.head.appendChild(style);
    const verdrahte = (wrap, rasterVon) => {
      rasterVon.raster.style.setProperty('display', 'none', 'important'); // Spiel-CSS setzt display mit !important
      rasterVon.raster.insertAdjacentElement('beforebegin', wrap);
      wrap.addEventListener('click', klick);
    };
    const klick = ev => {
      const zeile = ev.target.closest('.fi-fp-zeile');
      if (!zeile || ev.target.closest('.fi-fp-detail')) return;
      const naechste = zeile.nextElementSibling;
      if (naechste?.classList.contains('fi-fp-detail')) { // zuklappen: Karte zurück ins (versteckte) Raster
        daten[+zeile.dataset.i].raster.appendChild(naechste.querySelector('.fleet-card'));
        naechste.remove();
        zeile.querySelector('.fi-fp-pfeil').textContent = '▾';
        return;
      }
      const d = daten[+zeile.dataset.i];
      const detail = document.createElement('tr');
      detail.className = 'fi-fp-detail';
      const td = document.createElement('td');
      td.colSpan = zeile.children.length;
      const container = document.createElement('div');
      container.className = 'fleet-grid';
      container.style.display = 'block';
      container.appendChild(d.card);
      td.appendChild(container);
      detail.appendChild(td);
      zeile.insertAdjacentElement('afterend', detail);
      zeile.querySelector('.fi-fp-pfeil').textContent = '▴';
    };
    verdrahte(wrapFz, fahrzeuge[0]);
    if (wrapAufl) verdrahte(wrapAufl, auflieger[0]);
  }

  // ============================================================
  // ACHIEVEMENT-WAND (player-profile.php, eigenes Profil)
  // ============================================================
  /**
   * Das Spiel zeigt die "Große Achievement-Wand" nur mit Premium; ohne steht dort "Noch keine Erfolge
   * freigeschaltet". Diese Wand wird LOKAL aus den eigenen Spieldaten berechnet (Touren, Umsatz, Personal,
   * Firmenlevel, Fahrzeuge) - es sind NICHT die Spiel-Achievements: keine Punkte im Spiel, für andere
   * Spieler unsichtbar. Katalog (Namen, Schwellen, Seltenheit, Punkte) nach den Wänden öffentlich
   * sichtbarer Premium-Profile; Erfolge ohne lokal prüfbare Daten (Logo, Spezialisierung, Rangliste …)
   * stehen als "nicht prüfbar" da.
   */
  const ACHIEVEMENT_KATALOG = [
    { kat: 'Transport', icon: '🚚', name: 'Erste Lieferung', rar: 'common', pkt: 10, desc: 'Die erste Fracht wurde erfolgreich abgeschlossen.', m: 'fracht', ziel: 1 },
    { kat: 'Transport', icon: '🚚', name: 'Zuverlässiger Frachtführer', rar: 'common', pkt: 20, desc: '10 Frachten wurden erfolgreich abgeschlossen.', m: 'fracht', ziel: 10 },
    { kat: 'Transport', icon: '🏆', name: 'Stammfahrer der Wirtschaft', rar: 'rare', pkt: 60, desc: '100 Frachten wurden erfolgreich abgeschlossen.', m: 'fracht', ziel: 100 },
    { kat: 'Transport', icon: '👑', name: 'Logistik-Legende', rar: 'legendary', pkt: 250, desc: '1.000 Frachten wurden erfolgreich abgeschlossen.', m: 'fracht', ziel: 1000 },
    { kat: 'Personal', icon: '👤', name: 'Erster Mitarbeiter', rar: 'common', pkt: 10, desc: 'Der erste Mitarbeiter wurde eingestellt.', m: 'personal', ziel: 1 },
    { kat: 'Personal', icon: '👥', name: 'Personalabteilung', rar: 'rare', pkt: 60, desc: '10 Mitarbeiter arbeiten für die Firma.', m: 'personal', ziel: 10 },
    { kat: 'Wirtschaft', icon: '💶', name: 'Sechsstellig', rar: 'common', pkt: 25, desc: '100.000 € Gesamtumsatz wurden erreicht.', m: 'umsatz', ziel: 100000 },
    { kat: 'Wirtschaft', icon: '💰', name: 'Millionärs-Spedition', rar: 'rare', pkt: 100, desc: '1.000.000 € Gesamtumsatz wurden erreicht.', m: 'umsatz', ziel: 1000000 },
    { kat: 'Wirtschaft', icon: '💎', name: 'Marktmacht', rar: 'epic', pkt: 220, desc: '10.000.000 € Gesamtumsatz wurden erreicht.', m: 'umsatz', ziel: 10000000 },
    { kat: 'Firma', icon: '🏗️', name: 'Wachsende Firma', rar: 'common', pkt: 30, desc: 'Firmenlevel 5 wurde erreicht.', m: 'level', ziel: 5 },
    { kat: 'Firma', icon: '🏢', name: 'Etablierter Betrieb', rar: 'rare', pkt: 90, desc: 'Firmenlevel 10 wurde erreicht.', m: 'level', ziel: 10 },
    { kat: 'Fuhrpark', icon: '🚛', name: 'Erstes Fahrzeug', rar: 'common', pkt: 10, desc: 'Das erste Fahrzeug steht im Fuhrpark.', m: 'fahrzeuge', ziel: 1 },
    { kat: 'Fuhrpark', icon: '🚛', name: 'Kleine Flotte', rar: 'common', pkt: 25, desc: '5 Fahrzeuge stehen im Fuhrpark.', m: 'fahrzeuge', ziel: 5 },
    { kat: 'Fuhrpark', icon: '🚛', name: 'Flottenbetreiber', rar: 'rare', pkt: 80, desc: '25 Fahrzeuge stehen im Fuhrpark.', m: 'fahrzeuge', ziel: 25 },
    { kat: 'Fuhrpark', icon: '🏭', name: 'Fuhrpark-Imperium', rar: 'epic', pkt: 180, desc: '100 Fahrzeuge stehen im Fuhrpark.', m: 'fahrzeuge', ziel: 100 },
    { kat: 'Profil & Auftreten', icon: '🏢', name: 'Profil gestartet', rar: 'common', pkt: 5, desc: 'Die eigene Firmenseite wurde angelegt.', m: 'immer', ziel: 1 },
    { kat: 'Profil & Auftreten', icon: '📝', name: 'Werbetafel', rar: 'common', pkt: 10, desc: 'Ein eigener Werbetext wurde im Spielerprofil hinterlegt.', m: 'werbetext', ziel: 1 },
    { kat: 'Profil & Auftreten', icon: '⭐', name: 'Premium-Auftritt', rar: 'rare', pkt: 25, desc: 'Ein Premium-Spielerprofil wurde aktiviert (nur mit Premium).', m: null, premium: true },
    { kat: 'Profil & Auftreten', icon: '🛡️', name: 'Markenauftritt', rar: 'rare', pkt: 20, desc: 'Ein eigenes Firmenlogo wurde ausgewählt.', m: 'logo', ziel: 1, premium: true },
    { kat: 'Profil & Auftreten', icon: '🎯', name: 'Spezialist', rar: 'rare', pkt: 25, desc: 'Eine Speditions-Spezialisierung wurde gewählt.', m: 'spezialisierung', ziel: 1, premium: true },
    { kat: 'Profil & Auftreten', icon: '🚛', name: 'Fuhrpark-Schaufenster', rar: 'rare', pkt: 25, desc: 'Mindestens ein Top-Fahrzeug wurde im Profil präsentiert.', m: null, premium: true },
    { kat: 'Prestige', icon: '🥇', name: 'Ranglisten-Elite', rar: 'epic', pkt: 200, desc: 'Die Firma steht in den Top 10 der Rangliste.', m: null, premium: true }, // Kriterium unbekannt (kein Zusammenhang mit Level/Fahrzeugen/Umsatz/Frachten/Bekanntheit erkennbar) -> ausgeblendet
    { kat: 'Prestige', icon: '🏁', name: '1.000 Frachten', rar: 'common', pkt: 0, desc: '1.000 Frachten erfolgreich abgeschlossen.', m: 'fracht', ziel: 1000 },
    { kat: 'Prestige', icon: '📈', name: '1 Mio. Jahresumsatz', rar: 'common', pkt: 0, desc: '1.000.000 Euro Umsatz im laufenden Jahr erreicht.', m: 'jahresumsatz', ziel: 1000000 },
    { kat: 'Prestige', icon: '🚚', name: '50 Fahrzeuge', rar: 'common', pkt: 0, desc: '50 aktive Fahrzeuge im Fuhrpark.', m: 'fahrzeuge', ziel: 50 },
  ];

  /** Umsatz = Summe aller Tourgutschriften (Kontoauszug, Kategorie "orders"); ab = Startdatum ISO (Standard: Spielbeginn). 30 Min. gecached. */
  async function ladeTourUmsatz(abIso) {
    const schluessel = `fi_umsatz_${abIso}`;
    try {
      const c = JSON.parse(window.localStorage.getItem(schluessel) || 'null');
      if (c && Date.now() - c.zeit < 30 * 60 * 1000) return c.summe;
    } catch (e) { /* ohne Cache weiter */ }
    const heute = new Date();
    const bis = `${heute.getFullYear()}-${String(heute.getMonth() + 1).padStart(2, '0')}-${String(heute.getDate()).padStart(2, '0')}`;
    let summe = 0;
    for (let seite = 1; seite <= 200; seite++) {
      const res = await fiFetch(`/game/account_statement.php?from=${abIso}&to=${bis}&category=orders&page=${seite}`, { credentials: 'same-origin', cache: 'no-store' });
      const doc = safeParseHtml(await res.text());
      doc.querySelectorAll('tbody tr').forEach(tr => {
        const c = [...tr.children].map(x => x.textContent.replace(/\s+/g, ' ').trim());
        const betrag = parseFloat((c[4] ?? '').replace(/\./g, '').replace(',', '.').replace(/[^\d.\-]/g, ''));
        if (c[1] && Number.isFinite(betrag) && betrag > 0) summe += betrag;
      });
      const pg = /Seite\s+(\d+)\s*\/\s*(\d+)/.exec(doc.body?.textContent ?? '');
      if (!pg || +pg[1] >= +pg[2]) break;
    }
    try { window.localStorage.setItem(schluessel, JSON.stringify({ zeit: Date.now(), summe })); } catch (e) { /* egal */ }
    return summe;
  }

  async function baueAchievementWand() {
    if (document.getElementById('fi-ach-wand')) return;
    if (!document.querySelector('a[href*="profile-settings.php"]')) return; // nur das eigene Profil
    const leer = [...document.querySelectorAll('section.panel')].find(sec => /Achievement-Übersicht/.test(sec.querySelector('h2')?.textContent ?? ''));
    if (!leer) return; // Premium-Wand des Spiels vorhanden -> nichts ersetzen

    const jahr = new Date().getFullYear();
    const stat = parseStatBadges();
    // Das Profil zeigt Frachten, Gesamt-/Jahresumsatz selbst (Kennzahlen) - nur falls ausgeblendet: aus Spieldaten berechnen
    const seitenText = (document.querySelector('main') ?? document.body).textContent.replace(/\s+/g, ' ');
    const zahl = re => { const m = re.exec(seitenText); return m ? parseFloat(m[1].replace(/\./g, '').replace(',', '.')) : null; };
    let fracht = zahl(/Frachten\s*([\d.]+)/);
    if (fracht == null) {
      const fraRes = await fiFetch('/game/active_tours.php', { credentials: 'same-origin', cache: 'no-store' });
      const fraDoc = safeParseHtml(await fraRes.text());
      fracht = parseInt(/Erfüllte Touren\s*(\d+)/i.exec((fraDoc.body?.textContent ?? '').replace(/\s+/g, ' '))?.[1] ?? '0', 10);
    }
    const umsatz = zahl(/Gesamtumsatz\s*([\d.,]+)\s*€/) ?? await ladeTourUmsatz('2024-01-01');
    const jahresumsatz = zahl(/Jahresumsatz\s*([\d.,]+)\s*€/) ?? await ladeTourUmsatz(`${jahr}-01-01`);
    const messwerte = {
      fracht, umsatz, jahresumsatz, immer: 1,
      personal: stat.Personal ?? 0,
      level: parseInt(document.querySelector('.fi-level-badge strong')?.textContent ?? '0', 10) || 0,
      fahrzeuge: stat.Fahrzeuge ?? 0,
      spezialisierung: /Keine Spezialisierung/i.test(seitenText) ? 0 : 1,
      werbetext: /noch keine öffentliche Firmenbeschreibung/i.test(seitenText) ? 0 : 1,
      logo: /fi-status-logo\.png/.test(document.querySelector('main .logo, .hero .logo')?.getAttribute('src') ?? '') ? 0 : 1,
    };

    const nf = n => Math.round(n).toLocaleString('de-DE');
    // Erfolge, die Premium-Funktionen voraussetzen (Logo, Top-3-Fahrzeuge, Spezialisierung, Premium-Profil), sind ohne Premium ausgeblendet
    const eintraege = ACHIEVEMENT_KATALOG.filter(a => !a.premium).map(a => {
      const pruefbar = !!a.m;
      const wert = pruefbar ? messwerte[a.m] : null;
      return { ...a, pruefbar, wert, offen: pruefbar && wert >= a.ziel };
    });
    const freigeschaltet = eintraege.filter(e => e.offen);
    const punkte = freigeschaltet.reduce((a, e) => a + e.pkt, 0);
    const kategorien = [...new Set(eintraege.map(e => e.kat))];

    const html = `
      <h2>Große Achievement-Wand <small style="font-size:12px; font-weight:600; color:#9aa5b8;">lokal berechnet · ${freigeschaltet.length} von ${eintraege.length} · ${punkte} Punkte</small></h2>
      <div class="desc" style="margin-bottom:10px;">Nur auf diesem Gerät aus deinen Spieldaten errechnet - keine echten Spiel-Achievements (keine Punkte im Spiel, für andere Spieler nicht sichtbar).</div>
      <div class="achievement-categories">
        ${kategorien.map(k => `<div class="achievement-category"><h3>${k}</h3><div class="achievements">
          ${eintraege.filter(e => e.kat === k).map(e => {
            const pct = e.pruefbar ? Math.min(100, (e.wert / e.ziel) * 100) : 0;
            return `<article class="achievement ${e.offen ? 'unlocked' : 'locked'} rarity-${e.rar}">
              <span class="achievement-rarity">${e.rar}</span><div class="achievement-logo">${e.icon}</div><strong>${e.name}</strong>
              <small>${!e.pruefbar ? 'nicht prüfbar' : (e.offen ? 'Freigeschaltet' : 'Gesperrt')}${e.pkt ? ` · ${e.pkt} Punkte` : ''}</small>
              ${e.pruefbar && e.ziel > 1 ? `<div class="achievement-progress" style="--p:${pct.toFixed(1)}%"><i></i></div><div class="achievement-progress-text">${nf(Math.min(e.wert, e.ziel))} / ${nf(e.ziel)}</div>` : ''}
              <div class="fi-ach-desc">${e.desc}</div>
            </article>`;
          }).join('')}
        </div></div>`).join('')}
      </div>`;

    const wand = document.createElement('section');
    wand.className = 'panel';
    wand.id = 'fi-ach-wand';
    wand.innerHTML = html;
    const style = document.createElement('style');
    style.textContent = `
      #fi-ach-wand .achievements { display: grid; grid-template-columns: repeat(auto-fill, minmax(170px, 1fr)); gap: 10px; }
      #fi-ach-wand .achievement { position: relative; padding: 10px 12px; border-radius: 12px; border: 1px solid rgba(255,255,255,.12); background: rgba(255,255,255,.05); }
      #fi-ach-wand .achievement.locked { opacity: .55; }
      #fi-ach-wand .achievement-progress { height: 5px; border-radius: 3px; background: rgba(255,255,255,.10); overflow: hidden; margin-top: 6px; }
      #fi-ach-wand .achievement-progress > i { display: block; height: 100%; width: var(--p, 0%); background: linear-gradient(90deg, #f5b84b, #ffd98a); }
      #fi-ach-wand .achievement-progress-text { font-size: 11px; color: #9aa5b8; margin-top: 2px; }
      #fi-ach-wand .achievement strong, #fi-ach-wand .achievement small { display: block; }
      #fi-ach-wand .fi-ach-desc { font-size: 11px; color: #9aa5b8; margin-top: 4px; line-height: 1.35; }
    `;
    document.head.appendChild(style);
    leer.replaceWith(wand);
  }

  /** Abruf-Zeile ("🔎 N Seiten aufgerufen in X ms") ganz unten auf jeder Seite, die das Skript verändert (das Dashboard hat sie im eigenen Template). */
  function zeigeAbrufZeileUnten() {
    if (document.getElementById('fi-dash-abrufe')) { starteAbrufAnzeige(); return; }
    injectZIndexOverrides(); // Styles der Abruf-Zeile
    const wrap = document.createElement('div');
    wrap.id = 'fi-dash-abrufe';
    wrap.style.cssText = 'margin: 16px auto 28px; max-width: 1100px; padding: 0 16px;';
    (document.querySelector('main') || document.querySelector('.content') || document.body).appendChild(wrap);
    starteAbrufAnzeige();
  }

  // ============================================================
  // 7. INIT
  // ============================================================
  // Der Helper läuft AUSSCHLIESSLICH als Cockpit auf active_tours.php -
  // auf allen anderen Seiten passiert bewusst NICHTS (keine Sidebar,
  // kein Body-Platzhalter). Die alte Sidebar-Variante (buildOverlay,
  // updateOverlay, renderFreightMarketPanel, renderVehicleBlock,
  // setzePlatzhalter) wurde entfernt - siehe Git-Historie, falls sie
  // je wieder gebraucht wird.
  if (/\/game\/active_tours\.php/.test(location.pathname)) {
    injectZIndexOverrides(); // Basis-Styles (auch für's Dashboard) einmalig einspielen
    renderActiveToursDashboard().catch(e => console.error('[FI-Helper] Dashboard-Aufbau fehlgeschlagen:', e));
  } else if (/\/game\/recruitment\.php/.test(location.pathname)) {
    initPersonalboerseWertung();
  } else if (/\/game\/truck-catalog\.php/.test(location.pathname)) {
    ergaenzeFehlendeFahrzeuge();
  } else if (/\/game\/fuhrpark\.php/.test(location.pathname)) {
    try { baueFuhrparkListe(); } catch (e) { console.error('[FI-Helper] Fuhrpark-Liste fehlgeschlagen', e); }
  } else if (/\/game\/player-profile\.php/.test(location.pathname)) {
    baueAchievementWand().catch(e => console.error('[FI-Helper] Achievement-Wand fehlgeschlagen', e));
  }
  // Auf jeder manipulierten Seite: Abruf-Zeile ganz unten
  if (/\/game\/(recruitment|truck-catalog|fuhrpark|player-profile)\.php/.test(location.pathname)) {
    try { zeigeAbrufZeileUnten(); } catch (e) { console.error('[FI-Helper] Abruf-Zeile fehlgeschlagen', e); }
  }

  // Datensammler auf jeder eingeloggten Spielseite (verzögert, damit die Seite
  // zuerst fertig lädt; Login-/Startseiten ausgenommen)
  if (/\/game\//.test(location.pathname)) {
    setTimeout(starteDatensammler, 8000);
  }

})();
