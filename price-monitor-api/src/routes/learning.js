const express = require('express');
const Product = require('../models/Product');
const ProductLearning = require('../models/ProductLearning');
const { requireAdmin } = require('../middleware/auth');
const { uniqueStrings } = require('../utils/text');

const router = express.Router();
const demoLearnings = new Map();
const isDemo = () => process.env.DEMO_MODE === 'true';
router.use(requireAdmin);

router.get('/:productId', async (req, res, next) => {
  try {
    if (isDemo()) return res.json(demoLearnings.get(req.params.productId) || { productId: req.params.productId });
    return res.json(await ProductLearning.findOne({ productId: req.params.productId }).lean() || { productId: req.params.productId });
  } catch (error) { return next(error); }
});

router.post('/feedback', async (req, res, next) => {
  try {
    const { productId, action } = req.body;
    if (!isDemo() && !await Product.exists({ _id: productId })) return res.status(404).json({ error: 'Produto não encontrado.' });
    if (!['confirm', 'ignore'].includes(action)) return res.status(400).json({ error: 'Feedback deve ser confirm ou ignore.' });
    const title = String(req.body.title || '').trim();
    const term = String(req.body.searchTerm || '').trim();
    if (isDemo()) {
      const learning = demoLearnings.get(productId) || { productId, confirmedAliases: [], goodTerms: [], badTerms: [], ignoredTitles: [], excludedWords: [] };
      const add = (field, value) => { if (value && !learning[field].includes(value)) learning[field].push(value); };
      if (action === 'confirm') { add('confirmedAliases', title); add('goodTerms', term); }
      else { add('ignoredTitles', title); add('badTerms', term); uniqueStrings(req.body.excludedWords).forEach((word) => add('excludedWords', word)); }
      demoLearnings.set(productId, learning);
      return res.json(learning);
    }
    const update = { $set: { productId } };
    const additions = {};
    if (action === 'confirm') {
      if (title) additions.confirmedAliases = title;
      if (term) additions.goodTerms = term;
    } else {
      if (title) additions.ignoredTitles = title;
      if (term) additions.badTerms = term;
      const excluded = uniqueStrings(req.body.excludedWords);
      if (excluded.length) update.$addToSet = { excludedWords: { $each: excluded } };
    }
    if (Object.keys(additions).length) {
      update.$addToSet ||= {};
      Object.entries(additions).forEach(([field, value]) => { update.$addToSet[field] = value; });
    }
    const learning = await ProductLearning.findOneAndUpdate({ productId }, update, { upsert: true, new: true, runValidators: true }).lean();
    return res.json(learning);
  } catch (error) { return next(error); }
});

module.exports = router;
