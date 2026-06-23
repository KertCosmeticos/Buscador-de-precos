const express = require('express');
const Product = require('../models/Product');
const ProductLearning = require('../models/ProductLearning');
const Site = require('../models/Site');
const SiteCandidate = require('../models/SiteCandidate');
const { uniqueStrings } = require('../utils/text');
const { hostname, inferredType } = require('../services/siteDiscovery');

const router = express.Router();
const demoLearnings = new Map();
const isDemo = () => process.env.DEMO_MODE === 'true';

async function candidateFromConfirmedOffer(body) {
  const domain = hostname(body.link);
  const price = Number(body.price);
  if (!domain || !Number.isFinite(price)) return null;
  if (!isDemo()) {
    const sites = await Site.find({ active: true }).select('baseUrl searchUrl').lean();
    const registered = sites.some((site) => {
      const known = hostname(site.searchUrl || site.baseUrl);
      return known && (domain === known || domain.endsWith(`.${known}`) || known.endsWith(`.${domain}`));
    });
    if (registered) return null;
  }
  const candidate = {
    domain,
    name: String(body.marketplace || body.seller || domain).trim(),
    searchUrl: `https://${domain}/`,
    type: inferredType(domain),
    status: 'pending',
    evidenceTitle: String(body.title || '').trim(),
    evidencePrice: price,
    score: Number.isFinite(Number(body.score)) ? Number(body.score) : null,
    humanConfirmed: true
  };
  if (isDemo()) return candidate;
  return SiteCandidate.findOneAndUpdate(
    { domain },
    { $set: candidate },
    { upsert: true, new: true, runValidators: true }
  ).lean();
}

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
      else {
        add('ignoredTitles', title);
        learning.confirmedAliases = learning.confirmedAliases.filter((value) => value !== title);
        uniqueStrings(req.body.excludedWords).forEach((word) => add('excludedWords', word));
      }
      demoLearnings.set(productId, learning);
      const siteCandidate = action === 'confirm' ? await candidateFromConfirmedOffer(req.body) : null;
      return res.json({ ...learning, siteCandidate });
    }
    const update = { $set: { productId } };
    const additions = {};
    if (action === 'confirm') {
      if (title) additions.confirmedAliases = title;
      if (term) additions.goodTerms = term;
    } else {
      if (title) additions.ignoredTitles = title;
      update.$pull = {};
      if (title) update.$pull.confirmedAliases = title;
      const excluded = uniqueStrings(req.body.excludedWords);
      if (excluded.length) update.$addToSet = { excludedWords: { $each: excluded } };
    }
    if (Object.keys(additions).length) {
      update.$addToSet ||= {};
      Object.entries(additions).forEach(([field, value]) => { update.$addToSet[field] = value; });
    }
    if (update.$pull && !Object.keys(update.$pull).length) delete update.$pull;
    const learning = await ProductLearning.findOneAndUpdate({ productId }, update, { upsert: true, new: true, runValidators: true }).lean();
    const siteCandidate = action === 'confirm' ? await candidateFromConfirmedOffer(req.body) : null;
    return res.json({ ...learning, siteCandidate });
  } catch (error) { return next(error); }
});

module.exports = router;
