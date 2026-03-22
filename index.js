const express = require('express');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 3000;

const EBAY_CLIENT_ID = process.env.EBAY_CLIENT_ID;
const EBAY_CLIENT_SECRET = process.env.EBAY_CLIENT_SECRET;

// Cache token to avoid fetching every request
let cachedToken = null;
let tokenExpiry = 0;

async function getOAuthToken() {
  if (cachedToken && Date.now() < tokenExpiry) {
    return cachedToken;
  }

  const credentials = Buffer.from(`${EBAY_CLIENT_ID}:${EBAY_CLIENT_SECRET}`).toString('base64');

  const response = await axios.post(
    'https://api.ebay.com/identity/v1/oauth2/token',
    'grant_type=client_credentials&scope=https%3A%2F%2Fapi.ebay.com%2Foauth%2Fapi_scope',
    {
      headers: {
        'Authorization': `Basic ${credentials}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
    }
  );

  cachedToken = response.data.access_token;
  // Expire 60 seconds early to be safe
  tokenExpiry = Date.now() + (response.data.expires_in - 60) * 1000;
  return cachedToken;
}

// Search football cards and find deals
// A "deal" = items priced below the average price of results
async function searchFootballCardDeals(query = 'football card', limit = 50) {
  const token = await getOAuthToken();

  const response = await axios.get('https://api.ebay.com/buy/browse/v1/item_summary/search', {
    headers: {
      'Authorization': `Bearer ${token}`,
      'X-EBAY-C-MARKETPLACE-ID': 'EBAY_US',
      'Content-Type': 'application/json',
    },
    params: {
      q: query,
      category_ids: '261328', // Sports Trading Cards category
      limit: limit,
      sort: 'price',
      filter: 'buyingOptions:{FIXED_PRICE},conditionIds:{1000|1500|2000|2500|3000}',
    },
  });

  const items = response.data.itemSummaries || [];

  if (items.length === 0) {
    return { query, deals: [], message: 'No items found' };
  }

  // Calculate prices
  const prices = items
    .filter(item => item.price && item.price.value)
    .map(item => parseFloat(item.price.value));

  const avgPrice = prices.reduce((sum, p) => sum + p, 0) / prices.length;
  const dealThreshold = avgPrice * 0.75; // 25% below average = deal

  const deals = items
    .filter(item => item.price && parseFloat(item.price.value) <= dealThreshold)
    .map(item => ({
      title: item.title,
      price: `$${parseFloat(item.price.value).toFixed(2)}`,
      priceValue: parseFloat(item.price.value),
      avgPrice: `$${avgPrice.toFixed(2)}`,
      savings: `$${(avgPrice - parseFloat(item.price.value)).toFixed(2)}`,
      savingsPct: `${Math.round((1 - parseFloat(item.price.value) / avgPrice) * 100)}%`,
      condition: item.condition || 'Unknown',
      seller: item.seller ? item.seller.username : 'Unknown',
      url: item.itemWebUrl,
      image: item.image ? item.image.imageUrl : null,
    }))
    .sort((a, b) => a.priceValue - b.priceValue);

  return {
    query,
    totalResults: response.data.total || items.length,
    itemsAnalyzed: items.length,
    averagePrice: `$${avgPrice.toFixed(2)}`,
    dealThreshold: `$${dealThreshold.toFixed(2)}`,
    dealsFound: deals.length,
    deals,
  };
}

// GET /search?q=patrick mahomes rookie card
app.get('/search', async (req, res) => {
  const query = req.query.q || 'football card';
  const limit = Math.min(parseInt(req.query.limit) || 50, 200);

  try {
    const results = await searchFootballCardDeals(query, limit);
    res.json(results);
  } catch (err) {
    const status = err.response ? err.response.status : 500;
    const message = err.response ? JSON.stringify(err.response.data) : err.message;
    res.status(status).json({ error: message });
  }
});

// GET /deals - default search for general football card deals
app.get('/deals', async (req, res) => {
  const query = req.query.q || 'football card rookie';
  const limit = Math.min(parseInt(req.query.limit) || 50, 200);

  try {
    const results = await searchFootballCardDeals(query, limit);
    res.json(results);
  } catch (err) {
    const status = err.response ? err.response.status : 500;
    const message = err.response ? JSON.stringify(err.response.data) : err.message;
    res.status(status).json({ error: message });
  }
});

// GET / - usage info
app.get('/', (req, res) => {
  res.json({
    name: 'eBay Football Card Deal Finder',
    endpoints: {
      '/deals': 'Find deals on football cards (default search)',
      '/deals?q=patrick mahomes': 'Search specific player/card',
      '/deals?q=rookie card&limit=100': 'Custom query with more results',
      '/search?q=tom brady': 'Same as /deals, alias endpoint',
    },
    description: 'Returns eBay listings priced 25%+ below average — those are the deals.',
  });
});

app.listen(PORT, () => {
  console.log(`eBay Football Card Deal Finder running on port ${PORT}`);
  console.log(`Visit http://localhost:${PORT}/ for usage info`);
  console.log(`Try http://localhost:${PORT}/deals to see current deals`);
});
