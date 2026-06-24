(function initializeProductPageExtractor() {
  function cleanText(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
  }

  function numberFromPrice(value) {
    let text = String(value ?? '').replace(/[^\d.,]/g, '');
    if (!text) return null;
    if (text.includes(',') && text.includes('.')) text = text.lastIndexOf(',') > text.lastIndexOf('.')
      ? text.replaceAll('.', '').replace(',', '.')
      : text.replaceAll(',', '');
    else if (text.includes(',')) text = text.replaceAll('.', '').replace(',', '.');
    const price = Number(text);
    return Number.isFinite(price) && price > 0.5 ? price : null;
  }

  function objects(value) {
    if (!value || typeof value !== 'object') return [];
    if (Array.isArray(value)) return value.flatMap(objects);
    return [value, ...Object.values(value).flatMap(objects)];
  }

  function offerPrice(offer) {
    if (Array.isArray(offer)) {
      for (const item of offer) {
        const price = offerPrice(item);
        if (Number.isFinite(price)) return price;
      }
      return null;
    }
    if (!offer || typeof offer !== 'object') return null;
    return numberFromPrice(offer.price ?? offer.lowPrice ?? offer.highPrice);
  }

  function structuredProduct() {
    for (const script of document.querySelectorAll('script[type="application/ld+json"]')) {
      try {
        const candidates = objects(JSON.parse(script.textContent || ''));
        for (const candidate of candidates) {
          const types = Array.isArray(candidate['@type']) ? candidate['@type'] : [candidate['@type']];
          if (!types.some((type) => /product/i.test(String(type || '')))) continue;
          const price = offerPrice(candidate.offers);
          if (Number.isFinite(price)) return { title: cleanText(candidate.name), price };
        }
      } catch { /* JSON-LD inválido */ }
    }
    return null;
  }

  function metaPrice() {
    const selectors = [
      'meta[property="product:price:amount"]', 'meta[property="og:price:amount"]',
      'meta[itemprop="price"]', '[itemprop="price"][content]'
    ];
    for (const selector of selectors) {
      const element = document.querySelector(selector);
      const price = numberFromPrice(element?.content || element?.getAttribute('content'));
      if (Number.isFinite(price)) return price;
    }
    return null;
  }

  function extract(product) {
    const structured = structuredProduct();
    const title = structured?.title || cleanText(document.querySelector('h1')?.textContent || document.title);
    const price = structured?.price || metaPrice();
    const link = window.location.href;
    if (!Number.isFinite(price) || !ProductMatcher.matchesOffer(`${title} ${link}`, link, product).relevant) {
      return { title, price: null, link };
    }
    return { title, price, link };
  }

  if (typeof chrome !== 'undefined' && chrome.runtime?.onMessage) {
    chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
      if (message.type !== 'EXTRACT_PRODUCT_PAGE') return;
      sendResponse(extract(message.product || {}));
    });
  }

  if (typeof module === 'object' && module.exports) {
    module.exports = { numberFromPrice, offerPrice };
  }
}());
