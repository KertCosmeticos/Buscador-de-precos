const FALLBACK_POSTAL_CODE = '06795000';

function normalizePostalCode(value) {
  const digits = String(value || '').replace(/\D/g, '');
  return /^\d{8}$/.test(digits) ? digits : FALLBACK_POSTAL_CODE;
}

function formatPostalCode(value) {
  const digits = normalizePostalCode(value);
  return `${digits.slice(0, 5)}-${digits.slice(5)}`;
}

const postalCode = normalizePostalCode(process.env.SEARCH_POSTAL_CODE);

module.exports = { FALLBACK_POSTAL_CODE, postalCode, formatPostalCode, normalizePostalCode };
