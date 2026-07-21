// api/search.js — IMAGE ONLY, via eBay Browse API (active listings)
//
// Purpose: fetch a real card thumbnail for the dashboard. Nothing else.
// All prices/pop/score in the app stay as the seeded sold-comp data — this
// endpoint does NOT touch them. It returns only an image URL.
//
// Why Browse: the old Finding API (findCompletedItems) was decommissioned
// 2025-02-05. Browse is supported and returns listing photos. Browse is
// active listings only, so we use it purely for the picture, never the price.
//
// Auth: OAuth2 client-credentials using EBAY_CLIENT_ID + EBAY_CLIENT_SECRET
// (already set in Vercel). No new env vars.

const TOKEN_URL  = 'https://api.ebay.com/identity/v1/oauth2/token';
const BROWSE_URL = 'https://api.ebay.com/buy/browse/v1/item_summary/search';
const SCOPE      = 'https://api.ebay.com/oauth/api_scope';

// Parallel/insert terms — used to avoid picking a parallel's photo for a base card
const PARALLEL_TERMS = [
  'refractor','superfractor','prizm','prism','rainbow','gold','silver',
  'sapphire','sparkle','mojo','auto','autograph','patch','relic','/25','/10','/5','/1','1/1'
];

const itemTitle = it => (it.title || '').toLowerCase();
const itemImage = it => it.image?.imageUrl || it.thumbnailImages?.[0]?.imageUrl || null;

function isParallelTitle(it) {
  const t = itemTitle(it);
  return PARALLEL_TERMS.some(term => t.includes(term));
}

function baseKeywords(name, set, num) {
  const yearMatch = (set || '').match(/(\d{4})/);
  const year = yearMatch ? yearMatch[1] : '';
  const setCore = (set || '')
    .replace(/\d{4}-?\d{0,2}/g, '')
    .replace(/\b(series|edition|hobby|retail)\b/gi, '')
    .trim();
  let q = `${name} ${year} ${setCore}`.trim();
  if (num && num !== '1' && num.length <= 8 && !/^(1|2|3|4|5)$/.test(num)) q += ` ${num}`;
  return q;
}

function variantTerm(variant, set) {
  const v = (variant || '').toLowerCase();
  if (v.includes('rainbow foil')) return '"rainbow foil"';
  if (v.includes('superfractor')) return 'superfractor';
  if (v.includes('prism refractor') || v.includes('prizm refractor')) return '"prism refractor"';
  if (v.includes('refractor')) return 'refractor';
  if (v.includes('magenta')) return 'magenta';
  if (v.includes('sapphire')) return 'sapphire';
  if (v.includes('young guns')) return '"young guns"';
  if (v.includes('sparkle')) return 'sparkle';
  if (v.includes('auto') || v.includes('autograph')) return 'auto';
  if (v.includes('silver') && (set || '').toLowerCase().includes('prizm')) return 'silver';
  if (v.includes('gold')) return 'gold';
  return '';
}

function buildQuery(name, set, variant, num) {
  return `${baseKeywords(name, set, num)} ${variantTerm(variant, set)}`.replace(/\s+/g, ' ').trim();
}

// ── OAuth token (cached in module scope until expiry) ──
let cachedToken = null;
let tokenExpiresAt = 0;

async function getToken(clientId, clientSecret) {
  if (cachedToken && Date.now() < tokenExpiresAt) return cachedToken;
  const basic = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Authorization': `Basic ${basic}`,
    },
    body: `grant_type=client_credentials&scope=${encodeURIComponent(SCOPE)}`,
  });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`eBay token error ${res.status}: ${t.slice(0, 200)}`);
  }
  const data = await res.json();
  cachedToken = data.access_token;
  tokenExpiresAt = Date.now() + ((data.expires_in || 7200) - 60) * 1000;
  return cachedToken;
}

async function browseSearch(token, query, limit = 20) {
  const url = `${BROWSE_URL}?q=${encodeURIComponent(query)}&limit=${limit}`;
  const res = await fetch(url, {
    headers: {
      'Authorization': `Bearer ${token}`,
      'X-EBAY-C-MARKETPLACE-ID': 'EBAY_US',
      'Content-Type': 'application/json',
    },
  });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`eBay browse error ${res.status}: ${t.slice(0, 200)}`);
  }
  const data = await res.json();
  return data.itemSummaries || [];
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { name, set, variant, num } = req.query;
  if (!name) return res.status(400).json({ error: 'name required' });

  const clientId = process.env.EBAY_CLIENT_ID;
  const clientSecret = process.env.EBAY_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    return res.status(500).json({ error: 'EBAY_CLIENT_ID / EBAY_CLIENT_SECRET not configured' });
  }

  try {
    const token = await getToken(clientId, clientSecret);
    const query = buildQuery(name, set, variant, num);
    const items = await browseSearch(token, query, 20);

    // For a base card, prefer a non-parallel listing so the photo matches.
    let pool = items;
    if (!variantTerm(variant, set)) {
      const nonParallel = items.filter(it => !isParallelTitle(it));
      if (nonParallel.length) pool = nonParallel;
    }
    const image = pool.map(itemImage).find(Boolean) || null;

    res.status(200).json({ image, query, total: items.length });
  } catch (err) {
    console.error('Image search error:', err.message);
    res.status(500).json({ error: err.message });
  }
}