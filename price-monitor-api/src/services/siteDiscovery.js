const SiteCandidate = require('../models/SiteCandidate');

function hostname(value) {
  try { return new URL(value).hostname.replace(/^www\./, '').toLowerCase(); } catch { return ''; }
}

function registeredDomain(domain, sites) {
  return sites.some((site) => {
    const known = hostname(site.searchUrl || site.baseUrl);
    return known && (domain === known || domain.endsWith(`.${known}`) || known.endsWith(`.${domain}`));
  });
}

function inferredType(domain) {
  if (/(amazon|mercadolivre|shopee|magazineluiza)/i.test(domain)) return 'marketplace';
  if (/(drog|farm)/i.test(domain)) return 'drogaria';
  return 'perfumaria';
}

async function splitDiscoveredListings(listings, sites, demoMode = false) {
  const regular = [];
  const byDomain = new Map();
  listings.forEach((listing) => {
    const domain = hostname(listing.link);
    const isRegistered = domain && registeredDomain(domain, sites);
    const candidate = listing.discoveryCandidate === true && domain && !isRegistered
      && Number.isFinite(listing.price) && Number(listing.score) >= 40;
    if (!candidate) {
      if (!listing.discoveryCandidate || isRegistered) regular.push({ ...listing, sellerStatus: 'active' });
      return;
    }
    const current = byDomain.get(domain);
    if (!current || listing.score > current.candidate.score) {
      const siteCandidate = {
        domain,
        name: listing.marketplace && !/não informada/i.test(listing.marketplace) ? listing.marketplace : domain,
        searchUrl: `https://${domain}/`,
        type: inferredType(domain),
        evidenceTitle: listing.title,
        evidencePrice: listing.price,
        score: listing.score
      };
      byDomain.set(domain, { candidate: siteCandidate, listing });
    }
  });
  if (!demoMode && byDomain.size) {
    const existing = await SiteCandidate.find({ domain: { $in: [...byDomain.keys()] } }).lean();
    existing.filter(({ status }) => status !== 'pending').forEach(({ domain }) => byDomain.delete(domain));
    const existingDomains = new Set(existing.map(({ domain }) => domain));
    const pending = [...byDomain.values()].map(({ candidate }) => candidate).filter(({ domain }) => !existingDomains.has(domain));
    if (pending.length) {
      await SiteCandidate.bulkWrite(pending.map((candidate) => ({
        updateOne: { filter: { domain: candidate.domain }, update: { $setOnInsert: { ...candidate, status: 'pending' } }, upsert: true }
      })), { ordered: false });
    }
  }
  const discovered = [...byDomain.values()];
  const newListings = discovered.map(({ listing, candidate }) => ({ ...listing, sellerStatus: 'new', siteCandidate: candidate }));
  return { listings: [...newListings, ...regular], discoveredSites: discovered.map(({ candidate }) => candidate) };
}

module.exports = { hostname, inferredType, splitDiscoveredListings };
