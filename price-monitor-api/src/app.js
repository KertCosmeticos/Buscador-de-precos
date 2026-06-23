const express = require('express');
const cors = require('cors');
const { searchAllMarketplaces } = require('./services/multiMarketplace');
const { demoSearch } = require('./services/demo');
const { assertValidEan, normalizeEan, isValidEan } = require('./utils/validation');
const { mapWithConcurrency } = require('./utils/limit');
const productRoutes = require('./routes/products');
const authRoutes = require('./routes/auth');
const siteRoutes = require('./routes/sites');
const learningRoutes = require('./routes/learning');
const productCatalog = require('./services/productCatalog');
const ProductLearning = require('./models/ProductLearning');
const { calculateCompatibility } = require('./services/compatibilityScore');
const { generateSearchTerms } = require('./services/searchTerms');

const app = express();
const demoMode = process.env.DEMO_MODE === 'true';
const allowedOrigins = (process.env.CORS_ORIGINS || '')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

app.use(cors({
  origin(origin, callback) {
    if (!origin || allowedOrigins.length === 0 || allowedOrigins.includes(origin)) {
      return callback(null, true);
    }
    return callback(new Error('Origem não permitida pelo CORS.'));
  }
}));
app.use(express.json({ limit: '1mb' }));
app.use('/auth', authRoutes);
app.use('/produtos', productRoutes);
app.use('/sites', siteRoutes);
app.use('/aprendizado', learningRoutes);

function summarize(ean, listings, sources = []) {
  const prices = listings.map((item) => item.price).filter(Number.isFinite);
  const sum = prices.reduce((total, price) => total + price, 0);
  const grouped = new Map();
  listings.forEach((listing) => {
    const marketplace = listing.marketplace || 'Não informado';
    if (!grouped.has(marketplace)) grouped.set(marketplace, []);
    grouped.get(marketplace).push(listing);
  });
  const marketplaceSummary = [...grouped].map(([marketplace, marketplaceListings]) => {
    const marketplacePrices = marketplaceListings.map((item) => item.price).filter(Number.isFinite);
    return {
      marketplace,
      minPrice: marketplacePrices.length ? Math.min(...marketplacePrices) : null,
      maxPrice: marketplacePrices.length ? Math.max(...marketplacePrices) : null,
      averagePrice: marketplacePrices.length
        ? marketplacePrices.reduce((total, price) => total + price, 0) / marketplacePrices.length
        : null,
      listingsCount: marketplaceListings.length,
      pricedListingsCount: marketplacePrices.length
    };
  });
  return {
    ean,
    minPrice: prices.length ? Math.min(...prices) : null,
    maxPrice: prices.length ? Math.max(...prices) : null,
    averagePrice: prices.length ? sum / prices.length : null,
    listingsCount: listings.length,
    pricedListingsCount: prices.length,
    marketplaces: [...new Set(listings.map((item) => item.marketplace).filter(Boolean))],
    marketplaceSummary,
    sources,
    listings
  };
}

async function searchFresh(ean) {
  const product = demoMode ? null : await productCatalog.getProductByEan(ean);
  const learning = product?._id ? await ProductLearning.findOne({ productId: product._id }).lean() : null;
  const terms = product ? generateSearchTerms(product, learning || {}) : [];
  const nameTerm = terms.find((term) => term !== ean) || product?.name;
  const search = demoMode
    ? { listings: demoSearch(ean), sources: [{ name: 'Demonstração multicanal', status: 'ok', count: 5 }] }
    : await searchAllMarketplaces(ean, nameTerm);
  const listings = product
    ? search.listings.map((listing) => ({ ...listing, ...calculateCompatibility(product, listing, learning || {}) }))
      .sort((left, right) => right.score - left.score || (left.price ?? Infinity) - (right.price ?? Infinity))
    : search.listings;
  const result = summarize(ean, listings, search.sources);
  if (product) {
    result.productId = product._id;
    result.searchTerms = terms;
    result.usedSearchTerm = nameTerm;
  }
  return result;
}

app.get('/health', (_req, res) => res.json({
  status: 'ok',
  mode: demoMode ? 'demo' : 'real',
  providers: {
    mercadoLivre: !demoMode,
    googleShopping: !demoMode && Boolean(process.env.SERPAPI_KEY),
    productCatalog: true
  }
}));

app.get('/buscar', async (req, res, next) => {
  try {
    const ean = assertValidEan(req.query.ean);
    const result = await searchFresh(ean);
    if (result.listingsCount === 0) {
      return res.status(404).json({
        error: 'Nenhum anúncio foi encontrado para este EAN.',
        ...result
      });
    }
    return res.json(result);
  } catch (error) {
    return next(error);
  }
});

app.post('/buscar/lote', async (req, res, next) => {
  try {
    const input = Array.isArray(req.body) ? req.body : req.body?.eans;
    if (!Array.isArray(input) || input.length === 0) {
      return res.status(400).json({ error: 'Envie um array com pelo menos um EAN.' });
    }
    if (input.length > 100) {
      return res.status(400).json({ error: 'O limite é de 100 EANs por consulta.' });
    }

    const eans = [...new Set(input.map(normalizeEan))];
    const results = await mapWithConcurrency(eans, 5, async (ean) => {
      if (!isValidEan(ean)) {
        return { ean, error: 'EAN inválido. Informe somente de 8 a 14 dígitos.' };
      }
      try {
        const result = await searchFresh(ean);
        return result.listingsCount
          ? result
          : { ...result, error: 'Nenhum anúncio foi encontrado para este EAN.' };
      } catch (error) {
        return { ean, error: error.message || 'Erro inesperado durante a busca.' };
      }
    });

    return res.json({ results });
  } catch (error) {
    return next(error);
  }
});

app.post('/avaliar', async (req, res, next) => {
  try {
    const ean = assertValidEan(req.body?.ean);
    const listings = req.body?.listings;
    if (!Array.isArray(listings) || listings.length > 200) return res.status(400).json({ error: 'Envie até 200 ofertas para avaliação.' });
    const product = await productCatalog.getProductByEan(ean);
    if (!product) return res.status(404).json({ error: 'Produto não encontrado no catálogo.' });
    const learning = demoMode ? {} : await ProductLearning.findOne({ productId: product._id }).lean() || {};
    return res.json({
      productId: product._id,
      listings: listings.map((listing) => ({ ...listing, ...calculateCompatibility(product, listing, learning) }))
        .sort((left, right) => right.score - left.score || (left.price ?? Infinity) - (right.price ?? Infinity))
    });
  } catch (error) { return next(error); }
});

app.use((_req, res) => res.status(404).json({ error: 'Rota não encontrada.' }));

app.use((error, _req, res, _next) => {
  console.error(error);
  if (error?.code === 11000) {
    const field = Object.keys(error.keyPattern || {})[0];
    return res.status(409).json({ error: field === 'name' ? 'Já existe um site com este nome.' : 'Este EAN já está cadastrado.' });
  }
  const status = error.status || (error.message?.includes('CORS') ? 403 : 500);
  const message = status === 500
    ? 'Ocorreu um erro interno. Tente novamente mais tarde.'
    : error.message;
  res.status(status).json({ error: message });
});

module.exports = app;
