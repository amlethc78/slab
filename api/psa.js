// api/psa.js
// Fetches real PSA population data via Apify lulzasaur/psa-pop-scraper
// Returns: psa10pop, psa9pop, totalpop, gemRate, psa9Rate

const APIFY_TOKEN = process.env.APIFY_TOKEN;
const ACTOR = 'lulzasaur~psa-pop-scraper';

// PSA spec IDs extracted from psacard.com URLs
// URL pattern: psacard.com/auctionprices/[sport]/[set]/[player]/values/[SPEC_ID]
// To find: search psacard.com for the card, look at the URL of the auction prices page
const SPEC_IDS = {
  // ── OHTANI ──
  'o01': '2694018',  // 2018 Topps Update Rainbow Foil #US189
  'o02': null,       // 2024 Topps Chrome Refractor #1 — too new, no spec ID yet
  'o03': null,       // 2024 Topps Chrome Prism Refractor
  'o04': null,       // 2018 Topps Update LITM Black
  'o05': null,       // 2018 Bowman's Best 98BP-SO
  'o06': null,       // 2018 Topps Update LITM Blue
  'o07': '2659441',  // 2018 Topps Chrome Update Pink #HMT32
  'o08': null,       // 2018 Topps Chrome Update Base HMT32
  'o09': null,       // 2024 Bowman Chrome Sapphire
  'o10': null,       // 2020 Topps Chrome Refractor #21
  'o11': null,       // 2025 Topps Chrome Prism Refractor
  'o12': '2662525',  // 2018 Topps Update Rookie Debut #US285
  'o13': null,       // 2018 Topps Chrome Update HMT1
  'o14': '2618202',  // 2018 Topps Chrome Rookie RC #150 (Prism Refractor spec — base is similar range)
  // ── NON-OHTANI COIN ──
  'c01': null,       // Jacob Misiorowski — too new
  'c02': null,       // Carson Benge — too new
  'c03': null,       // Sal Stewart — too new
  'c04': null,       // Roman Anthony — too new
  // ── BASKETBALL ──
  'k01': null,       // Caitlin Clark 2025 Prizm — too new
  'k02': null,       // Dylan Harper — too new
  'k03': null,       // Dylan Harper Refractor — too new
  'k04': null,       // Victor Wembanyama Premier Level Silver
  'k05': null,       // Stephen Curry Black Silver
  // ── HOCKEY ──
  'h01': '2089244',  // Nathan MacKinnon 2013-14 Upper Deck Young Guns #238
  'h02': null,       // Connor McDavid 2015-16 Upper Deck Young Guns
  'h03': null,       // Lane Hutson — too new
  'h04': null,       // Connor Bedard — too new
  'h05': null,       // Matvei Michkov — too new
  // ── FOOTBALL ──
  'f01': null,       // Patrick Mahomes 2017 Prizm Silver
  'f02': null,       // Josh Allen 2018 Prizm Silver
};

async function fetchPopData(specId) {
  const url = `https://api.apify.com/v2/acts/${ACTOR}/run-sync-get-dataset-items?token=${APIFY_TOKEN}&timeout=55`;

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ specId })
  });

  if (!res.ok) throw new Error(`Apify error: ${res.status}`);
  const data = await res.json();
  return Array.isArray(data) ? data : [];
}

function parseGrades(items) {
  if (!items || !items.length) return null;
  const item = items[0];

  // Handle different field name conventions the scraper may return
  const grades = item.grades || item.gradeBreakdown || item.population || {};

  // Try to get PSA 10 count
  const psa10 = item.grade10 ?? item.psa10 ?? item['10'] ?? item.gemMint ??
    grades['10'] ?? grades['PSA 10'] ?? grades['Gem Mint 10'] ?? null;

  // Try to get PSA 9 count
  const psa9 = item.grade9 ?? item.psa9 ?? item['9'] ?? item.mint9 ??
    grades['9'] ?? grades['PSA 9'] ?? grades['Mint 9'] ?? null;

  // Total population
  const total = item.total ?? item.totalPop ?? item.totalPopulation ??
    item.totalSubmissions ?? null;

  if (psa10 === null && total === null) return null;

  const realTotal = total || (Object.values(grades).reduce((a, b) => a + (parseInt(b) || 0), 0));
  const gemRate = (psa10 && realTotal) ? +((psa10 / realTotal) * 100).toFixed(1) : null;
  const psa9Rate = (psa9 && realTotal) ? +((psa9 / realTotal) * 100).toFixed(1) : null;

  return {
    psa10pop: parseInt(psa10) || null,
    psa9pop: parseInt(psa9) || null,
    totalpop: parseInt(realTotal) || null,
    gemRate,
    psa9Rate,
  };
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { cardId } = req.query;
  if (!cardId) return res.status(400).json({ error: 'cardId required' });
  if (!APIFY_TOKEN) return res.status(500).json({ error: 'APIFY_TOKEN not set' });

  const specId = SPEC_IDS[cardId];
  if (!specId) {
    return res.status(404).json({
      error: `No PSA spec ID for card ${cardId} — add it to the SPEC_IDS map`,
      tip: 'Find spec ID at psacard.com/auctionprices — it is the last number in the URL'
    });
  }

  try {
    console.log(`PSA pop lookup: cardId=${cardId}, specId=${specId}`);
    const items = await fetchPopData(specId);
    console.log(`Apify returned ${items.length} items`);

    if (!items.length) {
      return res.status(200).json({ error: 'No data returned from Apify', specId });
    }

    const popData = parseGrades(items);
    if (!popData) {
      return res.status(200).json({ error: 'Could not parse grade data', raw: items[0] });
    }

    console.log(`PSA pop result: PSA10=${popData.psa10pop}, PSA9=${popData.psa9pop}, Total=${popData.totalpop}, Gem%=${popData.gemRate}`);
    return res.status(200).json(popData);
  } catch (err) {
    console.error('PSA lookup error:', err.message);
    return res.status(500).json({ error: err.message });
  }
}
