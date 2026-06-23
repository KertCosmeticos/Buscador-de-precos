const express = require('express');
const Site = require('../models/Site');
const { requireAdmin } = require('../middleware/auth');

const router = express.Router();
const validTypes = new Set(['marketplace', 'perfumaria', 'drogaria', 'loja_propria']);
const demoSites = [];
const isDemo = () => process.env.DEMO_MODE === 'true';

function validateSite(body) {
  const site = {
    name: String(body.name || '').trim(),
    baseUrl: String(body.baseUrl || '').trim(),
    searchUrl: String(body.searchUrl || '').trim(),
    type: String(body.type || '').trim(),
    acceptsEan: body.acceptsEan !== false,
    acceptsName: body.acceptsName !== false,
    requiresPlaywright: body.requiresPlaywright === true,
    active: body.active !== false
  };
  if (!site.name || !site.baseUrl || !site.searchUrl || !validTypes.has(site.type)) {
    throw Object.assign(new Error('Nome, URLs e tipo válido são obrigatórios.'), { status: 400 });
  }
  for (const field of ['baseUrl', 'searchUrl']) {
    try { new URL(site[field]); } catch { throw Object.assign(new Error(`${field} deve ser uma URL válida.`), { status: 400 }); }
  }
  if (!site.acceptsEan && !site.acceptsName) throw Object.assign(new Error('O site deve aceitar EAN ou nome.'), { status: 400 });
  return site;
}

router.get('/', async (_req, res, next) => {
  try { res.json({ sites: isDemo() ? demoSites : await Site.find().sort({ name: 1 }).lean() }); } catch (error) { next(error); }
});
router.post('/', requireAdmin, async (req, res, next) => {
  try {
    const input = validateSite(req.body);
    if (isDemo()) {
      if (demoSites.some((site) => site.name === input.name)) throw Object.assign(new Error('Já existe um site com este nome.'), { status: 409 });
      const site = { _id: `demo-site-${Date.now()}`, ...input };
      demoSites.push(site);
      return res.status(201).json(site);
    }
    return res.status(201).json(await Site.create(input));
  } catch (error) { return next(error); }
});
router.put('/:id', requireAdmin, async (req, res, next) => {
  try {
    if (isDemo()) {
      const index = demoSites.findIndex((site) => site._id === req.params.id);
      if (index < 0) return res.status(404).json({ error: 'Site não encontrado.' });
      demoSites[index] = { _id: req.params.id, ...validateSite(req.body) };
      return res.json(demoSites[index]);
    }
    const site = await Site.findByIdAndUpdate(req.params.id, validateSite(req.body), { new: true, runValidators: true }).lean();
    return site ? res.json(site) : res.status(404).json({ error: 'Site não encontrado.' });
  } catch (error) { return next(error); }
});
router.delete('/:id', requireAdmin, async (req, res, next) => {
  try {
    if (isDemo()) {
      const index = demoSites.findIndex((site) => site._id === req.params.id);
      if (index < 0) return res.status(404).json({ error: 'Site não encontrado.' });
      demoSites.splice(index, 1);
      return res.status(204).end();
    }
    return await Site.findByIdAndDelete(req.params.id) ? res.status(204).end() : res.status(404).json({ error: 'Site não encontrado.' });
  } catch (error) { return next(error); }
});

module.exports = router;
