// v29bf11f
const express = require('express');
const cors = require('cors');
const { deduplicate } = require('./services/multiMarketplace');
const { assertValidEan } = require('./utils/validation');
const productRoutes = require('./routes/products');
const authRoutes = require('./routes/auth');
const siteRoutes = require('./routes/sites');
const learningRoutes = require('./routes/learning');

const productCatalog = require('./services/productCatalog');
const ProductLearning = require('./models/ProductLearning');
const { calculateCompatibility } = require('./services/compatibilityScore');
const { generateLayeredTerms } = require('./services/searchTerms');
const { postalCode, formatPostalCode } = require('./config/search');
const Site = require('./models/Site');
const { splitDiscoveredListings } = require('./services/siteDiscovery');
const { searchGoogleWebMedium } = require('./services/serpApi');

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


function shouldHideListing(listing) {
  if (listing.rejectedByLearning) return true;
  return listing.status === 'Rejeitado' || listing.status === 'CandidatoFraco';
}

app.get('/health', (_req, res) => res.json({
  status: 'ok',
  mode: demoMode ? 'demo' : 'real',
  providers: {
    mercadoLivre: !demoMode,
    googleShopping: !demoMode && Boolean(process.env.SERPAPI_KEY),
    productCatalog: true
  },
  searchDefaults: { postalCode: formatPostalCode(postalCode) }
}));

app.post('/avaliar', async (req, res, next) => {
  try {
    const ean = assertValidEan(req.body?.ean);
    const listings = req.body?.listings;
    if (!Array.isArray(listings) || listings.length > 200) return res.status(400).json({ error: 'Envie até 200 ofertas para avaliação.' });
    const product = await productCatalog.getProductByEan(ean);
    if (!product) return res.status(404).json({ error: 'Produto não encontrado no catálogo.' });
    const learning = demoMode ? {} : await ProductLearning.findOne({ productId: product._id }).lean() || {};
    const sites = demoMode ? [] : await Site.find({ active: true }).lean();

    // Busca Google site:domain para sites cadastrados — complementa o que a extensão Chrome capturou
    let allListings = listings;
    if (!demoMode && process.env.SERPAPI_KEY && sites.length) {
      const domains = [...new Set(sites.map((s) => {
        try { return new URL(s.baseUrl || s.searchUrl || '').hostname.replace(/^www\./, '').toLowerCase(); } catch { return ''; }
      }).filter(Boolean))];
      if (domains.length) {
        const terms = generateLayeredTerms(product, learning);
        const productName = (terms.medium || [])[0] || product.name;
        const siteListings = await searchGoogleWebMedium(productName, domains.slice(0, 8)).catch(() => []);
        if (siteListings.length) allListings = deduplicate([...listings, ...siteListings]);
      }
    }

    const allScored = allListings.map((listing) => ({ ...listing, ...calculateCompatibility(product, listing, learning) }));
    const discovery = await splitDiscoveredListings(allScored, sites, demoMode);
    const priceListings = discovery.listings
      .filter((listing) => !shouldHideListing(listing))
      .sort((left, right) => right.score - left.score || (left.price ?? Infinity) - (right.price ?? Infinity));
    if (!demoMode && priceListings.length) {
      const titles = [...new Set(priceListings.map((listing) => String(listing.title || '').trim()).filter(Boolean))];
      if (titles.length) {
        await ProductLearning.updateOne(
          { productId: product._id },
          { $setOnInsert: { productId: product._id }, $addToSet: { confirmedAliases: { $each: titles } } },
          { upsert: true }
        );
      }
    }
    return res.json({
      productId: product._id,
      listings: priceListings,
      discoveredSites: discovery.discoveredSites,
      ...(discovery.weakSites?.length ? { weakSites: discovery.weakSites } : {}),
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
