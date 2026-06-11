// api/psa.js — PSA Population Report via Apify lulzasaur/psa-pop-scraper

const APIFY_TOKEN = process.env.APIFY_TOKEN;
const ACTOR = 'lulzasaur~psa-pop-scraper';

const SPEC_IDS = {
  'o01': 2694018,
  'o07': 2659441,
  'o12': 2662525,
  'o14': 2618202,
  'h01': 2089244,
};

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { cardId } = req.query;
  if (!cardId) return res.status(400).json({ error: 'cardId required' });
  if (!APIFY_TOKEN) return res.status(500).json({ error: 'APIFY_TOKEN not set' });

  const specID = SPEC_IDS[cardId];
  if (!specID) return res.status(404).json({ error: `No spec ID for ${cardId}`, available: Object.keys(SPEC_IDS) });

  try {
    // Start async run — pass maxItems to satisfy Apify requirement
    const runRes = await fetch(
      `https://api.apify.com/v2/acts/${ACTOR}/runs?token=${APIFY_TOKEN}&maxItems=10`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ specID, maxItems: 10 })
      }
    );
    if (!runRes.ok) {
      const errText = await runRes.text();
      throw new Error(`Start run failed: ${runRes.status} ${errText}`);
    }
    const runJson = await runRes.json();
    const runId = runJson.data?.id;
    const datasetId = runJson.data?.defaultDatasetId;
    if (!runId) throw new Error(`No run ID. Response: ${JSON.stringify(runJson).slice(0,200)}`);
    console.log(`Run started: ${runId}, dataset: ${datasetId}`);

    // Poll for completion (max 45 seconds)
    let status = runJson.data?.status || 'RUNNING';
    const deadline = Date.now() + 45000;
    while (!['SUCCEEDED','FAILED','ABORTED','TIMED-OUT'].includes(status) && Date.now() < deadline) {
      await new Promise(r => setTimeout(r, 3000));
      const checkRes = await fetch(`https://api.apify.com/v2/actor-runs/${runId}?token=${APIFY_TOKEN}`);
      const checkJson = await checkRes.json();
      status = checkJson.data?.status;
      console.log(`Status: ${status}`);
    }

    if (status !== 'SUCCEEDED') throw new Error(`Run ended: ${status}`);

    // Fetch dataset
    const itemsRes = await fetch(
      `https://api.apify.com/v2/datasets/${datasetId}/items?token=${APIFY_TOKEN}&limit=10`
    );
    const items = await itemsRes.json();
    if (!items.length) return res.status(200).json({ error: 'Empty dataset', runId });

    const item = items[0];
    console.log('Keys:', Object.keys(item));
    console.log('Data:', JSON.stringify(item).slice(0, 600));

    // Parse grades
    const psa10 = item.grade10 ?? item.psa10 ?? item['10'] ?? item.gemMint10 ??
      item.gradeBreakdown?.['10'] ?? item.gradeBreakdown?.['PSA 10'] ?? null;
    const psa9 = item.grade9 ?? item.psa9 ?? item['9'] ?? item.mint9 ??
      item.gradeBreakdown?.['9'] ?? item.gradeBreakdown?.['PSA 9'] ?? null;
    const total = item.total ?? item.totalPop ?? item.totalPopulation ?? item.pop ?? null;

    if (psa10 === null && total === null) {
      return res.status(200).json({
        error: 'Could not parse grades',
        keys: Object.keys(item),
        sample: JSON.stringify(item).slice(0, 400)
      });
    }

    const realTotal = parseInt(total) || null;
    const gemRate = (psa10 && realTotal) ? +((parseInt(psa10)/realTotal)*100).toFixed(1) : null;
    const psa9Rate = (psa9 && realTotal) ? +((parseInt(psa9)/realTotal)*100).toFixed(1) : null;

    return res.status(200).json({
      psa10pop: parseInt(psa10)||null,
      psa9pop: parseInt(psa9)||null,
      totalpop: realTotal,
      gemRate,
      psa9Rate
    });

  } catch (err) {
    console.error('PSA error:', err.message);
    return res.status(500).json({ error: err.message });
  }
};
