const express = require('express');
const { assertValidEan } = require('../utils/validation');
const catalog = require('../services/productCatalog');
const { requireAdmin } = require('../middleware/auth');
const { tokenize, uniqueStrings } = require('../utils/text');

const router = express.Router();

function validateProduct(body) {
  const product = {
    ean: assertValidEan(body.ean),
    sku: String(body.sku || '').trim(),
    name: String(body.name || '').trim(),
    category: String(body.category || '').trim(),
    line: String(body.line || body.family || '').trim(),
    volume: String(body.volume || '').trim(),
    ncm: String(body.ncm || '').trim(),
    netPrice: body.netPrice === '' || body.netPrice == null ? null : Number(body.netPrice),
    searchTerm: String(body.searchTerm || '').trim(),
    tokens: uniqueStrings(body.tokens?.length ? body.tokens : tokenize(body.searchTerm || body.name)),
    aliases: uniqueStrings(body.aliases),
    requiredWords: uniqueStrings(body.requiredWords),
    forbiddenWords: uniqueStrings(body.forbiddenWords),
    nuance: String(body.nuance || '').trim(),
    color: String(body.color || '').trim(),
    variant: String(body.variant || '').trim(),
    active: body.active !== false
  };
  if (!product.name || !product.category || !product.line) {
    const error = new Error('Nome, categoria e linha são obrigatórios.');
    error.status = 400;
    throw error;
  }
  if (product.netPrice != null && (!Number.isFinite(product.netPrice) || product.netPrice < 0)) {
    const error = new Error('Preço líquido deve ser um número positivo.');
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
      line: req.query.line
    });
    res.json({ products });
  } catch (error) { next(error); }
});

router.post('/importar', requireAdmin, async (req, res, next) => {
  try {
    const input = Array.isArray(req.body) ? req.body : req.body?.products;
    if (!Array.isArray(input) || input.length === 0) {
      return res.status(400).json({ error: 'Envie uma lista com pelo menos um produto.' });
    }
    if (input.length > 2000) {
      return res.status(400).json({ error: 'O limite é de 2.000 produtos por importação.' });
    }
    const products = input.map((item, index) => {
      try {
        return validateProduct(item);
      } catch (error) {
        error.message = `Linha ${index + 2}: ${error.message}`;
        throw error;
      }
    });
    const seen = new Set();
    products.forEach((product, index) => {
      if (seen.has(product.ean)) {
        const error = new Error(`Linha ${index + 2}: o EAN ${product.ean} está duplicado no arquivo.`);
        error.status = 400;
        throw error;
      }
      seen.add(product.ean);
    });
    return res.json(await catalog.importProducts(products));
  } catch (error) {
    return next(error);
  }
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
