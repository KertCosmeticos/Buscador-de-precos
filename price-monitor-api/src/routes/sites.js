const express = require('express');
const Site = require('../models/Site');
const SiteCandidate = require('../models/SiteCandidate');
const { requireAdmin } = require('../middleware/auth');

const router = express.Router();
const validTypes = new Set(['marketplace', 'perfumaria', 'drogaria', 'loja_propria']);
const demoSites = [];
const isDemo = () => process.env.DEMO_MODE === 'true';

function validateSite(body) {
  const searchUrl = String(body.searchUrl || '').trim();
  let parsedUrl;
  try { parsedUrl = new URL(searchUrl); } catch { throw Object.assign(new Error('URL de busca deve ser uma URL válida.'), { status: 400 }); }
  const site = {
    name: String(body.name || '').trim(),
    baseUrl: parsedUrl.origin,
    searchUrl,
    type: String(body.type || '').trim()
  };
  if (!site.name || !validTypes.has(site.type)) throw Object.assign(new Error('Nome, URL de busca e tipo válido são obrigatórios.'), { status: 400 });
  return site;
}

router.get('/', async (_req, res, next) => {
  try { res.json({ sites: isDemo() ? demoSites : await Site.find().sort({ name: 1 }).lean() }); } catch (error) { next(error); }
});
router.post('/descobertos/decisao', async (req, res, next) => {
  try {
    const action = String(req.body.action || '');
    const domain = String(req.body.domain || '').replace(/^www\./, '').toLowerCase().trim();
    const name = String(req.body.name || domain).trim();
    const type = String(req.body.type || 'perfumaria');
    const searchUrl = String(req.body.searchUrl || `https://${domain}/`).trim();
    let parsed;
    try { parsed = new URL(searchUrl); } catch { return res.status(400).json({ error: 'URL do site descoberto é inválida.' }); }
    if (!domain || parsed.hostname.replace(/^www\./, '').toLowerCase() !== domain || !['confirm', 'ignore'].includes(action)) {
      return res.status(400).json({ error: 'Decisão ou domínio inválido.' });
    }
    if (action === 'confirm' && !validTypes.has(type)) return res.status(400).json({ error: 'Selecione um tipo válido.' });
    if (isDemo()) {
      if (action === 'ignore') return res.json({ status: 'ignored' });
      const existing = demoSites.find((site) => site.baseUrl === parsed.origin || site.name === name);
      if (existing) return res.json({ status: 'approved', site: existing });
      const site = { _id: `demo-site-${Date.now()}`, ...validateSite({ name, searchUrl, type }), active: true, discoveryStatus: 'pending' };
      demoSites.push(site);
      return res.json({ status: 'approved', site });
    }
    const pending = await SiteCandidate.findOne({ domain, status: 'pending' }).lean();
    if (!pending || Number(pending.score) < 90 || !Number.isFinite(pending.evidencePrice)) {
      return res.status(404).json({ error: 'Esta sugestão não está mais pendente ou não possui evidência válida.' });
    }
    await SiteCandidate.updateOne({ _id: pending._id }, { $set: { name, type, status: action === 'confirm' ? 'approved' : 'ignored' } });
    if (action === 'ignore') return res.json({ status: 'ignored' });
    let site = await Site.findOne({ $or: [{ baseUrl: parsed.origin }, { name }] }).lean();
    if (!site) site = (await Site.create(validateSite({ name, searchUrl, type }))).toObject();
    return res.json({ status: 'approved', site });
  } catch (error) { return next(error); }
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
    if (!Array.isArray(input) || input.length === 0) return res.status(400).json({ error: 'Envie uma lista com pelo menos um site.' });
    if (input.length > 500) return res.status(400).json({ error: 'O limite é de 500 sites por importação.' });
    const sites = input.map((item, index) => {
      try { return validateSite(item); } catch (error) { error.message = `Linha ${index + 2}: ${error.message}`; throw error; }
    });
    const names = new Set();
    sites.forEach((site, index) => {
      const key = site.name.toLocaleLowerCase('pt-BR');
      if (names.has(key)) throw Object.assign(new Error(`Linha ${index + 2}: o site ${site.name} está duplicado no arquivo.`), { status: 400 });
      names.add(key);
    });
    if (isDemo()) {
      let created = 0; let updated = 0;
      sites.forEach((site) => {
        const index = demoSites.findIndex((item) => item.name.toLocaleLowerCase('pt-BR') === site.name.toLocaleLowerCase('pt-BR'));
        if (index < 0) { demoSites.push({ _id: `demo-site-${Date.now()}-${created}`, ...site, active: true, discoveryStatus: 'pending' }); created += 1; }
        else { demoSites[index] = { ...demoSites[index], ...site }; updated += 1; }
      });
      return res.json({ total: sites.length, created, updated });
    }
    const existing = await Site.find({ name: { $in: sites.map((site) => site.name) } }).select('name').lean();
    const existingNames = new Set(existing.map((site) => site.name.toLocaleLowerCase('pt-BR')));
    await Site.bulkWrite(sites.map((site) => ({ updateOne: { filter: { name: site.name }, update: { $set: site, $setOnInsert: { active: true, discoveryStatus: 'pending' } }, upsert: true } })), { ordered: false });
    const updated = sites.filter((site) => existingNames.has(site.name.toLocaleLowerCase('pt-BR'))).length;
    return res.json({ total: sites.length, created: sites.length - updated, updated });
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
