const express = require('express');
const SearchConfig = require('../models/SearchConfig');
const { requireAdmin } = require('../middleware/auth');
const { normalizeText } = require('../utils/text');

const router = express.Router();

const SEED = {
  ownBrands: ['kert', 'keraton', 'phytogen', 'keragen', 'reduton'],
  lines: [
    { id: 'banho-brilho', label: 'Banho de Brilho', anchors: ['banho', 'brilho'], detectPattern: 'banho\\s+de\\s+brilho' },
    { id: 'dual-block', label: 'Color Dual Block', anchors: ['dual', 'block'], detectPattern: 'color\\s+dual\\s+block' },
    { id: 'selfie-my-crush', label: 'Selfie My Crush', anchors: ['selfie', 'crush'], detectPattern: 'selfie\\s+my\\s+crush' },
    { id: 'selfie', label: 'Selfie', anchors: ['selfie'], detectPattern: '\\bselfie\\b' },
    { id: 'demi-color', label: 'Demi Color', anchors: ['demi'], detectPattern: 'demi\\s+color' },
    { id: 'color-cachos', label: 'Color Cachos', anchors: ['cachos'], detectPattern: 'color\\s+cachos' },
    { id: 'neon-colors', label: 'Neon Colors', anchors: ['neon'], detectPattern: 'neon\\s+colors' },
    { id: 'hard-color', label: 'Hard Color', anchors: ['hard'], detectPattern: 'hard\\s+colors?' },
    { id: 'shine-mask', label: 'Shine Mask', anchors: ['shine'], detectPattern: 'shine\\s+mask' },
    { id: 'men', label: 'Keraton Men', anchors: ['men'], detectPattern: '\\bkeraton\\s+men\\b' },
    { id: 'muito-liso', label: 'Muito + Liso', anchors: ['muito', 'liso'], detectPattern: 'muito\\s*\\+?\\s*liso' },
    { id: 'muito-cachos', label: 'Muito + Cachos', anchors: ['muito', 'cachos'], detectPattern: 'muito\\s*\\+?\\s*cachos' },
    { id: 'uso-essencial', label: 'Uso Essencial', anchors: ['essencial'], detectPattern: 'uso\\s+essencial' },
    { id: 'desmaia-fio', label: 'Desmaia Fio', anchors: ['desmaia', 'fio'], detectPattern: 'desmaia\\s+fio' },
    { id: 'keragen-evolution', label: 'Keragen Evolution', anchors: ['keragen', 'evolution'], detectPattern: 'keragen\\s+evolution' },
    { id: 'mais-cor', label: 'Mais Cor', anchors: ['mais', 'cor'], detectPattern: 'mais\\s+cor' },
    { id: 'mais-forca', label: 'Mais Força', anchors: ['mais', 'forca'], detectPattern: 'mais\\s+forca' },
    { id: 'mais-hidratacao', label: 'Mais Hidratação', anchors: ['mais', 'hidratacao'], detectPattern: 'mais\\s+hidratacao' },
  ],
  types: [
    { id: 'shampoo', label: 'Shampoo', alternatives: [['shampoo'], ['sh']], detectPattern: '\\b(?:shampoo|sh)\\b' },
    { id: 'condicionador', label: 'Condicionador', alternatives: [['condicionador'], ['cond'], ['conditioner']], detectPattern: '\\b(?:condicionador|cond|conditioner)\\b' },
    { id: 'mascara', label: 'Máscara', alternatives: [['mascara'], ['mask'], ['masc']], detectPattern: '\\b(?:mascara|mask|masc)\\b' },
    { id: 'leave-in', label: 'Leave-in', alternatives: [['leave', 'in'], ['creme', 'pentear']], detectPattern: '\\b(?:leave.?in|creme\\s+de\\s+pentear)\\b' },
    { id: 'oxidante', label: 'Oxidante', alternatives: [['oxidante'], ['revelador'], ['oxigenada']], detectPattern: '\\boxidante\\b' },
    { id: 'descolorante', label: 'Descolorante', alternatives: [['descolorante'], ['dust', 'free'], ['blond']], detectPattern: '\\b(?:descolorante|dust\\s+free|blond)\\b' },
    { id: 'serum', label: 'Sérum', alternatives: [['serum']], detectPattern: '\\bserum\\b' },
    { id: 'oleo', label: 'Óleo', alternatives: [['oleo'], ['oil']], detectPattern: '\\boleo\\b' },
    { id: 'gelatina', label: 'Gelatina', alternatives: [['gelatina'], ['jelly']], detectPattern: '\\bgelatina\\b' },
    { id: 'spray', label: 'Spray', alternatives: [['spray']], detectPattern: '\\bspray\\b' },
    { id: 'relaxamento', label: 'Relaxamento', alternatives: [['relaxamento'], ['alisamento']], detectPattern: '\\brelaxamento\\b' },
    { id: 'redutor-cor', label: 'Redutor de Cor', alternatives: [['redutor', 'cor'], ['reduton'], ['dye', 'remover']], detectPattern: '\\b(?:redutor\\s+de\\s+cor|reduton|dye\\s+remover)\\b' },
    { id: 'banho-brilho-type', label: 'Banho de Brilho', alternatives: [['banho'], ['brilho'], ['tonalizante'], ['coloracao'], ['tintura']], detectPattern: 'banho\\s+de\\s+brilho' },
  ],
};

let _cache = null;
let _cacheAt = 0;
const CACHE_TTL = 5 * 60 * 1000;

async function getSearchConfig() {
  if (_cache && Date.now() - _cacheAt < CACHE_TTL) return _cache;
  _cache = (await SearchConfig.findOne().lean()) || SEED;
  _cacheAt = Date.now();
  return _cache;
}

function invalidateCache() { _cache = null; }

const FILLER = new Set(['a', 'as', 'com', 'da', 'das', 'de', 'do', 'dos', 'e', 'em', 'o', 'os', 'para', 'por', 'sem', 'produto', 'unidade', 'uso', 'n']);
const VOLUME_RE = /^\d+(?:[.,]\d+)?(?:ml|g|gr|kg|l)$/;
const SHADE_RE = /^\d{1,2}\.\d{1,3}$/;

function detectNewTerms(name, config) {
  const normalized = normalizeText(name);
  const tokens = normalized.split(/\s+/).filter((t) => t.length >= 3 && !FILLER.has(t) && !VOLUME_RE.test(t) && !SHADE_RE.test(t));

  const ownBrandsSet = new Set(config.ownBrands || []);
  const typeKeywords = new Set((config.types || []).flatMap((t) => t.alternatives.flat()));

  const lineMatched = (config.lines || []).some((l) => {
    try { return new RegExp(l.detectPattern, 'i').test(normalized); } catch { return false; }
  });

  const newBrands = [];
  const lineCandidates = [];
  let brandFound = false;

  for (const token of tokens) {
    if (ownBrandsSet.has(token)) { brandFound = true; continue; }
    if (typeKeywords.has(token)) continue;
    if (!brandFound) {
      newBrands.push(token);
      brandFound = true;
    } else {
      lineCandidates.push(token);
    }
  }

  const newLines = [];
  if (!lineMatched && lineCandidates.length > 0) {
    const label = lineCandidates.map((t) => t.charAt(0).toUpperCase() + t.slice(1)).join(' ');
    newLines.push({
      id: lineCandidates.join('-'),
      label,
      anchors: lineCandidates,
      detectPattern: lineCandidates.map((t) => `\\b${t}\\b`).join('\\s+'),
    });
  }

  return { newBrands, newLines, hasNew: newBrands.length > 0 || newLines.length > 0 };
}

router.get('/', async (_req, res, next) => {
  try { return res.json(await getSearchConfig()); } catch (error) { return next(error); }
});

router.post('/analisar', async (req, res, next) => {
  try {
    const name = String(req.body?.name || '').trim();
    if (!name) return res.status(400).json({ error: 'Nome do produto é obrigatório.' });
    const config = await getSearchConfig();
    return res.json(detectNewTerms(name, config));
  } catch (error) { return next(error); }
});

router.post('/adicionar', requireAdmin, async (req, res, next) => {
  try {
    const brands = (Array.isArray(req.body?.brands) ? req.body.brands : [])
      .map((b) => normalizeText(String(b))).filter(Boolean);
    const lines = Array.isArray(req.body?.lines) ? req.body.lines : [];
    const update = {};
    if (brands.length) update.$addToSet = { ownBrands: { $each: brands } };
    if (lines.length) {
      update.$push = { lines: { $each: lines.map((l) => ({ id: String(l.id || ''), label: String(l.label || ''), anchors: Array.isArray(l.anchors) ? l.anchors : [], detectPattern: String(l.detectPattern || '') })) } };
    }
    if (!Object.keys(update).length) return res.json({ ok: true });
    await SearchConfig.findOneAndUpdate({}, update, { upsert: true, new: true, runValidators: true });
    invalidateCache();
    return res.json({ ok: true });
  } catch (error) { return next(error); }
});

module.exports = { router, getSearchConfig, SEED };
