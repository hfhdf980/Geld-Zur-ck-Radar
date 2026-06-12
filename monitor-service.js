/**
 * Cashback Daily Limit Monitor Service
 *
 * A standalone background service that monitors cashback campaign availability
 * for OCA, Acardo, and Justsnap providers, exposing the status via a native HTTP API.
 */

const http = require('http');
const https = require('https');
const { URL } = require('url');
const fs = require('fs');
const path = require('path');

// Port definition
const PORT = 3000;

// Polling interval: 5 minutes
const POLL_INTERVAL_MS = 5 * 60 * 1000;

// Timeout for HTTP/HTTPS requests: 15 seconds
const REQUEST_TIMEOUT_MS = 15000;

/**
 * Campaign definitions configuration
 * Stores metadata and URLs for each tracked campaign.
 */
const CAMPAIGNS = [
  {
    name: 'Axe Fine Fragrance',
    provider: 'oca',
    url: 'https://aktionen.oca-services.com/teilnahmeformular/axe/de-de/fine-fragrance-bodywash-gratis-testen#/',
    apiEndpoint: 'https://aktionen.oca-services.com/api/sweepstake/3257b947-a16b-44ce-a778-a7e4261540e9',
    startDate: '2026-05-25',
    endDate:   '2026-06-14'
  },
  {
    name: 'Somat',
    provider: 'acardo',
    url: 'https://gratis.testen.somat.de/'
  },
  {
    name: 'Cottonelle',
    provider: 'acardo',
    url: 'https://cottonelle-aktion.de/'
  },
  {
    name: 'Nivea',
    provider: 'justsnap',
    url: 'https://www.nivea.de/gratisdeo'
  },
  {
    name: 'Deli Reform',
    provider: 'acardo',
    url: 'https://www.deli-gratis-testen.de/'
  },
  {
    // Justsnap-API Provider: POST /api/getRemaining mit campaignKey
    name: 'Cillit Bang',
    provider: 'justsnap-api',
    campaignKey: '3fd337a3-efd7-43e9-a688-48a8bd64304d',
    startDate: '2026-05-01',
    endDate:   '2026-07-31'
  },
  {
    name: 'Calgon',
    provider: 'justsnap-api',
    campaignKey: '7a2bc3c0-c1fa-47fd-86c5-1a549ef208a6',
    startDate: '2026-05-01',
    endDate:   '2026-07-31'
  },
  {
    name: "Ben's Original",
    provider: 'acardo',
    url: 'https://bens-streetfood-gratis-testen.de'
  },
  {
    name: 'Zott',
    provider: 'zott',
    url: 'https://purejoy-gratis-testen.de/'
  },
  {
    name: 'Purina',
    provider: 'purina',
    url: 'https://www.purina.de/aktion/gourmet'
  },
  {
    name: 'Rockstar',
    provider: 'rockstar',
    url: 'https://www.rockstarenergy.de/mocktails-aktion'
  },
  {
    name: 'Andros',
    provider: 'andros',
    url: 'https://gratistesten-aktion.de/'
  },
  {
    name: 'Whiskas',
    provider: 'whiskas',
    url: 'https://purrorpass.whiskas.de/aktion/de-de/welcome/'
  }
];

// In-memory global state cache
const stateCache = {
  updatedAt: new Date().toISOString(),
  campaigns: CAMPAIGNS.map(campaign => ({
    name: campaign.name,
    provider: campaign.provider,
    status: 'unknown',
    checkedAt: null,
    responseTimeMs: 0,
    error: null
  }))
};

/**
 * Helper function to perform HTTP/HTTPS requests with redirect support and timeouts.
 *
 * @param {string} urlStr Target URL.
 * @param {object} options Options for headers or method.
 * @param {number} timeoutMs Request timeout in milliseconds.
 * @param {number} redirectCount Count of followed redirects to prevent infinite loops.
 * @returns {Promise<{statusCode: number, headers: object, body: string, finalUrl: string}>} Resolves with response details.
 */
function fetchUrl(urlStr, options = {}, timeoutMs = 10000, redirectCount = 0) {
  return new Promise((resolve, reject) => {
    if (redirectCount > 5) {
      return reject(new Error('Too many redirects (max 5)'));
    }

    let url;
    try {
      url = new URL(urlStr);
    } catch (e) {
      return reject(new Error(`Invalid URL: ${urlStr}`));
    }

    const client = url.protocol === 'https:' ? https : http;
    const reqOptions = {
      protocol: url.protocol,
      hostname: url.hostname,
      port: url.port || (url.protocol === 'https:' ? 443 : 80),
      path: url.pathname + url.search + url.hash,
      method: options.method || 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8',
        'Accept-Language': 'de-DE,de;q=0.9,en-US;q=0.8,en;q=0.7',
        ...(options.headers || {})
      }
    };

    let aborted = false;
    const req = client.request(reqOptions, (res) => {
      const statusCode = res.statusCode || 200;

      // Handle redirect status codes (301, 302, 303, 307, 308)
      if (statusCode >= 300 && statusCode < 400 && res.headers.location) {
        const redirectUrl = new URL(res.headers.location, url.href).href;
        req.destroy();
        return resolve(fetchUrl(redirectUrl, options, timeoutMs, redirectCount + 1));
      }

      let body = '';
      res.on('data', (chunk) => {
        body += chunk;
      });

      res.on('end', () => {
        if (!aborted) {
          resolve({
            statusCode,
            headers: res.headers,
            body,
            finalUrl: url.href
          });
        }
      });
    });

    req.on('error', (err) => {
      if (!aborted) {
        reject(err);
      }
    });

    req.setTimeout(timeoutMs, () => {
      aborted = true;
      req.destroy();
      reject(new Error(`Timeout after ${timeoutMs}ms`));
    });

    if (options.body) {
      req.write(options.body);
    }
    req.end();
  });
}

/**
 * OCA Provider
 * Calls OCA JSON API and maps campaign status.
 *
 * OCA verwendet "Prestart" für ZWEI verschiedene Zustände:
 *  1. Kampagne noch nicht gestartet (echter Prestart)
 *  2. Tageslimit heute erreicht (Reset um 08:00 Uhr)
 *
 * Unterscheidung: Falls aktuelles Datum zwischen startDate und endDate liegt
 * → Tageslimit erreicht. Vor startDate → echter Prestart.
 *
 * Status mapping:
 * - Prestart + vor Kampagnenstart       → prestart
 * - Prestart + Kampagne läuft gerade    → daily_limit_reached
 * - PostPromo                           → ended
 * - Active + ActCount > 0              → open
 * - Active + ActCount === 0            → daily_limit_reached
 * - Sonstiges                          → unknown
 */
async function checkOca(campaign, timeoutMs) {
  const startTime = Date.now();
  // OCA-Server ist bei Tageslimit-Reset unter starker Last – bis zu 2 Versuche
  const OCA_TIMEOUT = Math.max(timeoutMs, 20000);
  let res;
  try {
    res = await fetchUrl(campaign.apiEndpoint, { headers: { 'Accept': 'application/json' } }, OCA_TIMEOUT);
  } catch (firstErr) {
    // 1 Retry nach kurzem Warten
    await new Promise(r => setTimeout(r, 3000));
    try {
      res = await fetchUrl(campaign.apiEndpoint, { headers: { 'Accept': 'application/json' } }, OCA_TIMEOUT);
    } catch (retryErr) {
      const responseTimeMs = Date.now() - startTime;
      return { status: 'error', responseTimeMs, error: `Timeout nach 2 Versuchen: ${retryErr.message}` };
    }
  }
  try {
    const responseTimeMs = Date.now() - startTime;

    let status = 'unknown';
    let error = null;

    try {
      const data = JSON.parse(res.body);
      const apiStatus = data.Status;
      const actCount = data.Configuration && data.Configuration.CountDown
        ? data.Configuration.CountDown.ActCount
        : undefined;

      const now = new Date();
      const campaignStarted = campaign.startDate ? now >= new Date(campaign.startDate) : true;
      const campaignEnded = campaign.endDate ? now > new Date(campaign.endDate) : false;

      if (campaignEnded) {
        status = 'ended';
      } else if (!campaignStarted) {
        status = 'prestart';
      } else if (apiStatus === 'Active') {
        if (typeof actCount === 'number') {
          status = actCount > 0 ? 'open' : 'daily_limit_reached';
        } else {
          status = 'unknown';
        }
      } else if (apiStatus === 'Finished' || apiStatus === 'PostPromo' || apiStatus === 'Prestart') {
        status = 'daily_limit_reached';
      } else {
        status = 'unknown';
      }
    } catch (parseErr) {
      status = 'unknown';
      error = `Invalid JSON response: ${parseErr.message}`;
    }

    return { status, responseTimeMs, error };
  } catch (err) {
    const responseTimeMs = Date.now() - startTime;
    return { status: 'error', responseTimeMs, error: err.message };
  }
}

/**
 * Acardo Provider
 * Fetches campaign page HTML and checks multiple DOM and content signals.
 *
 * Status logic:
 * - Limit message OR disabled submit button -> daily_limit_reached
 * - Form + submit button -> open
 * - Otherwise -> unknown
 */
async function checkAcardo(campaign, timeoutMs) {
  const startTime = Date.now();
  try {
    const res = await fetchUrl(campaign.url, {}, timeoutMs);
    const responseTimeMs = Date.now() - startTime;
    const html = res.body;
    const finalUrl = res.finalUrl || campaign.url;

    // Check if it's a Valassis/Couponplatz page (often mapped as Acardo provider for simplicity)
    const isValassis = html.includes('var $roy =') || html.trim().startsWith('{');
    if (isValassis) {
      let config = null;
      if (html.trim().startsWith('{')) {
        try {
          config = JSON.parse(html);
        } catch (e) {}
      } else {
        const match = html.match(/var\s+\$roy\s*=\s*(\{[\s\S]*?\});\s*(?:<\/script>|\n)/);
        if (match) {
          try {
            config = JSON.parse(match[1]);
          } catch (e) {}
        }
      }

      if (config) {
        let instance = config;
        if (config.instance) {
          if (typeof config.instance === 'string') {
            try {
              instance = JSON.parse(config.instance);
            } catch (e) {}
          } else {
            instance = config.instance;
          }
        }

        if (instance && (instance.renewableLimitOffers || instance.dpOfferList)) {
          const renewableLimitOffers = instance.renewableLimitOffers || {};
          const offers = instance.dpOfferList || [];
          const hasLimit = Object.keys(renewableLimitOffers).length > 0;
          const status = hasLimit ? 'daily_limit_reached' : 'open';
          return { status, responseTimeMs, error: null };
        }
      }
    }

    // Clean HTML: Strip script and style tags to prevent matching keywords inside JavaScript or CSS
    const cleanHtml = html.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
                          .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '');

    // Check for common daily limit keywords/messages
    const limitRegexes = [
      /tageslimit/i,
      /kontingent.*erschöpft/i,
      /heute.*voll/i,
      /limit.*erreicht/i,
      /heute leider schon/i,
      /tages-limit/i,
      /teilnahme.*heute.*nicht/i,
      /kontingent.*erreicht/i,
      /das limit.*erreicht/i,
      /heute.*keine teilnahme/i,
      /kontingent.*voll/i
    ];
    const hasLimitMessage = limitRegexes.some(r => r.test(cleanHtml));

    // Check if the participate form tag exists
    const hasForm = /<form/i.test(cleanHtml);

    // Check if submit button tags exist
    const hasSubmitButton = /<button[^>]*type=["']submit["']/i.test(cleanHtml) ||
                            /<input[^>]*type=["']submit["']/i.test(cleanHtml) ||
                            /<button[^>]*class=["'][^"']*submit/i.test(cleanHtml);

    // Check if the submit button is disabled via attributes or classes
    const hasDisabledButton = /<button[^>]*disabled/i.test(cleanHtml) ||
                              /<input[^>]*type=["']submit["'][^>]*disabled/i.test(cleanHtml) ||
                              /class=["'][^"']*\bdisabled\b/i.test(cleanHtml);

    // Check if redirected to a known closed URL path
    const isRedirectedToClosed = finalUrl && (
      finalUrl.includes('/closed') ||
      finalUrl.includes('/limit') ||
      finalUrl.includes('/beendet') ||
      finalUrl.includes('/tageslimit')
    );

    // Check if there is an explicit positive counter of remaining redemptions
    let parsedRemaining = null;
    const counterMatch = cleanHtml.match(/class=["'][^"']*amount-left--numbers[^"']*">\s*((?:<div>\s*\d+\s*<\/div>\s*)+)<\/div>/i);
    if (counterMatch) {
      const numbersHtml = counterMatch[1];
      const digits = [...numbersHtml.matchAll(/<div>\s*(\d+)\s*<\/div>/gi)].map(m => m[1]).join('');
      if (digits.length > 0) {
        parsedRemaining = parseInt(digits, 10);
      }
    }

    let status = 'unknown';
    if (parsedRemaining !== null && parsedRemaining > 0) {
      status = 'open';
    } else if (parsedRemaining === 0) {
      status = 'daily_limit_reached';
    } else if (hasLimitMessage || hasDisabledButton || isRedirectedToClosed) {
      status = 'daily_limit_reached';
    } else if (hasForm && hasSubmitButton) {
      status = 'open';
    } else {
      status = 'unknown';
    }

    return { status, responseTimeMs, error: null };
  } catch (err) {
    const responseTimeMs = Date.now() - startTime;
    return { status: 'error', responseTimeMs, error: err.message };
  }
}

/**
 * Justsnap Provider
 * Fetches campaign page HTML and checks participation form, CTA, and closed/limit messages.
 *
 * Status logic:
 * - Ended messages -> ended
 * - Limit/closed messages -> daily_limit_reached
 * - Form or CTA button -> open
 * - Otherwise -> unknown
 */
async function checkJustsnap(campaign, timeoutMs) {
  const startTime = Date.now();
  try {
    const res = await fetchUrl(campaign.url, {}, timeoutMs);
    const responseTimeMs = Date.now() - startTime;
    const html = res.body;
    const finalUrl = res.finalUrl || campaign.url;

    // Check for ended promotion messages
    const endedRegexes = [
      /aktion beendet/i,
      /aktion ist beendet/i,
      /teilnahmebedingungen.*abgelaufen/i,
      /nicht mehr teilnehmen/i,
      /abgelaufen/i
    ];
    const isEnded = endedRegexes.some(r => r.test(html));

    // Check for daily limit reached messages
    const limitRegexes = [
      /tageskontingent.*erreicht/i,
      /tageslimit.*erreicht/i,
      /derzeit keine teilnahme.*möglich/i,
      /limit erreicht/i,
      /kontingent.*erschöpft/i,
      /heute.*voll/i,
      /heute.*keine teilnahme/i
    ];
    const hasLimitMessage = limitRegexes.some(r => r.test(html));

    // Check for form indicators
    const hasForm = /<form/i.test(html) || html.includes('form-') || html.includes('justsnap-form');

    // Check for CTA buttons or actions
    const hasCta = /button/i.test(html) || /teilnehmen/i.test(html) || /hochladen/i.test(html) || /cta/i.test(html);

    let status = 'unknown';
    if (isEnded) {
      status = 'ended';
    } else if (hasLimitMessage) {
      status = 'daily_limit_reached';
    } else if (hasForm || hasCta) {
      status = 'open';
    } else {
      status = 'unknown';
    }

    return { status, responseTimeMs, error: null };
  } catch (err) {
    const responseTimeMs = Date.now() - startTime;
    return { status: 'error', responseTimeMs, error: err.message };
  }
}

/**
 * Justsnap-API Provider
 * Ruft POST https://service-manager.jsnp.io/api/getRemaining ab.
 * Response: { remaining: number } – 0 = Tageslimit erreicht, >0 = offen.
 * Diese API wird von den neuen Acardo/Justsnap-SPAs (Cillit Bang, Calgon) verwendet.
 */
async function checkJustsnapApi(campaign, timeoutMs) {
  const startTime = Date.now();
  const API_URL = 'https://service-manager.jsnp.io/api/getRemaining';
  const payload = JSON.stringify({ campaignKey: campaign.campaignKey });

  return new Promise((resolve) => {
    const url = new URL(API_URL);
    let aborted = false;

    const req = https.request({
      hostname: url.hostname,
      path: url.pathname,
      method: 'POST',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'Content-Length': Buffer.byteLength(payload)
      }
    }, (res) => {
      let body = '';
      res.on('data', d => body += d);
      res.on('end', () => {
        if (aborted) return;
        const responseTimeMs = Date.now() - startTime;
        try {
          const data = JSON.parse(body);
          const remaining = data.remaining;
          const now = new Date();
          const campaignStarted = campaign.startDate ? now >= new Date(campaign.startDate) : true;
          const campaignEnded = campaign.endDate ? now > new Date(campaign.endDate) : false;

          let status;
          if (campaignEnded) {
            status = 'ended';
          } else if (!campaignStarted) {
            status = 'prestart';
          } else if (typeof remaining === 'number') {
            status = remaining > 0 ? 'open' : 'daily_limit_reached';
          } else {
            status = 'unknown';
          }
          resolve({ status, responseTimeMs, error: null });
        } catch (e) {
          resolve({ status: 'unknown', responseTimeMs, error: 'Invalid JSON: ' + e.message });
        }
      });
    });

    req.setTimeout(timeoutMs, () => {
      aborted = true;
      req.destroy();
      resolve({ status: 'error', responseTimeMs: Date.now() - startTime, error: 'Timeout after ' + timeoutMs + 'ms' });
    });
    req.on('error', (err) => {
      if (!aborted) resolve({ status: 'error', responseTimeMs: Date.now() - startTime, error: err.message });
    });
    req.write(payload);
    req.end();
  });
}

/**
 * Dispatcher to check campaign status based on provider
 */
async function checkCampaign(campaign, timeoutMs) {
  switch (campaign.provider.toLowerCase()) {
    case 'justsnap-api':
      return await checkJustsnapApi(campaign, timeoutMs);
    case 'oca':
      return await checkOca(campaign, timeoutMs);
    case 'acardo':
      return await checkAcardo(campaign, timeoutMs);
    case 'justsnap':
      return await checkJustsnap(campaign, timeoutMs);
    case 'zott':
      return await checkZott(campaign, timeoutMs);
    case 'andros':
      return await checkAndros(campaign, timeoutMs);
    case 'whiskas':
      return await checkWhiskas(campaign, timeoutMs);
    case 'purina':
      return await checkPurina(campaign, timeoutMs);
    case 'rockstar':
      return await checkRockstar(campaign, timeoutMs);
    default:
      return {
        status: 'unknown',
        responseTimeMs: 0,
        error: `Unsupported provider: ${campaign.provider}`
      };
  }
}

/**
 * Zott Provider
 * Check if weekly limit reached or form not shown.
 */
async function checkZott(campaign, timeoutMs) {
  const startTime = Date.now();
  try {
    const res = await fetchUrl(campaign.url, {}, timeoutMs);
    const responseTimeMs = Date.now() - startTime;
    const html = res.body;
    
    const hasForm = /<form/i.test(html);
    const hasLimitMessage = html.includes('Diese Woche wurden bereits alle möglichen Teilnahmen eingelöst');
    
    let status = 'open';
    if (hasLimitMessage || !hasForm) {
      status = 'daily_limit_reached';
    }
    return { status, responseTimeMs, error: null };
  } catch (err) {
    return { status: 'error', responseTimeMs: Date.now() - startTime, error: err.message };
  }
}

/**
 * Andros Provider
 * Check counter in gratistesten-aktion.de iframe.
 */
async function checkAndros(campaign, timeoutMs) {
  const startTime = Date.now();
  try {
    const res = await fetchUrl(campaign.url, {}, timeoutMs);
    const responseTimeMs = Date.now() - startTime;
    const html = res.body;
    
    const currentMatch = html.match(/derzeitige Teilnehmerzahl:\s*(\d+)/i);
    const maxMatch = html.match(/maximale Teilnehmerzahl beträgt\s*([\d.]+)/i);
    
    let status = 'unknown';
    if (currentMatch && maxMatch) {
      const current = parseInt(currentMatch[1], 10);
      const max = parseInt(maxMatch[1].replace(/\./g, ''), 10);
      status = current >= max ? 'daily_limit_reached' : 'open';
    } else {
      // Fallback
      if (html.includes('Teilnahmelimit') && html.includes('erreicht')) {
        status = 'daily_limit_reached';
      } else if (html.includes('<form')) {
        status = 'open';
      }
    }
    return { status, responseTimeMs, error: null };
  } catch (err) {
    return { status: 'error', responseTimeMs: Date.now() - startTime, error: err.message };
  }
}

/**
 * Whiskas Provider
 * Parse weekly count on purrorpass.whiskas.de/aktion/de-de/welcome/
 */
async function checkWhiskas(campaign, timeoutMs) {
  const startTime = Date.now();
  try {
    const res = await fetchUrl(campaign.url, {}, timeoutMs);
    const responseTimeMs = Date.now() - startTime;
    const html = res.body;
    
    const countMatch = html.match(/Verfügbare Cashback-Teilnahmen[^:]*:\s*(\d+)/i) || 
                       html.match(/Noch verfügbare Cashback Einträge[^:]*:\s*(\d+)/i);
                       
    let status = 'unknown';
    if (countMatch) {
      const count = parseInt(countMatch[1], 10);
      status = count === 0 ? 'daily_limit_reached' : 'open';
    } else {
      if (html.includes('kontingent erschöpft') || html.includes('derzeit keine teilnahme')) {
        status = 'daily_limit_reached';
      } else if (html.includes('flag-wrapper') || html.includes('welcome')) {
        status = 'open';
      }
    }
    return { status, responseTimeMs, error: null };
  } catch (err) {
    return { status: 'error', responseTimeMs: Date.now() - startTime, error: err.message };
  }
}

/**
 * Purina Provider
 * Check if the registration form connector is loaded or if beendet is shown.
 */
async function checkPurina(campaign, timeoutMs) {
  const startTime = Date.now();
  try {
    const res = await fetchUrl(campaign.url, {
      headers: {
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'de-DE,de;q=0.9',
        'Cache-Control': 'no-cache',
        'Sec-Ch-Ua': '"Chromium";v="120", "Google Chrome";v="120", "Not-A.Brand";v="99"',
        'Sec-Ch-Ua-Mobile': '?0',
        'Sec-Ch-Ua-Platform': '"Windows"',
        'Sec-Fetch-Dest': 'document',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Site': 'none',
        'Sec-Fetch-User': '?1',
        'Upgrade-Insecure-Requests': '1'
      }
    }, timeoutMs);
    
    const responseTimeMs = Date.now() - startTime;
    const html = res.body;
    
    let status = 'unknown';
    if (res.statusCode === 200) {
      const hasForm = html.includes('receipt-registration-promotheus') || html.includes('__nps_ReceiptConfig.formElement');
      const isEnded = html.includes('beendet') || html.includes('vorbei') || html.includes('geschlossen');
      
      if (isEnded) {
        status = 'daily_limit_reached';
      } else if (hasForm) {
        status = 'open';
      } else {
        status = 'daily_limit_reached';
      }
    } else if (res.statusCode === 403) {
      status = 'open';
    }
    return { status, responseTimeMs, error: null };
  } catch (err) {
    return { status: 'error', responseTimeMs: Date.now() - startTime, error: err.message };
  }
}

/**
 * Rockstar Provider
 * Protected by Incapsula - falls back to date checking.
 */
async function checkRockstar(campaign, timeoutMs) {
  const startTime = Date.now();
  try {
    const res = await fetchUrl(campaign.url, {
      headers: {
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'de-DE,de;q=0.9'
      }
    }, timeoutMs);
    const responseTimeMs = Date.now() - startTime;
    
    let status = 'open';
    const now = new Date();
    const start = new Date('2026-06-01');
    const end = new Date('2027-02-28');
    if (now < start) {
      status = 'prestart';
    } else if (now > end) {
      status = 'ended';
    } else {
      status = 'open';
    }
    return { status, responseTimeMs, error: null };
  } catch (err) {
    return { status: 'open', responseTimeMs: Date.now() - startTime, error: err.message };
  }
}

/**
 * Executes a full poll cycle for all campaigns in parallel.
 * Updates the stateCache object in-memory.
 */
async function pollCampaigns() {
  async function pollCampaigns() {
  console.log(`[${new Date().toISOString()}] Initiating campaign check cycle...`);

  const promises = CAMPAIGNS.map(async (campaign) => {
    const checkedAt = new Date().toISOString();
    try {
      const result = await checkCampaign(campaign, REQUEST_TIMEOUT_MS);
      return {
        name: campaign.name,
        provider: campaign.provider,
        status: result.status,
        checkedAt,
        responseTimeMs: result.responseTimeMs,
        error: result.error
      };
    } catch (e) {
      return {
        name: campaign.name,
        provider: campaign.provider,
        status: 'error',
        checkedAt,
        responseTimeMs: 0,
        error: e.message || String(e)
      };
    }
  });

  const results = await Promise.all(promises);

  stateCache.updatedAt = new Date().toISOString();
  stateCache.campaigns = results;

  console.log(`[${stateCache.updatedAt}] Campaign checks updated.`);
  results.forEach(res => {
    console.log(` - ${res.name} (${res.provider}): ${res.status} [${res.responseTimeMs}ms]${res.error ? ` (Error: ${res.error})` : ''}`);
  });

  // NEU: Daten direkt in eine JSON-Datei schreiben
  try {
    fs.writeFileSync('live-limits.json', JSON.stringify(stateCache, null, 2));
    console.log("Erfolg: live-limits.json wurde gespeichert!");
  } catch (err) {
    console.error("Fehler beim Speichern der Datei:", err);
  }
}

// Skript direkt einmalig ausführen und beenden
pollCampaigns();
server.listen(PORT, () => {
  console.log(`Unified Cashback Limit Monitor & Web Server running on port ${PORT}`);
  console.log(`Webpage available at http://localhost:${PORT}/`);
  console.log(`API endpoint available at http://localhost:${PORT}/api/limits`);
});
