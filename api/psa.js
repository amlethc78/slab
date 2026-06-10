// api/psa.js — PSA Population Report lookup via Apify lulzasaur/psa-pop-scraper
// Input field is "specID" (integer) per Apify schema

const APIFY_TOKEN = process.env.APIFY_TOKEN;
const ACTOR = 'lulzasaur~psa-pop-scraper';

// PSA spec IDs — integer values from psacard.com URLs
// URL pattern: psacard.com/auctionprices/[sport]/[set]/[player]/values/[SPEC_ID]
const SPEC_IDS = {
  'o01': 2694018,   // 2018 Topps Update Rainbow Foil #US189
  'o07': 2659441,   // 2018 Topps Chrome Update Pink #HMT32
  'o12': 2662525,   // 2018 Topps Update Rookie Debut #US285
  'o14': 2618202,   // 2018 Topps Chrome Rookie (Prism Refractor spec)
  'h01': 2089244,   // Nathan MacKinnon 2013-14 Upper Deck Young Guns #238
};

async function fetchPopData(specID) {
  const url = `https://api.apify.com/v2/acts/${ACTOR}/run-sync-get-dataset-items?token=${APIFY_TOKEN}&timeout=55`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ specID })  // integer, capital ID
  });
  if (!res.ok) throw new Error(`Apify error: ${res.status} ${await res.text()}`);
  const data = await res.json();
  return Array.isArray(data) ? data : [];
}

function parseGrades(items) {
  if (!items || !items.length) return null;
  const item = items[0];
  console.log('Apify raw item keys:', Object.keys(item));
  console.log('Apify raw item:', JSON.stringify(item).slice(0, 500));

  // The scraper returns population report — try all possible field names
  const psa10 = item.grade10 ?? item.psa10 ?? item['10'] ?? item.gemMint10 ??
    item.gradeBreakdown?.['10'] ?? item.gradeBreakdown?.['PSA 10'] ??
    item.population?.['10'] ?? null;

  const psa9 = item.grade9 ?? item.psa9 ?? item['9'] ?? item.mint9 ??
    item.gradeBreakdown?.['9'] ?? item.gradeBreakdown?.['PSA 9'] ??
    item.population?.['9'] ?? null;

  const total = item.total ?? item.totalPop ?? item.totalPopulation ??
    item.totalSubmissions ?? item.pop ?? null;

  if (psa10 === null && total === null) return null;

  const realTotal = parseInt(total) ||
    Object.values(item.gradeBreakdown || item.population || {})
      .reduce((a, b) => a + (parseInt(b) || 0), 0) || null;

  const gemRate = (psa10 && realTotal) ? +((parseInt(psa10) / realTotal) * 100).toFixed(1) : null;
  const psa9Rate = (psa9 && realTotal) ? +((parseInt(psa9) / realTotal) * 100).toFixed(1) : null;

  return {
    psa10pop: parseInt(psa10) || null,
    psa9pop: parseInt(psa9) || null,
    totalpop: realTotal,
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

  const specID = SPEC_IDS[cardId];
  if (!specID) {
    return res.status(404).json({
      error: `No PSA spec ID for ${cardId}`,
      available: Object.keys(SPEC_IDS)
    });
  }

  try {
    console.log(`PSA lookup: cardId=${cardId}, specID=${specID}`);
    const items = await fetchPopData(specID);
    console.log(`Apify returned ${items.length} item(s)`);

    if (!items.length) {
      return res.status(200).json({ error: 'No data from Apify', specID });
    }

    const popData = parseGrades(items);
    if (!popData) {
      return res.status(200).json({
        error: 'Could not parse grade data',
        rawKeys: Object.keys(items[0] || {}),
        rawSample: JSON.stringify(items[0]).slice(0, 300)
      });
    }

    console.log(`Result: PSA10=${popData.psa10pop}, PSA9=${popData.psa9pop}, Total=${popData.totalpop}, Gem%=${popData.gemRate}`);
    return res.status(200).json(popData);
  } catch (err) {
    console.error('PSA error:', err.message);
    return res.status(500).json({ error: err.message });
  }
}
