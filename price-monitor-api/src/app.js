// v29bf11f
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
const { generateSearchTerms, generateLayeredTerms } = require('./services/searchTerms');
const { postalCode, formatPostalCode } = require('./config/search');
const Site = require('./models/Site');
const { splitDiscoveredListings } = require('./services/siteDiscovery');

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

function shouldHideListing(listing) {
  if (listing.rejectedByLearning) return true;
  return listing.status === 'Rejeitado' || listing.status === 'CandidatoFraco';
}

async function searchFresh(ean, sites = []) {
  const product = demoMode ? null : await productCatalog.getProductByEan(ean);
  const learning = product?._id ? await ProductLearning.findOne({ productId: product._id }).lean() : null;
  const layeredTerms = product ? generateLayeredTerms(product, learning || {}) : null;
  const firstExactTerm = layeredTerms?.exact?.find((t) => t !== ean) || product?.name;
  const search = demoMode
    ? { listings: demoSearch(ean), sources: [{ name: 'Demonstração multicanal', status: 'ok', count: 5 }] }
    : await searchAllMarketplaces(ean, layeredTerms, sites);

  // Pontua todos os resultados antes de qualquer filtro
  const allScored = product
    ? search.listings.map((listing) => ({ ...listing, ...calculateCompatibility(product, listing, learning || {}) }))
    : search.listings;

  // Discovery roda sobre TODOS os pontuados (inclui CandidatoFraco para detecção de sites)
  const discovery = await splitDiscoveredListings(allScored, sites, demoMode);

  // Filtra para exibição de preços somente após a discovery processar candidatos fracos
  const priceListings = product
    ? discovery.listings
        .filter((listing) => !shouldHideListing(listing))
        .sort((left, right) => right.score - left.score || (left.price ?? Infinity) - (right.price ?? Infinity))
    : discovery.listings;

  if (!demoMode && product?._id && priceListings.length) {
    const titles = [...new Set(priceListings.map((listing) => String(listing.title || '').trim()).filter(Boolean))];
    const addToSet = { confirmedAliases: { $each: titles } };
    if (firstExactTerm) addToSet.goodTerms = firstExactTerm;
    await ProductLearning.updateOne(
      { productId: product._id },
      { $setOnInsert: { productId: product._id }, $addToSet: addToSet },
      { upsert: true }
    );
  }
  const result = summarize(ean, priceListings, search.sources);
  result.discoveredSites = discovery.discoveredSites;
  if (discovery.weakSites?.length) result.weakSites = discovery.weakSites;
  if (product) {
    result.productId = product._id;
    result.searchTerms = layeredTerms;
    result.usedSearchTerm = firstExactTerm;
    // Debug: resumo do pipeline de coleta e pontuação
    const byStatus = allScored.reduce((acc, l) => {
      const s = l.status || 'sem-status';
      acc[s] = (acc[s] || 0) + 1;
      return acc;
    }, {});
    const rejectReasons = allScored
      .filter((l) => l.status === 'Rejeitado')
      .flatMap((l) => l.reasons || [])
      .reduce((acc, r) => {
        const key = String(r.reason || 'unknown').slice(0, 50);
        acc[key] = (acc[key] || 0) + 1;
        return acc;
      }, {});
    result.debug = {
      collected: allScored.length,
      priced: allScored.filter((l) => Number.isFinite(l.price)).length,
      byStatus,
      rejectReasons,
    };
  }
  if (sites.length && !demoMode) {
    await Site.updateMany({ _id: { $in: sites.map((site) => site._id) } }, { $set: { discoveryStatus: 'learning', lastDiscoveryAt: new Date() } });
  }
  return result;
}

async function selectedSites(input) {
  if (demoMode) return [];
  if (!Array.isArray(input) || !input.length) return Site.find({ active: true }).sort({ name: 1 }).lean();
  const ids = [...new Set(input.map(String).filter((id) => /^[a-f\d]{24}$/i.test(id)))].slice(0, 20);
  return ids.length ? Site.find({ _id: { $in: ids }, active: true }).lean() : [];
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

app.get('/buscar', async (req, res, next) => {
  try {
    const ean = assertValidEan(req.query.ean);
    const result = await searchFresh(ean, await selectedSites());
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
    const sites = await selectedSites(req.body?.siteIds);
    const results = await mapWithConcurrency(eans, 5, async (ean) => {
      if (!isValidEan(ean)) {
        return { ean, error: 'EAN inválido. Informe somente de 8 a 14 dígitos.' };
      }
      try {
        const result = await searchFresh(ean, sites);
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
    const sites = demoMode ? [] : await Site.find({ active: true }).lean();
    const allScored = listings.map((listing) => ({ ...listing, ...calculateCompatibility(product, listing, learning) }));
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
