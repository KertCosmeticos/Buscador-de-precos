const express = require('express');
const Site = require('../models/Site');
const { requireAdmin } = require('../middleware/auth');

const router = express.Router();
const validTypes = new Set(['marketplace', 'perfumaria', 'drogaria', 'loja_propria']);
const demoSites = [];
const isDemo = () => process.env.DEMO_MODE === 'true';

function validateSite(body) {
  let inferredBaseUrl = '';
  try { inferredBaseUrl = new URL(body.searchUrl || body.baseUrl || '').origin; } catch {}
  const site = {
    name: String(body.name || '').trim(),
    baseUrl: String(body.baseUrl || inferredBaseUrl).trim(),
    searchUrl: String(body.searchUrl || '').trim(),
    type: String(body.type || 'perfumaria').trim(),
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
router.post('/importar', requireAdmin, async (req, res, next) => {
  try {
    const input = Array.isArray(req.body) ? req.body : req.body?.sites;
    if (!Array.isArray(input) || !input.length) return res.status(400).json({ error: 'Envie uma lista de sites.' });
    if (input.length > 500) return res.status(400).json({ error: 'O limite é de 500 sites por importação.' });

    let created = 0;
    let updated = 0;
    const createdRefs = [];
    for (const item of input) {
      const site = validateSite(item);
      if (isDemo()) {
        const index = demoSites.findIndex((current) => current.name.toLocaleLowerCase('pt-BR') === site.name.toLocaleLowerCase('pt-BR'));
        if (index >= 0) { demoSites[index] = { ...demoSites[index], ...site }; updated += 1; }
        else { demoSites.push({ _id: `demo-site-${Date.now()}-${created}`, ...site }); created += 1; createdRefs.push(site.name); }
        continue;
      }
      const existing = await Site.findOne({ name: site.name }).lean();
      await Site.updateOne({ name: site.name }, { $set: site }, { upsert: true });
      if (existing) { updated += 1; } else { created += 1; createdRefs.push(site.name); }
    }
    return res.json({ created, updated, createdRefs });
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
