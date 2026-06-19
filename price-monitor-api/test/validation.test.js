const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeEan, isValidEan, assertValidEan } = require('../src/utils/validation');

test('normaliza e valida EANs de 8 a 14 dígitos', () => {
  assert.equal(normalizeEan(' 7896380606429 '), '7896380606429');
  assert.equal(isValidEan('7896380606429'), true);
  assert.equal(isValidEan('1234567'), false);
  assert.equal(isValidEan('789ABC0606429'), false);
});

test('EAN inválido gera erro amigável', () => {
  assert.throws(() => assertValidEan('ABC'), /EAN inválido/);
});
