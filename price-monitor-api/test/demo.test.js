const test = require('node:test');
const assert = require('node:assert/strict');
const { demoSearch } = require('../src/services/demo');

test('modo demonstração nunca publica busca genérica como link de produto', () => {
  const listings = demoSearch('7896380606429');
  assert.equal(listings.length, 5);
  assert.ok(listings.every((listing) => listing.demo && listing.link === ''));
});
