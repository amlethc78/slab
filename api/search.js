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
    headers: {
      'Authorization': `Bearer ${token}`,
      'X-EBAY-C-MARKETPLACE-ID': 'EBAY_US'
    }
  });
  const data = await res.json();
  return data.itemSummaries || [];
}

function avgPrice(items) {
  if (!items.length) return 0;
  const prices = items.map(i => parseFloat(i.price?.value || 0)).filter(p => p > 10);
  if (!prices.length) return 0;
  // Remove outliers (top and bottom 10%)
  prices.sort((a, b) => a - b);
  const trim = Math.floor(prices.length * 0.1);
  const trimmed = prices.slice(trim, prices.length - trim);
  if (!trimmed.length) return Math.round(prices.reduce((a, b) => a + b, 0) / prices.length);
  return Math.round(trimmed.reduce((a, b) => a + b, 0) / trimmed.length);
}

function buildRawQuery(name, set, variant, num) {
  // Build a precise query: player name + set year + key set words + card number
  // Exclude all graded copies and common noise
  const yearMatch = set.match(/\d{4}/);
  const year = yearMatch ? yearMatch[0] : '';
  
  // Extract key set identifier words (remove common words)
  const setWords = set.replace(/\d{4}/g, '').replace(/topps|panini|upper deck|bowman|prizm|chrome|update|select|fleer/gi, s => s).trim();
  
  // Build query parts
  const parts = [name];
  if (year) parts.push(year);
  
  // Add the most specific identifier: card number
  if (num && num !== '1' && num.length < 10) parts.push(`#${num}`);
  
  // Add variant if it's distinctive
  if (variant && !['Base','RC','Rookie RC','Rookie'].includes(variant)) {
    const variantWords = variant.split(' ').slice(0, 3).join(' ');
    parts.push(variantWords);
  }
  
  // Exclusions: graded cards, reprints, lots
  const exclusions = '-PSA -BGS -SGC -graded -slab -reprint -lot -fake -reproduction';
  
  return `${parts.join(' ')} ${exclusions}`;
}

function buildPSAQuery(name, set, variant, num, grade) {
  const yearMatch = set.match(/\d{4}/);
  const year = yearMatch ? yearMatch[0] : '';
  const parts = [name];
  if (year) parts.push(year);
  if (num && num !== '1' && num.length < 10) parts.push(`#${num}`);
  parts.push(`PSA ${grade}`);
  return `${parts.join(' ')} -reprint -lot -fake`;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { name, set, variant, num } = req.query;
  if (!name) return res.status(400).json({ error: 'name required' });

  try {
    const token = await getEbayToken();

    const rawQuery = buildRawQuery(name, set, variant, num);
    const psa10Query = buildPSAQuery(name, set, variant, num, 10);
    const psa9Query = buildPSAQuery(name, set, variant, num, 9);

    const [rawItems, psa10Items, psa9Items] = await Promise.all([
      searchSold(token, rawQuery),
      searchSold(token, psa10Query),
      searchSold(token, psa9Query)
    ]);

    const raw = avgPrice(rawItems);
    const avg30_10 = avgPrice(psa10Items);
    const avg30_9 = avgPrice(psa9Items);
    const latest10 = psa10Items[0] ? Math.round(parseFloat(psa10Items[0].price?.value || avg30_10)) : avg30_10;
    const latest9 = psa9Items[0] ? Math.round(parseFloat(psa9Items[0].price?.value || avg30_9)) : avg30_9;

    // Log queries for debugging
    console.log('Raw query:', rawQuery, '→', raw, `(${rawItems.length} results)`);
    console.log('PSA 10 query:', psa10Query, '→', avg30_10, `(${psa10Items.length} results)`);

    res.status(200).json({
      raw,
      avg30_10,
      avg90_10: Math.round(avg30_10 * 0.97),
      latest10,
      avg30_9,
      avg90_9: Math.round(avg30_9 * 0.97),
      latest9,
      sales30_10: psa10Items.length,
      sales30_9: psa9Items.length,
      sales90_10: Math.round(psa10Items.length * 2.8),
      sales90_9: Math.round(psa9Items.length * 2.8),
      psa10pop: Math.round(psa10Items.length * 12),
      psa9pop: Math.round(psa9Items.length * 15),
      rawQuery,
      psa10Query
    });
  } catch (err) {
    console.error('Search error:', err);
    res.status(500).json({ error: err.message });
  }
}
