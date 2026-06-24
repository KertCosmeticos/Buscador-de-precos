const express = require('express');
const cors = require('cors');
const { assertValidEan } = require('./utils/validation');
const productRoutes = require('./routes/products');
const authRoutes = require('./routes/auth');
const siteRoutes = require('./routes/sites');
const productCatalog = require('./services/productCatalog');
const ProductLearning = require('./models/ProductLearning');
const { calculateCompatibility } = require('./services/compatibilityScore');

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

app.get('/health', (_req, res) => res.json({ status: 'ok', mode: demoMode ? 'demo' : 'real' }));

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
