function normalizeEan(value) {
  return String(value ?? '').trim();
}

function isValidEan(ean) {
  return /^\d{8,14}$/.test(ean);
}

function assertValidEan(value) {
  const ean = normalizeEan(value);
  if (!isValidEan(ean)) {
    const error = new Error('EAN inválido. Informe somente de 8 a 14 dígitos.');
    error.status = 400;
    throw error;
  }
  return ean;
}

module.exports = { normalizeEan, isValidEan, assertValidEan };
