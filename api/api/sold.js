// api/sold.js — real eBay SOLD comps via Apify scraper (caffein.dev/ebay-sold-listings)
//
// Why scraping: eBay's Finding API (sold comps) was decommissioned 2025-02-05, and
// the official sold-data API (Marketplace Insights) is partner-approval-only. Scraping
// public sold-listing search pages is the working route. Same Apify setup your PSA
// pop scraper already uses (APIFY_TOKEN env var).
//
// This runs ONE Apify run per card with three keywords (raw / PSA 10 / PSA 9) and
// returns averaged sold prices in the same shape the app already consumes.
//
// NOTE ON SCOPE: this fetches sold comps for a SINGLE card on demand (called when a
// card is opened). It does not re-rank the whole dashboard — that would need a batch
// job that scrapes every card and stores the results. This is the per-card version.

const ACTOR = 'caffein.dev~ebay-sold-listings';
const APIFY_RUN = `https://api.apify.com/v2/acts/${ACTOR}/run-sync-get-dataset-items`;

// Allow up to 60s for the scrape (Vercel Pro; hobby tier caps lower — see README note).
export const config = { maxDuration: 60 };

// ── parallel terms, to keep parallels out of a base-card raw average ──
const PARALLEL_TERMS = [
  'refractor','superfractor','prizm','prism','rainbow','gold','silver',
  'sapphire','sparkle','mojo','auto','autograph','patch','relic',
  '/25','/10','/5','/1','1/1','sepia','orange','pink','magenta','teal'
];

function baseKeywords(name, set, num) {
  const yearMatch = (set || '').match(/(\d{4})/);
  const year = yearMatch ? yearMatch[1] : '';
  const setCore = (set || '')
    .replace(/\d{4}-?\d{0,2}/g, '')
    .replace(/\b(series|edition|hobby|retail)\b/gi, '')
    .trim();
  let q = `${name} ${year} ${setCore}`.trim();
  if (num && num !== '1' && num.length <= 8 && !/^(1|2|3|4|5)$/.test(num)) q += ` ${num}`;
  return q.replace(/\s+/g, ' ').trim();
}

function variantTerm(variant, set) {
  const v = (variant || '').toLowerCase();
  if (v.includes('rainbow foil')) return 'rainbow foil';
  if (v.includes('superfractor')) return 'superfractor';
  if (v.includes('prism refractor') || v.includes('prizm refractor')) return 'prism refractor';
  if (v.includes('refractor')) return 'refractor';
  if (v.includes('sapphire')) return 'sapphire';
  if (v.includes('young guns')) return 'young guns';
  if (v.includes('sparkle')) return 'sparkle';
  if (v.includes('auto') || v.includes('autograph')) return 'auto';
  if (v.includes('silver') && (set || '').toLowerCase().includes('prizm')) return 'silver';
  if (v.includes('gold')) return 'gold';
  return '';
}

function trimmedAvg(prices) {
  const p = prices.filter(x => x > 5).sort((a, b) => a - b);
  if (!p.length) return 0;
  const trim = p.length > 8 ? Math.floor(p.length * 0.1) : 0;
  const t = trim > 0 ? p.slice(trim, p.length - trim) : p;
  return Math.round(t.reduce((a, b) => a + b, 0) / t.length);
}

const soldPrice = it => parseFloat(it.soldPrice || it.totalPrice || 0);
const lower = it => (it.title || '').toLowerCase();

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { name, set, variant, num } = req.query;
  if (!name) return res.status(400).json({ error: 'name required' });

  const token = process.env.APIFY_TOKEN;
  if (!token) return res.status(500).json({ error: 'APIFY_TOKEN not configured' });

  const vt = variantTerm(variant, set);
  const base = baseKeywords(name, set, num);
  const rawKw   = `${base} ${vt} -psa -bgs -sgc -cgc`.replace(/\s+/g, ' ').trim();
  const psa10Kw = `${base} PSA 10`.replace(/\s+/g, ' ').trim();
  const psa9Kw  = `${base} PSA 9`.replace(/\s+/g, ' ').trim();

  const input = {
    keywords: [rawKw, psa10Kw, psa9Kw],
    daysToScrape: 30,
    count: 50,
    ebaySite: 'ebay.com',
    sortOrder: 'endedRecently',
    itemCondition: 'any',
    currencyMode: 'USD',
    detailedSearch: false,
  };

  try {
    const r = await fetch(`${APIFY_RUN}?token=${encodeURIComponent(token)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
    if (!r.ok) {
      const t = await r.text().catch(() => '');
      return res.status(502).json({ error: `Apify error ${r.status}: ${t.slice(0, 200)}` });
    }
    const items = await r.json();
    if (!Array.isArray(items)) return res.status(502).json({ error: 'unexpected Apify response' });

    // Bucket by which keyword produced each row (actor tags results with `keyword`),
    // then apply title safety filters.
    const byKw = kw => items.filter(it => (it.keyword || '') === kw);

    const rawItems = byKw(rawKw).filter(it => {
      const t = lower(it);
      if (t.includes('psa') || t.includes('bgs') || t.includes('sgc') || t.includes('cgc')) return false;
      if (!vt) return !PARALLEL_TERMS.some(term => t.includes(term)); // base card: drop parallels
      return true;
    });
    const psa10Items = byKw(psa10Kw).filter(it => {
      const t = lower(it);
      return t.includes('psa') && (t.includes('psa 10') || t.includes('psa10') || t.includes('gem mint 10'));
    });
    const psa9Items = byKw(psa9Kw).filter(it => {
      const t = lower(it);
      return t.includes('psa') && (t.includes('psa 9') || t.includes('psa9'));
    });

    const raw      = trimmedAvg(rawItems.map(soldPrice));
    const avg30_10 = trimmedAvg(psa10Items.map(soldPrice));
    const avg30_9  = trimmedAvg(psa9Items.map(soldPrice));

    res.status(200).json({
      raw, avg30_10, avg30_9,
      sales30_10: psa10Items.length, sales30_9: psa9Items.length,
      dataType: 'sold_comps',
      counts: { raw: rawItems.length, psa10: psa10Items.length, psa9: psa9Items.length, total: items.length },
    });
  } catch (err) {
    console.error('Sold scrape error:', err.message);
    res.status(500).json({ error: err.message });
  }
}