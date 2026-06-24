const test = require('node:test');
const assert = require('node:assert/strict');

const extractor = require('./product-page-extractor');

test('interpreta preços brasileiros e internacionais', () => {
  assert.equal(extractor.numberFromPrice('R$ 1.234,56'), 1234.56);
  assert.equal(extractor.numberFromPrice('66.60'), 66.60);
  assert.equal(extractor.numberFromPrice('34,99'), 34.99);
});

test('lê preço de Offer e AggregateOffer', () => {
  assert.equal(extractor.offerPrice({ price: '59.88' }), 59.88);
  assert.equal(extractor.offerPrice({ lowPrice: '34,99', highPrice: '49,90' }), 34.99);
  assert.equal(extractor.offerPrice([{ price: '66.60' }]), 66.60);
});
