const express = require('express');
const { assertValidEan } = require('../utils/validation');
const catalog = require('../services/productCatalog');
const { requireAdmin } = require('../middleware/auth');

const router = express.Router();

function validateProduct(body) {
  const product = {
    ean: assertValidEan(body.ean),
    sku: String(body.sku || '').trim(),
    name: String(body.name || '').trim(),
    category: String(body.category || '').trim(),
    family: String(body.family || '').trim(),
    active: body.active !== false
  };
  if (!product.name || !product.category || !product.family) {
    const error = new Error('Nome, categoria e família são obrigatórios.');
    error.status = 400;
    throw error;
  }
  return product;
}

router.get('/filtros', async (_req, res, next) => {
  try { res.json(await catalog.getFilters()); } catch (error) { next(error); }
});

router.get('/', async (req, res, next) => {
  try {
    const products = await catalog.listProducts({
      search: req.query.search,
      category: req.query.category,
      family: req.query.family
    });
    res.json({ products });
  } catch (error) { next(error); }
});

router.post('/', requireAdmin, async (req, res, next) => {
  try { res.status(201).json(await catalog.createProduct(validateProduct(req.body))); } catch (error) { next(error); }
});

router.put('/:id', requireAdmin, async (req, res, next) => {
  try {
    const product = await catalog.updateProduct(req.params.id, validateProduct(req.body));
    if (!product) return res.status(404).json({ error: 'Produto não encontrado.' });
    return res.json(product);
  } catch (error) { return next(error); }
});

router.delete('/:id', requireAdmin, async (req, res, next) => {
  try {
    const deleted = await catalog.deleteProduct(req.params.id);
    return deleted ? res.status(204).end() : res.status(404).json({ error: 'Produto não encontrado.' });
  } catch (error) { return next(error); }
});

module.exports = router;
