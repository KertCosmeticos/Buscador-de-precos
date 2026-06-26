'use strict';

const { normalizeText } = require('../utils/text');

// IDs devem ser idênticos aos usados em compatibilityScore.js — do mais específico ao mais genérico
const LINE_PATTERNS = [
  { id: 'dual-block',        pattern: /color\s+dual\s+block/i },
  { id: 'selfie-my-crush',   pattern: /selfie\s+my\s+crush/i },
  { id: 'keragen-evolution', pattern: /keragen\s+evolution/i },
  { id: 'color-cachos',      pattern: /color\s+cachos/i },
  { id: 'neon-colors',       pattern: /neon\s+colors/i },
  { id: 'hard-color',        pattern: /hard\s+colors?/i },
  { id: 'demi-color',        pattern: /demi\s+color/i },
  { id: 'shine-mask',        pattern: /shine\s+mask/i },
  { id: 'mais-cor',          pattern: /mais\s+cor/i },
  { id: 'mais-forca',        pattern: /mais\s+forca/i },
  { id: 'mais-hidratacao',   pattern: /mais\s+hidratacao/i },
  { id: 'selfie',            pattern: /\bselfie\b/i },
  { id: 'men',               pattern: /keraton\s+men/i },
  { id: 'muito-liso',        pattern: /muito\s*\+?\s*liso/i },
  { id: 'muito-cachos',      pattern: /muito\s*\+?\s*cachos/i },
  { id: 'uso-essencial',     pattern: /uso\s+essencial/i },
  { id: 'desmaia-fio',       pattern: /desmaia\s+fio/i },
  { id: 'color',             pattern: /\bcolor\b/i },  // genérico — deve ficar por último
];

// IDs devem ser idênticos aos usados em compatibilityScore.js — do mais específico ao mais genérico
const TYPE_PATTERNS = [
  { id: 'banho-brilho',  pattern: /banho\s+de\s+brilho/i },
  { id: 'leave-in',      pattern: /leave.?in|creme\s+de\s+pentear/i },
  { id: 'redutor-cor',   pattern: /redutor\s+de\s+cor|dye\s+remover/i },
  { id: 'descolorante',  pattern: /descolorante|dust\s+free/i },
  { id: 'coloracao',     pattern: /colora.ao|tintura/i },
  { id: 'relaxamento',   pattern: /relaxamento/i },
  { id: 'condicionador', pattern: /condicionador|conditioner/i },
  { id: 'mascara',       pattern: /\b(?:mascara|masc)\b/i },
  { id: 'shampoo',       pattern: /\bshampoo\b/i },
  { id: 'oxidante',      pattern: /\boxidante\b/i },
  { id: 'serum',         pattern: /\bserum\b/i },
  { id: 'gelatina',      pattern: /\bgelatina\b/i },
  { id: 'spray',         pattern: /\bspray\b/i },
  { id: 'oleo',          pattern: /\b(?:oleo|oil)\b/i },
];

const OWN_BRANDS = ['keraton', 'kert', 'phytogen', 'keragen', 'reduton'];

// Captura volumes: 50g, 100ml, 1.5l, 500 ml, etc.
const VOLUME_RE = /\b(\d+(?:[.,]\d+)?)\s*(ml|g|gr|kg|l)\b/i;

// Códigos de tom para coloração: 7.0, 8.1, 7/0, 5N, 4A, 10.1
// Aplicado sobre o título original (antes de normalizeText, que remove "/")
// Strip de volumes feito primeiro para evitar confundir "50g" com nuance
const NUANCE_RE = /\b([1-9]\d?[.,\/]\d{1,2}|[1-9][A-Za-z]{1,2})\b/;

// Descritores de cor de cabelo (específico → genérico)
const COLOR_PATTERNS = [
  { id: 'louro-escuro',    pattern: /louro\s+escuro/i,        label: 'Louro Escuro' },
  { id: 'louro-medio',     pattern: /louro\s+m[eé]dio/i,      label: 'Louro Médio' },
  { id: 'louro-claro',     pattern: /louro\s+claro/i,         label: 'Louro Claro' },
  { id: 'louro-dourado',   pattern: /louro\s+dourado/i,       label: 'Louro Dourado' },
  { id: 'louro-acobreado', pattern: /louro\s+acobreado/i,     label: 'Louro Acobreado' },
  { id: 'louro',           pattern: /\blouro\b/i,              label: 'Louro' },
  { id: 'castanho-escuro', pattern: /castanho\s+escuro/i,     label: 'Castanho Escuro' },
  { id: 'castanho-claro',  pattern: /castanho\s+claro/i,      label: 'Castanho Claro' },
  { id: 'castanho',        pattern: /\bcastanho\b/i,           label: 'Castanho' },
  { id: 'preto',           pattern: /\bpreto\b/i,              label: 'Preto' },
  { id: 'ruivo',           pattern: /\bruivo\b/i,              label: 'Ruivo' },
  { id: 'cobre',           pattern: /\bcobre\b/i,              label: 'Cobre' },
  { id: 'violeta',         pattern: /\bvioleta\b/i,            label: 'Violeta' },
  { id: 'bordo',           pattern: /\bbord[oô]\b/i,           label: 'Bordô' },
  { id: 'dourado',         pattern: /\bdourado\b/i,            label: 'Dourado' },
  { id: 'cinza',           pattern: /\bcinza\b/i,              label: 'Cinza' },
  { id: 'platinado',       pattern: /\bplatinado\b/i,          label: 'Platinado' },
];

function extractBrand(normalizedText) {
  return OWN_BRANDS.find((b) => new RegExp(`\\b${b}\\b`).test(normalizedText)) || null;
}

function extractLine(normalizedText) {
  return LINE_PATTERNS.find((l) => l.pattern.test(normalizedText))?.id || null;
}

function extractType(normalizedText) {
  return TYPE_PATTERNS.find((t) => t.pattern.test(normalizedText))?.id || null;
}

// Normaliza volume para formato canônico: "50g", "100ml", "1.5kg"
function normalizeVolume(text) {
  const m = VOLUME_RE.exec(normalizeText(text));
  return m ? `${m[1].replace(',', '.')}${m[2].toLowerCase()}` : null;
}

function extractNuance(originalTitle) {
  // Remove volumes do título original antes de buscar código de tom
  const noVol = originalTitle.replace(/\b\d+\s*(?:ml|g|gr|kg|l)\b/gi, '');
  const m = NUANCE_RE.exec(noVol);
  return m ? m[1] : null;
}

function extractColor(originalTitle) {
  return COLOR_PATTERNS.find((c) => c.pattern.test(originalTitle)) || null;
}

function extractKit(normalizedText) {
  if (!/\b(?:kit|combo|conjunto|pack)\b/.test(normalizedText)) return { isKit: false, qty: 1 };
  const qm = /(?:kit|combo|pack)\s+(?:com\s+)?(\d+)|(\d+)\s*(?:un(?:idades?)?|pe[cç]as?)/i.exec(normalizedText);
  return { isKit: true, qty: qm ? parseInt(qm[1] || qm[2], 10) : 2 };
}

/**
 * Extrai atributos estruturados de um título de anúncio.
 * @param {string} title
 * @returns {{ brand: string|null, line: string|null, type: string|null,
 *             volume: string|null, nuance: string|null,
 *             colorId: string|null, colorLabel: string|null,
 *             isKit: boolean, qty: number }}
 */
function parseListingTitle(title) {
  const original = String(title || '');
  const normalized = normalizeText(original);
  const colorMatch = extractColor(original);
  const { isKit, qty } = extractKit(normalized);
  return {
    brand:      extractBrand(normalized),
    line:       extractLine(normalized),
    type:       extractType(normalized),
    volume:     normalizeVolume(normalized),
    nuance:     extractNuance(original),
    colorId:    colorMatch?.id || null,
    colorLabel: colorMatch?.label || null,
    isKit,
    qty,
  };
}

// Normaliza código de nuance para comparação: "7/0" → "7.0", "7,0" → "7.0"
function normalizeNuance(n) {
  return String(n || '').replace(/[,\/]/g, '.').trim().toLowerCase();
}

module.exports = { parseListingTitle, normalizeVolume, normalizeNuance };
