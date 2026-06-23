const test = require('node:test');
const assert = require('node:assert/strict');
const { generateSearchTerms } = require('../src/services/searchTerms');

const product = {
  ean: '7896380660735',
  name: 'KERATON PRO QUERATINA LIQUIDA 140ML',
  searchTerm: 'keraton queratina liquida',
  aliases: ['Queratina Keraton Reparação']
};

test('gera termos priorizando EAN, aprendizado e termo cadastrado', () => {
  const terms = generateSearchTerms(product, { goodTerms: ['queratina líquida keraton'], badTerms: ['termo ruim'] });
  assert.deepEqual(terms.slice(0, 3), ['7896380660735', 'queratina liquida keraton', 'keraton queratina liquida']);
  assert.ok(terms.includes('queratina keraton reparacao'));
});

test('respeita capacidades do site e remove termos ruins', () => {
  const terms = generateSearchTerms(product, { badTerms: ['keraton queratina liquida'] }, { acceptsEan: false, acceptsName: true });
  assert.ok(!terms.includes(product.ean));
  assert.ok(!terms.includes('keraton queratina liquida'));
});
