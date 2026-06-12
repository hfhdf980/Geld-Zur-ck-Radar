// App State
let state = {
  campaigns: [], // Wird in DOMContentLoaded geladen
  filters: {
    search: "",
    category: "all",
    retailer: "all",
    sort: "default"
  },
  communityReports: [],
  monitorData: {} // Live-Daten vom Monitor-Service (campaignName -> {status, checkedAt, responseTimeMs})
};

/* ==========================================================================
   MONITOR SERVICE INTEGRATION
   ========================================================================== */
const MONITOR_API_URL = window.location.protocol === 'file:' 
  ? 'http://localhost:3000/api/limits' 
  : '/api/limits';
const MONITOR_POLL_INTERVAL_MS = 60 * 1000; // 60 Sekunden

// Mappt Campaign-IDs aus data.js auf Monitor-Namen
const MONITOR_CAMPAIGN_MAP = {
  'axe-duschgel':                       'Axe Fine Fragrance',
  'somat-excellence':                    'Somat',
  'cottonelle-feucht':                   'Cottonelle',
  'nivea-derma-control':                 'Nivea',
  'deli-reform-omega3':                  'Deli Reform',
  'cillit-bang-cillit-bang-expert-k':    'Cillit Bang',
  'calgon-calgon-4in1-wasseren':         'Calgon',
  'ben-s-original-ben-s-original-stree': "Ben's Original",
  'zott-zott-pure-joy-joghur':           'Zott',
  'purina-purina-gourmet-revel':         'Purina',
  'rockstar-mocktail':                   'Rockstar',
  'andros-andros-be-nuts':               'Andros',
  'whiskas-geld-zurueck':                'Whiskas'
};

/**
 * Ruft die Live-Daten vom Monitor-Service ab und speichert sie im State.
 * Re-rendert die Karten bei Änderungen.
 */
async function fetchMonitorData() {
  try {
    const response = await fetch(MONITOR_API_URL, { signal: AbortSignal.timeout(5000) });
    if (!response.ok) return;
    const data = await response.json();

    let changed = false;
    const newMonitorData = {};
    if (data && Array.isArray(data.campaigns)) {
      data.campaigns.forEach(c => {
        newMonitorData[c.name] = {
          status: c.status,
          checkedAt: c.checkedAt,
          responseTimeMs: c.responseTimeMs,
          error: c.error
        };
        // Prüfe ob sich ein Status geändert hat
        if (!state.monitorData[c.name] || state.monitorData[c.name].status !== c.status) {
          changed = true;
        }
      });
    }
    state.monitorData = newMonitorData;
    if (changed) {
      renderCampaigns();
    }
    // Stats-Karte immer aktualisieren (auch wenn sich nur Timestamps ändern)
    updateStats();
    // Aktualisiere Live-Badge Timestamps ohne Neurendern
    updateMonitorTimestamps();
  } catch (e) {
    // Kein Monitor-Service erreichbar – stille Ignorierung
  }
}

/**
 * Aktualisiert nur die Zeitstempel in bereits gerenderten Live-Badges.
 */
function updateMonitorTimestamps() {
  document.querySelectorAll('[data-monitor-time]').forEach(el => {
    const iso = el.getAttribute('data-monitor-time');
    if (iso) {
      el.textContent = formatRelativeTime(iso);
    }
  });
}

/**
 * Gibt eine lesbare relative Zeit zurück ("Vor 2 Min.", "Vor 1 Std.", etc.)
 */
function formatRelativeTime(isoString) {
  try {
    const diff = Math.floor((Date.now() - new Date(isoString).getTime()) / 1000);
    if (diff < 60) return 'Gerade eben';
    if (diff < 3600) return `Vor ${Math.floor(diff / 60)} Min.`;
    return `Vor ${Math.floor(diff / 3600)} Std.`;
  } catch {
    return '';
  }
}

/**
 * Gibt das HTML für das Live-Status-Badge zurück.
 * @param {string} campaignId - Die ID der Kampagne aus data.js
 * @returns {string} HTML-String
 */
function getLiveMonitorBadge(campaignId) {
  const monitorName = MONITOR_CAMPAIGN_MAP[campaignId];
  if (!monitorName) return ''; // Kein Monitoring für diese Aktion

  const data = state.monitorData[monitorName];

  // Service noch nicht geantwortet
  if (!data) {
    return `
      <div class="live-monitor-badge live-monitor-loading">
        <span class="live-dot live-dot-gray"></span>
        <span>Live-Status wird geladen…</span>
      </div>`;
  }

  let dotClass = 'live-dot-gray';
  let label = 'Unbekannt';
  let badgeClass = 'live-monitor-unknown';

  switch (data.status) {
    case 'open':
      dotClass = 'live-dot-green';
      label = '✓ Jetzt offen – Teilnahme möglich';
      badgeClass = 'live-monitor-open';
      break;
    case 'daily_limit_reached':
      dotClass = 'live-dot-red';
      label = '✕ Tageslimit heute erreicht';
      badgeClass = 'live-monitor-limit';
      break;
    case 'prestart':
      dotClass = 'live-dot-yellow';
      label = '⏳ Aktion noch nicht gestartet';
      badgeClass = 'live-monitor-prestart';
      break;
    case 'ended':
      dotClass = 'live-dot-gray';
      label = 'Aktion beendet';
      badgeClass = 'live-monitor-ended';
      break;
    case 'error':
      dotClass = 'live-dot-gray';
      label = 'Status nicht abrufbar';
      badgeClass = 'live-monitor-error';
      break;
    default:
      dotClass = 'live-dot-gray';
      label = 'Status unbekannt';
      badgeClass = 'live-monitor-unknown';
  }

  const timeStr = data.checkedAt ? formatRelativeTime(data.checkedAt) : '';

  return `
    <div class="live-monitor-badge ${badgeClass}">
      <span class="live-dot ${dotClass}"></span>
      <span class="live-monitor-label">${label}</span>
      ${timeStr ? `<span class="live-monitor-time" data-monitor-time="${data.checkedAt}">${timeStr}</span>` : ''}
    </div>`;
}

// Beliebte deutsche Händler für den Abgleich
const POPULAR_RETAILERS = [
  { id: "REWE", name: "REWE", type: "supermarket" },
  { id: "Edeka", name: "EDEKA", type: "supermarket" },
  { id: "Kaufland", name: "Kaufland", type: "supermarket" },
  { id: "dm-drogerie markt", name: "dm Drogerie", type: "drogerie" },
  { id: "Rossmann", name: "Rossmann", type: "drogerie" },
  { id: "Müller", name: "Müller", type: "drogerie" },
  { id: "Aldi", name: "Aldi (Nord/Süd)", type: "discounter" },
  { id: "Lidl", name: "Lidl", type: "discounter" }
];

// Standard-Meldungen für den Live-Ticker (Echtzeiteindruck)
const DEFAULT_REPORTS = [
  {
    id: 1,
    user: "SparFuchs94",
    productName: "Die Limo von Granini (1,0l PET oder Dose)",
    productId: "die-limo-granini",
    retailer: "REWE",
    status: "ok",
    text: "Kassenzettel am Vormittag hochgeladen. Bestätigung über 1,79 € Erstattung kam am nächsten Tag. Hat wunderbar geklappt! Das wöchentliche Limit von 7.078 Plätzen ist meist über die ganze Woche gut verfügbar.",
    timestamp: "Vor 12 Minuten"
  },
  {
    id: 2,
    user: "DrogerieQueen",
    productName: "Axe Fine Fragrance Body Wash gratis testen",
    productId: "axe-duschgel",
    retailer: "dm-drogerie markt",
    status: "danger",
    text: "Das tägliche Limit von 2.500 Plätzen war heute leider schon um 11:30 Uhr voll. Probiere es morgen früh direkt ab 08:00 Uhr wieder!",
    timestamp: "Vor 45 Minuten"
  },
  {
    id: 3,
    user: "SparHase",
    productName: "Deli Reform Omega-3 Daily (225g)",
    productId: "deli-reform-omega3",
    retailer: "EDEKA",
    status: "danger",
    text: "Das tägliche Limit von 100 Uploads für die Deli Reform Margarine war heute Morgen schon nach 5 Minuten komplett aufgebraucht! Bitte den Bon direkt um 08:00 Uhr hochladen.",
    timestamp: "Vor 2 Stunden"
  },
  {
    id: 4,
    user: "Sparguru",
    productName: "Somat Gel gratis testen",
    productId: "somat-excellence",
    retailer: "Kaufland",
    status: "danger",
    text: "Das tägliche Kontingent von 1.208 Teilnahmen bei Somat war heute um 14:00 Uhr leider komplett voll. Schade. Probiere es morgen früh direkt um 09:00 Uhr wieder!",
    timestamp: "Vor 3 Stunden"
  },
  {
    id: 5,
    user: "SchnaeppchenKönig",
    productName: "Air Wick, Calgon & Cillit Bang (3 € ab 10 € Einkauf)",
    productId: "airwick-calgon-cillit",
    retailer: "Rossmann",
    status: "ok",
    text: "Habe gestern meinen Kassenbon über 11,50 € hochgeladen (Air Wick & Calgon). Die 3 € Erstattung wurden nach wenigen Stunden per E-Mail bestätigt. Keine Probleme!",
    timestamp: "Vor 5 Stunden"
  },
  {
    id: 6,
    user: "NiveaFan",
    productName: "Nivea Deo Derma Control (Clinical)",
    productId: "nivea-derma-control",
    retailer: "Rossmann",
    status: "danger",
    text: "Habe versucht meinen Bon hochzuladen, aber das tägliche Limit von 4.000 Teilnahmen ist für heute bereits komplett erreicht.",
    timestamp: "Vor 1 Stunde"
  },
  {
    id: 7,
    user: "SauberMann",
    productName: "Cottonelle Feuchtes Toilettenpapier Ultimativ Frisch gratis testen",
    productId: "cottonelle-feucht",
    retailer: "dm-drogerie markt",
    status: "danger",
    text: "Das tägliche Limit von 604 Uploads für Cottonelle war heute leider schon um 08:25 Uhr voll. Man muss wirklich direkt um 08:00 Uhr morgens hochladen, um einen Platz zu bekommen!",
    timestamp: "Vor 15 Minuten"
  },
  {
    id: 8,
    user: "SchokoFuchs",
    productName: "Tony's Chocolonely 90g oder 180g Tafel",
    productId: "tony-s-chocolonely-tony-s-chocolonely-9",
    retailer: "REWE",
    status: "danger",
    text: "Das wöchentliche Limit von 1.300 Plätzen für Tony's Schokolade ist für diese Woche leider bereits komplett voll. Nächste Woche ab Montag 09:00 Uhr wieder!",
    timestamp: "Vor 10 Minuten"
  }
];

/* ==========================================================================
   INITIALISIERUNG & EVENT LISTENERS
   ========================================================================== */
document.addEventListener("DOMContentLoaded", () => {
  try {
    if (window.CAMPAIGNS) {
      state.campaigns = JSON.parse(JSON.stringify(window.CAMPAIGNS));
    } else {
      throw new Error("Fehler: Aktionen konnten nicht geladen werden (data.js fehlt oder ist fehlerhaft).");
    }
    initCommunityReports();
    initFormSelects();
    setupEventListeners();
    renderApp();
    
    // Simuliere Live-Traffic, um den Prototypen zum Leben zu erwecken (WOW-Effekt)
    startLiveTrafficSimulation();

    // Monitor-Service Live-Daten laden und alle 60s aktualisieren
    fetchMonitorData();
    setInterval(fetchMonitorData, MONITOR_POLL_INTERVAL_MS);
    // Timestamps jede Minute frisch rendern
    setInterval(updateMonitorTimestamps, 60 * 1000);
  } catch (e) {
    document.body.insertAdjacentHTML('afterbegin', '<div style="background:red;color:white;padding:20px;z-index:99999;position:fixed;top:0;left:0;width:100%;">' + e.toString() + '</div>');
  }
});

// Initialisiert die Community-Meldungen (aus LocalStorage oder Default-Werten)
function initCommunityReports() {
  const saved = localStorage.getItem("gratis_testen_reports_v2.3");
  let parsed = null;
  try { parsed = saved ? JSON.parse(saved) : null; } catch(e) {}
  
  // Falls das LocalStorage veraltete Aktionen enthält, überschreiben wir es mit den neuen Defaults
  const hasInvalidProduct = parsed && parsed.some(r => !state.campaigns.some(c => c.id === r.productId));
  
  if (parsed && !hasInvalidProduct) {
    state.communityReports = parsed;
  } else {
    state.communityReports = [...DEFAULT_REPORTS];
    localStorage.setItem("gratis_testen_reports_v2.3", JSON.stringify(state.communityReports));
  }
}

// Füllt die Auswahllisten im Community-Formular dynamisch
function initFormSelects() {
  const productSelect = document.getElementById("report-product");
  productSelect.innerHTML = "";
  const now = new Date();
  
  state.campaigns.forEach(c => {
    const isExpired = new Date(c.deadline) < now;
    if (isExpired) return;
    
    const opt = document.createElement("option");
    opt.value = c.id;
    opt.textContent = c.name;
    productSelect.appendChild(opt);
  });
}

// Registriert alle UI-Event-Listeners
function setupEventListeners() {
  // Suche
  document.getElementById("search-input").addEventListener("input", (e) => {
    state.filters.search = e.target.value;
    renderApp();
  });
  
  // Kategorie-Dropdown
  document.getElementById("filter-category").addEventListener("change", (e) => {
    state.filters.category = e.target.value;
    updateCategoryChips(e.target.value);
    renderApp();
  });
  
  // Händler-Dropdown (Direkter Händlerabgleich - User Request)
  document.getElementById("filter-retailer").addEventListener("change", (e) => {
    state.filters.retailer = e.target.value;
    renderApp();
  });
  
  // Sortierung
  document.getElementById("sort-select").addEventListener("change", (e) => {
    state.filters.sort = e.target.value;
    renderApp();
  });
  
  // Kategorie-Chips (Klickbare Filter-Schaltflächen)
  document.querySelectorAll(".category-chips .chip").forEach(chip => {
    chip.addEventListener("click", () => {
      document.querySelectorAll(".category-chips .chip").forEach(c => c.classList.remove("active"));
      chip.classList.add("active");
      
      const cat = chip.dataset.category;
      state.filters.category = cat;
      document.getElementById("filter-category").value = cat;
      renderApp();
    });
  });
  
  // Community-Formular Absenden
  document.getElementById("report-form").addEventListener("submit", handleReportSubmit);
  
  // Modal Schließen
  document.getElementById("modal-close").addEventListener("click", closeModal);
  document.getElementById("detail-modal").addEventListener("click", (e) => {
    if (e.target === document.getElementById("detail-modal")) {
      closeModal();
    }
  });
  
  // ESC Taste schließt Modal
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeModal();
  });
}

// Passt die aktiven Chips an, wenn das Dropdown geändert wird
function updateCategoryChips(activeCategory) {
  document.querySelectorAll(".category-chips .chip").forEach(chip => {
    if (chip.dataset.category === activeCategory) {
      chip.classList.add("active");
    } else {
      chip.classList.remove("active");
    }
  });
}

/* ==========================================================================
   APP-RENDERING LOGIK
   ========================================================================== */
function renderApp() {
  updateStats();
  renderCampaigns();
  renderReportsFeed();
}

// Berechnet und aktualisiert die Dashboard-Statistiken
function updateStats() {
  const now = new Date();

  const activeCount = state.campaigns.filter(c => {
    const isExpired = new Date(c.deadline) < now;
    const isUpcoming = c.startDate && new Date(c.startDate) > now;
    return !isExpired && !isUpcoming;
  }).length;

  const totalPotential = state.campaigns
    .filter(c => {
      const isExpired = new Date(c.deadline) < now;
      const isUpcoming = c.startDate && new Date(c.startDate) > now;
      return !isExpired && !isUpcoming;
    })
    .reduce((sum, c) => sum + c.cashbackVal, 0);

  // Tageslimit-Zähler: Live aus dem Monitor-Service
  // Zähle alle aktiven Kampagnen, für die der Monitor "daily_limit_reached" meldet
  const monitorDailyReached = Object.values(state.monitorData)
    .filter(d => d.status === 'daily_limit_reached').length;

  // Fallback auf Community-Reports wenn Monitor noch keine Daten hat
  const communityDailyReached = state.campaigns.filter(c => {
    const isExpired = new Date(c.deadline) < now;
    const isUpcoming = c.startDate && new Date(c.startDate) > now;
    return !isExpired && !isUpcoming &&
      (c.limitType === "daily" || c.limitType === "weekly") &&
      state.communityReports.some(r => r.productId === c.id && r.status === "danger");
  }).length;

  const dailyReachedCount = monitorDailyReached > 0 ? monitorDailyReached : communityDailyReached;

  // Gesamtlimit erreicht: abgelaufene Aktionen + komplett erschöpfte (total)
  const totalReachedCount = state.campaigns.filter(c => {
    const isExpired = new Date(c.deadline) < now;
    const isUpcoming = c.startDate && new Date(c.startDate) > now;
    const monitorEntry = state.monitorData[MONITOR_CAMPAIGN_MAP[c.id]];
    const isMonitorEnded = monitorEntry && monitorEntry.status === 'ended';
    const isTotalFull = state.communityReports.some(r =>
      r.productId === c.id && r.status === "danger" && c.limitType === "total"
    );
    return (isExpired && !isUpcoming) || (isTotalFull && !isUpcoming) || (isMonitorEnded && !isUpcoming);
  }).length;

  // DOM-Befüllung
  document.getElementById("val-active").textContent = activeCount;
  document.getElementById("val-potential").textContent = totalPotential.toFixed(2);

  const dailyReachedEl = document.getElementById("val-daily-reached");
  if (dailyReachedEl) dailyReachedEl.textContent = dailyReachedCount;

  const totalReachedEl = document.getElementById("val-total-reached");
  if (totalReachedEl) totalReachedEl.textContent = totalReachedCount;
}


// Filtert, sortiert und rendert das Aktions-Grid
function renderCampaigns() {
  const grid = document.getElementById("campaign-grid");
  grid.innerHTML = "";
  const now = new Date();
  
  // 1. Filtern
  let filtered = state.campaigns.filter(c => {
    // Exclude expired campaigns automatically (User Request)
    const isExpired = new Date(c.deadline) < now;
    if (isExpired) return false;
    
    // Suche
    const searchMatch = 
      c.name.toLowerCase().includes(state.filters.search.toLowerCase()) ||
      c.brand.toLowerCase().includes(state.filters.search.toLowerCase());
      
    // Kategorie
    const catMatch = state.filters.category === "all" || c.category === state.filters.category;
    
    // Händler (Core-Feature für User-Abgleich)
    let retailerMatch = true;
    if (state.filters.retailer !== "all") {
      const selected = state.filters.retailer;
      // Überprüfe Händlerausschluss
      const isExcluded = c.excludedRetailers.some(r => 
        r.toLowerCase().includes(selected.toLowerCase()) || 
        (selected === "Aldi" && r.toLowerCase().includes("aldi"))
      );
      
      const isAllRetailersAllowed = c.allowedRetailers.length === 0;
      
      const isAllowed = isAllRetailersAllowed || c.allowedRetailers.some(r => 
        r.toLowerCase().includes(selected.toLowerCase()) || 
        (selected === "Aldi" && r.toLowerCase().includes("aldi"))
      );
      
      retailerMatch = isAllowed && !isExcluded;
    }
    
    return searchMatch && catMatch && retailerMatch;
  });
  
  // 2. Sortieren
  filtered.sort((a, b) => {
    const sortVal = state.filters.sort;
    if (sortVal === "cashback-desc") {
      return b.cashbackVal - a.cashbackVal;
    } else if (sortVal === "deadline-asc") {
      return new Date(a.deadline) - new Date(b.deadline);
    }
    
    // Default: Beliebte & Noch offene Aktionen zuerst, dann Vorschau-Aktionen, abgelaufene ganz nach hinten
    const aExpired = new Date(a.deadline) < now ? 1 : 0;
    const bExpired = new Date(b.deadline) < now ? 1 : 0;
    if (aExpired !== bExpired) return aExpired - bExpired;
    
    const aUpcoming = a.startDate && new Date(a.startDate) > now ? 1 : 0;
    const bUpcoming = b.startDate && new Date(b.startDate) > now ? 1 : 0;
    if (aUpcoming !== bUpcoming) return aUpcoming - bUpcoming;
    
    if (aUpcoming && bUpcoming) {
      return new Date(a.startDate) - new Date(b.startDate);
    }
    
    return (b.isPopular ? 1 : 0) - (a.isPopular ? 1 : 0);
  });
  
  // 3. Fehlermeldung bei leeren Ergebnissen
  if (filtered.length === 0) {
    grid.innerHTML = `
      <div style="grid-column: 1/-1; text-align: center; padding: 48px; background: var(--bg-card); border: 1px dashed var(--border-color); border-radius: var(--border-radius-md);">
        <p style="color: var(--text-secondary); font-size: 1.1rem; margin-bottom: 8px;">Keine passenden Aktionen gefunden.</p>
        <p style="color: var(--text-muted); font-size: 0.9rem;">Passe deine Such- oder Händlerfilter an, um mehr Aktionen zu sehen.</p>
      </div>
    `;
    return;
  }
  
  // 4. Rendern
  filtered.forEach(c => {
    const isExpired = new Date(c.deadline) < now;
    const isUpcoming = c.startDate && new Date(c.startDate) > now;
    
    // Monitor-Status für diese Kampagne abrufen (hat Vorrang vor Community-Reports)
    const monitorName = MONITOR_CAMPAIGN_MAP[c.id];
    const monitorEntry = monitorName ? state.monitorData[monitorName] : null;
    const monitorStatus = monitorEntry ? monitorEntry.status : null;

    // Status-Klassen bestimmen – Monitor hat Vorrang
    let limitStatusClass = "success-limit";
    if (isExpired) {
      limitStatusClass = "expired-campaign";
    } else if (isUpcoming) {
      limitStatusClass = "upcoming-campaign";
    } else if (monitorStatus === 'daily_limit_reached') {
      limitStatusClass = "danger-limit";
    } else if (monitorStatus === 'ended') {
      limitStatusClass = "expired-campaign";
    } else if (monitorStatus === 'open') {
      limitStatusClass = "success-limit";
    } else {
      // Fallback: Community-Reports
      const productReports = state.communityReports.filter(r => r.productId === c.id);
      if (productReports.length > 0) {
        const latestReport = productReports[productReports.length - 1];
        if (latestReport.status === "danger") {
          limitStatusClass = "danger-limit";
        } else if (latestReport.status === "warning") {
          limitStatusClass = "warning-limit";
        }
      } else {
        if (c.limitType === "daily" && (c.id === "deli-reform-omega3" || c.id === "cottonelle-feucht")) {
          limitStatusClass = "warning-limit";
        }
      }
    }
    
    const card = document.createElement("article");
    card.className = `campaign-card ${limitStatusClass}`;
    
    const brandColor = isExpired ? "#475569" : getBrandColor(c.brand);
    const formattedDeadline = new Date(c.deadline).toLocaleDateString("de-DE", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric"
    });
    
    let formattedStartDate = "";
    if (c.startDate) {
      formattedStartDate = new Date(c.startDate).toLocaleDateString("de-DE", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric"
      });
    }
    
    // Retailer badges
    let allowedBadges = c.allowedRetailers.slice(0, 3).map(r => `<span class="retailer-preview-badge allowed">${r}</span>`).join("");
    if (c.allowedRetailers.length > 3) {
      allowedBadges += `<span class="retailer-preview-badge">+${c.allowedRetailers.length - 3}</span>`;
    }
    if (c.allowedRetailers.length === 0) {
      // Nur stationär, wenn Online-Shops in den Ausschlüssen stehen, oder der Händlertext "stationär" enthält, ohne "online" (wie Online-Handel) zu erlauben
      const hasOnlineExclusion = c.excludedRetailers.includes("Online-Shops");
      const isStationaryOnlyText = c.allowedRetailersText.toLowerCase().includes("stationär") && 
                                    !c.allowedRetailersText.toLowerCase().includes("und online") && 
                                    !c.allowedRetailersText.toLowerCase().includes("online-handel");
      
      if (hasOnlineExclusion || isStationaryOnlyText) {
        allowedBadges = `<span class="retailer-preview-badge allowed">✓ Alle Händler (stationär)</span>`;
      } else {
        allowedBadges = `<span class="retailer-preview-badge allowed">✓ Alle Händler erlaubt</span>`;
      }
    }
    
    let cardBadge = "";
    if (isExpired) {
      cardBadge = `<span class="cashback-badge expired">Abgelaufen</span>`;
    } else if (isUpcoming) {
      cardBadge = `
        <div class="card-badges" style="display: flex; flex-direction: column; align-items: flex-end; gap: 6px;">
          <span class="cashback-badge upcoming">Vorschau</span>
          <span class="cashback-badge" style="background: hsla(var(--success-hsl), 0.04); border-color: hsla(var(--success-hsl), 0.12);">${c.cashbackVal.toFixed(2)} € Erstattung</span>
        </div>
      `;
    } else if (limitStatusClass === "danger-limit") {
      let limitLabel = "Limit erreicht";
      if (c.limitType === "daily") {
        limitLabel = "Tageslimit voll";
      } else if (c.limitType === "weekly") {
        limitLabel = "Wochenlimit voll";
      } else if (c.limitType === "total") {
        limitLabel = "Aktion beendet";
      }
      cardBadge = `
        <div class="card-badges" style="display: flex; flex-direction: column; align-items: flex-end; gap: 6px;">
          <span class="cashback-badge danger">${limitLabel}</span>
          <span class="cashback-badge" style="background: hsla(var(--success-hsl), 0.04); border-color: hsla(var(--success-hsl), 0.12);">${c.cashbackVal.toFixed(2)} € Erstattung</span>
        </div>
      `;
    } else {
      cardBadge = `<span class="cashback-badge">${c.cashbackVal.toFixed(2)} € Erstattung</span>`;
    }

    const isMonitorLimitReached = monitorStatus === 'daily_limit_reached' || monitorStatus === 'ended';
    const actionButton = isExpired ?
      `<button class="btn btn-secondary" onclick="openCampaignDetail('${c.id}')">Einreichen &amp; Infos</button>` :
      (isUpcoming ?
        `<button class="btn btn-secondary" onclick="openCampaignDetail('${c.id}')">Details &amp; Infos</button>` :
        (isMonitorLimitReached ?
          `<button class="btn btn-secondary" onclick="openCampaignDetail('${c.id}')">Infos &amp; Details</button>` :
          `<button class="btn btn-primary" onclick="openCampaignDetail('${c.id}')">Details &amp; Prüfen</button>`
        )
      );
      
    let deadlineBadgeHtml = "";
    if (isExpired) {
      deadlineBadgeHtml = `Beendet am ${formattedDeadline}`;
    } else if (isUpcoming) {
      deadlineBadgeHtml = `Startet am ${formattedStartDate}`;
    } else {
      deadlineBadgeHtml = `Bis ${formattedDeadline}`;
    }
    
    const deadlineClass = isExpired ? 'expired-deadline' : (isUpcoming ? 'upcoming-deadline' : '');
    
    card.innerHTML = `
      <div class="card-header">
        <div class="brand-info">
          <img src="${c.imageUrl}" alt="${c.brand}" class="brand-avatar-img" referrerpolicy="no-referrer" onerror="this.onerror=null; this.src='https://placehold.co/200x200/f1f5f9/64748b?text=Kein+Bild';">
          <div class="brand-names">
            <span class="brand-label" style="color: ${brandColor};">${c.brand}</span>
            <h3 class="product-name">${c.name}</h3>
          </div>
        </div>
        ${cardBadge}
      </div>
      
      <div class="availability-section">
        <div class="availability-info">
          <span class="availability-title">${isExpired ? 'Aktions-Status' : (isUpcoming ? 'Vorschau-Status' : (c.limitType === 'daily' ? 'Tageslimit' : (c.limitType === 'weekly' ? 'Wöchentliches Limit' : 'Gesamtlimit')))}</span>
          <div style="font-size: 0.85rem; color: var(--text-muted); margin-top: 4px; line-height: 1.4;">
            ${c.limitNote}
          </div>
        </div>
      </div>

      ${MONITOR_CAMPAIGN_MAP[c.id] ? getLiveMonitorBadge(c.id) : ''}
      
      <div class="retailer-preview">
        <div class="retailer-preview-title">Einkauf möglich bei:</div>
        <div class="retailer-preview-list">
          ${allowedBadges}
        </div>
      </div>
      
      <div class="card-footer">
        <span class="deadline-badge ${deadlineClass}">
          <svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
            <path stroke-linecap="round" stroke-linejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"></path>
          </svg>
          ${deadlineBadgeHtml}
        </span>
        ${actionButton}
      </div>
    `;
    
    grid.appendChild(card);
  });
}

// Rendert den Community Live-Ticker
function renderReportsFeed() {
  const feed = document.getElementById("reports-feed");
  feed.innerHTML = "";
  
  // Neueste Meldungen zuerst anzeigen
  const sortedReports = [...state.communityReports].reverse();
  
  sortedReports.forEach(r => {
    let statusClass = "status-ok";
    let statusLabel = "Erfolgreich eingelöst";
    if (r.status === "warning") {
      statusClass = "status-warning";
      statusLabel = "Bestand knapp";
    } else if (r.status === "danger") {
      statusClass = "status-danger";
      statusLabel = "Aktion fehlgeschlagen";
    }
    
    const div = document.createElement("div");
    div.className = "report-item";
    div.innerHTML = `
      <div class="report-meta">
        <span class="report-user">
          <svg width="14" height="14" fill="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
            <path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"></path>
          </svg>
          ${r.user}
        </span>
        <span>${r.timestamp || 'Gerade eben'}</span>
      </div>
      <p class="report-text">${r.text}</p>
      <div class="report-tags">
        <span class="report-tag">${r.productName}</span>
        <span class="report-tag">Gekauft bei: ${r.retailer}</span>
        <span class="report-badge ${statusClass}">${statusLabel}</span>
      </div>
    `;
    feed.appendChild(div);
  });
}

/* ==========================================================================
   DETAIL-MODAL & INTERACTIVE RETAILER MATCHING (User Request Core Feature)
   ========================================================================== */
let currentActiveCampaign = null;

function openCampaignDetail(campaignId) {
  const c = state.campaigns.find(item => item.id === campaignId);
  if (!c) return;
  currentActiveCampaign = c;
  
  const modal = document.getElementById("detail-modal");
  const bodyContent = document.getElementById("modal-body-content");
  const brandColor = getBrandColor(c.brand);
  
  const now = new Date();
  const isUpcoming = c.startDate && new Date(c.startDate) > now;
  const upcomingNoticeHtml = isUpcoming ? `
        <div class="modal-card-block" style="margin-bottom: 24px; border-left: 4px solid var(--warning); background: rgba(245, 158, 11, 0.07); padding-top: 16px; padding-bottom: 16px;">
          <h3 style="color: var(--warning); display: flex; align-items: center; gap: 8px; font-weight: 700; border-left: none; padding-left: 0; margin-bottom: 8px;">
            ⚠️ Vorschau: Aktion startet erst am ${new Date(c.startDate).toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" })}
          </h3>
          <p style="font-size: 0.9rem; line-height: 1.6; color: var(--text-secondary); margin-top: 8px;">
            Diese Aktion ist aktuell noch nicht aktiv. Einkäufe und Kassenbon-Einreichungen vor dem <strong>${new Date(c.startDate).toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" })}</strong> werden vom Veranstalter abgelehnt. Du kannst dich aber bereits hier über die Teilnahmebedingungen informieren.
          </p>
        </div>
  ` : "";
  
  // 1. Erzeuge Händler-Checkliste (Direkter Abgleich mit Bedingungen)
  const checklistHtml = POPULAR_RETAILERS.map(retailer => {
    // Finde heraus, ob Händler in den Teilnahmebedingungen ausgeschlossen ist
    const isExcluded = c.excludedRetailers.some(ex => 
      retailer.id.toLowerCase().includes(ex.toLowerCase()) ||
      ex.toLowerCase().includes(retailer.id.toLowerCase()) ||
      (retailer.id === "Aldi" && ex.toLowerCase().includes("aldi"))
    );
    
    // Finde heraus, ob der Händler explizit oder implizit erlaubt ist
    const isAllRetailersAllowed = c.allowedRetailers.length === 0;
    
    const isAllowed = (isAllRetailersAllowed || c.allowedRetailers.some(al => 
      retailer.id.toLowerCase().includes(al.toLowerCase()) ||
      al.toLowerCase().includes(retailer.id.toLowerCase()) ||
      (retailer.id === "Aldi" && al.toLowerCase().includes("aldi"))
    )) && !isExcluded;
    
    const statusClass = isAllowed ? "allowed" : "excluded";
    const statusIcon = isAllowed ? "✓" : "✗";
    const statusText = isAllowed ? "Erlaubt" : "Ausgeschlossen";
    
    return `
      <div class="retailer-status-box ${statusClass}">
        <span class="retailer-status-icon">${statusIcon}</span>
        <span class="retailer-status-name">${retailer.name}</span>
        <span style="font-size: 0.7rem; opacity: 0.8;">${statusText}</span>
      </div>
    `;
  }).join("");

  // 2. Erzeuge Händler-Dropdown-Optionen für den Simulator
  const simulatorRetailerOptions = POPULAR_RETAILERS.map(retailer => {
    return `<option value="${retailer.id}">${retailer.name}</option>`;
  }).join("");
  
  // 2.b. Erzeuge Insider-Tipps
  const tipsHtml = c.tips && c.tips.length > 0 ? `
        <div class="modal-card-block" style="margin-bottom: 24px; border-left: 4px solid var(--warning); background: rgba(245, 158, 11, 0.07); padding-top: 16px; padding-bottom: 16px;">
          <h3 style="color: var(--warning); display: flex; align-items: center; gap: 8px; font-weight: 700;">
            💡 Insider-Tipps &amp; Stolperfallen
          </h3>
          <ul style="margin-top: 12px; font-size: 0.9rem; line-height: 1.6; color: var(--text-secondary); padding-left: 20px; list-style-type: disc;">
            ${c.tips.map(tip => `<li style="margin-bottom: 8px;">${tip}</li>`).join("")}
          </ul>
        </div>
  ` : "";
  
  // 3. Fülle das Modal mit dem dynamischen Inhalt
  bodyContent.innerHTML = `
    <div class="modal-campaign-header">
      <img src="${c.imageUrl}" alt="${c.brand}" class="brand-avatar-img modal-avatar-img" referrerpolicy="no-referrer" onerror="this.onerror=null; this.src='data:image/svg+xml;utf8,<svg xmlns=\'http://www.w3.org/2000/svg\' width=\'200\' height=\'200\' viewBox=\'0 0 200 200\'><rect width=\'200\' height=\'200\' fill=\'%23f1f5f9\'/><text x=\'50%\' y=\'50%\' dominant-baseline=\'middle\' text-anchor=\'middle\' font-family=\'sans-serif\' font-size=\'12\' fill=\'%2364748b\'>Kein Bild</text></svg>';">
      <div>
        <span class="brand-label" style="font-size: 0.9rem; font-weight: 700; color: ${brandColor};">${c.brand}</span>
        <h2>${c.name}</h2>
      </div>
    </div>
    
    <div class="modal-grid">
      <!-- LINKE SEITE: Regeln & Händlerabgleich -->
      <div class="modal-main-section">
        ${upcomingNoticeHtml}
        ${tipsHtml}
        
        <div class="modal-card-block" style="margin-bottom: 24px;">
          <h3>🛍️ Kassenbon-Abgleich: Wo kaufen?</h3>
          <p style="font-size: 0.85rem; color: var(--text-muted); margin-bottom: 12px;">
            Laut offiziellen Teilnahmebedingungen ist das Produkt bei folgenden Händlern zulässig bzw. ausgeschlossen:
          </p>
          <div class="retailers-grid">
            ${checklistHtml}
          </div>
          <div style="margin-top: 14px; font-size: 0.85rem; padding: 8px 12px; background: rgba(99, 102, 241, 0.05); border-radius: 4px; border-left: 3px solid var(--primary);">
            <strong>Offizielle Händlerregel:</strong> ${c.allowedRetailersText}
          </div>
        </div>

        <div class="modal-card-block" style="margin-bottom: 24px;">
          <h3>📦 Teilnehmende Aktionsartikel</h3>
          <p style="font-size: 0.85rem; color: var(--text-muted); margin-bottom: 12px;">
            Folgende Artikel und Sorten nehmen offiziell an der Aktion teil:
          </p>
          <div class="participating-products-list">
            ${c.participatingProducts.map(prod => `
              <div class="participating-product-item">
                <img src="${prod.imageUrl}" alt="${prod.name}" class="product-item-img" style="${prod.imageStyle || ''}" referrerpolicy="no-referrer" onerror="this.onerror=null; this.src='https://placehold.co/200x200/f1f5f9/64748b?text=Kein+Bild';">
                <span class="product-item-name">${prod.name}</span>
              </div>
            `).join("")}
          </div>
        </div>

        <div class="modal-card-block">
          <h3>📋 Teilnahmebedingungen</h3>
          <ul class="conditions-list" style="margin-top: 12px;">
            ${c.conditions.map(cond => `<li>${cond}</li>`).join("")}
          </ul>
        </div>
      </div>
      
      <!-- RECHTE SEITE: Bon-Simulator & Aktionen -->
      <div>
      <!-- RECHTE SEITE: Live-Scanner & Aktionen -->
      <div>
        <div class="simulator-box" id="scanner-box">
          <h3 style="border-left: 3px solid var(--accent-cyan); padding-left: 8px;">📷 Live-Scanner</h3>
          <p style="font-size: 0.85rem; margin-bottom: 12px; line-height: 1.4; color: var(--text-muted);">Prüfe direkt im Laden, ob dein Produkt an dieser Aktion teilnimmt.</p>
          
          <div class="form-group" style="margin-bottom: 16px;">
            <label for="scanner-retailer" style="font-size: 0.8rem; font-weight: 600; color: var(--text-secondary); margin-bottom: 4px; display:block;">
              📍 Ich befinde mich bei:
            </label>
            <select id="scanner-retailer" class="filter-select" style="background: rgba(255, 255, 255, 0.9); color: var(--text-primary);" onchange="checkScannerMarket()">
              <option value="none">-- Bitte Markt wählen --</option>
              ${simulatorRetailerOptions}
            </select>
          </div>

          <div id="scanner-market-status" class="scanner-status-badge" style="display: none; margin-bottom: 12px;"></div>

          <div id="scanner-container" style="display: none; margin-top: 10px;">
            <div id="reader" style="width: 100%;"></div>
            <div style="font-size: 0.75rem; color: var(--text-muted); margin-top: 8px; text-align: center;">
              Wichtig: Muss über http://localhost geöffnet werden für Kamerazugriff!
            </div>
          </div>

          <div id="scanner-result-area" style="display: none; margin-top: 16px; text-align: center;">
            <div id="scanner-spinner" class="spinner" style="margin: 0 auto 10px auto; display: none;"></div>
            <div id="scanner-api-text" style="font-size: 0.85rem; color: var(--text-muted); margin-bottom: 12px; display: none;">Prüfe Barcode über Open Food Facts API...</div>
            
            <div id="scanner-final-result" style="padding: 12px; border-radius: 8px; background: rgba(0,0,0,0.03);">
              <div id="scanner-product-name" style="font-weight: 700; font-size: 1rem; margin-bottom: 6px;"></div>
              <div id="scanner-participation-badge" style="display: inline-block; padding: 4px 10px; border-radius: 20px; font-weight: 600; font-size: 0.85rem;"></div>
            </div>
            
            <button class="btn btn-secondary" id="scanner-reset-btn" onclick="resetScanner()" style="margin-top: 12px; width: 100%; justify-content: center;">Erneut scannen</button>
          </div>

          <div style="text-align: center; margin-top: 20px; display: flex; flex-direction: column; gap: 8px;">
            ${c.websiteUrls ? c.websiteUrls.map(link => `
              <a href="${link.url}" target="_blank" class="btn" style="width: 100%; justify-content: center; background: rgba(99, 102, 241, 0.08); border-color: rgba(99, 102, 241, 0.2); color: var(--primary);">
                ${link.label} ↗
              </a>
            `).join("") : `
              <a href="${c.websiteUrl}" target="_blank" class="btn" style="width: 100%; justify-content: center; background: rgba(99, 102, 241, 0.08); border-color: rgba(99, 102, 241, 0.2); color: var(--primary);">
                Zur offiziellen Aktionsseite ↗
              </a>
            `}
          </div>
        </div>

        <div class="alert-signup-box">
          <h4>🔔 Limit-Wecker aktivieren</h4>
          <p style="font-size: 0.8rem; color: var(--text-muted); line-height: 1.3; margin-top: 4px;">
            Lasse dich benachrichtigen, sobald das Tageslimit für dieses Produkt zu 80% voll ist.
          </p>
          <div class="alert-input-group">
            <input type="email" id="alert-email" placeholder="deine-mail@web.de">
            <button class="btn btn-primary" style="font-size: 0.8rem; padding: 6px 12px;" onclick="registerAlert('${c.name}')">Aktivieren</button>
          </div>
        </div>
      </div>
    </div>
  `;
  
  modal.classList.add("active");
}

function closeModal() {
  document.getElementById("detail-modal").classList.remove("active");
  if (html5QrcodeScanner) {
    html5QrcodeScanner.clear().catch(e => console.error(e));
    html5QrcodeScanner = null;
  }
}

/* ==========================================================================
   SIMULATION LOGICS (Receipt analysis, Konfetti, real-time feedback)
   ========================================================================== */
function simulateReceiptUpload(campaignId) {
  const c = state.campaigns.find(item => item.id === campaignId);
  const selectedRetailer = document.getElementById("sim-retailer").value;
  const overlay = document.getElementById("upload-processing");
  const zone = document.getElementById("upload-zone");
  
  if (!c) return;
  
  // Starte optische OCR-Simulation
  overlay.innerHTML = `
    <div class="spinner"></div>
    <div style="font-size: 0.85rem; font-weight: 700; color: var(--primary);">OCR-Texterkennung läuft...</div>
    <div style="font-size: 0.75rem; color: var(--text-muted);">Prüfe Händler: "${selectedRetailer}"</div>
  `;
  overlay.classList.add("active");
  
  setTimeout(() => {
    // 2. Abgleich mit Händlerausschlüssen (Direkte Regelauswertung)
    const isExcluded = c.excludedRetailers.some(ex => 
      ex.toLowerCase().includes(selectedRetailer.toLowerCase()) ||
      (selectedRetailer === "Aldi" && ex.toLowerCase().includes("aldi"))
    );
    
    const isAllAllowed = c.allowedRetailers.length === 0;
    const isAllowed = (isAllAllowed || c.allowedRetailers.some(al => 
      al.toLowerCase().includes(selectedRetailer.toLowerCase()) ||
      (selectedRetailer === "Aldi" && al.toLowerCase().includes("aldi"))
    )) && !isExcluded;
    
    if (!isAllowed) {
      // Fehlermeldung bei falschem Händler (Einhaltung der Teilnahmebedingungen bewiesen!)
      overlay.innerHTML = `
        <span class="success-icon-animated" style="color: var(--danger)">✗</span>
        <div style="font-size: 0.9rem; font-weight: 700; color: var(--danger);">Bon abgelehnt!</div>
        <div style="font-size: 0.75rem; color: var(--text-primary); text-align: center; padding: 0 10px; line-height: 1.3;">
          "${selectedRetailer}" ist laut Teilnahmebedingungen ausgeschlossen!
        </div>
        <button class="btn" style="margin-top: 10px; font-size: 0.75rem; padding: 4px 8px;" onclick="resetUploadZone(event)">Erneut versuchen</button>
      `;
      return;
    }
    
    // 3. Erfolgs-Fall
    
    overlay.innerHTML = `
      <span class="success-icon-animated">✓</span>
      <div style="font-size: 0.9rem; font-weight: 700; color: var(--success);">Erstattung genehmigt!</div>
      <div style="font-size: 0.75rem; color: var(--text-secondary); text-align: center; line-height: 1.3;">
        +${c.cashbackVal.toFixed(2)} € werden auf Ihr Bankkonto überwiesen.
      </div>
    `;
    
    // Konfetti-Effekt & Dashboard-Aktualisierung
    triggerConfetti();
    
    // Erstelle automatischen Erfolgsbericht in der Community
    const newReport = {
      id: Date.now(),
      user: "Du (Simulator)",
      productName: c.name,
      productId: c.id,
      retailer: selectedRetailer,
      status: "ok",
      text: `Bon-Upload erfolgreich simuliert! Gekauft bei ${selectedRetailer}. Die Prüfung der Teilnahmebedingungen war einwandfrei.`,
      timestamp: "Gerade eben"
    };
    
    state.communityReports.push(newReport);
    localStorage.setItem("gratis_testen_reports_v2.3", JSON.stringify(state.communityReports));
    
    // Re-Rendern aller Ansichten
    renderApp();
    
    // Nach 3 Sekunden schließt sich das Overlay wieder für weitere Uploads
    setTimeout(() => {
      resetUploadZoneDirect(zone);
    }, 3500);
    
  }, 1800); // 1.8 Sekunden künstliche OCR-Ladezeit
}

// Setzt die Upload-Zone nach einem Fehler zurück
function resetUploadZone(event) {
  event.stopPropagation();
  const overlay = document.getElementById("upload-processing");
  overlay.classList.remove("active");
}

function resetUploadZoneDirect(zone) {
  const overlay = zone.querySelector(".processing-overlay");
  if (overlay) overlay.classList.remove("active");
}

// Melde-Wecker Mockup
function registerAlert(productName) {
  const email = document.getElementById("alert-email").value;
  if (!email || !email.includes("@")) {
    alert("Bitte gib eine gültige E-Mail-Adresse ein!");
    return;
  }
  
  alert(`Erfolgreich eingetragen!\n\nWir senden eine Benachrichtigung an "${email}", sobald das Limit für "${productName}" knapp wird.`);
  document.getElementById("alert-email").value = "";
}

/* ==========================================================================
   COMMUNITY FORM SUBMISSION LOGIC
   ========================================================================== */
function handleReportSubmit(e) {
  e.preventDefault();
  
  const userVal = document.getElementById("report-user").value.trim();
  const productSelect = document.getElementById("report-product");
  const productId = productSelect.value;
  const productName = productSelect.options[productSelect.selectedIndex].text;
  const retailerVal = document.getElementById("report-retailer").value;
  const statusVal = document.getElementById("report-status").value;
  const textVal = document.getElementById("report-text").value.trim();
  
  if (!userVal || !textVal) return;
  
  const newReport = {
    id: Date.now(),
    user: userVal,
    productName: productName,
    productId: productId,
    retailer: retailerVal,
    status: statusVal,
    text: textVal,
    timestamp: "Gerade eben"
  };
  
  // Zum State hinzufügen
  state.communityReports.push(newReport);
  localStorage.setItem("gratis_testen_reports_v2.3", JSON.stringify(state.communityReports));
  
  // Formular zurücksetzen
  document.getElementById("report-user").value = "";
  document.getElementById("report-text").value = "";
  
  // Dashboard & Feed aktualisieren
  renderApp();
  
  // Sanftes Scrollen zum Ticker
  document.getElementById("reports-feed").firstElementChild.scrollIntoView({
    behavior: "smooth"
  });
}

/* ==========================================================================
   VISUAL EFFECTS & LIVE BACKGROUND SHOOPER TRAFFIC
   ========================================================================== */
// Konfetti-Effekt bei erfolgreicher Einlösung
function triggerConfetti() {
  const colors = ["#6366f1", "#06b6d4", "#10b981", "#a855f7", "#fbbf24"];
  for (let i = 0; i < 40; i++) {
    const confetti = document.createElement("div");
    confetti.style.position = "fixed";
    confetti.style.width = `${Math.random() * 8 + 6}px`;
    confetti.style.height = `${Math.random() * 15 + 8}px`;
    confetti.style.backgroundColor = colors[Math.floor(Math.random() * colors.length)];
    confetti.style.top = `-20px`;
    confetti.style.left = `${Math.random() * 100}vw`;
    confetti.style.opacity = Math.random();
    confetti.style.transform = `rotate(${Math.random() * 360}deg)`;
    confetti.style.zIndex = "2000";
    confetti.style.borderRadius = "2px";
    
    document.body.appendChild(confetti);
    
    // Animations-Flugbahn
    const destinationY = window.innerHeight + 20;
    const destinationX = parseFloat(confetti.style.left) + (Math.random() * 20 - 10);
    const duration = Math.random() * 2 + 1.5;
    
    confetti.animate([
      { top: "-20px", left: confetti.style.left, transform: confetti.style.transform },
      { top: `${destinationY}px`, left: `${destinationX}vw`, transform: `rotate(${Math.random() * 720}deg)` }
    ], {
      duration: duration * 1000,
      easing: "cubic-bezier(0.1, 0.8, 0.3, 1)",
      fill: "forwards"
    });
    
    setTimeout(() => {
      confetti.remove();
    }, duration * 1000);
  }
}

// Hintergrund Traffic deaktiviert, da keine Fake Limits mehr.
function startLiveTrafficSimulation() {
  // Leere Funktion
}

// Generiert zufällige, sehr realistische Community-Meldungen im Hintergrund
function generateMockCommunityReport(campaign) {
  const names = ["SparBiene", "SchnaeppchenJaeger", "BioKaeufer", "PfennigFuchser", "Mimi_Maunzt", "DrogerieFan", "KuechenChef"];
  const name = names[Math.floor(Math.random() * names.length)];
  
  const retailers = campaign.allowedRetailers.filter(r => !campaign.excludedRetailers.includes(r));
  const retailer = retailers.length > 0 ? retailers[Math.floor(Math.random() * retailers.length)] : "Supermarkt";
  
  const texts = [
    `Habe heute den Bon hochgeladen, Erstattung für ${campaign.name} wurde direkt vorgemerkt! Geiler Deal.`,
    `War eben bei ${retailer}, da gab es noch gut Auswahl im Regal. Lasst uns die Aktion leeren!`,
    `Achtung, das Limit bei ${campaign.brand} wird heute wohl recht früh voll sein, da es aktuell super viele hochladen.`
  ];
  const text = texts[Math.floor(Math.random() * texts.length)];
  
  const newReport = {
    id: Date.now(),
    user: name,
    productName: campaign.name,
    productId: campaign.id,
    retailer: retailer,
    status: "ok",
    text: text,
    timestamp: "Gerade eben"
  };
  
  state.communityReports.push(newReport);
  // Begrenze Verlauf auf max. 10 Berichte im LocalStorage, damit es nicht überläuft
  if (state.communityReports.length > 10) {
    state.communityReports.shift();
  }
  
  localStorage.setItem("gratis_testen_reports_v2.3", JSON.stringify(state.communityReports));
  renderReportsFeed();
}

/* ==========================================================================
   FEATURE: LIVE-SCANNER & BARCODEPRÜFER
   ========================================================================== */

let html5QrcodeScanner = null;

// WICHTIGER ENTWICKLER-HINWEIS:
// Die getUserMedia() / Kamera-API wird in modernen Browsern (Chrome, iOS Safari) aus Sicherheitsgründen
// oft blockiert, wenn die index.html nur lokal über das file:// Protokoll geöffnet wird.
// -> Die App muss zwingend über einen lokalen Webserver (z. B. http://localhost) gestartet werden, 
// damit die Kamera für den Barcode-Scanner funktioniert!

function checkScannerMarket() {
  const retailer = document.getElementById('scanner-retailer').value;
  const statusBadge = document.getElementById('scanner-market-status');
  const scannerContainer = document.getElementById('scanner-container');
  const resultArea = document.getElementById('scanner-result-area');
  
  if (retailer === 'none') {
    statusBadge.style.display = 'none';
    scannerContainer.style.display = 'none';
    resultArea.style.display = 'none';
    if (html5QrcodeScanner) {
      html5QrcodeScanner.clear().catch(e => console.error(e));
      html5QrcodeScanner = null;
    }
    return;
  }
  
  if (!currentActiveCampaign) return;
  
  statusBadge.style.display = 'block';
  resultArea.style.display = 'none';
  
  // Händler dynamisch prüfen anstatt festem Array
  const isExcluded = currentActiveCampaign.excludedRetailers.some(ex => 
    retailer.toLowerCase().includes(ex.toLowerCase()) || ex.toLowerCase().includes(retailer.toLowerCase())
  );
  
  const isAllAllowed = currentActiveCampaign.allowedRetailers.length === 0;
  const isAllowed = (isAllAllowed || currentActiveCampaign.allowedRetailers.some(al => 
    retailer.toLowerCase().includes(al.toLowerCase()) || al.toLowerCase().includes(retailer.toLowerCase())
  )) && !isExcluded;
  
  const now = new Date();
  const isUpcoming = currentActiveCampaign && currentActiveCampaign.startDate && new Date(currentActiveCampaign.startDate) > now;

  if (isAllowed) {
    if (isUpcoming) {
      const formattedStart = new Date(currentActiveCampaign.startDate).toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" });
      statusBadge.className = 'scanner-status-badge warning';
      statusBadge.innerHTML = `⚠️ Markt nimmt teil (Aktion startet erst am ${formattedStart})`;
    } else {
      statusBadge.className = 'scanner-status-badge green';
      statusBadge.innerHTML = '✅ Markt nimmt an dieser Aktion teil';
    }
    
    // Protokoll prüfen und Warnung einblenden, wenn file:// verwendet wird
    if (window.location.protocol === 'file:') {
      scannerContainer.innerHTML = `
        <div style="background: rgba(239, 68, 68, 0.1); border-left: 3px solid #ef4444; padding: 12px; margin-bottom: 12px; border-radius: 4px;">
          <h4 style="color: #ef4444; font-size: 0.9rem; margin-bottom: 4px;">⚠️ Kamerazugriff blockiert</h4>
          <p style="color: var(--text-primary); font-size: 0.8rem; line-height: 1.4;">
            Moderne Browser blockieren den Kamerazugriff über das <code>file://</code> Protokoll. 
            Bitte starte einen lokalen Server (z.B. <code>http://localhost</code>) um diese Funktion zu nutzen.
          </p>
        </div>
        <div id="reader" style="width: 100%;"></div>
      `;
    }

    scannerContainer.style.display = 'block';
    initScanner();
  } else {
    statusBadge.className = 'scanner-status-badge red';
    statusBadge.innerHTML = '❌ Markt nimmt NICHT teil';
    scannerContainer.style.display = 'none';
    if (html5QrcodeScanner) {
      html5QrcodeScanner.clear().catch(e => console.error(e));
      html5QrcodeScanner = null;
    }
  }
}

function initScanner() {
  if (html5QrcodeScanner) {
    return; 
  }
  // Nutzt Html5QrcodeScanner mit den geforderten Konfigurationen
  html5QrcodeScanner = new Html5QrcodeScanner(
    "reader",
    { 
      fps: 10, 
      qrbox: { width: 250, height: 150 },
      formatsToSupport: [ Html5QrcodeSupportedFormats.EAN_13, Html5QrcodeSupportedFormats.EAN_8 ]
    },
    /* verbose= */ false
  );
  html5QrcodeScanner.render(onScanSuccess, onScanFailure);
}

function onScanSuccess(decodedText, decodedResult) {
  // Scanner SOFORT pausieren, um Mehrfach-Scans desselben Barcodes zu verhindern
  if (html5QrcodeScanner) {
    html5QrcodeScanner.pause(true);
  }
  
  document.getElementById('scanner-container').style.display = 'none';
  const resultArea = document.getElementById('scanner-result-area');
  const spinner = document.getElementById('scanner-spinner');
  const apiText = document.getElementById('scanner-api-text');
  const finalResult = document.getElementById('scanner-final-result');
  const badge = document.getElementById('scanner-participation-badge');
  const nameEl = document.getElementById('scanner-product-name');
  
  resultArea.style.display = 'block';
  spinner.style.display = 'block';
  apiText.style.display = 'block';
  finalResult.style.display = 'none';
  
  // Sende Fetch-Request an Open Food Facts API
  fetch(`https://world.openfoodfacts.org/api/v2/product/${decodedText}.json`)
    .then(response => response.json())
    .then(data => {
      spinner.style.display = 'none';
      apiText.style.display = 'none';
      finalResult.style.display = 'block';
      
      if (data.status === 1) {
        const product = data.product;
        const productName = product.product_name || 'Unbekanntes Produkt';
        const brands = product.brands ? product.brands.toLowerCase() : '';
        nameEl.innerText = productName;
        
        // Dynamische Prüfung gegen die Marke der aktuellen Aktion
        const isParticipating = currentActiveCampaign && brands.includes(currentActiveCampaign.brand.toLowerCase());
        
        if (isParticipating) {
          if (isUpcoming) {
            const formattedStart = new Date(currentActiveCampaign.startDate).toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" });
            badge.className = 'scanner-status-badge warning';
            badge.innerHTML = `⚠️ Produkt nimmt teil (Aktion startet erst am ${formattedStart})`;
          } else {
            badge.className = 'scanner-status-badge green';
            badge.innerHTML = '✅ Produkt nimmt teil';
          }
        } else {
          badge.className = 'scanner-status-badge red';
          badge.innerHTML = '❌ Produkt nimmt nicht teil';
        }
      } else {
        nameEl.innerText = 'Barcode nicht gefunden: ' + decodedText;
        badge.className = 'scanner-status-badge red';
        badge.innerHTML = '❌ Unbekanntes Produkt';
      }
    })
    .catch(error => {
      console.error('API Error:', error);
      spinner.style.display = 'none';
      apiText.style.display = 'none';
      finalResult.style.display = 'block';
      nameEl.innerText = 'API-Fehler aufgetreten';
      badge.className = 'scanner-status-badge red';
      badge.innerHTML = '❌ Netzwerkfehler';
    });
}

function onScanFailure(error) {
  // Wird ignoriert
}

function resetScanner() {
  document.getElementById('scanner-result-area').style.display = 'none';
  document.getElementById('scanner-container').style.display = 'block';
  if (html5QrcodeScanner) {
    html5QrcodeScanner.resume();
  }
}

// Hilfsfunktion: Markenfarbe
function getBrandColor(brand) {
  const colors = {
    "Axe": "#1a1a2e",
    "Nivea": "#003087",
    "Granini": "#0f7d45",
    "Deli Reform": "#e87722",
    "Air Wick": "#832f91",
    "Lenor": "#0057a8",
    "Whiskas": "#8b0000",
    "Somat": "#c0392b",
    "NESCAFÉ": "#c8102e",
    "Rockstar": "#f49d1a",
    "tetesept": "#008b8b",
    "Cottonelle": "#06b6d4"
  };
  return colors[brand] || "#3b82f6";
}
