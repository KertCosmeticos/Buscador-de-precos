const test = require('node:test');
const assert = require('node:assert/strict');
const { FALLBACK_POSTAL_CODE, formatPostalCode, normalizePostalCode } = require('../src/config/search');

test('usa e formata o CEP padrão definido para as buscas', () => {
  assert.equal(FALLBACK_POSTAL_CODE, '06795000');
  assert.equal(normalizePostalCode('06795-000'), '06795000');
  assert.equal(formatPostalCode('06795000'), '06795-000');
});

test('CEP inválido retorna ao padrão seguro', () => {
  assert.equal(normalizePostalCode('123'), FALLBACK_POSTAL_CODE);
});
