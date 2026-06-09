const FINDING_API = 'https://svcs.ebay.com/services/search/FindingService/v1';

// ── PARALLEL TERMS — any listing title containing these = NOT a base card ──
const PARALLEL_TERMS = [
  'refractor','superfractor','prizm','prism','rainbow','gold','silver',
  'blue wave','red wave','green wave','orange','purple','pink','black',
  'aqua','magenta','atomic','xfractor','speckle','sparkle','mojo',
  'sapphire','cracked ice','mini','short print',' sp ','1st edition',
  'first edition','laser','neon','electric','pulsar','hyper',
  'canvas','exclusive','red foil','blue foil','gold foil',
  'platinum','chrome refractor','copper','bronze','emerald','ruby',
  'tiger','camo','flag','fireworks','independence','mother','father',
  'holiday','winter','spring','all-star','asg','photo','variation',
  '/25','/10','/5','/1','1/1','auto ','autograph','rpa','patch',
  'rookie auto','auto rookie','signed','jersey','relic','bat','base ball',
  'one of one','1 of 1'
];

// Terms that MUST appear in the title for graded queries
const GRADED_REQUIRED = ['psa'];

// Post-filter: remove listings whose titles contain parallel terms
function filterRawListings(items) {
  return items.filter(item => {
    const title = (item.title?.[0] || '').toLowerCase();
    return !PARALLEL_TERMS.some(term => title.includes(term.toLowerCase()));
  });
}

// Post-filter: keep only listings that mention PSA + the correct grade
function filterGradedListings(items, grade) {
  return items.filter(item => {
    const title = (item.title?.[0] || '').toLowerCase();
    return title.includes('psa') && (
      title.includes(`psa ${grade}`) ||
      title.includes(`psa${grade}`) ||
      title.includes(`psa-${grade}`) ||
      title.includes(`grade ${grade}`) ||
      title.includes(`gem mint ${grade === 10 ? '10' : ''}`)
    );
  });
}

function avgPrice(items) {
  if (!items.length) return 0;
  const prices = items
    .map(i => parseFloat(
      i.sellingStatus?.[0]?.currentPrice?.[0]?.['__value__'] || 0
    ))
    .filter(p => p > 5);
  if (!prices.length) return 0;
  prices.sort((a, b) => a - b);
  // Trim top and bottom 10% to remove outliers
  const trim = prices.length > 8 ? Math.floor(prices.length * 0.1) : 0;
  const trimmed = trim > 0 ? prices.slice(trim, prices.length - trim) : prices;
  return Math.round(trimmed.reduce((a, b) => a + b, 0) / trimmed.length);
}

function buildRawQuery(name, set, variant, num) {
  const v = (variant || '').toLowerCase();
  const yearMatch = (set || '').match(/(\d{4})/);
  const year = yearMatch ? yearMatch[1] : '';
  const setCore = (set || '')
    .replace(/\d{4}-?\d{0,2}/g, '')
    .replace(/\b(series|edition|hobby|retail)\b/gi, '')
    .trim();

  let query = `${name} ${year} ${setCore}`.trim();

  // Add card number when specific
  if (num && num !== '1' && num.length <= 8 && !/^(1|2|3|4|5)$/.test(num)) {
    query += ` ${num}`;
  }

  // Add variant-specific include terms so the correct parallel IS found
  if (v.includes('rainbow foil')) {
    query += ' "rainbow foil"';
  } else if (v.includes('superfractor')) {
    query += ' superfractor';
  } else if (v.includes('prism refractor') || v.includes('prizm refractor')) {
    query += ' "prism refractor"';
  } else if (v.includes('refractor')) {
    query += ' refractor';
  } else if (v.includes('magenta')) {
    query += ' magenta';
  } else if (v.includes('black silver')) {
    query += ' "black silver"';
  } else if (v.includes('silver') && (set || '').toLowerCase().includes('prizm')) {
    query += ' silver';
  } else if (v.includes('gold')) {
    query += ' gold';
  } else if (v.includes('sapphire')) {
    query += ' sapphire';
  } else if (v.includes('young guns')) {
    query += ' "young guns"';
  } else if (v.includes('mezzanine')) {
    query += ' mezzanine';
  } else if (v.includes('premier level')) {
    query += ' "premier level"';
  } else if (v.includes('monopoly')) {
    query += ' monopoly';
  } else if (v.includes('sparkle')) {
    query += ' sparkle';
  } else if (v.includes('instinct')) {
    query += ' instinct';
  } else if (v.includes('legends in the making')) {
    query += ' "legends in the making"';
    if (v.includes('black')) query += ' black';
    else if (v.includes('blue')) query += ' blue';
  } else if (v.includes('rookie debut')) {
    query += ' "rookie debut"';
  } else if (v.includes("best performers") || v.includes("bowman's best")) {
    query += ' "best performers"';
  } else if (v.includes('pink')) {
    query += ' pink';
  } else if (v.includes('auto') || v.includes('autograph')) {
    query += ' auto';
  }

  // For BASE cards — add explicit keyword exclusions as a first-pass filter
  // Post-filtering handles the rest
  const isBase = !v.includes('refractor') && !v.includes('prizm') && !v.includes('prism') &&
    !v.includes('rainbow') && !v.includes('gold') && !v.includes('silver') &&
    !v.includes('auto') && !v.includes('sapphire') && !v.includes('sparkle') &&
    !v.includes('foil') && !v.includes('mezzanine') && !v.includes('monopoly') &&
    !v.includes('magenta') && !v.includes('instinct') && !v.includes('premier') &&
    (v.includes('base') || v.includes('rookie rc') || v.includes('rookie') || v === 'rc' || v === '');

  if (isBase) {
    query += ' -refractor -prizm -rainbow -gold -superfractor -auto -autograph -sapphire -sparkle';
  }

  // Always exclude graded and noise
  query += ' -PSA -BGS -SGC -graded -slab -reprint -lot -fake';

  return query.replace(/\s+/g, ' ').trim();
}

function buildGradedQuery(name, set, variant, num, grade) {
  const yearMatch = (set || '').match(/(\d{4})/);
  const year = yearMatch ? yearMatch[1] : '';
  const setCore = (set || '')
    .replace(/\d{4}-?\d{0,2}/g, '')
    .replace(/\b(series|edition)\b/gi, '')
    .trim();

  let query = `${name} ${year} ${setCore}`.trim();
  if (num && num !== '1' && num.length <= 8) query += ` ${num}`;
  query += ` PSA ${grade}`;
  query += ' -reprint -lot -fake -counterfeit';
  return query.replace(/\s+/g, ' ').trim();
}

async function findCompletedItems(appId, query, entriesPerPage = 50) {
  const params = new URLSearchParams({
    'OPERATION-NAME': 'findCompletedItems',
    'SERVICE-VERSION': '1.0.0',
    'SECURITY-APPNAME': appId,
    'RESPONSE-DATA-FORMAT': 'JSON',
    'keywords': query,
    'itemFilter(0).name': 'SoldItemsOnly',
    'itemFilter(0).value': 'true',
    'sortOrder': 'EndTimeSoonest',
    'paginationInput.entriesPerPage': String(entriesPerPage),
  });

  const url = `${FINDING_API}?${params.toString()}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`eBay API error: ${res.status}`);
  const data = await res.json();

  try {
    return data?.findCompletedItemsResponse?.[0]?.searchResult?.[0]?.item || [];
  } catch {
    return [];
  }
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { name, set, variant, num } = req.query;
  if (!name) return res.status(400).json({ error: 'name required' });

  const appId = process.env.EBAY_APP_ID || process.env.EBAY_CLIENT_ID;
  if (!appId) return res.status(500).json({ error: 'EBAY_APP_ID not configured' });

  try {
    const rawQuery   = buildRawQuery(name, set, variant, num);
    const psa10Query = buildGradedQuery(name, set, variant, num, 10);
    const psa9Query  = buildGradedQuery(name, set, variant, num, 9);

    console.log('RAW query:', rawQuery);
    console.log('PSA10 query:', psa10Query);

    const [rawItemsRaw, psa10ItemsRaw, psa9ItemsRaw] = await Promise.all([
      findCompletedItems(appId, rawQuery, 80),
      findCompletedItems(appId, psa10Query, 50),
      findCompletedItems(appId, psa9Query, 50)
    ]);

    // ── POST-FILTER: remove parallels from raw results ──
    const rawItems  = filterRawListings(rawItemsRaw);
    const psa10Items = filterGradedListings(psa10ItemsRaw, 10);
    const psa9Items  = filterGradedListings(psa9ItemsRaw, 9);

    console.log(`Raw: ${rawItemsRaw.length} → ${rawItems.length} after filtering`);
    console.log(`PSA10: ${psa10ItemsRaw.length} → ${psa10Items.length} after filtering`);

    // Log a sample of kept titles for verification
    if (rawItems.length > 0) {
      console.log('Sample raw titles kept:');
      rawItems.slice(0, 3).forEach(i => console.log(' •', i.title?.[0]));
    }
    if (rawItemsRaw.length > rawItems.length) {
      console.log('Sample raw titles filtered OUT:');
      rawItemsRaw.filter(i => !rawItems.includes(i)).slice(0, 3)
        .forEach(i => console.log(' ✗', i.title?.[0]));
    }

    const raw      = avgPrice(rawItems);
    const avg30_10 = avgPrice(psa10Items);
    const avg30_9  = avgPrice(psa9Items);
    const latest10 = psa10Items[0]
      ? Math.round(parseFloat(psa10Items[0].sellingStatus?.[0]?.currentPrice?.[0]?.['__value__'] || avg30_10))
      : avg30_10;
    const latest9 = psa9Items[0]
      ? Math.round(parseFloat(psa9Items[0].sellingStatus?.[0]?.currentPrice?.[0]?.['__value__'] || avg30_9))
      : avg30_9;

    res.status(200).json({
      raw, avg30_10, avg90_10: Math.round(avg30_10 * 0.97), latest10,
      avg30_9,  avg90_9: Math.round(avg30_9 * 0.97), latest9,
      sales30_10: psa10Items.length, sales30_9: psa9Items.length,
      sales90_10: Math.round(psa10Items.length * 2.8),
      sales90_9:  Math.round(psa9Items.length * 2.8),
      rawQuery, psa10Query,
      rawTotal: rawItemsRaw.length, rawKept: rawItems.length,
      psa10Total: psa10ItemsRaw.length, psa10Kept: psa10Items.length
    });

  } catch (err) {
    console.error('Search error:', err.message);
    res.status(500).json({ error: err.message });
  }
}
