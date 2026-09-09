// ==UserScript==
// @name         FrachtImperium Helper
// @namespace    noone.frachtimperium
// @version      0.29.0
// @description  Übersicht über Fuhrpark, Frachtbörse, Kredit & Personal-Wirtschaftlichkeit
// @author       NoOne
// @match        https://frachtimperium.de/*
// @grant        none
// @run-at       document-idle
// @updateURL    https://raw.githubusercontent.com/Ob3s/frimp_fuehrer/main/frachtimperium-helper.user.js
// @downloadURL  https://raw.githubusercontent.com/Ob3s/frimp_fuehrer/main/frachtimperium-helper.user.js
// ==/UserScript==

(function () {
  'use strict';

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
    driverLiveContainer: '#driverLiveStatus',               // data-vehicle-id Attribut
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

    // --- Seite: Finanzen / Kredit (noch nicht analysiert) ---
    kreditZinssatz: null,
    kreditMaxHoehe: null,
    kreditLaufzeit: null,

    // --- Seite: Personal (noch nicht analysiert) ---
    personalListe: null,
    personalName: null,
    personalLohn: null,
    personalErfahrungsstufe: null,

    // --- Seite: Fuhrpark-Übersicht (fuhrpark.php) ---
    fuhrparkCard: '.fleet-card',                      // ein Artikel pro Fahrzeug, data-vehicle-id
    fuhrparkTypBild: '.fleet-thumb img',               // alt-Attribut = Fahrzeugtyp, z.B. "Kleintransporter"
    fuhrparkName: '.fleet-name',
    fuhrparkKennzeichen: '.fleet-plate',
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
   * Liefert die Fahrzeugliste, egal auf welcher Seite wir gerade sind.
   * Auf dispatch.php steht sie direkt im DOM, auf allen anderen Seiten
   * (z.B. active_tours.php, das Premium-only ist und uns keine Details
   * zeigt) holen wir uns dispatch.php einmal per fetch() nach.
   * @returns {Promise<Vehicle[]>}
   */
  async function getVehicleListAnywhere() {
    const onDispatchPage = /\/game\/dispatch\.php/.test(location.pathname);
    if (onDispatchPage) {
      return parseVehicleList();
    }
    try {
      const res = await fetch('/game/dispatch.php', { credentials: 'same-origin', cache: 'no-store' });
      if (!res.ok) return [];
      const html = await res.text();
      const doc = safeParseHtml(html);
      return parseVehicleList(doc);
    } catch (e) {
      console.warn('[FI-Helper] Fahrzeugliste konnte nicht geladen werden', e);
      return [];
    }
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
   * @returns {Promise<VehicleStatus|null>}
   */
  async function fetchVehicleStatus(vehicleId) {
    try {
      const heute = new Date();
      const datumIso = `${heute.getFullYear()}-${String(heute.getMonth() + 1).padStart(2, '0')}-${String(heute.getDate()).padStart(2, '0')}`;
      const url = `/game/dispatch.php?vehicle_id=${encodeURIComponent(vehicleId)}&date=${datumIso}`;
      const res = await fetch(url, { credentials: 'same-origin', cache: 'no-store' });
      if (!res.ok) return null;
      const html = await res.text();
      const doc = safeParseHtml(html);
      return parseCurrentVehicleStatus(doc);
    } catch (e) {
      console.warn(`[FI-Helper] Fahrzeug ${vehicleId} konnte nicht geladen werden`, e);
      return null;
    }
  }

  /**
   * Berechnet die YYYY-MM-DD-Kalendertage, die ein Zeitfenster überdeckt -
   * für das gezielte Nachladen einzelner Tage via ?date=... (siehe Chat).
   */
  function berechneBenoetigteDaten(fensterStartMs, fensterEndeMs) {
    const daten = [];
    const start = new Date(fensterStartMs);
    start.setHours(0, 0, 0, 0);
    for (let t = start.getTime(); t <= fensterEndeMs; t += 24 * 3600 * 1000) {
      const d = new Date(t);
      daten.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`);
    }
    return daten;
  }

  /**
   * Holt die Phasen EINES bestimmten Kalendertags für ein Fahrzeug
   * (dispatch.php lädt standardmäßig nur 1-2 Tage in den DOM - für ein
   * lückenloses Zeitfenster müssen wir gezielt jeden Tag einzeln anfragen).
   */
  async function fetchPhasenFuerTag(vehicleId, datumIso) {
    try {
      const url = `/game/dispatch.php?vehicle_id=${encodeURIComponent(vehicleId)}&date=${datumIso}`;
      const res = await fetch(url, { credentials: 'same-origin', cache: 'no-store' });
      if (!res.ok) return [];
      const html = await res.text();
      const doc = safeParseHtml(html);
      return parsePhaseBlocks(doc);
    } catch (e) {
      console.warn(`[FI-Helper] Phasen für ${datumIso} (Fahrzeug ${vehicleId}) konnten nicht geladen werden`, e);
      return [];
    }
  }

  /** Dedupliziert eine Phasenliste über Typ + exakte Start-/Endzeit (siehe parsePhaseBlocks). */
  function dedupliierePhasen(phasenListe) {
    const gesehen = new Set();
    const eindeutig = [];
    for (const p of phasenListe) {
      const schluessel = `${p.type}|${p.start?.getTime() ?? ''}|${p.ende?.getTime() ?? ''}`;
      if (gesehen.has(schluessel)) continue;
      gesehen.add(schluessel);
      eindeutig.push(p);
    }
    return eindeutig;
  }

  /**
   * Ergänzt vehicleStatus.phasen um alle Tage, die das gewünschte Zeitfenster
   * überdeckt, damit die Timeline lückenlos ist (Bugfix, siehe Chat: die
   * Standardansicht von dispatch.php enthält oft nur 1-2 Tage, dadurch fehlten
   * kurze Leerfahrt-/Lade-Phasen auf nicht geladenen Tagen komplett).
   */
  async function ergaenzePhasenFuerFenster(vehicleStatus, fensterStartMs, fensterEndeMs) {
    if (!vehicleStatus?.vehicleId) return vehicleStatus;
    const daten = berechneBenoetigteDaten(fensterStartMs, fensterEndeMs);
    const ergebnisse = await Promise.all(daten.map(d => fetchPhasenFuerTag(vehicleStatus.vehicleId, d)));
    const allePhasen = [...(vehicleStatus.phasen || []), ...ergebnisse.flat()];
    return { ...vehicleStatus, phasen: dedupliierePhasen(allePhasen) };
  }

  /**
   * Holt den Status ALLER Fahrzeuge (aktuelles Fahrzeug direkt aus dem DOM,
   * die anderen per fetch()) und liefert eine sortierte Liste.
   * @returns {Promise<VehicleStatus[]>}
   */
  async function fetchFleetStatus() {
    const vehicles = await getVehicleListAnywhere();
    if (!vehicles.length) return [];

    // "Schon geladen, kein Fetch nötig" gilt NUR, wenn wir wirklich auf dispatch.php
    // sind - sonst bezieht sich "istAusgewaehlt" auf einen Hintergrund-Fetch der
    // Fahrzeugliste, nicht auf die aktuell im Browser sichtbare Seite.
    const onDispatchPage = /\/game\/dispatch\.php/.test(location.pathname);

    const results = await Promise.all(
      vehicles.map(v =>
        (onDispatchPage && v.istAusgewaehlt)
          ? Promise.resolve(parseCurrentVehicleStatus())
          : fetchVehicleStatus(v.id)
      )
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
  async function fetchLiveDriverStatus(vehicleId) {
    try {
      const res = await fetch(`/game/driver_time_status.php?vehicle_id=${encodeURIComponent(vehicleId)}`, {
        credentials: 'same-origin',
        cache: 'no-store',
        headers: { Accept: 'application/json' },
      });
      if (!res.ok) return null;
      const data = await res.json();
      return data?.ok ? data : null;
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

  /** Holt die Fahrzeugkategorien per fetch() nach, egal auf welcher Seite man gerade ist. */
  async function getBodyTypeOptionsAnywhere() {
    const onFreightMarket = /\/game\/freight-market\.php/.test(location.pathname);
    if (onFreightMarket) return parseBodyTypeOptions(document);
    try {
      const res = await fetch('/game/freight-market.php', { credentials: 'same-origin', cache: 'no-store' });
      if (!res.ok) return [];
      const html = await res.text();
      const doc = safeParseHtml(html);
      return parseBodyTypeOptions(doc);
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
    let url = `/game/freight-market.php?body_type=${encodeURIComponent(bodyType)}&per_page=${perPage}&page=${page}&sort=price_km_desc`;
    if (filter.zielStadt) {
      url += `&destination_radius_city=${encodeURIComponent(filter.zielStadt)}&destination_radius_km=${filter.zielRadiusKm ?? 0}`;
    }
    const res = await fetch(url, { credentials: 'same-origin', cache: 'no-store' });
    if (!res.ok) return { angebote: [], pagination: null };
    const html = await res.text();
    const doc = safeParseHtml(html);
    return { angebote: parseFrachtboerse(doc), pagination: parsePaginationInfo(doc) };
  }

  /**
   * Lädt ALLE Seiten einer Kategorie (bis maxPages als Sicherheitsdeckel).
   * @param {string} bodyType
   * @param {number} maxPages
   * @param {(status: string) => void} onProgress
   * @param {{zielStadt?: string, zielRadiusKm?: number}} filter
   * @returns {Promise<{angebote: FrachtAngebot[], gescannteSeiten: number, gesamtSeiten: number|null}>}
   */
  async function fetchAllOffersForBodyType(bodyType, maxPages = 20, onProgress = () => {}, filter = {}) {
    onProgress('Lade Seite 1 ...');
    const erste = await fetchFreightMarktPageSafe(bodyType, 1, filter);
    let alle = [...erste.angebote];
    const gesamtSeiten = erste.pagination ? erste.pagination.totalPages : 1;
    const zuLadendeSeiten = Math.min(gesamtSeiten, maxPages);

    // restliche Seiten in Batches parallel laden, um den Server nicht zu fluten
    const BATCH_SIZE = 4;
    for (let start = 2; start <= zuLadendeSeiten; start += BATCH_SIZE) {
      const seiten = [];
      for (let p = start; p < Math.min(start + BATCH_SIZE, zuLadendeSeiten + 1); p++) {
        seiten.push(p);
      }
      onProgress(`Lade Seiten ${seiten[0]}–${seiten[seiten.length - 1]} von ${zuLadendeSeiten} ...`);
      const ergebnisse = await Promise.all(seiten.map(p => fetchFreightMarktPageSafe(bodyType, p, filter)));
      ergebnisse.forEach(e => { alle = alle.concat(e.angebote); });
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
  function bewerteFrachtFuerFahrzeug(fracht, vehicleStatus, liveStatus = null, aufbauTypLabel = 'Kleintransporter', fahrzeugStellplaetze = null) {
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
    const restLenkzeitStunden = liveStatus?.drivers?.[0]?.remaining_drive_seconds != null
      ? liveStatus.drivers[0].remaining_drive_seconds / 3600 : null;
    const restSchichtzeitStunden = liveStatus?.drivers?.[0]?.remaining_shift_seconds != null
      ? liveStatus.drivers[0].remaining_shift_seconds / 3600 : null;
    const lenkzeitUngeprueft = restLenkzeitStunden === null || restSchichtzeitStunden === null;

    const spezifikation = holeFahrzeugSpezifikation(aufbauTypLabel);
    const ladeZeitStunden = berechneLadeZeitStunden(spezifikation, fahreranzahl);
    const entladeZeitStunden = berechneLadeZeitStunden(spezifikation, fahreranzahl);
    const geschwindigkeit = ZEIT_ANNAHMEN.avgGeschwindigkeitKmh;

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
    const einplanbar = beladungsStartZeit <= planungsfensterEnde;
    const einplanbarHinweis = einplanbar
      ? null
      : `Nächstmöglicher Beladungsstart (${beladungsStartZeit.toLocaleString('de-DE')}) liegt außerhalb des ${PLANUNGSFENSTER_STUNDEN}h-Planungsfensters (Fenster endet ${planungsfensterEnde.toLocaleString('de-DE')}) - noch nicht einplanbar, erst annehmen und später einplanen`;

    // Anfahrt = LEER (kein Auftrag geladen), Fracht-Fahrt = BELADEN - unterschiedlicher Verbrauch!
    const kostenAnfahrt = anfahrtKm * (dieselKostenProKm(false, spezifikation) + ASSUMPTIONS.mautProKm + ASSUMPTIONS.verschleissProKm);
    const kostenFahrt = fahrtKm * (dieselKostenProKm(true, spezifikation) + ASSUMPTIONS.mautProKm + ASSUMPTIONS.verschleissProKm);
    const deckungsbeitragEuro = (fracht.verguetungEuro ?? 0) - kostenAnfahrt - kostenFahrt;

    const effektivProKm = gesamtFahrKm > 0 ? deckungsbeitragEuro / gesamtFahrKm : null;
    // Leerfahrt-Anteil separat ausweisen - "gutes €/km" kann eine riesige
    // unbezahlte Anfahrt verschleiern, wenn die Fracht selbst lukrativ genug ist.
    const anfahrtAnteilProzent = gesamtFahrKm > 0 ? Math.round((anfahrtKm / gesamtFahrKm) * 100) : null;

    return {
      anfahrtKm, gesamtStunden, ankunftZeit, schaffbar, effektivProKm, deckungsbeitragEuro,
      kostenAnfahrt, anfahrtAnteilProzent, beladungsStartZeit,
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
  function bewerteBundleFuerFahrzeug(bundleFrachten, vehicleStatus, liveStatus, aufbauTypLabel, fahrzeugStellplaetze) {
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

    const bewertung = bewerteFrachtFuerFahrzeug(virtuelleFracht, vehicleStatus, liveStatus, aufbauTypLabel, fahrzeugStellplaetze);
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
  function bewerteKetteFuerFahrzeug(kette, vehicleStatus, liveStatus, aufbauTypLabel, fahrzeugStellplaetze) {
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
    const restLenkzeitStunden = liveStatus?.drivers?.[0]?.remaining_drive_seconds != null
      ? liveStatus.drivers[0].remaining_drive_seconds / 3600 : null;
    const restSchichtzeitStunden = liveStatus?.drivers?.[0]?.remaining_shift_seconds != null
      ? liveStatus.drivers[0].remaining_shift_seconds / 3600 : null;
    const lenkzeitUngeprueft = restLenkzeitStunden === null || restSchichtzeitStunden === null;

    const spezifikation = holeFahrzeugSpezifikation(aufbauTypLabel);
    const ladeZeitStunden = berechneLadeZeitStunden(spezifikation, fahreranzahl);
    const entladeZeitStunden = berechneLadeZeitStunden(spezifikation, fahreranzahl);
    const geschwindigkeit = ZEIT_ANNAHMEN.avgGeschwindigkeitKmh;

    // Etappe 1: Anfahrt zuerst SEPARAT simulieren, um den echten Beladungsstart
    // zu ermitteln (dieselbe Korrektur wie bei Einzel-Frachten, siehe Chat).
    const anfahrtSegment = [{ dauer: anfahrtKm / geschwindigkeit, istFahrt: true }];
    const anfahrtErgebnis = simuliereTourZeitplan(anfahrtSegment, fahreranzahl, restLenkzeitStunden, restSchichtzeitStunden);
    const beladungsStartZeit = new Date(vehicleStatus.freiAbZeit.getTime() + anfahrtErgebnis.gesamtStunden * 3600 * 1000);

    const restSegmenteEtappe1 = [
      { dauer: ladeZeitStunden, istFahrt: false },
      { dauer: fahrt1Km / geschwindigkeit, istFahrt: true },
      { dauer: entladeZeitStunden, istFahrt: false },
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
      { dauer: ladeZeitStunden, istFahrt: false },
      { dauer: fahrt2Km / geschwindigkeit, istFahrt: true },
      { dauer: entladeZeitStunden, istFahrt: false },
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
    const kostenAnfahrt = anfahrtKm * (dieselKostenProKm(false, spezifikation) + ASSUMPTIONS.mautProKm + ASSUMPTIONS.verschleissProKm);
    const kostenFahrt1 = fahrt1Km * (dieselKostenProKm(true, spezifikation) + ASSUMPTIONS.mautProKm + ASSUMPTIONS.verschleissProKm);
    const kostenFahrt2 = fahrt2Km * (dieselKostenProKm(true, spezifikation) + ASSUMPTIONS.mautProKm + ASSUMPTIONS.verschleissProKm);
    const deckungsbeitragEuro = (etappe1.verguetungEuro ?? 0) + (etappe2.verguetungEuro ?? 0) - kostenAnfahrt - kostenFahrt1 - kostenFahrt2;

    const gesamtFahrKm = anfahrtKm + fahrt1Km + fahrt2Km;
    const effektivProKm = gesamtFahrKm > 0 ? deckungsbeitragEuro / gesamtFahrKm : null;
    const anfahrtAnteilProzent = gesamtFahrKm > 0 ? Math.round((anfahrtKm / gesamtFahrKm) * 100) : null;

    // Planungsfenster-Check: gegen den ECHTEN Beladungsstart prüfen, nicht
    // gegen freiAbZeit (Bugfix, siehe Chat).
    const planungsfensterEnde = new Date(Date.now() + PLANUNGSFENSTER_STUNDEN * 3600 * 1000);
    const einplanbar = beladungsStartZeit <= planungsfensterEnde;
    const einplanbarHinweis = einplanbar
      ? null
      : `Nächstmöglicher Beladungsstart (${beladungsStartZeit.toLocaleString('de-DE')}) liegt außerhalb des ${PLANUNGSFENSTER_STUNDEN}h-Planungsfensters (Fenster endet ${planungsfensterEnde.toLocaleString('de-DE')}) - noch nicht einplanbar, erst annehmen und später einplanen`;

    return {
      anfahrtKm, gesamtStunden, ankunftZeit, schaffbar, effektivProKm, deckungsbeitragEuro,
      kostenAnfahrt, anfahrtAnteilProzent, beladungsStartZeit,
      lenkzeitHinweis, lenkzeitUngeprueft,
      kapazitaetOk: true, kapazitaetHinweis: null,
      einplanbar, einplanbarHinweis,
      zwischenankunft, etappe1Schaffbar, etappe2Schaffbar,
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
  function findeBesteRoutenProFahrzeug(angebote, fleet, zielReferenzStadt = null, zielRadiusKm = 0) {
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

    return fleet.map(fahrzeug => {
      const direktKm = (zielReferenzStadt && fahrzeug.status?.freiAbOrt)
        ? geschaetzteStrassenKm(fahrzeug.status.freiAbOrt, zielReferenzStadt)
        : null;

      const einzelBewertungen = angeboteFuerDirekt
        .map(fracht => {
          const bewertung = bewerteFrachtFuerFahrzeug(fracht, fahrzeug.status, fahrzeug.live, fahrzeug.typ, fahrzeug.stellplaetze ?? null);
          if (bewertung && direktKm) {
            const gesamtFahrKm = bewertung.anfahrtKm + (fracht.entfernungKm ?? 0);
            bewertung.umwegProzent = Math.round(((gesamtFahrKm / direktKm) - 1) * 100);
          }
          return { fracht, bewertung, istBundle: false };
        })
        .filter(x => x.bewertung !== null);

      const bundleBewertungen = baueBundlesFuerAlleRouten(angeboteFuerDirekt, fahrzeug.stellplaetze ?? null)
        .map(bundleFrachten => {
          const { fracht, bewertung } = bewerteBundleFuerFahrzeug(
            bundleFrachten, fahrzeug.status, fahrzeug.live, fahrzeug.typ, fahrzeug.stellplaetze ?? null
          );
          if (bewertung && direktKm) {
            const gesamtFahrKm = bewertung.anfahrtKm + (fracht.entfernungKm ?? 0);
            bewertung.umwegProzent = Math.round(((gesamtFahrKm / direktKm) - 1) * 100);
          }
          return { fracht, bewertung, istBundle: true, bundleFrachten };
        })
        .filter(x => x.bewertung !== null);

      // Ketten-Kandidaten (Etappe 1 → Zwischenstadt → Etappe 2 → Ziel) - nur
      // sinnvoll bei Rückfracht-Suche mit bekannter Zielstadt, siehe Chat:
      // kein zweiter Scan nötig, wir mischen einfach denselben Datensatz.
      const kettenBewertungen = zielReferenzStadt
        ? baueKettenKandidaten(angebote, zielReferenzStadt, zielRadiusKm)
            .map(kette => {
              const bewertung = bewerteKetteFuerFahrzeug(kette, fahrzeug.status, fahrzeug.live, fahrzeug.typ, fahrzeug.stellplaetze ?? null);
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

      const bewertungen = [...einzelBewertungen, ...bundleBewertungen, ...kettenBewertungen];

      // Fristen-Einhaltung bleibt eine WEICHE Präferenz - lieber eine knapp
      // verpasste Frist zeigen als gar nichts, das ist informativ statt gefährlich.
      const schaffbare = bewertungen.filter(x => x.bewertung.schaffbar !== false); // true ODER unbekannt (null)
      let kandidaten = schaffbare.length > 0 ? schaffbare : bewertungen;

      kandidaten.forEach(k => { k.bewertung.kombiScore = kombinierterScore(k.bewertung); });
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
    }));
  }

  // ============================================================
  // 5. BERECHNUNGSLOGIK
  // ============================================================

  const ASSUMPTIONS = {
    dieselPreisProLiter: 2.06, // echter Marktpreis von /game/pc.php (Stand: siehe Chat)
    mautProKm: 0.15,           // € – TODO prüfen, ob Kleintransporter mautpflichtig sind
    verschleissProKm: 0.05,    // €
  };

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
      tankinhaltLiter: 80,
      verbrauchLeerLPro100km: 9.0,
      verbrauchBeladenLPro100km: 12.0,
      ladeSystem: 'fix',
      ladeZeitFixStunden: 1,
    },
    'Kofferaufbau': { // = "Solo-LKW Koffer" im Truck-Katalog/Fuhrpark
      tankinhaltLiter: 300,
      verbrauchLeerLPro100km: 21.0,
      verbrauchBeladenLPro100km: 25.0,
      ladeSystem: 'palette',
      stellplaetzeGesamt: 18,
    },
    'Tautliner / Plane': { // = "Solo-LKW Plane" im Truck-Katalog/Fuhrpark
      tankinhaltLiter: 300,
      verbrauchLeerLPro100km: 19.0,
      verbrauchBeladenLPro100km: 24.0,
      ladeSystem: 'palette',
      stellplaetzeGesamt: 18,
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
   */
  function berechneLadeZeitStunden(spezifikation, fahreranzahl) {
    if (spezifikation.ladeSystem === 'fix') {
      return spezifikation.ladeZeitFixStunden;
    }
    const stellplaetze = spezifikation.stellplaetzeGesamt ?? 0;
    const rohMinuten = 10 + 1.5 * stellplaetze;
    const gerundetMinuten = Math.round(rohMinuten / 5) * 5;
    const mindestMinuten = fahreranzahl >= 2 ? 10 : 15;
    return Math.max(gerundetMinuten, mindestMinuten) / 60;
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
   * @returns {Map<string, {typ: string, stellplaetze: number|null, hatFahrer: boolean}>}
   */
  function parseFuhrparkDetails(root = document) {
    const details = new Map();
    root.querySelectorAll(SELECTORS.fuhrparkCard).forEach(card => {
      const vehicleId = card.dataset.vehicleId;
      if (!vehicleId) return;
      const typ = card.querySelector(SELECTORS.fuhrparkTypBild)?.getAttribute('alt')?.trim() || null;

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

      details.set(vehicleId, { typ, stellplaetze, hatFahrer });
    });
    return details;
  }

  /** Holt die Fuhrpark-Details per fetch() nach, egal auf welcher Seite man gerade ist. */
  async function fetchFuhrparkDetails() {
    try {
      const onFuhrparkPage = /\/game\/fuhrpark\.php/.test(location.pathname);
      if (onFuhrparkPage) return parseFuhrparkDetails();
      const res = await fetch('/game/fuhrpark.php', { credentials: 'same-origin', cache: 'no-store' });
      if (!res.ok) return new Map();
      const html = await res.text();
      const doc = safeParseHtml(html);
      return parseFuhrparkDetails(doc);
    } catch (e) {
      console.warn('[FI-Helper] Fuhrpark-Details konnten nicht geladen werden', e);
      return new Map();
    }
  }

  const ZEIT_ANNAHMEN = {
    avgGeschwindigkeitKmh: 75, // TODO: aus echten Touren kalibrieren
  };

  /**
   * OFFIZIELLE Regel aus dem Spiel-Wiki (Disponentenregeln): Ohne Disponent
   * darf nur 24h im Voraus geplant werden - jeder weitere aktive Disponent
   * erweitert das Fenster um 24h. Wir kennen deine Disponenten-Anzahl aktuell
   * NICHT automatisch (müsste aus staff.php geparst werden) - falls du
   * Disponenten einstellst, sag mir die Anzahl, dann passe ich das hier an.
   */
  const PLANUNGSFENSTER_STUNDEN = 24; // TODO: automatisch aus Disponenten-Anzahl ableiten, sobald staff.php geparst wird

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
  //     Feste Tabelle statt externer Karten-API (kein CORS/Rate-Limit-Risiko,
  //     funktioniert offline). Kalibriert an zwei echten Frachtbörsen-Routen:
  //     Minden→Aachen (Luftlinie 258km, Spiel 323km) und
  //     Gent→Berlin (Luftlinie 685km, Spiel 860km) -> beide Faktor 1,25.
  // ============================================================
  const CITY_COORDS = {'Dornbirn':[47.41,9.74],'Graz':[47.07,15.44],'Innsbruck':[47.27,11.39],'Klagenfurt':[46.62,14.31],'Linz':[48.31,14.29],'Salzburg':[47.8,13.05],'Sankt Pölten':[48.2,15.62],'Villach':[46.61,13.86],'Wels':[48.16,14.03],'Wien':[48.21,16.37],'Antwerpen':[51.22,4.4],'Brügge':[51.21,3.22],'Brüssel':[50.85,4.35],'Charleroi':[50.41,4.44],'Gent':[51.05,3.72],'Leuven':[50.88,4.7],'Lüttich':[50.63,5.57],'Mechelen':[51.03,4.48],'Mons':[50.45,3.95],'Namur':[50.47,4.87],'Brünn':[49.2,16.61],'Budweis':[48.97,14.47],'Hradec Králové':[50.21,15.83],'Liberec':[50.77,15.06],'Olmütz':[49.59,17.25],'Ostrava':[49.84,18.29],'Pardubice':[50.04,15.78],'Pilsen':[49.74,13.38],'Prag':[50.08,14.44],'Ústí nad Labem':[50.66,14.03],'Aachen':[50.78,6.08],'Aalen':[48.84,10.09],'Arnsberg':[51.4,8.05],'Aschaffenburg':[49.98,9.15],'Augsburg':[48.37,10.9],'Bamberg':[49.9,10.9],'Bayreuth':[49.95,11.58],'Bergheim':[50.96,6.64],'Bergisch Gladbach':[50.99,7.13],'Berlin':[52.52,13.4],'Bielefeld':[52.02,8.53],'Bocholt':[51.84,6.61],'Bochum':[51.48,7.22],'Bonn':[50.74,7.1],'Bottrop':[51.52,6.93],'Brandenburg an der Havel':[52.41,12.55],'Braunschweig':[52.27,10.52],'Bremen':[53.08,8.81],'Bremerhaven':[53.55,8.58],'Castrop-Rauxel':[51.55,7.31],'Celle':[52.62,10.08],'Chemnitz':[50.83,12.92],'Cottbus':[51.76,14.33],'Delmenhorst':[53.05,8.63],'Detmold':[51.94,8.88],'Dinslaken':[51.57,6.74],'Dormagen':[51.1,6.84],'Dorsten':[51.66,6.96],'Dortmund':[51.51,7.47],'Dresden':[51.05,13.74],'Duisburg':[51.43,6.76],'Düren':[50.8,6.49],'Düsseldorf':[51.23,6.78],'Erfurt':[50.98,11.03],'Erlangen':[49.6,11.0],'Essen':[51.46,7.01],'Esslingen am Neckar':[48.74,9.31],'Flensburg':[54.78,9.44],'Frankfurt am Main':[50.11,8.68],'Freiburg im Breisgau':[47.99,7.85],'Friedrichshafen':[47.65,9.48],'Fulda':[50.56,9.68],'Fürth':[49.48,10.99],'Garbsen':[52.42,9.6],'Gelsenkirchen':[51.52,7.1],'Gera':[50.88,12.08],'Gladbeck':[51.57,6.99],'Göppingen':[48.7,9.65],'Göttingen':[51.53,9.94],'Greifswald':[54.1,13.39],'Grevenbroich':[51.09,6.59],'Gütersloh':[51.91,8.38],'Hagen':[51.36,7.47],'Halle (Saale)':[51.48,11.97],'Hamburg':[53.55,9.99],'Hamm':[51.68,7.82],'Hanau':[50.13,8.92],'Hannover':[52.37,9.73],'Heidelberg':[49.41,8.69],'Heilbronn':[49.14,9.22],'Herford':[52.11,8.67],'Herne':[51.54,7.22],'Herten':[51.6,7.14],'Hildesheim':[52.15,9.95],'Hürth':[50.87,6.87],'Ingolstadt':[48.76,11.42],'Iserlohn':[51.38,7.7],'Jena':[50.93,11.59],'Kaiserslautern':[49.44,7.75],'Karlsruhe':[49.01,8.4],'Kassel':[51.31,9.5],'Kempten (Allgäu)':[47.73,10.32],'Kerpen':[50.87,6.7],'Kiel':[54.32,10.14],'Koblenz':[50.36,7.59],'Köln':[50.94,6.96],'Konstanz':[47.66,9.18],'Krefeld':[51.34,6.58],'Landshut':[48.54,12.15],'Langenfeld (Rheinland)':[51.11,6.94],'Leipzig':[51.34,12.37],'Leverkusen':[51.03,6.99],'Lippstadt':[51.68,8.35],'Lübeck':[53.87,10.68],'Lüdenscheid':[51.22,7.63],'Ludwigsburg':[48.9,9.19],'Ludwigshafen am Rhein':[49.48,8.45],'Lüneburg':[53.25,10.41],'Lünen':[51.62,7.53],'Magdeburg':[52.13,11.64],'Mainz':[50.0,8.27],'Mannheim':[49.49,8.47],'Marburg':[50.81,8.77],'Marl':[51.66,7.09],'Minden':[52.29,8.91],'Moers':[51.45,6.63],'Mönchengladbach':[51.19,6.44],'Mülheim an der Ruhr':[51.43,6.88],'München':[48.14,11.58],'Münster':[51.96,7.63],'Neu-Ulm':[48.4,10.0],'Neubrandenburg':[53.56,13.26],'Neuss':[51.2,6.69],'Neuwied':[50.43,7.46],'Norderstedt':[53.69,10.01],'Nürnberg':[49.45,11.08],'Oberhausen':[51.47,6.85],'Offenbach am Main':[50.1,8.76],'Offenburg':[48.47,7.94],'Oldenburg':[53.14,8.21],'Osnabrück':[52.28,8.05],'Paderborn':[51.72,8.75],'Pforzheim':[48.89,8.7],'Plauen':[50.5,12.14],'Potsdam':[52.4,13.06],'Ratingen':[51.3,6.85],'Recklinghausen':[51.61,7.2],'Regensburg':[49.02,12.1],'Remscheid':[51.18,7.19],'Reutlingen':[48.49,9.21],'Rheine':[52.28,7.44],'Rosenheim':[47.86,12.13],'Rostock':[54.09,12.14],'Saarbrücken':[49.24,6.99],'Salzgitter':[52.15,10.33],'Schwäbisch Gmünd':[48.8,9.79],'Schwerin':[53.63,11.42],'Siegen':[50.87,8.02],'Sindelfingen':[48.71,9.0],'Solingen':[51.17,7.08],'Stralsund':[54.31,13.09],'Stuttgart':[48.78,9.18],'Trier':[49.76,6.64],'Troisdorf':[50.81,7.15],'Tübingen':[48.52,9.06],'Ulm':[48.4,9.99],'Unna':[51.53,7.68],'Velbert':[51.34,7.05],'Viersen':[51.25,6.4],'Villingen-Schwenningen':[48.06,8.46],'Weimar':[50.98,11.33],'Wesel':[51.66,6.62],'Wiesbaden':[50.08,8.24],'Wilhelmshaven':[53.53,8.11],'Witten':[51.44,7.34],'Wolfsburg':[52.42,10.79],'Worms':[49.63,8.36],'Wuppertal':[51.26,7.15],'Würzburg':[49.79,9.93],'Zwickau':[50.72,12.49],'Aalborg':[57.05,9.92],'Aarhus':[56.16,10.2],'Esbjerg':[55.47,8.45],'Horsens':[55.86,9.85],'Kolding':[55.49,9.47],'Kopenhagen':[55.68,12.57],'Odense':[55.4,10.38],'Randers':[56.46,10.04],'Roskilde':[55.64,12.08],'Vejle':[55.71,9.54],'Alicante':[38.35,-0.48],'Barcelona':[41.39,2.17],'Bilbao':[43.26,-2.93],'Madrid':[40.42,-3.7],'Málaga':[36.72,-4.42],'Murcia':[37.99,-1.13],'Palma':[39.57,2.65],'Sevilla':[37.39,-5.99],'Valencia':[39.47,-0.38],'Zaragoza':[41.65,-0.88],'Espoo':[60.21,24.66],'Helsinki':[60.17,24.94],'Jyväskylä':[62.24,25.75],'Kuopio':[62.89,27.68],'Lahti':[60.98,25.66],'Oulu':[65.01,25.47],'Pori':[61.48,21.8],'Tampere':[61.5,23.76],'Turku':[60.45,22.27],'Vantaa':[60.29,25.04],'Angers':[47.47,-0.55],'Bordeaux':[44.84,-0.58],'Dijon':[47.32,5.04],'Grenoble':[45.19,5.72],'Le Havre':[49.49,0.11],'Lille':[50.63,3.06],'Lyon':[45.76,4.84],'Marseille':[43.3,5.37],'Montpellier':[43.61,3.88],'Nantes':[47.22,-1.55],'Nice':[43.71,7.26],'Nîmes':[43.84,4.36],'Paris':[48.86,2.35],'Reims':[49.26,4.03],'Rennes':[48.11,-1.68],'Saint-Étienne':[45.44,4.39],'Strasbourg':[48.58,7.75],'Toulon':[43.12,5.93],'Toulouse':[43.6,1.44],'Villeurbanne':[45.77,4.88],'Bari':[41.12,16.87],'Bologna':[44.49,11.34],'Florenz':[43.77,11.25],'Genua':[44.41,8.93],'Mailand':[45.46,9.19],'Neapel':[40.85,14.27],'Palermo':[38.12,13.36],'Rom':[41.9,12.5],'Turin':[45.07,7.69],'Venedig':[45.44,12.32],'Diekirch':[49.87,6.16],'Differdingen':[49.52,5.89],'Düdelingen':[49.48,6.09],'Esch an der Alzette':[49.5,5.98],'Ettelbrück':[49.85,6.1],'Grevenmacher':[49.68,6.44],'Luxemburg':[49.61,6.13],'Mersch':[49.75,6.1],'Remich':[49.54,6.37],'Wiltz':[49.97,5.93],'Almere':[52.35,5.26],'Amsterdam':[52.37,4.9],'Breda':[51.59,4.78],'Den Haag':[52.08,4.31],'Eindhoven':[51.44,5.48],'Groningen':[53.22,6.57],'Nijmegen':[51.84,5.85],'Rotterdam':[51.92,4.48],'Tilburg':[51.56,5.09],'Utrecht':[52.09,5.12],'Bergen':[60.39,5.32],'Drammen':[59.74,10.2],'Fredrikstad':[59.22,10.95],'Kristiansand':[58.15,7.99],'Oslo':[59.91,10.75],'Sandnes':[58.85,5.74],'Sarpsborg':[59.28,11.11],'Stavanger':[58.97,5.73],'Tromsø':[69.65,18.96],'Trondheim':[63.43,10.39],'Breslau':[51.11,17.04],'Bydgoszcz':[53.12,18.0],'Danzig':[54.35,18.65],'Katowice':[50.26,19.02],'Krakau':[50.06,19.94],'Lublin':[51.25,22.57],'Łódź':[51.76,19.46],'Posen':[52.41,16.93],'Stettin':[53.43,14.55],'Warschau':[52.23,21.01],'Göteborg':[57.71,11.97],'Helsingborg':[56.05,12.69],'Jönköping':[57.78,14.16],'Linköping':[58.41,15.62],'Malmö':[55.6,13.0],'Norrköping':[58.59,16.19],'Örebro':[59.27,15.21],'Stockholm':[59.33,18.07],'Uppsala':[59.86,17.64],'Västerås':[59.61,16.55]};

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

  /** @deprecated Unbenutzter Erstentwurf - siehe bewerteFrachtFuerFahrzeug für die aktive Logik */
  function bewerteFracht(fracht, gesamtzeitStunden) {
    const anfahrtKm = fracht.distanzAnfahrtKm ?? 0;
    const tourKm = fracht.distanzTourKm ?? 0;
    const gesamtKm = anfahrtKm + tourKm;
    const spez = holeFahrzeugSpezifikation('Kleintransporter');
    const kosten =
      anfahrtKm * (dieselKostenProKm(false, spez) + ASSUMPTIONS.mautProKm + ASSUMPTIONS.verschleissProKm) +
      tourKm * (dieselKostenProKm(true, spez) + ASSUMPTIONS.mautProKm + ASSUMPTIONS.verschleissProKm);
    const deckungsbeitragEuro = fracht.preis - kosten;

    return {
      deckungsbeitragEuro,
      deckungsbeitragProKm: gesamtKm > 0 ? deckungsbeitragEuro / gesamtKm : 0,
      deckungsbeitragProStunde: gesamtzeitStunden > 0 ? deckungsbeitragEuro / gesamtzeitStunden : 0,
      leerfahrtAnteilProzent: gesamtKm > 0 ? (anfahrtKm / gesamtKm) * 100 : 0,
    };
  }

  function rankeFrachtangebote(angebote) {
    return angebote
      .map(a => ({ fracht: a.fracht, bewertung: bewerteFracht(a.fracht, a.gesamtzeitStunden) }))
      .sort((a, b) => b.bewertung.deckungsbeitragProStunde - a.bewertung.deckungsbeitragProStunde);
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

  const PANEL_WIDTH_PX = 320;
  const PANEL_COLLAPSED_WIDTH_PX = 44;

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
      #fi-helper-panel {
        font-family: "Segoe UI", Arial, sans-serif;
        font-size: 13px;
        line-height: 1.45;
        color: #f8fafc;
        background: linear-gradient(180deg, rgba(10,15,26,.97), rgba(7,11,18,.95));
      }
      #fi-helper-panel * { box-sizing: border-box; }
      #fi-helper-panel a { color: inherit; }

      #fi-helper-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        cursor: pointer;
        padding-bottom: 12px;
        margin-bottom: 12px;
        border-bottom: 1px solid rgba(255,255,255,.10);
      }
      #fi-helper-header .fi-title {
        font-size: 15px;
        font-weight: 800;
        letter-spacing: -0.01em;
        color: #fff6d9;
        display: flex;
        align-items: center;
        gap: 8px;
      }
      #fi-helper-header .fi-title::before {
        content: "🚚";
        font-size: 16px;
      }
      #fi-helper-toggle {
        width: 26px;
        height: 26px;
        border-radius: 999px;
        border: 1px solid rgba(255,255,255,.16);
        background: rgba(255,255,255,.07);
        color: #f8fafc;
        font-size: 15px;
        font-weight: 700;
        line-height: 1;
        cursor: pointer;
        flex-shrink: 0;
      }
      #fi-helper-toggle:hover { background: rgba(255,255,255,.14); }

      .fi-pill {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 8px 12px;
        border-radius: 12px;
        background: rgba(255,255,255,.05);
        border: 1px solid rgba(255,255,255,.10);
        font-size: 13px;
        font-weight: 700;
        margin-bottom: 10px;
      }
      .fi-pill.is-negative { color: #ffb3b3; border-color: rgba(248,113,113,.30); background: rgba(127,29,29,.16); }
      .fi-pill.is-positive { color: #a9f7c4; border-color: rgba(134,239,172,.30); background: rgba(20,60,30,.20); }

      .fi-stats-row {
        font-size: 11px;
        color: #aeb8c9;
        margin-bottom: 14px;
        display: flex;
        flex-wrap: wrap;
        gap: 6px 10px;
      }

      .fi-divider { border: none; border-top: 1px solid rgba(255,255,255,.10); margin: 14px 0; }

      .fi-section-title {
        font-size: 11px;
        text-transform: uppercase;
        letter-spacing: .09em;
        color: #ffd98a;
        font-weight: 800;
        margin: 0 0 8px;
      }

      .fi-select {
        width: 100%;
        padding: 9px 10px;
        border-radius: 10px;
        background: rgba(255,255,255,.06);
        border: 1px solid rgba(255,255,255,.16);
        color: #f8fafc;
        font-size: 13px;
        margin-bottom: 10px;
      }
      .fi-select:focus { outline: none; border-color: rgba(255,217,138,.5); }

      .fi-btn-primary {
        width: 100%;
        padding: 10px 12px;
        border-radius: 10px;
        border: 1px solid rgba(255,217,138,.52);
        background: linear-gradient(180deg,#ffd98a,#f5b84b);
        color: #211404;
        font-weight: 800;
        font-size: 13px;
        cursor: pointer;
      }
      .fi-btn-primary:hover { filter: brightness(1.05); }
      .fi-btn-primary:disabled { opacity: .55; cursor: default; filter: none; }

      .fi-card {
        padding: 12px;
        border-radius: 14px;
        background: rgba(255,255,255,.045);
        border: 1px solid rgba(255,255,255,.09);
        margin-top: 10px;
      }
      .fi-card-title {
        font-weight: 800;
        font-size: 13.5px;
        margin-bottom: 6px;
        color: #ffffff;
        display: flex;
        align-items: center;
        gap: 6px;
      }
      .fi-card-row { font-size: 12px; color: #dbe2f0; margin-top: 3px; }
      .fi-card-row.fi-muted { color: #9aa5b8; }
      .fi-card-row.fi-loc { color: #ffd98a; }
      .fi-card-row.fi-warn { color: #ff9a6b; }
      .fi-card-row.fi-good { color: #8ef2a8; }
      .fi-card-row.fi-bad { color: #ff8a8a; }
      .fi-card-row strong { color: #fff; }

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
        font-size: 22px;
        font-weight: 800;
        color: #fff6d9;
        margin: 0 0 16px;
        display: flex;
        align-items: center;
        gap: 10px;
      }
      #fi-dashboard h3 {
        font-size: 15px;
        text-transform: uppercase;
        letter-spacing: .08em;
        color: #ffd98a;
        font-weight: 800;
        margin: 28px 0 14px;
      }
      .fi-dash-pills { display: flex; gap: 12px; flex-wrap: wrap; margin-bottom: 8px; }
      .fi-dash-pill {
        padding: 12px 18px;
        border-radius: 14px;
        background: rgba(255,255,255,.05);
        border: 1px solid rgba(255,255,255,.10);
        font-size: 16px;
        font-weight: 800;
      }
      .fi-dash-pill.is-negative { color: #ffb3b3; border-color: rgba(248,113,113,.30); background: rgba(127,29,29,.16); }
      .fi-dash-pill.is-positive { color: #a9f7c4; border-color: rgba(134,239,172,.30); background: rgba(20,60,30,.20); }
      .fi-dash-grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
        gap: 16px;
      }
      .fi-dash-card {
        padding: 20px;
        border-radius: 16px;
        background: rgba(255,255,255,.045);
        border: 1px solid rgba(255,255,255,.09);
      }
      .fi-dash-card-title {
        font-size: 17px;
        font-weight: 800;
        color: #fff;
        margin-bottom: 10px;
        display: flex;
        align-items: center;
        justify-content: space-between;
        flex-wrap: wrap;
        gap: 6px 10px;
      }
      .fi-dash-card-title a { color: inherit; text-decoration: none; }
      .fi-dash-card-title a:hover { text-decoration: underline; }
      .fi-dash-row { font-size: 14px; color: #dbe2f0; margin-top: 6px; line-height: 1.5; }
      .fi-dash-row.fi-muted { color: #9aa5b8; }
      .fi-dash-row.fi-loc { color: #ffd98a; }
      .fi-dash-row.fi-warn { color: #ff9a6b; }
      .fi-dash-row.fi-good { color: #8ef2a8; }
      .fi-dash-row.fi-bad { color: #ff8a8a; }
      .fi-dash-controls {
        display: flex;
        gap: 14px;
        align-items: flex-end;
        flex-wrap: wrap;
        padding: 20px;
        border-radius: 16px;
        background: rgba(255,255,255,.045);
        border: 1px solid rgba(255,255,255,.09);
        margin-bottom: 20px;
      }
      .fi-dash-field { display: flex; flex-direction: column; gap: 6px; font-size: 13px; }
      .fi-dash-select {
        padding: 12px 14px;
        border-radius: 12px;
        background: rgba(255,255,255,.06);
        border: 1px solid rgba(255,255,255,.16);
        color: #f8fafc;
        font-size: 14px;
        min-width: 220px;
      }
      .fi-dash-btn {
        padding: 13px 24px;
        border-radius: 12px;
        border: 1px solid rgba(255,217,138,.52);
        background: linear-gradient(180deg,#ffd98a,#f5b84b);
        color: #211404;
        font-weight: 800;
        font-size: 14px;
        cursor: pointer;
      }
      .fi-dash-btn:disabled { opacity: .55; cursor: default; }
      .fi-dash-btn-reload {
        padding: 13px 16px;
        border-radius: 12px;
        border: 1px solid rgba(255,255,255,.16);
        background: rgba(255,255,255,.07);
        color: #f8fafc;
        cursor: pointer;
        font-size: 15px;
      }
      .fi-dash-bundle-item { padding-left: 12px; font-size: 12.5px; color: #9aa5b8; margin-top: 4px; }
      .fi-dash-accept-btn {
        margin-top: 12px;
        padding: 10px 16px;
        border-radius: 10px;
        border: 1px solid rgba(255,217,138,.52);
        background: linear-gradient(180deg,#ffd98a,#f5b84b);
        color: #211404;
        font-weight: 800;
        font-size: 13px;
        cursor: pointer;
      }
      .fi-dash-accept-btn:disabled { opacity: .55; cursor: default; }

      /* ====== Timeline (mehrere Fahrzeuge auf einen Blick) ====== */
      .fi-dash-timeline-legend { display: flex; gap: 16px; flex-wrap: wrap; margin-bottom: 16px; font-size: 12px; color: #cbd5e1; }
      .fi-dash-timeline-legend span { display: inline-flex; align-items: center; gap: 6px; }
      .fi-dash-timeline-legend i { width: 12px; height: 12px; border-radius: 3px; display: inline-block; }
      .fi-dash-timeline-row { display: flex; align-items: center; gap: 14px; margin-bottom: 12px; }
      .fi-dash-timeline-label { width: 170px; flex-shrink: 0; font-size: 13px; font-weight: 700; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .fi-dash-timeline-label a { color: inherit; text-decoration: none; }
      .fi-dash-timeline-label a:hover { text-decoration: underline; }
      .fi-dash-timeline-track {
        position: relative;
        flex: 1;
        min-width: 0;
        height: 38px;
        background: rgba(255,255,255,.04);
        border-radius: 8px;
        border: 1px solid rgba(255,255,255,.08);
        overflow: hidden; /* Blöcke bleiben strikt in ihrer eigenen Zeile - Tooltips laufen jetzt über ein eigenes fixed-position JS-System, siehe initFiTooltipSystem() */
      }
      .fi-dash-phase-block {
        position: absolute;
        top: 4px;
        height: 30px; /* EXPLIZIT statt bottom:4px - garantiert, dass jeder Block exakt gleich hoch ist, egal wie schmal */
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
        font-size: 10px;
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
      .fi-dash-timeline-now {
        position: absolute;
        top: 0; bottom: 0;
        width: 2px;
        background: #ff5566;
        z-index: 2;
      }
      .fi-dash-timeline-gridline {
        position: absolute;
        top: 0; bottom: 0;
        width: 1px;
        background: rgba(255,255,255,.07);
      }
      .fi-dash-timeline-gridline.is-day { background: rgba(255,217,138,.20); width: 1px; }
      .fi-dash-timeline-tick {
        position: absolute;
        top: 0;
        transform: translateX(-50%);
        white-space: nowrap;
        font-size: 10.5px;
        color: #9aa5b8;
      }
      .fi-dash-timeline-tick.is-day { color: #ffd98a; font-weight: 700; }

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

    document.addEventListener('mouseover', (ev) => {
      const el = ev.target.closest('[data-fi-tip]');
      if (!el) return;
      const text = el.getAttribute('data-fi-tip');
      if (!text) return;
      tip.textContent = text;
      tip.style.display = 'block';
      const rect = el.getBoundingClientRect();
      let left = rect.left + rect.width / 2;
      // Grob am linken/rechten Bildschirmrand abfangen, damit die Box nicht abgeschnitten wird
      left = Math.max(160, Math.min(window.innerWidth - 160, left));
      tip.style.left = `${left}px`;
      tip.style.top = `${Math.max(8, rect.top - 8)}px`;
      tip.style.transform = 'translate(-50%, -100%)';
    });

    document.addEventListener('mouseout', (ev) => {
      const el = ev.target.closest('[data-fi-tip]');
      if (!el) return;
      if (el.contains(ev.relatedTarget)) return; // nur ausblenden, wenn wirklich verlassen
      tip.style.display = 'none';
    });
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
  function baueTimelineTrackHtml(phasen, fensterStartMs, fensterEndeMs) {
    const fensterDauerMs = fensterEndeMs - fensterStartMs;
    let html = '';

    baueZeitAchsenTicks(fensterStartMs, fensterEndeMs).forEach(tick => {
      html += `<div class="fi-dash-timeline-gridline${tick.istMitternacht ? ' is-day' : ''}" style="left:${tick.pct.toFixed(2)}%"></div>`;
    });

    const jetztPct = ((Date.now() - fensterStartMs) / fensterDauerMs) * 100;
    if (jetztPct >= 0 && jetztPct <= 100) {
      html += `<div class="fi-dash-timeline-now" style="left:${jetztPct.toFixed(2)}%" data-fi-tip="Jetzt: ${new Date().toLocaleString('de-DE')}"></div>`;
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
  function baueTimelineKopfzeileHtml(fensterStartMs, fensterEndeMs) {
    const ticks = baueZeitAchsenTicks(fensterStartMs, fensterEndeMs);
    const tickHtml = ticks.map(t => `<div class="fi-dash-timeline-tick${t.istMitternacht ? ' is-day' : ''}" style="left:${t.pct.toFixed(2)}%">${t.label}</div>`).join('');
    return `<div class="fi-dash-timeline-row" style="margin-bottom:4px;">
      <div class="fi-dash-timeline-label"></div>
      <div class="fi-dash-timeline-track" style="height:20px; background:none; border:none;">${tickHtml}</div>
    </div>`;
  }

  /**
   * Reserviert Platz auf der rechten Seite, damit der Seiteninhalt nicht
   * hinter dem Panel verschwindet. WICHTIG: Nicht <body> selbst verschieben -
   * das würde die sticky/fixe Statusleiste (.fi-statusbar) mit stauchen und
   * ihr internes Flex-Layout zerreißen. Stattdessen wird der ".wrap"-Container
   * verschoben, der auf praktisch jeder Spielseite den eigentlichen Inhalt
   * umschließt (siehe HTML von dispatch.php, freight-market.php etc.).
   */
  function setzePlatzhalter(collapsed) {
    const width = (collapsed ? PANEL_COLLAPSED_WIDTH_PX : PANEL_WIDTH_PX) + 'px';
    const wraps = Array.from(document.body.children).filter(el => el.classList.contains('wrap'));
    const targets = wraps.length ? wraps : [document.body]; // Fallback falls Seite kein .wrap hat
    targets.forEach(el => {
      el.style.transition = 'margin-right 0.15s ease';
      el.style.marginRight = width;
      el.style.boxSizing = 'border-box';
    });
  }

  function buildOverlay() {
    injectZIndexOverrides();

    if (document.getElementById('fi-helper-panel')) return;

    const panel = document.createElement('div');
    panel.id = 'fi-helper-panel';
    Object.assign(panel.style, {
      position: 'fixed',
      top: '78px',            // unter der fi-statusbar, damit "Menü" frei bleibt
      bottom: '0',
      right: '0',
      width: PANEL_WIDTH_PX + 'px',
      overflowY: 'auto',
      padding: '16px',
      borderLeft: '1px solid rgba(255,217,138,.20)',
      boxSizing: 'border-box',
      zIndex: 100,             // niedrig gehalten, damit JEDES Seiten-eigene Overlay (Menü, Modals, Tutorial) automatisch gewinnt
      boxShadow: '-6px 0 24px rgba(0,0,0,.45)',
      transition: 'transform 0.15s ease',
    });

    panel.innerHTML = `
      <div id="fi-helper-header">
        <span class="fi-title" id="fi-helper-title">FrachtImperium Helper</span>
        <button type="button" id="fi-helper-toggle" title="Ein-/Ausklappen">−</button>
      </div>
      <div id="fi-helper-content"><div class="fi-empty">Lade …</div></div>
    `;

    document.body.appendChild(panel);

    // Einklappbar machen, Zustand merken (pro Browser-Session via sessionStorage)
    const collapsedKey = 'fi_helper_collapsed';
    const header = panel.querySelector('#fi-helper-header');
    const titleEl = panel.querySelector('#fi-helper-title');
    const toggleBtn = panel.querySelector('#fi-helper-toggle');
    const contentEl = panel.querySelector('#fi-helper-content');

    function applyCollapsed(collapsed) {
      contentEl.style.display = collapsed ? 'none' : '';
      // WICHTIG: Titel-Text komplett ausblenden statt nur zu quetschen - sonst
      // drängt er bei sehr schmalem Panel den Knopf aus dem sichtbaren Bereich
      // und man kommt nicht mehr ans Aufklappen (siehe Bugreport).
      titleEl.style.display = collapsed ? 'none' : '';
      header.style.justifyContent = collapsed ? 'center' : 'space-between';
      header.style.marginBottom = collapsed ? '0' : '12px';
      header.style.paddingBottom = collapsed ? '0' : '12px';
      header.style.borderBottom = collapsed ? 'none' : '1px solid rgba(255,255,255,.10)';
      toggleBtn.textContent = collapsed ? '+' : '−';
      panel.style.width = (collapsed ? PANEL_COLLAPSED_WIDTH_PX : PANEL_WIDTH_PX) + 'px';
      panel.style.padding = collapsed ? '12px 8px' : '16px';
      setzePlatzhalter(collapsed);
      try { window.sessionStorage.setItem(collapsedKey, collapsed ? '1' : '0'); } catch (e) {}
    }

    let startCollapsed = false;
    try { startCollapsed = window.sessionStorage.getItem(collapsedKey) === '1'; } catch (e) {}
    applyCollapsed(startCollapsed);

    toggleBtn.addEventListener('click', (ev) => {
      ev.stopPropagation();
      applyCollapsed(contentEl.style.display !== 'none');
    });
  }

  function fmtEuro(n) {
    return n.toLocaleString('de-DE', { style: 'currency', currency: 'EUR' });
  }

  function renderVehicleBlock(label, vehicleStatus, live) {
    const vehicleId = vehicleStatus?.vehicleId;
    const titelInhalt = vehicleId
      ? `<a href="/game/dispatch.php?vehicle_id=${encodeURIComponent(vehicleId)}" style="color:inherit; text-decoration:none;">🚐 ${label}</a>`
      : `🚐 ${label}`;
    let html = `<div class="fi-card">
      <div class="fi-card-title">${titelInhalt}<span class="fi-badge-status">${vehicleStatus?.rohStatus ?? 'unbekannt'}</span></div>`;
    if (vehicleStatus?.freiAbOrt) {
      html += `<div class="fi-card-row fi-loc">📍 frei ab ${vehicleStatus.freiAbZeit ? vehicleStatus.freiAbZeit.toLocaleString('de-DE') : '?'} in <strong>${vehicleStatus.freiAbOrt}</strong></div>`;
    }
    if (live?.drivers?.length) {
      live.drivers.forEach(d => {
        html += `<div class="fi-card-row">👤 ${d.name}${d.is_driving_now ? ' <span class="fi-good">(fährt)</span>' : ''}</div>`;
      });
    }
    const leerfahrten = vehicleStatus?.phasen?.filter(p => p.type === 'leerfahrt') ?? [];
    if (leerfahrten.length) {
      html += `<div class="fi-card-row fi-warn">⚠ ${leerfahrten.length} Leerfahrt(en) geplant</div>`;
    }
    html += `</div>`;
    return html;
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
      <h2>🚚 FrachtImperium Cockpit</h2>
      <div id="fi-dash-header" class="fi-dash-pills"><div class="fi-dash-pill">Lade …</div></div>

      <h3>Tourenplan – alle Fahrzeuge auf einen Blick</h3>
      <div id="fi-dash-timeline"><div class="fi-empty">Lade Tourenplan …</div></div>

      <h3>Flotte</h3>
      <div id="fi-dash-fleet" class="fi-dash-grid"><div class="fi-empty">Lade Flotte …</div></div>

      <h3>Frachtbörse – beste Routen berechnen</h3>
      <div class="fi-dash-controls">
        <div class="fi-dash-field">
          <label>Fahrzeugkategorie</label>
          <select id="fi-dash-bodytype" class="fi-dash-select"></select>
        </div>
        <div class="fi-dash-field">
          <label><input type="checkbox" id="fi-dash-only-return"> Nur Rückfracht nach</label>
          <input type="text" id="fi-dash-return-city" value="Berlin" class="fi-dash-select" style="min-width:140px;">
        </div>
        <div class="fi-dash-field">
          <label>Umkreis (km)</label>
          <input type="number" id="fi-dash-return-radius" value="30" min="0" max="500" class="fi-dash-select" style="min-width:80px;" title="0 = nur exakte Stadt, sonst z.B. 30km für Vororte wie Potsdam bei Berlin">
        </div>
        <button type="button" id="fi-dash-load-btn" class="fi-dash-btn">Beste Routen berechnen</button>
        <button type="button" id="fi-dash-reload-btn" class="fi-dash-btn-reload" title="Cache umgehen und frisch laden">🔄</button>
      </div>
      <div id="fi-dash-results" class="fi-dash-grid"></div>
    `;

    // Nach den Statistik-Karten einfügen, vor der (jetzt versteckten) Sperr-Meldung
    const statsSection = wrap.querySelector('.tour-stats');
    if (statsSection && statsSection.nextSibling) {
      statsSection.parentNode.insertBefore(dashboard, statsSection.nextSibling);
    } else {
      wrap.appendChild(dashboard);
    }

    // --- Kopfbereich (Kontostand/Statistik) ---
    async function aktualisiereKopf() {
      const kontostand = parseKontostand();
      const stats = parseStatBadges();
      let html = '';
      if (kontostand) {
        html += `<div class="fi-dash-pill ${kontostand.negativ ? 'is-negative' : 'is-positive'}">💰 ${kontostand.text}</div>`;
      }
      Object.entries(stats).forEach(([k, v]) => { html += `<div class="fi-dash-pill">${k}: ${v}</div>`; });
      const kopfEl = document.getElementById('fi-dash-header');
      if (kopfEl) kopfEl.innerHTML = html;
    }
    await aktualisiereKopf();

    // --- Flotte (große Karten statt schmaler Sidebar-Zeilen) ---
    async function aktualisiereFlotte() {
      const fleetEl = document.getElementById('fi-dash-fleet');
      if (!fleetEl) return;
      const [fleet, fuhrparkDetails] = await Promise.all([fetchFleetStatus(), fetchFuhrparkDetails()]);

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

      let html = '';
      const dispatchVehicleIds = new Set(fleet.map(f => String(f.status?.vehicleId ?? '')));
      const fehlendeFahrzeuge = Array.from(fuhrparkDetails.entries())
        .filter(([vehicleId, details]) => !details.hatFahrer && !dispatchVehicleIds.has(String(vehicleId)));
      if (fehlendeFahrzeuge.length) {
        html += `<div class="fi-dash-card" style="border-color: rgba(255,154,107,.4);">
          <div class="fi-dash-card-title">⚠ ${fehlendeFahrzeuge.length} Fahrzeug(e) ohne Fahrer</div>
          ${fehlendeFahrzeuge.map(([, d]) => `<div class="fi-dash-row">🚐 ${d.typ || 'Unbekannter Typ'}</div>`).join('')}
          <div class="fi-dash-row fi-muted">→ Fahrer in <a href="/game/fuhrpark.php" style="color:#ffd98a;">fuhrpark.php</a> zuweisen</div>
        </div>`;
      }

      for (const entry of fleet) {
        const live = entry.status?.vehicleId ? await fetchLiveDriverStatus(entry.status.vehicleId) : null;
        const vehicleId = entry.status?.vehicleId;
        const titel = vehicleId
          ? `<a href="/game/dispatch.php?vehicle_id=${encodeURIComponent(vehicleId)}" style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap; min-width:0;">🚐 ${entry.name}</a>`
          : `<span style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap; min-width:0;">🚐 ${entry.name}</span>`;
        html += `<div class="fi-dash-card"><div class="fi-dash-card-title">${titel}<span class="fi-badge-status">${entry.status?.rohStatus ?? 'unbekannt'}</span></div>`;
        if (entry.status?.freiAbOrt) {
          html += `<div class="fi-dash-row fi-loc">📍 frei ab ${entry.status.freiAbZeit ? entry.status.freiAbZeit.toLocaleString('de-DE') : '?'} in <strong>${entry.status.freiAbOrt}</strong></div>`;
        }
        if (live?.drivers?.length) {
          live.drivers.forEach(d => {
            html += `<div class="fi-dash-row">👤 ${d.name}${d.is_driving_now ? ' <span class="fi-dash-row fi-good" style="display:inline; margin:0;">(fährt)</span>' : ''}</div>`;
          });
        }
        const leerfahrten = entry.status?.phasen?.filter(p => p.type === 'leerfahrt') ?? [];
        if (leerfahrten.length) {
          const details = leerfahrten
            .map(p => `${p.von || '?'} → ${p.bis || '?'} (${p.start ? p.start.toLocaleString('de-DE') : '?'} – ${p.ende ? p.ende.toLocaleString('de-DE') : '?'})`)
            .join('\n');
          html += `<div class="fi-dash-row fi-warn" data-fi-tip="${details.replace(/"/g, '&quot;')}">⚠ ${leerfahrten.length} Leerfahrt(en) geplant (Hover für Details)</div>`;
        }
        html += `</div>`;
      }

      fleetEl.innerHTML = html || '<div class="fi-empty">Keine Fahrzeuge gefunden.</div>';

      // --- Timeline: alle Fahrzeuge auf einen Blick (wie der spieleigene
      // Dispositionsplan, nur alle Fahrzeuge übereinander statt einzeln) ---
      const timelineEl = document.getElementById('fi-dash-timeline');
      if (timelineEl) {
        const fensterStartMs = Date.now();
        const fensterEndeMs = fensterStartMs + 48 * 3600 * 1000; // 48h-Fenster ab jetzt
        let timelineHtml = `<div class="fi-dash-timeline-legend">
          <span><i style="background:#5b9bd5;"></i>Leerfahrt</span>
          <span><i style="background:#d4a94a;"></i>Laden / Entladen</span>
          <span><i style="background:#4caf7d;"></i>Fahrt beladen</span>
          <span><i style="background:#c1554a;"></i>Pause / Schichtpause</span>
        </div>`;

        if (!fleet.length) {
          timelineHtml += '<div class="fi-empty">Keine Fahrzeuge gefunden.</div>';
        } else {
          // Ein einzelner Fetch (mit ?date=heute, siehe fetchVehicleStatus)
          // liefert bereits eine ganze Woche an Tagen - kein Mehrfach-Nachladen
          // mehr nötig (das hat vorher nur Duplikate erzeugt, siehe Chat).
          timelineHtml += baueTimelineKopfzeileHtml(fensterStartMs, fensterEndeMs);
          fleet.forEach(entry => {
            const vehicleId = entry.status?.vehicleId;
            const labelInhalt = vehicleId
              ? `<a href="/game/dispatch.php?vehicle_id=${encodeURIComponent(vehicleId)}">🚐 ${entry.name}</a>`
              : `🚐 ${entry.name}`;
            const trackInhalt = baueTimelineTrackHtml(entry.status?.phasen, fensterStartMs, fensterEndeMs);
            timelineHtml += `<div class="fi-dash-timeline-row">
              <div class="fi-dash-timeline-label">${labelInhalt}</div>
              <div class="fi-dash-timeline-track">${trackInhalt}</div>
            </div>`;
          });
        }
        timelineEl.innerHTML = timelineHtml;
      }
    }
    await aktualisiereFlotte();

    // --- Frachtbörsen-Kategorie-Auswahl befüllen ---
    const bodyTypeSelect = document.getElementById('fi-dash-bodytype');
    const options = await getBodyTypeOptionsAnywhere();
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

    // --- Routen berechnen (nutzt denselben Cache + dieselbe Bewertungslogik wie die Sidebar) ---
    const loadBtn = document.getElementById('fi-dash-load-btn');
    const reloadBtn = document.getElementById('fi-dash-reload-btn');
    const resultsEl = document.getElementById('fi-dash-results');
    const onlyReturnCb = document.getElementById('fi-dash-only-return');
    const returnCityInput = document.getElementById('fi-dash-return-city');
    const returnRadiusInput = document.getElementById('fi-dash-return-radius');

    async function routenBerechnen(erzwingeNeuladen) {
      const bodyType = bodyTypeSelect.value;
      if (!bodyType) {
        resultsEl.innerHTML = '<div class="fi-empty">Bitte zuerst eine Kategorie wählen.</div>';
        return;
      }
      const rueckfrachtFilter = onlyReturnCb.checked && returnCityInput.value.trim()
        ? { zielStadt: returnCityInput.value.trim(), zielRadiusKm: parseInt(returnRadiusInput.value, 10) || 0 }
        : {};

      loadBtn.disabled = true;
      reloadBtn.disabled = true;
      const originalText = loadBtn.textContent;
      loadBtn.textContent = 'Lade …';
      resultsEl.innerHTML = '<div class="fi-empty">Starte Scan …</div>';

      try {
        // Kein Server-Zielfilter mehr (siehe Chat: unzuverlässig UND wir
        // brauchen für Ketten-Touren ohnehin einen breiten, ungefilterten
        // Datensatz) - Ziel-Filterung und Ketten-Bildung passieren komplett
        // clientseitig in findeBesteRoutenProFahrzeug aus EINEM Scan.
        const cacheKey = marktCacheSchluessel(bodyType);
        const cacheEintrag = marktScanCache.get(cacheKey);
        const cacheIstFrisch = cacheEintrag && (Date.now() - cacheEintrag.zeitstempel) < MARKT_CACHE_TTL_MS;

        let marktErgebnis;
        let ausCache = false;
        if (cacheIstFrisch && !erzwingeNeuladen) {
          marktErgebnis = cacheEintrag;
          ausCache = true;
        } else {
          marktErgebnis = await fetchAllOffersForBodyType(bodyType, 20, status => { resultsEl.innerHTML = `<div class="fi-empty">${status}</div>`; });
          marktScanCache.set(cacheKey, { ...marktErgebnis, zeitstempel: Date.now() });
        }

        const fleetRoh = await fetchFleetStatus();
        const { angebote, gescannteSeiten, gesamtSeiten } = marktErgebnis;
        const kategorieLabel = options.find(o => o.value === bodyType)?.label ?? bodyType;

        const [fleetMitLive, detailsMap] = await Promise.all([
          Promise.all(fleetRoh.map(async f => ({ ...f, live: f.status?.vehicleId ? await fetchLiveDriverStatus(f.status.vehicleId) : null }))),
          fetchFuhrparkDetails(),
        ]);
        const fleet = fleetMitLive.map(f => {
          const details = f.status?.vehicleId ? detailsMap.get(String(f.status.vehicleId)) : null;
          return {
            ...f,
            typ: normalisiereFahrzeugtyp(details?.typ) || kategorieLabel,
            stellplaetze: details?.stellplaetze ?? holeFahrzeugSpezifikation(details?.typ || kategorieLabel).stellplaetzeGesamt ?? null,
          };
        });

        // WICHTIG: passende bleibt bewusst UNGEFILTERT nach Zielort - die
        // Ketten-Suche braucht genau diese Breite, um Zwischenetappen zu
        // finden. Die eigentliche Ziel-Filterung für Direkt-Routen und
        // Bündel passiert jetzt INNERHALB findeBesteRoutenProFahrzeug.
        const passende = filtereNachAufbau(angebote, kategorieLabel);
        const kompatibleFleet = fleet.filter(f => f.typ === kategorieLabel);
        const inkompatibleFleet = fleet.filter(f => f.typ !== kategorieLabel);

        let infoHtml = '';
        if (ausCache) {
          const minutenAlt = Math.round((Date.now() - cacheEintrag.zeitstempel) / 60000);
          infoHtml += `<div class="fi-dash-row fi-muted">💾 Aus Cache (vor ${minutenAlt} Min. geladen)</div>`;
        }
        infoHtml += `<div class="fi-dash-row">${passende.length} passende Angebote · ${gescannteSeiten}${gesamtSeiten && gesamtSeiten > gescannteSeiten ? `/${gesamtSeiten}` : ''} Seiten à 100 gescannt</div>`;
        if (rueckfrachtFilter.zielStadt) {
          const zielTreffer = filtereNachZielstadt(passende, rueckfrachtFilter.zielStadt, rueckfrachtFilter.zielRadiusKm ?? 0).length;
          infoHtml += `<div class="fi-dash-row ${zielTreffer === 0 ? 'fi-warn' : 'fi-muted'}">🎯 davon ${zielTreffer} mit Ziel "${rueckfrachtFilter.zielStadt}"${rueckfrachtFilter.zielRadiusKm > 0 ? ` (±${rueckfrachtFilter.zielRadiusKm}km Umkreis)` : ' (exakt)'}</div>`;
        }
        if (!FAHRZEUG_SPEZIFIKATIONEN[kategorieLabel]) {
          infoHtml += `<div class="fi-dash-row fi-warn">⚠ Für "${kategorieLabel}" noch keine echten Verbrauchsdaten - Kostenschätzung nutzt Platzhalter.</div>`;
        }
        if (inkompatibleFleet.length) {
          console.log(`[FI-Helper] ${inkompatibleFleet.length} Fahrzeug(e) übersprungen (anderer Typ): ${inkompatibleFleet.map(f => f.name).join(', ')}`);
        }

        let html = `<div class="fi-dash-card" style="grid-column: 1 / -1;">${infoHtml}</div>`;

        if (!passende.length) {
          html += '<div class="fi-empty">Keine passenden Angebote gefunden.</div>';
        } else if (!kompatibleFleet.length) {
          html += '<div class="fi-empty">Kein Fahrzeug mit passendem Typ für diese Kategorie gefunden.</div>';
        } else {
          const besteProFahrzeugRoh = findeBesteRoutenProFahrzeug(passende, kompatibleFleet, rueckfrachtFilter.zielStadt || null, rueckfrachtFilter.zielRadiusKm ?? 0);
          const besteProFahrzeug = loeseFahrzeugKonflikte(besteProFahrzeugRoh);
          besteProFahrzeug.forEach(eintrag => {
            const titel = eintrag.vehicleId
              ? `<a href="/game/dispatch.php?vehicle_id=${encodeURIComponent(eintrag.vehicleId)}">🚐 ${eintrag.fahrzeugName}</a>`
              : `🚐 ${eintrag.fahrzeugName}`;
            html += `<div class="fi-dash-card"><div class="fi-dash-card-title">${titel}</div>`;
            if (!eintrag.beste) {
              html += `<div class="fi-dash-row fi-warn">Keine bewertbare Fracht (Stadt evtl. nicht in Koordinatentabelle).</div>`;
            } else {
              const { fracht, bewertung, istBundle, bundleFrachten, istKette, kette } = eintrag.beste;
              const schaffbarIcon = bewertung.schaffbar === true ? '✅' : bewertung.schaffbar === false ? '❌' : '❔';
              const schaffbarKlasse = bewertung.schaffbar === true ? 'fi-good' : bewertung.schaffbar === false ? 'fi-bad' : 'fi-warn';
              const schaffbarText = bewertung.schaffbar === true ? 'Frist einhaltbar' : bewertung.schaffbar === false ? 'Frist NICHT einhaltbar' : 'Frist unbekannt';

              if (eintrag.verdraengt) {
                html += `<div class="fi-dash-row fi-muted">↪ Eigentliche Top-Fracht ging an ein besser positioniertes Fahrzeug - das hier ist die beste noch freie Option.</div>`;
              }
              if (istBundle) {
                html += `<div class="fi-dash-row fi-loc">📦 <strong>Bündel: ${bundleFrachten.length} Teilladungen</strong> (${fracht.stellplaetzeBenoetigt} Stpl.)</div>`;
              }
              if (istKette) {
                html += `<div class="fi-dash-row fi-loc">🔗 <strong>Kette über ${kette.zwischenstadt}</strong> (2 Etappen)</div>`;
              }
              html += `<div class="fi-dash-row"><strong>${fracht.startOrt} → ${fracht.zielOrt}</strong> (${fracht.entfernungKm ?? '?'} km)</div>`;
              html += `<div class="fi-dash-row fi-muted">${istBundle ? `${bundleFrachten.length} Aufträge` : istKette ? '2 Etappen' : fracht.frachtName} · ${fmtEuro(fracht.verguetungEuro ?? 0)}${istBundle || istKette ? ' gesamt' : ''}</div>`;
              if (istBundle) {
                bundleFrachten.forEach(f => {
                  html += `<div class="fi-dash-bundle-item">↳ ${f.frachtName} · ${f.stellplaetzeBenoetigt} Stpl. · ${fmtEuro(f.verguetungEuro ?? 0)}</div>`;
                });
              }
              if (istKette) {
                html += `<div class="fi-dash-bundle-item">↳ Etappe 1: ${kette.etappe1.startOrt} → ${kette.etappe1.zielOrt} · ${kette.etappe1.entfernungKm} km · ${fmtEuro(kette.etappe1.verguetungEuro ?? 0)}${bewertung.zwischenankunft ? ' · Ankunft dort: ' + bewertung.zwischenankunft.toLocaleString('de-DE') : ''}${bewertung.etappe1Schaffbar === false ? ' ❌ Frist verpasst' : ''}</div>`;
                html += `<div class="fi-dash-bundle-item">↳ Etappe 2: ${kette.etappe2.startOrt} → ${kette.etappe2.zielOrt} · ${kette.etappe2.entfernungKm} km · ${fmtEuro(kette.etappe2.verguetungEuro ?? 0)}${bewertung.etappe2Schaffbar === false ? ' ❌ Frist verpasst' : ''}</div>`;
              }
              html += `<div class="fi-dash-row ${bewertung.anfahrtAnteilProzent > 40 ? 'fi-warn' : 'fi-loc'}">🚫 Leerfahrt: ~${Math.round(bewertung.anfahrtKm)} km${bewertung.anfahrtAnteilProzent != null ? ` (${bewertung.anfahrtAnteilProzent}% der Gesamtstrecke)` : ''}${bewertung.kostenAnfahrt != null ? ` · ${fmtEuro(bewertung.kostenAnfahrt)} Kosten` : ''}</div>`;
              if (bewertung.umwegProzent != null) {
                html += `<div class="fi-dash-row ${bewertung.umwegProzent > 50 ? 'fi-warn' : 'fi-muted'}">🧭 Umweg: ${bewertung.umwegProzent > 0 ? '+' : ''}${bewertung.umwegProzent}%${bewertung.umwegProzent > 150 ? ' – sehr großer Umweg, nur mangels besserer Alternative gewählt!' : ''}</div>`;
              }
              if (bewertung.kapazitaetHinweis) html += `<div class="fi-dash-row fi-warn">📦 ${bewertung.kapazitaetHinweis}</div>`;
              html += `<div class="fi-dash-row fi-muted">🕐 Ankunft: ${bewertung.ankunftZeit.toLocaleString('de-DE')}</div>`;
              html += `<div class="fi-dash-row ${schaffbarKlasse}">${schaffbarIcon} ${schaffbarText}</div>`;
              if (bewertung.lenkzeitHinweis) html += `<div class="fi-dash-row fi-warn">⏱ ${bewertung.lenkzeitHinweis}</div>`;
              if (!bewertung.einplanbar) html += `<div class="fi-dash-row fi-warn">⏳ ${bewertung.einplanbarHinweis}</div>`;
              html += `<div class="fi-dash-row"><strong>${bewertung.effektivProKm !== null ? bewertung.effektivProKm.toFixed(2) + ' €/km effektiv' : '—'}</strong></div>`;

              if (istBundle) {
                bundleFrachten.forEach(f => {
                  html += `<button type="button" class="fi-dash-accept-btn fi-accept-only-btn" data-job-id="${f.jobId}" data-route="${f.startOrt} → ${f.zielOrt}">✅ ${f.frachtName} annehmen</button>`;
                });
              } else if (istKette) {
                html += `<div class="fi-dash-row fi-muted" style="font-size:11px;">ℹ Beide Etappen einzeln annehmen, dann nacheinander einplanen (automatisches Verketten unterstütze ich noch nicht):</div>`;
                html += `<button type="button" class="fi-dash-accept-btn fi-accept-only-btn" data-job-id="${kette.etappe1.jobId}" data-route="${kette.etappe1.startOrt} → ${kette.etappe1.zielOrt}">✅ Etappe 1 annehmen</button>`;
                html += `<button type="button" class="fi-dash-accept-btn fi-accept-only-btn" data-job-id="${kette.etappe2.jobId}" data-route="${kette.etappe2.startOrt} → ${kette.etappe2.zielOrt}">✅ Etappe 2 annehmen</button>`;
              } else if (!bewertung.einplanbar && fracht.jobId) {
                html += `<button type="button" class="fi-dash-accept-btn fi-accept-only-btn" data-job-id="${fracht.jobId}" data-route="${fracht.startOrt} → ${fracht.zielOrt}">✅ Nur annehmen</button>`;
              } else if (fracht.jobId && eintrag.vehicleId && eintrag.freiAbZeit) {
                html += `<button type="button" class="fi-dash-accept-btn fi-accept-btn"
                  data-job-id="${fracht.jobId}" data-vehicle-id="${eintrag.vehicleId}"
                  data-frei-ab="${eintrag.freiAbZeit.toISOString()}"
                  data-route="${fracht.startOrt} → ${fracht.zielOrt}" data-fahrzeug="${eintrag.fahrzeugName}"
                >✅ Annehmen &amp; einplanen</button>`;
              }
            }
            html += `</div>`;
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
      }
    }

    loadBtn.addEventListener('click', () => routenBerechnen(false));
    reloadBtn.addEventListener('click', () => routenBerechnen(true));
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
        const { jobId, vehicleId, freiAb, route, fahrzeug } = btn.dataset;
        const bestaetigt = window.confirm(
          `Fracht ${route} für ${fahrzeug} annehmen und einplanen?\n\n` +
          `Das ist verbindlich - bei Nichtlieferung droht die Vertragsstrafe.`
        );
        if (!bestaetigt) return;
        btn.disabled = true;
        const original = btn.textContent;
        btn.textContent = 'Wird eingeplant …';
        try {
          await nimmFrachtAnUndPlaneEin(jobId, vehicleId, new Date(freiAb));
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

    container.querySelectorAll('.fi-accept-only-btn').forEach(btn => {
      if (btn.dataset.fiWired) return;
      btn.dataset.fiWired = '1';
      btn.addEventListener('click', async () => {
        const { jobId, route } = btn.dataset;
        const bestaetigt = window.confirm(`Fracht ${route} annehmen?\n\nDas ist verbindlich - bei Nichtlieferung droht die Vertragsstrafe.`);
        if (!bestaetigt) return;
        btn.disabled = true;
        const original = btn.textContent;
        btn.textContent = 'Wird angenommen …';
        try {
          await nimmFrachtNurAn(jobId);
          btn.textContent = '✅ Angenommen';
          btn.style.background = '#2f6f3f';
          btn.style.color = '#fff';
        } catch (e) {
          console.error('[FI-Helper] Annehmen fehlgeschlagen', e);
          btn.textContent = original;
          btn.disabled = false;
          window.alert(`Fehler: ${e.message}`);
        }
      });
    });
  }


  /**
   * Baut die Frachtbörsen-UI (Kategorie-Auswahl + Scan-Button + Ergebnisse).
   * Wird bei jedem Update-Tick aufgerufen, baut die UI aber nur EINMAL auf -
   * danach wird nur noch der Kopfbereich (Kontostand/Statistik) aktualisiert,
   * damit ein laufender Scan oder vorhandene Ergebnisse nicht überschrieben werden.
   */
  function renderFreightMarketPanel(contentEl, headerHtml) {
    const bestehenderHeader = contentEl.querySelector('#fi-fm-header');
    if (bestehenderHeader) {
      bestehenderHeader.innerHTML = headerHtml;
      return;
    }

    contentEl.innerHTML = `
      <div id="fi-fm-header">${headerHtml}</div>
      <hr class="fi-divider">
      <div class="fi-section-title">Fahrzeugkategorie</div>
      <select id="fi-fm-bodytype" class="fi-select"></select>
      <label style="display:flex; align-items:center; gap:8px; font-size:12px; margin-bottom:10px; cursor:pointer;">
        <input type="checkbox" id="fi-fm-only-return">
        Nur Rückfracht nach <input type="text" id="fi-fm-return-city" value="Berlin" class="fi-select" style="width:110px; padding:4px 8px; margin:0; display:inline-block;">
      </label>
      <div style="display:flex; gap:8px;">
        <button type="button" id="fi-fm-load-btn" class="fi-btn-primary" style="flex:1;">Beste Routen berechnen</button>
        <button type="button" id="fi-fm-reload-btn" class="fi-btn-primary" title="Cache umgehen und Frachtbörse frisch laden" style="width:40px; flex:none; padding:9px 0;">🔄</button>
      </div>
      <div id="fi-fm-results"></div>
    `;

    const select = contentEl.querySelector('#fi-fm-bodytype');
    const options = parseBodyTypeOptions(document); // Filter-Formular ist live auf dieser Seite vorhanden
    options.forEach(opt => {
      const el = document.createElement('option');
      el.value = opt.value;
      el.textContent = opt.label;
      select.appendChild(el);
    });

    let lastChoice = null;
    try { lastChoice = window.sessionStorage.getItem('fi_last_bodytype'); } catch (e) {}
    if (lastChoice && options.some(o => o.value === lastChoice)) {
      select.value = lastChoice;
    }
    select.addEventListener('change', () => {
      try { window.sessionStorage.setItem('fi_last_bodytype', select.value); } catch (e) {}
    });

    const button = contentEl.querySelector('#fi-fm-load-btn');
    const reloadButton = contentEl.querySelector('#fi-fm-reload-btn');
    const resultsEl = contentEl.querySelector('#fi-fm-results');
    const onlyReturnCheckbox = contentEl.querySelector('#fi-fm-only-return');
    const returnCityInput = contentEl.querySelector('#fi-fm-return-city');

    async function routenBerechnen(erzwingeNeuladen) {
      const bodyType = select.value;
      if (!bodyType) {
        resultsEl.innerHTML = '<em style="color:#ff9a6b;">Bitte zuerst eine Kategorie wählen.</em>';
        return;
      }
      const rueckfrachtFilter = onlyReturnCheckbox.checked && returnCityInput.value.trim()
        ? { zielStadt: returnCityInput.value.trim(), zielRadiusKm: 0 }
        : {};

      button.disabled = true;
      reloadButton.disabled = true;
      const originalText = button.textContent;
      button.textContent = 'Lade …';
      resultsEl.innerHTML = '<div class="fi-empty">Starte Scan …</div>';

      try {
        const cacheKey = marktCacheSchluessel(bodyType, rueckfrachtFilter);
        const cacheEintrag = marktScanCache.get(cacheKey);
        const cacheIstFrisch = cacheEintrag && (Date.now() - cacheEintrag.zeitstempel) < MARKT_CACHE_TTL_MS;

        let marktErgebnis;
        let ausCache = false;
        if (cacheIstFrisch && !erzwingeNeuladen) {
          marktErgebnis = cacheEintrag;
          ausCache = true;
        } else {
          marktErgebnis = await fetchAllOffersForBodyType(bodyType, 20, status => { resultsEl.innerHTML = `<div class="fi-empty">${status}</div>`; }, rueckfrachtFilter);
          marktScanCache.set(cacheKey, { ...marktErgebnis, zeitstempel: Date.now() });
        }

        const fleetRoh = await fetchFleetStatus();
        const { angebote, gescannteSeiten, gesamtSeiten } = marktErgebnis;
        const kategorieLabel = options.find(o => o.value === bodyType)?.label ?? bodyType;

        // Live-Lenkzeit + echten Fahrzeugtyp/Stellplätze pro Fahrzeug nachladen
        resultsEl.innerHTML = '<div class="fi-empty">Lade Lenkzeit-Status & Fahrzeugdetails …</div>';
        const [fleetMitLive, detailsMap] = await Promise.all([
          Promise.all(fleetRoh.map(async f => ({
            ...f,
            live: f.status?.vehicleId ? await fetchLiveDriverStatus(f.status.vehicleId) : null,
          }))),
          fetchFuhrparkDetails(),
        ]);
        const fleet = fleetMitLive.map(f => {
          const details = f.status?.vehicleId ? detailsMap.get(String(f.status.vehicleId)) : null;
          return {
            ...f,
            // Echten Typ aus dem Fuhrpark nehmen, falls bekannt - sonst Fallback auf die
            // gerade durchsuchte Kategorie (Annahme: passt meistens bei homogener Flotte).
            typ: normalisiereFahrzeugtyp(details?.typ) || kategorieLabel,
            // Echte AKTUELLE Stellplatzzahl (berücksichtigt angekoppelten Anhänger) -
            // sonst Fallback auf den statischen Tabellenwert des Fahrzeugtyps.
            stellplaetze: details?.stellplaetze ?? holeFahrzeugSpezifikation(details?.typ || kategorieLabel).stellplaetzeGesamt ?? null,
          };
        });

        const passende = filtereNachAufbau(angebote, kategorieLabel);

        // Nur Fahrzeuge auswerten, die zur gesuchten Kategorie passen - ein
        // Kleintransporter kann keine "Tautliner / Plane"-Fracht laden und
        // sollte hier gar nicht erst als Kandidat auftauchen (vorher wurde er
        // nur zufällig über den Stellplatz-Check von 0 rausgefiltert, mit
        // einer irreführenden "keine bewertbare Fracht"-Meldung).
        const kompatibleFleet = fleet.filter(f => f.typ === kategorieLabel);
        const inkompatibleFleet = fleet.filter(f => f.typ !== kategorieLabel);

        let html = `<hr class="fi-divider">`;
        if (ausCache) {
          const minutenAlt = Math.round((Date.now() - cacheEintrag.zeitstempel) / 60000);
          html += `<div class="fi-card-row fi-muted" style="margin-bottom:6px; font-size:10.5px;">💾 Aus Cache (vor ${minutenAlt} Min. geladen) - 🔄 zum Erzwingen eines frischen Scans</div>`;
        }
        if (rueckfrachtFilter.zielStadt) {
          html += `<div class="fi-card-row fi-loc" style="margin-bottom:6px;">🎯 Nur Fracht mit Ziel <strong>${rueckfrachtFilter.zielStadt}</strong></div>`;
        }
        html += `<div class="fi-stats-row">
          <span>${passende.length} passende Angebote</span>
          <span>· ${gescannteSeiten}${gesamtSeiten && gesamtSeiten > gescannteSeiten ? `/${gesamtSeiten}` : ''} Seiten à 100 gescannt</span>
        </div>`;
        if (gesamtSeiten && gesamtSeiten > gescannteSeiten) {
          html += `<div class="fi-card-row fi-warn" style="margin-bottom:8px;">⚠ Seitenlimit erreicht – sortiert nach €/km, beste Angebote sollten vorne dabei sein.</div>`;
        }
        if (!FAHRZEUG_SPEZIFIKATIONEN[kategorieLabel]) {
          html += `<div class="fi-card-row fi-warn" style="margin-bottom:8px;">⚠ Für "${kategorieLabel}" hab ich noch keine echten Verbrauchsdaten (Tank/L pro 100km) - die Kostenschätzung nutzt einen groben, unverifizierten Platzhalter.</div>`;
        }
        if (inkompatibleFleet.length) {
          html += `<div class="fi-card-row fi-muted" style="margin-bottom:8px; font-size:10.5px;">ℹ ${inkompatibleFleet.length} Fahrzeug(e) übersprungen (anderer Typ als "${kategorieLabel}"): ${inkompatibleFleet.map(f => `${f.name} (${f.typ || 'unbekannt'})`).join(', ')}</div>`;
        }

        if (!passende.length) {
          html += '<div class="fi-empty">Keine passenden Angebote gefunden.</div>';
        } else if (!kompatibleFleet.length) {
          html += '<div class="fi-empty">Kein Fahrzeug mit passendem Typ für diese Kategorie gefunden.</div>';
        } else {
          const besteProFahrzeug = findeBesteRoutenProFahrzeug(passende, kompatibleFleet, rueckfrachtFilter.zielStadt || null);
          besteProFahrzeug.forEach(eintrag => {
            const titelInhalt = eintrag.vehicleId
              ? `<a href="/game/dispatch.php?vehicle_id=${encodeURIComponent(eintrag.vehicleId)}" style="color:inherit; text-decoration:none;">🚐 ${eintrag.fahrzeugName}</a>`
              : `🚐 ${eintrag.fahrzeugName}`;
            html += `<div class="fi-card"><div class="fi-card-title">${titelInhalt}</div>`;
            if (!eintrag.beste) {
              html += `<div class="fi-card-row fi-warn">Keine bewertbare Fracht (Stadt evtl. nicht in Koordinatentabelle oder Fahrzeugstandort unbekannt).</div>`;
            } else {
              const { fracht, bewertung, istBundle, bundleFrachten } = eintrag.beste;
              const schaffbarIcon = bewertung.schaffbar === true ? '✅' : bewertung.schaffbar === false ? '❌' : '❔';
              const schaffbarKlasse = bewertung.schaffbar === true ? 'fi-good' : bewertung.schaffbar === false ? 'fi-bad' : 'fi-warn';
              const schaffbarText = bewertung.schaffbar === true ? 'Frist einhaltbar' : bewertung.schaffbar === false ? 'Frist NICHT einhaltbar' : 'Frist unbekannt/nicht erkannt';

              if (istBundle) {
                html += `<div class="fi-card-row fi-loc">📦 <strong>Bündel: ${bundleFrachten.length} Teilladungen kombiniert</strong> (${fracht.stellplaetzeBenoetigt} Stellplätze gesamt)</div>`;
              }
              html += `
                <div class="fi-card-row"><strong>${fracht.startOrt} → ${fracht.zielOrt}</strong> (${fracht.entfernungKm ?? '?'} km Fracht)</div>
                <div class="fi-card-row fi-muted">${istBundle ? `${bundleFrachten.length} Aufträge kombiniert` : fracht.frachtName} · ${fmtEuro(fracht.verguetungEuro ?? 0)}${istBundle ? ' gesamt' : ''}</div>`;

              if (istBundle) {
                bundleFrachten.forEach(f => {
                  html += `<div class="fi-card-row fi-muted" style="padding-left:8px; font-size:10.5px;">↳ ${f.frachtName} · ${f.stellplaetzeBenoetigt} Stpl. · ${fmtEuro(f.verguetungEuro ?? 0)}${f.lieferfrist ? ' · Frist: ' + f.lieferfrist.toLocaleString('de-DE') : ''}</div>`;
                });
              }

              html += `
                <div class="fi-card-row fi-loc">📍 Anfahrt ~${Math.round(bewertung.anfahrtKm)} km (geschätzt)</div>
                ${bewertung.umwegProzent != null ? `<div class="fi-card-row ${bewertung.umwegProzent > 50 ? 'fi-warn' : 'fi-muted'}">🧭 Umweg ggü. Direktstrecke: ${bewertung.umwegProzent > 0 ? '+' : ''}${bewertung.umwegProzent}%${bewertung.umwegProzent > 50 ? ' – spürbarer Umweg!' : ''}</div>` : ''}
                ${bewertung.kapazitaetHinweis ? `<div class="fi-card-row fi-warn">📦 ${bewertung.kapazitaetHinweis}</div>` : ''}
                <div class="fi-card-row fi-muted">🕐 Geschätzte Ankunft: ${bewertung.ankunftZeit.toLocaleString('de-DE')}</div>
                <div class="fi-card-row ${schaffbarKlasse}">${schaffbarIcon} ${schaffbarText}${fracht.lieferfrist ? ' · früheste Frist im Bündel: ' + fracht.lieferfrist.toLocaleString('de-DE') : ''}</div>
                ${bewertung.lenkzeitHinweis ? `<div class="fi-card-row fi-warn">⏱ ${bewertung.lenkzeitHinweis}</div>` : ''}
                ${bewertung.lenkzeitUngeprueft ? `<div class="fi-card-row fi-muted" style="font-size:10.5px;">ℹ Lenkzeit-Live-Status nicht verfügbar, nicht geprüft</div>` : ''}
                ${!bewertung.einplanbar ? `<div class="fi-card-row fi-warn">⏳ ${bewertung.einplanbarHinweis}</div>` : ''}
                ${!istBundle ? `<div class="fi-card-row fi-muted">${fracht.preisProKm ?? '?'} €/km roh</div>` : ''}
                <div class="fi-card-row"><strong>${bewertung.effektivProKm !== null ? bewertung.effektivProKm.toFixed(2) + ' €/km effektiv' : '—'}</strong></div>
              `;
              if (!eintrag.hatSchaffbareOption) {
                html += `<div class="fi-card-row fi-warn" style="font-size:10.5px;">⚠ Keine einzige schaffbare Fracht gefunden – das hier ist nur die beste unter den nicht schaffbaren.</div>`;
              }

              if (istBundle) {
                html += `<div class="fi-card-row fi-muted" style="font-size:10.5px; margin-top:4px;">ℹ Zum Kombinieren einzeln annehmen, dann im Tourenplaner zu einer Teilladungstour zusammenfassen (automatisches Einplanen unterstütze ich für Bündel noch nicht):</div>`;
                bundleFrachten.forEach(f => {
                  html += `<button type="button" class="fi-btn-primary fi-accept-only-btn" style="margin-top:6px; padding:6px 10px; font-size:11px;"
                    data-job-id="${f.jobId}" data-route="${f.startOrt} → ${f.zielOrt}"
                  >✅ ${f.frachtName} annehmen</button>`;
                });
              } else if (!bewertung.einplanbar && fracht.jobId) {
                // Planungsfenster (24h ohne Disponent) reicht noch nicht bis zur Startzeit -
                // nur annehmen, Einplanen muss später manuell erfolgen.
                html += `<button type="button" class="fi-btn-primary fi-accept-only-btn" style="margin-top:8px;"
                  data-job-id="${fracht.jobId}" data-route="${fracht.startOrt} → ${fracht.zielOrt}"
                >✅ Nur annehmen (später manuell einplanen)</button>`;
              } else if (fracht.jobId && eintrag.vehicleId && eintrag.freiAbZeit) {
                html += `<button type="button" class="fi-btn-primary fi-accept-btn" style="margin-top:8px;"
                  data-job-id="${fracht.jobId}" data-vehicle-id="${eintrag.vehicleId}"
                  data-frei-ab="${eintrag.freiAbZeit.toISOString()}"
                  data-route="${fracht.startOrt} → ${fracht.zielOrt}" data-fahrzeug="${eintrag.fahrzeugName}"
                >✅ Annehmen &amp; einplanen</button>`;
              }
            }
            html += `</div>`;
          });
        }

        resultsEl.innerHTML = html;

        resultsEl.querySelectorAll('.fi-accept-btn').forEach(btn => {
          btn.addEventListener('click', async () => {
            const { jobId, vehicleId, freiAb, route, fahrzeug } = btn.dataset;
            const bestaetigt = window.confirm(
              `Fracht ${route} für ${fahrzeug} annehmen und einplanen?\n\n` +
              `Das ist verbindlich - bei Nichtlieferung droht die Vertragsstrafe.`
            );
            if (!bestaetigt) return;

            btn.disabled = true;
            const original = btn.textContent;
            btn.textContent = 'Wird eingeplant …';
            try {
              await nimmFrachtAnUndPlaneEin(jobId, vehicleId, new Date(freiAb));
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

        resultsEl.querySelectorAll('.fi-accept-only-btn').forEach(btn => {
          btn.addEventListener('click', async () => {
            const { jobId, route } = btn.dataset;
            const bestaetigt = window.confirm(
              `Fracht ${route} annehmen?\n\n` +
              `Das ist verbindlich - bei Nichtlieferung droht die Vertragsstrafe. ` +
              `Danach im Tourenplaner mit den anderen Bündel-Aufträgen zu einer Teilladungstour kombinieren.`
            );
            if (!bestaetigt) return;

            btn.disabled = true;
            const original = btn.textContent;
            btn.textContent = 'Wird angenommen …';
            try {
              await nimmFrachtNurAn(jobId);
              btn.textContent = '✅ Angenommen';
              btn.style.background = '#2f6f3f';
              btn.style.color = '#fff';
            } catch (e) {
              console.error('[FI-Helper] Annehmen fehlgeschlagen', e);
              btn.textContent = original;
              btn.disabled = false;
              window.alert(`Fehler: ${e.message}`);
            }
          });
        });
      } catch (e) {
        console.error('[FI-Helper] Fehler beim Scan', e);
        resultsEl.innerHTML = `<div class="fi-card-row fi-bad">Fehler beim Laden: ${e.message}</div>`;
      } finally {
        button.disabled = false;
        reloadButton.disabled = false;
        button.textContent = originalText;
      }
    }

    button.addEventListener('click', () => routenBerechnen(false));
    reloadButton.addEventListener('click', () => routenBerechnen(true));
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

    const acceptRes = await fetch('/game/accept_freight_job.php', {
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
  async function nimmFrachtAnUndPlaneEin(jobId, vehicleId, freiAbZeit) {
    const acceptPayload = await nimmFrachtNurAn(jobId);

    // Manche Endpunkte liefern die neue Order-ID direkt mit - falls nicht,
    // versuchen wir sie aus dem frischen Auftragspool der Dispositionsseite zu lesen.
    let orderId = acceptPayload.order_id || acceptPayload.dispatch_order_id || acceptPayload.id || null;

    if (!orderId) {
      const dispatchRes = await fetch(`/game/dispatch.php?vehicle_id=${encodeURIComponent(vehicleId)}`, { credentials: 'same-origin', cache: 'no-store' });
      const dispatchHtml = await dispatchRes.text();
      const doc = safeParseHtml(dispatchHtml);
      const cards = Array.from(doc.querySelectorAll(SELECTORS.ordersPool));
      const erste = cards[0]; // Heuristik: erster/neuester Auftrag im Pool - NICHT 100% sicher!
      orderId = erste?.dataset?.orderId || null;
      console.log('[FI-Helper] Order-ID-Fallback über Auftragspool:', orderId, cards);
      if (!orderId) {
        throw new Error('Fracht wurde angenommen, aber keine Order-ID zum Einplanen gefunden - bitte manuell in der Disposition zuweisen.');
      }
    }

    const pad = n => String(n).padStart(2, '0');
    const startDatum = `${freiAbZeit.getFullYear()}-${pad(freiAbZeit.getMonth() + 1)}-${pad(freiAbZeit.getDate())}`;
    const startDatumZeit = `${startDatum}T${pad(freiAbZeit.getHours())}:${pad(freiAbZeit.getMinutes())}`;

    const planForm = new URLSearchParams();
    planForm.append('order_id', orderId);
    planForm.append('partial_tour_id', '');
    planForm.append('vehicle_id', String(vehicleId));
    planForm.append('planned_start_at', startDatumZeit);
    planForm.append('view_date', startDatum);

    const planRes = await fetch('/game/plan_dispatch_order.php', {
      method: 'POST',
      body: planForm,
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      redirect: 'manual',
    });

    console.log('[FI-Helper] plan_dispatch_order.php Antwort:', planRes.status, planRes.type);

    // redirect:'manual' liefert bei same-origin-Redirects oft status 0/opaqueredirect -
    // das ist bei diesem Endpunkt (der normalerweise redirected) ein ERWARTETER Erfolgsfall.
    if (!planRes.ok && planRes.type !== 'opaqueredirect' && planRes.status !== 0) {
      throw new Error(`Einplanen fehlgeschlagen (HTTP ${planRes.status}) - Fracht wurde aber schon angenommen! Bitte manuell in der Disposition einplanen.`);
    }

    return { orderId };
  }

  async function updateOverlay() {
    const contentEl = document.getElementById('fi-helper-content');
    if (!contentEl) return;

    const kontostand = parseKontostand();
    const stats = parseStatBadges();

    let html = '';

    if (kontostand) {
      html += `<div class="fi-pill ${kontostand.negativ ? 'is-negative' : 'is-positive'}">💰 ${kontostand.text}</div>`;
    }

    if (Object.keys(stats).length) {
      html += `<div class="fi-stats-row">${Object.entries(stats).map(([k, v]) => `<span>${k}: <strong>${v}</strong></span>`).join('')}</div>`;
    }

const onFreightMarket = /\/game\/freight-market\.php/.test(location.pathname);

    if (onFreightMarket) {
      renderFreightMarketPanel(contentEl, html);
      return; // eigene UI übernimmt ab hier, kein automatisches Nachrendern
    }

    html += `<hr class="fi-divider">`;
    const ladeMarker = '<div class="fi-empty">Lade Flotte …</div>';
    html += ladeMarker;
    contentEl.innerHTML = html; // Zwischenstand zeigen, während wir fetchen

    const [fleet, fuhrparkDetails] = await Promise.all([
      fetchFleetStatus(),
      fetchFuhrparkDetails(),
    ]);
    html = html.replace(ladeMarker, '');

    // Fahrzeuge, die im Fuhrpark existieren, aber (mangels Fahrer) NICHT in der
    // Disposition auftauchen, werden von uns sonst komplett übersehen - das war
    // der Grund für "mein neuer Solo-LKW wird nicht berücksichtigt".
    const dispatchVehicleIds = new Set(fleet.map(f => String(f.status?.vehicleId ?? '')));
    const fehlendeFahrzeuge = Array.from(fuhrparkDetails.entries())
      .filter(([vehicleId, details]) => !details.hatFahrer && !dispatchVehicleIds.has(String(vehicleId)));
    if (fehlendeFahrzeuge.length) {
      html += `<div class="fi-card" style="border-color: rgba(255,154,107,.4);">
        <div class="fi-card-title">⚠ ${fehlendeFahrzeuge.length} Fahrzeug(e) ohne Fahrer</div>
        <div class="fi-card-row fi-warn">Diese tauchen NICHT in der Disposition auf und werden hier nicht mit erfasst, bis ein Fahrer zugewiesen ist:</div>
        ${fehlendeFahrzeuge.map(([, d]) => `<div class="fi-card-row">🚐 ${d.typ || 'Unbekannter Typ'}</div>`).join('')}
        <div class="fi-card-row fi-muted" style="font-size:10.5px;">→ Fahrer in <a href="/game/fuhrpark.php" style="color:#ffd98a;">fuhrpark.php</a> zuweisen</div>
      </div>`;
    }

    if (!fleet.length) {
      html += '<div class="fi-empty">Flottendaten aktuell nicht abrufbar.</div>';
    }

    for (const entry of fleet) {
      let live = null;
      if (entry.status?.vehicleId) {
        live = await fetchLiveDriverStatus(entry.status.vehicleId);
      }
      html += renderVehicleBlock(entry.name, entry.status, live);
    }

    contentEl.innerHTML = html || '<div class="fi-empty">Keine Daten gefunden.</div>';
  }

  // ============================================================
  // 7. INIT
  // ============================================================
  // Der Helper läuft jetzt AUSSCHLIESSLICH als Cockpit auf active_tours.php -
  // auf allen anderen Seiten passiert bewusst NICHTS mehr (keine Sidebar,
  // kein Body-Platzhalter). Die Sidebar-Funktionen (buildOverlay,
  // updateOverlay, renderFreightMarketPanel, renderVehicleBlock) bleiben im
  // Code stehen, werden aber nirgends mehr aufgerufen - falls du sie später
  // doch mal zurückwillst, sag Bescheid, dann reaktivier ich sie oder räume
  // sie ganz raus.
  if (/\/game\/active_tours\.php/.test(location.pathname)) {
    injectZIndexOverrides(); // Basis-Styles (auch für's Dashboard) einmalig einspielen
    renderActiveToursDashboard().catch(e => console.error('[FI-Helper] Dashboard-Aufbau fehlgeschlagen:', e));
  }

})();
