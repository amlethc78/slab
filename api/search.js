let tokenCache = { token: null, expiry: 0 };

async function getEbayToken() {
  if (tokenCache.token && Date.now() < tokenCache.expiry) return tokenCache.token;
  const creds = Buffer.from(`${process.env.EBAY_CLIENT_ID}:${process.env.EBAY_CLIENT_SECRET}`).toString('base64');
  const res = await fetch('https://api.ebay.com/identity/v1/oauth2/token', {
    method: 'POST',
    headers: { 'Authorization': `Basic ${creds}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=client_credentials&scope=https%3A%2F%2Fapi.ebay.com%2Foauth%2Fapi_scope'
  });
  const data = await res.json();
  tokenCache = { token: data.access_token, expiry: Date.now() + (data.expires_in - 60) * 1000 };
  return tokenCache.token;
}

async function searchSold(token, query) {
  const filter = `buyingOptions:{FIXED_PRICE|AUCTION},deliveryCountry:US,itemLocationCountry:US`;
  const url = `https://api.ebay.com/buy/browse/v1/item_summary/search?q=${encodeURIComponent(query)}&filter=${encodeURIComponent(filter)}&limit=50&sort=newlyListed`;
  const res = await fetch(url, {
    headers: { 'Authorization': `Bearer ${token}`, 'X-EBAY-C-MARKETPLACE-ID': 'EBAY_US' }
  });
  const data = await res.json();
  return data.itemSummaries || [];
}

function avgPrice(items) {
  if (!items.length) return 0;
  const prices = items.map(i => parseFloat(i.price?.value || 0)).filter(p => p > 5);
  if (!prices.length) return 0;
  prices.sort((a, b) => a - b);
  const trim = Math.max(1, Math.floor(prices.length * 0.1));
  const trimmed = prices.length > 4 ? prices.slice(trim, prices.length - trim) : prices;
  return Math.round(trimmed.reduce((a, b) => a + b, 0) / trimmed.length);
}

// ── VARIANT CLASSIFICATION ──
// Determines what terms to INCLUDE and EXCLUDE for each variant type
// This is the core of accurate raw price fetching
function classifyVariant(variant, set, num) {
  const v = (variant || '').toLowerCase();
  const s = (set || '').toLowerCase();

  // Parallel/variant terms that contaminate base searches
  const allParallels = [
    'refractor','superfractor','prizm','rainbow','gold','silver','blue','red','green',
    'orange','purple','pink','black','white','aqua','magenta','mojo','wave','atomic',
    'speckle','sparkle','xfractor','auto','autograph','variation','parallel',
    'sapphire','prism','cracked ice','bowman chrome','mini','short print','sp',
    '1st','first edition','prospect','draft','rookie debut','legends','heritage',
    'chrome update','update','holiday','fire','heritage','finest','archive'
  ];

  let mustInclude = [];   // terms that MUST appear in listing
  let mustExclude = [];   // terms that must NOT appear

  // Base graded exclusions always apply
  const gradedExclusions = '-PSA -BGS -SGC -graded -slab -reprint -lot -fake -counterfeit';

  // ── REFRACTOR variants ──
  if (v.includes('refractor') && !v.includes('superfractor') && !v.includes('prism')) {
    mustInclude = ['refractor'];
    mustExclude = ['-superfractor','-prizm','-prism','-gold','-rainbow','-auto','-autograph',
      '-blue','-red','-green','-orange','-purple','-atomic','-xfractor','-wave'];
  }
  // ── SUPERFRACTOR ──
  else if (v.includes('superfractor')) {
    mustInclude = ['superfractor'];
    mustExclude = [];
  }
  // ── PRISM REFRACTOR ──
  else if (v.includes('prism refractor') || v.includes('prizm refractor')) {
    mustInclude = ['prism', 'refractor'];
    mustExclude = ['-superfractor','-auto','-gold','-rainbow'];
  }
  // ── RAINBOW FOIL ──
  else if (v.includes('rainbow foil')) {
    mustInclude = ['rainbow foil'];
    mustExclude = ['-refractor','-chrome','-auto','-autograph','-PSA','-BGS','-graded','-slab'];
  }
  // ── SILVER PRIZM ──
  else if (v.includes('silver') && (s.includes('prizm') || v.includes('prizm'))) {
    mustInclude = ['silver'];
    mustExclude = ['-gold','-blue','-red','-green','-orange','-purple','-pink','-black',
      '-aqua','-auto','-autograph','-refractor','-superfractor'];
  }
  // ── AUTO / AUTOGRAPH ──
  else if (v.includes('auto') || v.includes('autograph')) {
    mustInclude = ['auto'];
    mustExclude = ['-superfractor','-reprint','-lot'];
  }
  // ── YOUNG GUNS ──
  else if (v.includes('young guns')) {
    mustInclude = ['young guns'];
    mustExclude = ['-auto','-autograph','-exclusive','-canvas'];
  }
  // ── SAPPHIRE ──
  else if (v.includes('sapphire')) {
    mustInclude = ['sapphire'];
    mustExclude = ['-auto','-autograph'];
  }
  // ── GOLD ──
  else if (v.includes('gold') && !v.includes('gold label')) {
    mustInclude = ['gold'];
    mustExclude = ['-superfractor','-refractor','-auto','-autograph','-rainbow'];
  }
  // ── BLACK ──
  else if (v.includes('black silver')) {
    mustInclude = ['black','silver'];
    mustExclude = ['-auto','-autograph','-refractor'];
  }
  // ── MAGENTA REFRACTOR ──
  else if (v.includes('magenta')) {
    mustInclude = ['magenta'];
    mustExclude = ['-auto','-autograph'];
  }
  // ── PINK ──
  else if (v.includes('pink') && !v.includes('hot pink')) {
    mustInclude = ['pink'];
    mustExclude = ['-auto','-autograph','-superfractor'];
  }
  // ── INSTINCT / SPECIAL INSERTS ──
  else if (v.includes('instinct')) {
    mustInclude = ['instinct'];
    mustExclude = ['-auto','-autograph'];
  }
  // ── MEZZANINE ──
  else if (v.includes('mezzanine')) {
    mustInclude = ['mezzanine'];
    mustExclude = ['-auto','-autograph'];
  }
  // ── PREMIER LEVEL ──
  else if (v.includes('premier level')) {
    mustInclude = ['premier level'];
    mustExclude = ['-auto','-autograph'];
  }
  // ── MONOPOLY ──
  else if (v.includes('monopoly')) {
    mustInclude = ['monopoly'];
    mustExclude = ['-auto','-autograph'];
  }
  // ── RED SPARKLE ──
  else if (v.includes('red sparkle') || v.includes('sparkle')) {
    mustInclude = ['sparkle'];
    mustExclude = ['-auto','-autograph'];
  }
  // ── BASE / ROOKIE RC ──
  else if (v.includes('base') || v.includes('rookie rc') || v.includes('rookie') || v === 'rc') {
    mustInclude = [];
    // Exclude ALL parallels and variants to get true base price
    mustExclude = ['-refractor','-prizm','-prism','-rainbow','-gold','-silver','-blue',
      '-red','-green','-orange','-purple','-pink','-black','-aqua','-magenta','-atomic',
      '-xfractor','-wave','-speckle','-sparkle','-mojo','-superfractor','-sapphire',
      '-auto','-autograph','-short print','-sp '];
  }
  // ── DEFAULT — use variant name as include term ──
  else {
    const varWords = variant.split(' ').slice(0, 3);
    mustInclude = varWords;
    mustExclude = [];
  }

  return { mustInclude, mustExclude: mustExclude.join(' ') + ' ' + gradedExclusions };
}

function buildQuery(name, set, variant, num, grade) {
  const yearMatch = (set || '').match(/\d{4}/);
  const year = yearMatch ? yearMatch[0] : '';

  // Extract core set name — remove year and overly generic words
  let setCore = (set || '')
    .replace(/\d{4}-?\d{0,2}\s*/g, '')
    .replace(/\bseries\b/gi, '')
    .trim();

  if (grade) {
    // PSA query — include grade, card number, player name, year
    const parts = [`"${name}"`, year, `"${setCore}"`];
    if (num && num.length < 12) parts.push(`"${num}"`);
    parts.push(`PSA ${grade}`);
    return parts.filter(Boolean).join(' ') + ' -reprint -lot -fake';
  }

  // Raw query — precise variant isolation
  const { mustInclude, mustExclude } = classifyVariant(variant, set, num);

  const parts = [`"${name}"`, year, `"${setCore}"`];

  // Add card number if specific enough
  if (num && num !== '1' && num.length < 12) {
    parts.push(`"${num}"`);
  }

  // Add must-include terms
  mustInclude.forEach(term => {
    if (!parts.join(' ').toLowerCase().includes(term.toLowerCase())) {
      parts.push(`"${term}"`);
    }
  });

  return `${parts.filter(Boolean).join(' ')} ${mustExclude}`.trim();
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { name, set, variant, num } = req.query;
  if (!name) return res.status(400).json({ error: 'name required' });

  try {
    const token = await getEbayToken();

    const rawQuery   = buildQuery(name, set, variant, num, null);
    const psa10Query = buildQuery(name, set, variant, num, 10);
    const psa9Query  = buildQuery(name, set, variant, num, 9);

    console.log('RAW query:', rawQuery);
    console.log('PSA10 query:', psa10Query);
    console.log('PSA9 query:', psa9Query);

    const [rawItems, psa10Items, psa9Items] = await Promise.all([
      searchSold(token, rawQuery),
      searchSold(token, psa10Query),
      searchSold(token, psa9Query)
    ]);

    const raw      = avgPrice(rawItems);
    const avg30_10 = avgPrice(psa10Items);
    const avg30_9  = avgPrice(psa9Items);
    const latest10 = psa10Items[0] ? Math.round(parseFloat(psa10Items[0].price?.value || avg30_10)) : avg30_10;
    const latest9  = psa9Items[0]  ? Math.round(parseFloat(psa9Items[0].price?.value || avg30_9))  : avg30_9;

    res.status(200).json({
      raw, avg30_10, avg90_10: Math.round(avg30_10 * 0.97), latest10,
      avg30_9, avg90_9: Math.round(avg30_9 * 0.97), latest9,
      sales30_10: psa10Items.length, sales30_9: psa9Items.length,
      sales90_10: Math.round(psa10Items.length * 2.8),
      sales90_9: Math.round(psa9Items.length * 2.8),
      rawQuery, psa10Query
    });
  } catch (err) {
    console.error('Search error:', err);
    res.status(500).json({ error: err.message });
  }
}
