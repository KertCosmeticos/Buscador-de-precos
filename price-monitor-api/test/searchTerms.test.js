const test = require('node:test');
const assert = require('node:assert/strict');
const { generateSearchTerms } = require('../src/services/searchTerms');

const product = {
  ean: '7896380660735',
  name: 'KERATON PRO QUERATINA LIQUIDA 140ML'
};

test('gera termos priorizando EAN e aprendizado automático', () => {
  const terms = generateSearchTerms(product, { goodTerms: ['queratina líquida keraton'], confirmedAliases: ['Queratina Keraton Reparação'], badTerms: ['termo ruim'] });
  assert.deepEqual(terms.slice(0, 3), ['7896380660735', 'queratina liquida keraton', 'queratina keraton reparacao']);
  assert.ok(terms.includes('queratina keraton reparacao'));
});

test('respeita capacidades do site e remove termos ruins', () => {
  const terms = generateSearchTerms(product, { badTerms: ['keraton pro queratina liquida 140ml'] }, { acceptsEan: false, acceptsName: true });
  assert.ok(!terms.includes(product.ean));
  assert.ok(!terms.includes('keraton pro queratina liquida 140ml'));
});
