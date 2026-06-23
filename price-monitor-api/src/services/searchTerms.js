const { normalizeText, tokenize, uniqueStrings } = require('../utils/text');

function generateSearchTerms(product, site = {}) {
  const official = normalizeText(product.name);
  const terms = [];
  if (site.acceptsEan !== false && product.ean) terms.push(product.ean);
  if (site.acceptsName !== false) {
    terms.push(official);
    terms.push(tokenize(official).filter((token) => !/^\d+(?:[.,]\d+)?(?:ml|g|kg|l)$/.test(token)).join(' '));
  }
  return uniqueStrings(terms);
}

module.exports = { generateSearchTerms };
