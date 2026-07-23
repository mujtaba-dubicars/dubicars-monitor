// Central configuration — no secrets here (secrets come from env vars).
export const config = {
  thresholds: {
    apiMs: 600, // API SLOW bar
    pageMs: 4000, // page-load SLOW bar (tune after real numbers)
  },

  api: {
    search: {
      name: 'search',
      url: 'https://www.dubicars.com/api/v2/search?page=1',
    },
    homepage: {
      name: 'homepage',
      url: 'https://www.dubicars.com/api/v3/homepage',
    },
    suggestions: {
      name: 'suggestions',
      base: 'https://api-suggestions.dubicars.com/v1/suggestions',
      // Query a few random full make names each run. More representative than
      // typing one word letter-by-letter (those popular prefixes were mostly
      // served from CloudFront cache); rarer makes are likelier to hit origin.
      makes: ['toyota', 'honda', 'nissan', 'byd', 'mercedes', 'bmw', 'audi'],
      sampleCount: 3,
      ul: 'KW',
    },
    items: {
      name: 'items',
      urlTemplate: 'https://www.dubicars.com/api/v3/items/{id}',
      sampleCount: 3, // pick up to N random ids from the search response
    },
  },

  journey: {
    baseUrl: 'https://www.dubicars.com/',
    searchTerm: 'Nissan Navara',
    // Interactive search (primary): open the homepage search popup, type, submit.
    search: {
      // Clickable "fake bar" that opens the real search popup. First match wins.
      triggers: ['#desktop-search span.input-group.c-pointer', 'i.icon--search'],
      input: '#open-search-txt',
      typeSettleMs: 800, // let autocomplete populate before submitting
    },
    // Fallback if the popup can't be driven: the site's real results URL.
    searchUrl: 'https://www.dubicars.com/search?q={q}',
    // A DubiCars listing/ad detail page URL ends in "-<digits>.html".
    listingLinkRegex: '-\\d{5,}\\.html($|\\?)',
    // Only failed requests to these host suffixes count as real errors; everything
    // else (analytics, ads, third-party widgets) is counted but not alerted on.
    firstPartyHosts: ['dubicars.com'],
    // Known-benign failures suppressed to avoid alerting every run. Each is a
    // deliberate, documented exception — not a blanket mute.
    ignore: {
      // Substrings of the Chromium requestfailed error text.
      // ERR_ABORTED = in-flight request cancelled by our next navigation / a beacon.
      errorTexts: ['ERR_ABORTED'],
      // Regexes matched against the failing request URL.
      urlPatterns: [
        '/cdn-cgi/', // Cloudflare infra + RUM telemetry beacons
        'assets\\.dubicars\\.com/fonts/', // font served without CORS header (known issue; 200 on direct fetch)
      ],
      // Regexes matched against console-error text. "Failed to load resource" is
      // dropped because resource failures are tracked precisely by the network listener.
      consolePatterns: [
        'Failed to load resource',
        'assets\\.dubicars\\.com/fonts',
        'CORS policy',
        'advergic', // third-party ad script that intentionally disables itself
      ],
    },
    navTimeoutMs: 45000,
  },

  sheets: {
    tabs: { api: 'API_Log', journey: 'Journey_Log', netErrors: 'Network_Errors' },
  },

  // Link included in Google Chat messages.
  dashboardUrl: 'https://mujtaba-dubicars.github.io/dubicars-monitor/',
};
