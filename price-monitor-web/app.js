const IS_LOCAL = ['localhost', '127.0.0.1'].includes(window.location.hostname);
const API_URL = IS_LOCAL
  ? 'http://localhost:3000'
  : 'https://sua-api.koyeb.app';

let currentResults = [];
let adminToken = sessionStorage.getItem('priceMonitorAdminToken') || '';
let allCatalogProducts = [];
let catalogProducts = [];
let pendingImportProducts = [];
let pendingImportSites = [];
let browserExtensionAvailable = false;
const browserSearchRequests = new Map();
const selectedProductEans = new Set();
const selectedNames = new Set();
const selectedCategories = new Set();
const selectedFamilies = new Set();

const currency = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

const byId = (id) => document.getElementById(id);

document.querySelectorAll('.tab').forEach((tab) => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach((item) => {
      const active = item === tab;
      item.classList.toggle('active', active);
      item.setAttribute('aria-selected', String(active));
    });
    document.querySelectorAll('.panel').forEach((panel) => {
      const active = panel.id === `${tab.dataset.tab}-panel`;
      panel.classList.toggle('active', active);
      panel.hidden = !active;
    });
  });
});

async function loadApiMode() {
  const badge = byId('data-mode');
  try {
    const health = await request('/health');
    const real = health.mode === 'real';
    badge.textContent = real ? 'Dados reais' : 'Modo demonstração';
    badge.className = `mode-badge ${real ? 'real' : 'demo'}`;
    byId('demo-login-hint').hidden = real;
  } catch {
    badge.textContent = 'API desconectada';
    badge.className = 'mode-badge';
  }
}

function setMessage(element, text = '', type = '') {
  element.textContent = text;
  element.className = `message ${type}`.trim();
}

function setLoading(button, loading) {
  button.disabled = loading;
  button.classList.toggle('loading', loading);
}

function normalizeSpreadsheetHeader(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, ' ')
    .trim();
}

function spreadsheetCell(value) {
  if (typeof value === 'number' && Number.isInteger(value)) return String(value);
  return String(value ?? '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
}

function readImportSpreadsheet(file) {
  if (!globalThis.XLSX) throw new Error('O leitor de Excel não foi carregado. Atualize a página e tente novamente.');
  return file.arrayBuffer().then((buffer) => {
    const workbook = XLSX.read(buffer, { type: 'array' });
    const worksheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: '', raw: true });
    if (rows.length < 2) throw new Error('A planilha não contém produtos.');

    const headers = rows[0].map(normalizeSpreadsheetHeader);
    const aliases = {
      sku: ['COD SFA', 'COD DO SFA', 'SKU', 'CODIGO INTERNO'],
      name: ['NOME', 'PRODUTO', 'NOME DO PRODUTO'],
      volume: ['GRAMATURA', 'VOLUME', 'VOLUME GRAMATURA'],
      ean: ['CODBARRAS', 'COD BARRAS', 'EAN', 'CODIGO DE BARRAS'],
      category: ['CATEGORIA'],
      family: ['FAMILIA']
    };
    const positions = Object.fromEntries(Object.entries(aliases).map(([field, names]) => [
      field,
      headers.findIndex((header) => names.includes(header))
    ]));
    const missing = Object.entries(positions).filter(([, index]) => index < 0).map(([field]) => field);
    if (missing.length) {
      throw new Error('Cabeçalhos obrigatórios ausentes. Use a planilha-modelo disponível no painel.');
    }

    const products = [];
    const errors = [];
    const seenEans = new Map();
    rows.slice(1).forEach((row, offset) => {
      const line = offset + 2;
      if (!row.some((value) => spreadsheetCell(value))) return;
      const product = {
        sku: spreadsheetCell(row[positions.sku]),
        name: spreadsheetCell(row[positions.name]),
        volume: spreadsheetCell(row[positions.volume]),
        ean: spreadsheetCell(row[positions.ean]),
        category: spreadsheetCell(row[positions.category]),
        family: spreadsheetCell(row[positions.family]),
        active: true
      };
      const emptyFields = ['sku', 'name', 'volume', 'ean', 'category', 'family'].filter((field) => !product[field]);
      if (emptyFields.length) {
        errors.push(`Linha ${line}: existem campos obrigatórios vazios.`);
      } else if (!/^\d{8,14}$/.test(product.ean)) {
        errors.push(`Linha ${line}: EAN inválido (${product.ean || 'vazio'}).`);
      } else if (seenEans.has(product.ean)) {
        errors.push(`Linha ${line}: EAN duplicado com a linha ${seenEans.get(product.ean)}.`);
      } else {
        seenEans.set(product.ean, line);
        products.push(product);
      }
    });
    if (errors.length) {
      const preview = errors.slice(0, 5).join(' ');
      const remainder = errors.length > 5 ? ` Mais ${errors.length - 5} erro(s).` : '';
      throw new Error(`${preview}${remainder}`);
    }
    if (!products.length) throw new Error('Nenhum produto válido foi encontrado na planilha.');
    return products;
  });
}

function readSiteSpreadsheet(file) {
  if (!globalThis.XLSX) throw new Error('O leitor de Excel não foi carregado. Atualize a página e tente novamente.');
  return file.arrayBuffer().then((buffer) => {
    const workbook = XLSX.read(buffer, { type: 'array' });
    const worksheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: '', raw: true });
    if (rows.length < 2) throw new Error('A planilha não contém sites.');
    const headers = rows[0].map(normalizeSpreadsheetHeader);
    const positions = {
      name: headers.findIndex((header) => ['NOME', 'SITE', 'NOME DO SITE'].includes(header)),
      searchUrl: headers.findIndex((header) => ['URL DE BUSCA', 'URL BUSCA', 'URL'].includes(header)),
      type: headers.findIndex((header) => ['TIPO', 'TIPO DO SITE'].includes(header))
    };
    if (Object.values(positions).some((index) => index < 0)) throw new Error('Use os cabeçalhos NOME, URL DE BUSCA e TIPO.');
    const typeAliases = { marketplace: 'marketplace', perfumaria: 'perfumaria', drogaria: 'drogaria', 'loja propria': 'loja_propria' };
    const sites = [];
    const errors = [];
    const names = new Set();
    rows.slice(1).forEach((row, offset) => {
      if (!row.some((value) => spreadsheetCell(value))) return;
      const line = offset + 2;
      const name = spreadsheetCell(row[positions.name]);
      const searchUrl = spreadsheetCell(row[positions.searchUrl]);
      const rawType = normalizeSpreadsheetHeader(row[positions.type]).toLocaleLowerCase('pt-BR');
      const type = typeAliases[rawType];
      if (!name || !searchUrl || !type) errors.push(`Linha ${line}: nome, URL e tipo válido são obrigatórios.`);
      else {
        try { new URL(searchUrl); } catch { errors.push(`Linha ${line}: URL de busca inválida.`); return; }
        const key = name.toLocaleLowerCase('pt-BR');
        if (names.has(key)) errors.push(`Linha ${line}: site duplicado (${name}).`);
        else { names.add(key); sites.push({ name, searchUrl, type }); }
      }
    });
    if (errors.length) throw new Error(`${errors.slice(0, 5).join(' ')}${errors.length > 5 ? ` Mais ${errors.length - 5} erro(s).` : ''}`);
    if (!sites.length) throw new Error('Nenhum site válido foi encontrado na planilha.');
    return sites;
  });
}

function setImportProgress(percent, text) {
  const normalized = Math.max(0, Math.min(100, Math.round(percent)));
  byId('import-progress').hidden = false;
  byId('import-progress-bar').value = normalized;
  byId('import-progress-bar').textContent = `${normalized}%`;
  byId('import-progress-percent').textContent = `${normalized}%`;
  byId('import-progress-text').textContent = text;
}

function setBrowserExtensionStatus(available) {
  browserExtensionAvailable = Boolean(available);
  const status = byId('browser-extension-status');
  status.textContent = available
    ? 'Extensão do Chrome conectada e pronta para pesquisar.'
    : 'Extensão do Chrome não detectada. Instale ou recarregue a extensão e atualize esta página.';
  status.classList.toggle('unavailable', !available);
}

function setSearchProgress(percent, text) {
  const normalized = Math.max(0, Math.min(100, Math.round(percent)));
  byId('search-progress').hidden = false;
  byId('search-progress-bar').value = normalized;
  byId('search-progress-bar').textContent = `${normalized}%`;
  byId('search-progress-percent').textContent = `${normalized}%`;
  byId('search-progress-text').textContent = text;
}

function summarizeBrowserResult(result) {
  const listings = result.listings || [];
  const prices = listings.map((listing) => listing.price).filter(Number.isFinite);
  const sum = prices.reduce((total, price) => total + price, 0);
  const grouped = new Map();
  listings.forEach((listing) => {
    const marketplace = listing.marketplace || 'Não informado';
    if (!grouped.has(marketplace)) grouped.set(marketplace, []);
    grouped.get(marketplace).push(listing);
  });
  const marketplaceSummary = [...grouped].map(([marketplace, marketplaceListings]) => {
    const marketplacePrices = marketplaceListings.map((listing) => listing.price).filter(Number.isFinite);
    return {
      marketplace,
      minPrice: marketplacePrices.length ? Math.min(...marketplacePrices) : null,
      maxPrice: marketplacePrices.length ? Math.max(...marketplacePrices) : null,
      averagePrice: marketplacePrices.length
        ? marketplacePrices.reduce((total, price) => total + price, 0) / marketplacePrices.length
        : null,
      listingsCount: marketplaceListings.length
    };
  });
  return {
    ean: result.ean,
    minPrice: prices.length ? Math.min(...prices) : null,
    maxPrice: prices.length ? Math.max(...prices) : null,
    averagePrice: prices.length ? sum / prices.length : null,
    listingsCount: listings.length,
    pricedListingsCount: prices.length,
    marketplaces: [...grouped.keys()],
    marketplaceSummary,
    sources: result.sources || [],
    listings,
    ...(listings.length ? {} : { error: 'Nenhuma oferta relevante com preço e link direto foi encontrada.' })
  };
}

function searchWithBrowser(products) {
  if (!browserExtensionAvailable) {
    return Promise.reject(new Error('A extensão do Chrome não está conectada. Instale-a ou selecione API online.'));
  }
  if (products.length > 5) {
    return Promise.reject(new Error('A pesquisa pelo Chrome aceita até cinco produtos por vez.'));
  }
  const requestId = crypto.randomUUID();
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      browserSearchRequests.delete(requestId);
      reject(new Error('A pesquisa pelo Chrome excedeu oito minutos. Verifique se o Google solicitou CAPTCHA.'));
    }, 480000);
    browserSearchRequests.set(requestId, { resolve, reject, timeout });
    window.postMessage({
      source: 'price-monitor-web',
      type: 'BROWSER_SEARCH_REQUEST',
      requestId,
      products
    }, window.location.origin);
  });
}

async function scoreBrowserResults(results) {
  return Promise.all(results.map(async (result) => {
    if (!result.listings?.length) return result;
    try {
      const scored = await request('/avaliar', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ean: result.ean, listings: result.listings })
      });
      return { ...result, productId: scored.productId, listings: scored.listings };
    } catch { return result; }
  }));
}

window.addEventListener('message', (event) => {
  if (event.source !== window || event.origin !== window.location.origin) return;
  const message = event.data;
  if (!message || message.source !== 'price-monitor-extension') return;
  if (message.type === 'BROWSER_EXTENSION_STATUS') {
    setBrowserExtensionStatus(message.available);
    return;
  }
  const request = browserSearchRequests.get(message.requestId);
  if (!request) return;
  if (message.type === 'BROWSER_SEARCH_PROGRESS') {
    const percent = message.total ? (message.completed / message.total) * 100 : 0;
    setSearchProgress(percent, message.message || 'Pesquisando na internet…');
    return;
  }
  clearTimeout(request.timeout);
  browserSearchRequests.delete(message.requestId);
  if (message.type === 'BROWSER_SEARCH_RESULT') {
    setSearchProgress(100, 'Pesquisa pelo Chrome concluída.');
    request.resolve((message.results || []).map(summarizeBrowserResult));
  } else if (message.type === 'BROWSER_SEARCH_ERROR') {
    request.reject(new Error(message.error || 'A extensão não conseguiu concluir a pesquisa.'));
  }
});

window.postMessage({ source: 'price-monitor-web', type: 'BROWSER_EXTENSION_PING' }, window.location.origin);

async function request(path, options = {}) {
  if (!IS_LOCAL && API_URL.includes('sua-api.koyeb.app')) {
    throw new Error('A API ainda não foi conectada. Finalize a configuração do backend no Koyeb.');
  }
  const headers = new Headers(options.headers || {});
  if (adminToken) headers.set('Authorization', `Bearer ${adminToken}`);
  let response;
  try {
    response = await fetch(`${API_URL}${path}`, { ...options, headers });
  } catch {
    throw new Error('Não foi possível conectar à API. Verifique se o backend está disponível.');
  }
  let data;
  try { data = await response.json(); } catch { data = {}; }
  if (!response.ok) {
    const error = new Error(data.error || 'Não foi possível concluir a solicitação.');
    error.status = response.status;
    if (response.status === 401 && path !== '/auth/login' && adminToken) setAdminAccess(false);
    throw error;
  }
  return data;
}

function setAdminAccess(authenticated) {
  byId('restricted-login').hidden = authenticated;
  byId('admin-content').hidden = !authenticated;
  if (!authenticated) {
    adminToken = '';
    sessionStorage.removeItem('priceMonitorAdminToken');
    resetProductForm();
  }
}

async function restoreAdminSession() {
  if (!adminToken) return setAdminAccess(false);
  try {
    await request('/auth/me');
    setAdminAccess(true);
    await loadSites();
  } catch {
    setAdminAccess(false);
  }
}

const filterDefinitions = {
  name: { property: 'name', input: 'name-filter-search', options: 'name-filter-options', selected: selectedNames },
  category: { property: 'category', input: 'category-filter-search', options: 'category-filter-options', selected: selectedCategories },
  family: { property: 'family', input: 'family-filter-search', options: 'family-filter-options', selected: selectedFamilies }
};

function updateFilterPlaceholder(definition) {
  const input = byId(definition.input);
  input.placeholder = definition.selected.size
    ? `${definition.selected.size} opção(ões) selecionada(s)`
    : 'Clique para selecionar';
}

function closeFilterMenus(except = null) {
  Object.entries(filterDefinitions).forEach(([type, definition]) => {
    if (type === except) return;
    const input = byId(definition.input);
    input.closest('.filter-field').classList.remove('open');
    if (input.value) {
      input.value = '';
      renderFilterOptions(type);
    }
  });
}

function renderFilterOptions(type) {
  const definition = filterDefinitions[type];
  const container = byId(definition.options);
  const term = byId(definition.input).value.trim().toLocaleLowerCase('pt-BR');
  const values = [...new Set(allCatalogProducts.map((product) => product[definition.property]))]
    .filter((value) => !term || value.toLocaleLowerCase('pt-BR').includes(term))
    .sort((a, b) => a.localeCompare(b, 'pt-BR'));
  container.replaceChildren();
  if (!values.length) {
    const empty = document.createElement('p');
    empty.className = 'filter-empty';
    empty.textContent = 'Nenhuma opção encontrada.';
    container.append(empty);
  }
  values.forEach((value) => {
    const label = document.createElement('label');
    label.className = 'check-row filter-option';
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = definition.selected.has(value);
    checkbox.addEventListener('change', () => {
      checkbox.checked ? definition.selected.add(value) : definition.selected.delete(value);
      updateFilterPlaceholder(definition);
      loadPickerProducts();
    });
    const text = document.createElement('span');
    text.textContent = value;
    label.append(checkbox, text);
    container.append(label);
  });
  updateFilterPlaceholder(definition);
}

async function loadCatalogFilters() {
  const data = await request('/produtos');
  allCatalogProducts = data.products || [];
  Object.entries(filterDefinitions).forEach(([type, definition]) => {
    const available = new Set(allCatalogProducts.map((product) => product[definition.property]));
    [...definition.selected].forEach((value) => {
      if (!available.has(value)) definition.selected.delete(value);
    });
    renderFilterOptions(type);
  });
}

function updateSelectedCount() {
  byId('selected-count').textContent = `${selectedProductEans.size} selecionado(s)`;
  byId('select-all-products').checked = catalogProducts.length > 0
    && catalogProducts.every((product) => selectedProductEans.has(product.ean));
}

function hasActiveProductFilter() {
  return Boolean(byId('quick-product-search').value.trim())
    || selectedNames.size > 0
    || selectedCategories.size > 0
    || selectedFamilies.size > 0;
}

function renderProductPicker() {
  const list = byId('product-picker-list');
  list.replaceChildren();
  const hasFilter = hasActiveProductFilter();
  list.classList.toggle('awaiting-filter', !hasFilter);
  byId('filtered-select-all').hidden = !hasFilter || catalogProducts.length === 0;
  if (!catalogProducts.length) {
    const empty = document.createElement('p');
    empty.className = 'picker-product';
    empty.textContent = hasFilter
      ? 'Nenhum produto encontrado com estes filtros.'
      : 'Digite ou selecione um filtro para visualizar os produtos.';
    list.append(empty);
  }
  catalogProducts.forEach((product) => {
    const label = document.createElement('label');
    label.className = 'check-row picker-product';
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = selectedProductEans.has(product.ean);
    checkbox.addEventListener('change', () => {
      checkbox.checked ? selectedProductEans.add(product.ean) : selectedProductEans.delete(product.ean);
      updateSelectedCount();
    });
    const description = document.createElement('span');
    const name = document.createElement('strong');
    name.textContent = product.name;
    const details = document.createElement('small');
    details.textContent = `${product.ean} · ${product.category} · ${product.family}`;
    description.append(name, document.createElement('br'), details);
    label.append(checkbox, description);
    list.append(label);
  });
  updateSelectedCount();
}

async function loadPickerProducts() {
  const search = byId('quick-product-search').value.trim().toLocaleLowerCase('pt-BR');
  if (!hasActiveProductFilter()) {
    catalogProducts = [];
    renderProductPicker();
    return;
  }
  catalogProducts = allCatalogProducts.filter((product) => {
    const matchesSearch = !search || [product.ean, product.sku, product.name, product.category, product.family]
      .some((value) => String(value || '').toLocaleLowerCase('pt-BR').includes(search));
    return matchesSearch
      && (!selectedNames.size || selectedNames.has(product.name))
      && (!selectedCategories.size || selectedCategories.has(product.category))
      && (!selectedFamilies.size || selectedFamilies.has(product.family));
  });
  renderProductPicker();
}

function actionButton(label, className, handler) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = `table-action ${className}`.trim();
  button.textContent = label;
  button.addEventListener('click', handler);
  return button;
}

function fillProductForm(product) {
  byId('product-id').value = product._id;
  byId('catalog-ean').value = product.ean;
  byId('catalog-sku').value = product.sku || '';
  byId('catalog-name').value = product.name;
  byId('catalog-category').value = product.category;
  byId('catalog-family').value = product.family;
  byId('catalog-volume').value = product.volume || '';
  byId('product-form-title').textContent = 'Editar produto';
  byId('cancel-edit').hidden = false;
  byId('catalog-ean').focus();
}

function resetProductForm() {
  byId('product-form').reset();
  byId('product-id').value = '';
  byId('product-form-title').textContent = 'Cadastrar produto';
  byId('cancel-edit').hidden = true;
}

async function loadCatalogTable() {
  const data = await request('/produtos');
  const products = data.products || [];
  const body = byId('catalog-body');
  const viewBody = byId('catalog-view-body');
  body.replaceChildren();
  viewBody.replaceChildren();
  products.forEach((product) => {
    const viewRow = viewBody.insertRow();
    appendCell(viewRow, product.ean);
    appendCell(viewRow, product.sku || '—');
    appendCell(viewRow, product.name);
    appendCell(viewRow, product.category);
    appendCell(viewRow, product.family);

    const row = body.insertRow();
    appendCell(row, product.ean);
    appendCell(row, product.sku || '—');
    appendCell(row, product.name);
    appendCell(row, product.category);
    appendCell(row, product.family);
    const actions = row.insertCell();
    actions.append(
      actionButton('Editar', '', () => fillProductForm(product)),
      actionButton('Excluir', 'danger', async () => {
        if (!window.confirm(`Excluir ${product.name} do catálogo?`)) return;
        try {
          await request(`/produtos/${encodeURIComponent(product._id)}`, { method: 'DELETE' });
          selectedProductEans.delete(product.ean);
          await refreshCatalog();
          setMessage(byId('catalog-message'), 'Produto excluído.', 'success');
        } catch (error) { setMessage(byId('catalog-message'), error.message, 'error'); }
      })
    );
  });
  byId('catalog-count').textContent = `${products.length} produto(s)`;
  byId('catalog-view-count').textContent = `${products.length} produto(s)`;
}

async function refreshCatalog() {
  await loadCatalogFilters();
  await Promise.all([loadPickerProducts(), loadCatalogTable()]);
}

function cheapestListing(result) {
  const listings = result.listings || [];
  return listings.filter((listing) => Number.isFinite(listing.price)).reduce(
    (cheapest, listing) => !cheapest || listing.price < cheapest.price ? listing : cheapest,
    null
  ) || listings[0] || null;
}

function appendCell(row, value) {
  const cell = row.insertCell();
  cell.textContent = value;
  return cell;
}

function marketplaceLinks(listings) {
  const links = new Map();
  (listings || []).forEach((listing) => {
    if (listing.marketplace && listing.link && !links.has(listing.marketplace)) {
      links.set(listing.marketplace, listing.link);
    }
  });
  return links;
}

function renderResults(results) {
  const body = byId('results-body');
  body.replaceChildren();

  results.forEach((result) => {
    const row = body.insertRow();
    appendCell(row, result.ean || '—');
    if (result.error && !result.listingsCount) {
      row.className = 'error-row';
      const cell = row.insertCell();
      cell.colSpan = 8;
      cell.textContent = result.error;
      return;
    }

    const cheapest = cheapestListing(result);
    appendCell(row, cheapest?.title || '—');
    appendCell(row, (result.marketplaces || []).join(', ') || cheapest?.marketplace || '—');
    appendCell(row, result.minPrice == null ? '—' : currency.format(result.minPrice));
    appendCell(row, result.maxPrice == null ? '—' : currency.format(result.maxPrice));
    appendCell(row, result.averagePrice == null ? '—' : currency.format(result.averagePrice));
    appendCell(row, String(result.listingsCount ?? 0));
    const sellerCell = row.insertCell();
    if (cheapest?.link) {
      const link = document.createElement('a');
      link.href = cheapest.link;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.textContent = cheapest.seller;
      sellerCell.append(link);
    } else {
      sellerCell.textContent = cheapest?.seller || '—';
    }
    const linksCell = row.insertCell();
    const links = marketplaceLinks(result.listings);
    if (!links.size) {
      linksCell.textContent = result.listings?.some((listing) => listing.demo)
        ? 'Disponível na busca real'
        : '—';
    } else {
      [...links].forEach(([marketplace, url], index) => {
        if (index) linksCell.append(document.createTextNode(' · '));
        const link = document.createElement('a');
        link.href = url;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        link.textContent = marketplace;
        linksCell.append(link);
      });
    }
  });

  byId('results-count').textContent = `${results.length} produto(s) consultado(s)`;
  byId('results-card').hidden = false;
  byId('demo-notice').hidden = !results.some((result) =>
    (result.sources || []).some((source) => source.name?.includes('Demonstração'))
  );
  renderDetails(results);
}

function conditionLabel(condition) {
  const labels = { new: 'Novo', used: 'Usado', not_specified: 'Não informada' };
  return labels[condition] || condition || 'Não informada';
}

function renderDetails(results) {
  const body = byId('details-body');
  body.replaceChildren();
  const offers = results.flatMap((result) =>
    (result.listings || []).map((listing) => ({ ean: result.ean, productId: result.productId, searchTerm: result.usedSearchTerm, ...listing }))
  ).sort((a, b) => a.ean.localeCompare(b.ean)
    || (Number.isFinite(b.score) ? b.score : -Infinity) - (Number.isFinite(a.score) ? a.score : -Infinity)
    || (Number.isFinite(a.price) ? a.price : Number.POSITIVE_INFINITY)
      - (Number.isFinite(b.price) ? b.price : Number.POSITIVE_INFINITY));

  offers.forEach((offer) => {
    const row = body.insertRow();
    appendCell(row, offer.ean);
    appendCell(row, offer.marketplace || '—');
    appendCell(row, offer.title || '—');
    appendCell(row, Number.isFinite(offer.price) ? currency.format(offer.price) : '—');
    appendCell(row, offer.seller || '—');
    appendCell(row, Number.isFinite(offer.score) ? String(offer.score) : '—');
    appendCell(row, offer.status || '—');
    appendCell(row, offer.soldQuantity == null ? 'Não informado' : String(offer.soldQuantity));
    appendCell(row, conditionLabel(offer.condition));
    appendCell(row, offer.freeShipping ? 'Sim' : 'Não');
    const linkCell = row.insertCell();
    if (offer.link) {
      const link = document.createElement('a');
      link.href = offer.link;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.textContent = 'Ver produto';
      linkCell.append(link);
    } else {
      linkCell.textContent = offer.demo ? 'Disponível na busca real' : '—';
    }
    const feedbackCell = row.insertCell();
    if (offer.productId && adminToken) {
      feedbackCell.append(
        actionButton('Confirmar', '', () => sendFeedback(offer, 'confirm')),
        actionButton('Ignorar', 'danger', () => sendFeedback(offer, 'ignore'))
      );
    } else feedbackCell.textContent = '—';
  });

  byId('details-count').textContent = `${offers.length} oferta(s) B2C com preço e link direto`;
  byId('details-card').hidden = offers.length === 0;
}

async function sendFeedback(offer, action) {
  try {
    await request('/aprendizado/feedback', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ productId: offer.productId, action, title: offer.title, searchTerm: offer.searchTerm })
    });
    setMessage(byId('search-message'), action === 'confirm' ? 'Resultado confirmado e aprendizado salvo.' : 'Resultado ignorado e aprendizado salvo.', 'success');
  } catch (error) { setMessage(byId('search-message'), error.message, 'error'); }
}

function resetSiteForm() {
  byId('site-form').reset();
  byId('site-id').value = '';
  byId('site-form-title').textContent = 'Cadastrar site monitorado';
  byId('cancel-site-edit').hidden = true;
}

function fillSiteForm(site) {
  byId('site-id').value = site._id;
  byId('site-name').value = site.name;
  byId('site-type').value = site.type;
  byId('site-search-url').value = site.searchUrl;
  byId('site-form-title').textContent = 'Editar site monitorado';
  byId('cancel-site-edit').hidden = false;
}

async function loadSites() {
  const { sites = [] } = await request('/sites');
  const body = byId('sites-body');
  body.replaceChildren();
  sites.forEach((site) => {
    const row = body.insertRow();
    appendCell(row, site.name); appendCell(row, site.type.replace('_', ' '));
    const urlCell = row.insertCell();
    const url = document.createElement('a'); url.href = site.searchUrl; url.target = '_blank'; url.rel = 'noopener noreferrer'; url.textContent = 'Abrir busca'; urlCell.append(url);
    appendCell(row, ({ pending: 'Pendente', learning: 'Aprendendo', learned: 'Aprendido', failed: 'Revisar' })[site.discoveryStatus] || 'Pendente');
    const actions = row.insertCell();
    actions.append(actionButton('Editar', '', () => fillSiteForm(site)), actionButton('Excluir', 'danger', async () => {
      if (!window.confirm(`Excluir ${site.name}?`)) return;
      await request(`/sites/${encodeURIComponent(site._id)}`, { method: 'DELETE' });
      await loadSites();
    }));
  });
  byId('sites-count').textContent = `${sites.length} site(s)`;
}

byId('search-button').addEventListener('click', async () => {
  const typedValue = byId('quick-product-search').value.trim();
  const typedEans = /^\d{8,14}$/.test(typedValue) ? [typedValue] : [];
  const eans = [...new Set([...typedEans, ...selectedProductEans])];
  if (!eans.length) {
    setMessage(byId('search-message'), 'Selecione pelo menos um produto ou digite um EAN válido.', 'error');
    return;
  }

  const button = byId('search-button');
  const searchSource = document.querySelector('input[name="search-source"]:checked')?.value || 'browser';
  const products = eans.map((ean) => {
    const catalogProduct = allCatalogProducts.find((product) => product.ean === ean);
    return {
      ean,
      name: catalogProduct?.name || '',
      sku: catalogProduct?.sku || '',
      category: catalogProduct?.category || '',
      family: catalogProduct?.family || ''
    };
  });
  setLoading(button, true);
  byId('search-progress').hidden = true;
  setMessage(
    byId('search-message'),
    searchSource === 'browser' ? 'Preparando pesquisa no Chrome…' : 'Consultando a API online…'
  );
  try {
    if (searchSource === 'browser') {
      currentResults = await scoreBrowserResults(await searchWithBrowser(products));
    } else {
      const data = await request('/buscar/lote', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(eans)
      });
      currentResults = data.results || [];
    }
    renderResults(currentResults);
    byId('export-button').disabled = currentResults.length === 0;
    const errors = currentResults.filter((item) => item.error).length;
    const sourceDiagnostics = currentResults.flatMap((item) => item.sources || []);
    const sourcesWithOffers = sourceDiagnostics.filter((source) => Number(source.count) > 0).length;
    const failedSources = sourceDiagnostics.filter((source) => source.status === 'error').length;
    const errorGroups = new Map();
    sourceDiagnostics.filter((source) => source.status === 'error').forEach((source) => {
      const reason = source.error || 'Erro não identificado';
      errorGroups.set(reason, (errorGroups.get(reason) || 0) + 1);
    });
    const mainErrors = [...errorGroups.entries()].sort((a, b) => b[1] - a[1]).slice(0, 2)
      .map(([reason, count]) => `${count}× ${reason}`).join(' | ');
    const diagnosticText = searchSource === 'browser' && sourceDiagnostics.length
      ? ` ${sourcesWithOffers} fonte(s) com oferta e ${failedSources} com erro técnico.${mainErrors ? ` Principais erros: ${mainErrors}` : ''}`
      : '';
    setMessage(
      byId('search-message'),
      errors
        ? `Busca concluída com ${errors} item(ns) sem resultado.${diagnosticText}`
        : `Busca concluída com sucesso pelo ${searchSource === 'browser' ? 'Chrome' : 'servidor'}.${diagnosticText}`,
      errors ? 'error' : 'success'
    );
  } catch (error) {
    setMessage(byId('search-message'), error.message, 'error');
  } finally {
    setLoading(button, false);
  }
});

function csvCell(value) {
  return `"${String(value ?? '').replaceAll('"', '""')}"`;
}

byId('export-button').addEventListener('click', () => {
  const header = ['EAN', 'Marketplace', 'Produto', 'Preço', 'Vendedor', 'Quantidade vendida', 'Condição', 'Frete grátis', 'Link', 'Preço mínimo do EAN', 'Preço máximo do EAN', 'Preço médio do EAN'];
  const rows = currentResults.flatMap((result) => (result.listings || []).map((listing) => [
    result.ean, listing.marketplace, listing.title, listing.price, listing.seller,
    listing.soldQuantity ?? 'Não informado', conditionLabel(listing.condition),
    listing.freeShipping ? 'Sim' : 'Não', listing.link,
    result.minPrice, result.maxPrice, result.averagePrice
  ].map(csvCell).join(';')));
  const blob = new Blob([`\ufeff${header.map(csvCell).join(';')}\r\n${rows.join('\r\n')}`], { type: 'text/csv;charset=utf-8' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = `price-monitor-${new Date().toISOString().slice(0, 10)}.csv`;
  link.click();
  URL.revokeObjectURL(link.href);
});

let catalogSearchTimer;
byId('quick-product-search').addEventListener('input', () => {
  clearTimeout(catalogSearchTimer);
  catalogSearchTimer = setTimeout(() => loadPickerProducts().catch((error) => {
    byId('product-picker-list').textContent = error.message;
  }), 250);
});
Object.entries(filterDefinitions).forEach(([type, definition]) => {
  const input = byId(definition.input);
  input.addEventListener('focus', () => {
    closeFilterMenus(type);
    input.closest('.filter-field').classList.add('open');
  });
  input.addEventListener('click', () => {
    closeFilterMenus(type);
    input.closest('.filter-field').classList.add('open');
  });
  input.addEventListener('input', () => renderFilterOptions(type));
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      input.blur();
      closeFilterMenus();
    }
  });
});
document.addEventListener('click', (event) => {
  if (!event.target.closest('.filter-field')) closeFilterMenus();
});
byId('select-all-products').addEventListener('change', (event) => {
  catalogProducts.forEach((product) => {
    event.target.checked ? selectedProductEans.add(product.ean) : selectedProductEans.delete(product.ean);
  });
  renderProductPicker();
});

byId('product-import-file').addEventListener('change', async (event) => {
  pendingImportProducts = [];
  byId('import-products-button').disabled = true;
  byId('import-progress').hidden = true;
  setMessage(byId('import-message'));
  const [file] = event.target.files;
  if (!file) {
    byId('import-file-summary').textContent = 'Nenhum arquivo selecionado.';
    return;
  }
  byId('import-file-summary').textContent = `Lendo ${file.name}…`;
  try {
    pendingImportProducts = await readImportSpreadsheet(file);
    byId('import-file-summary').textContent = `${file.name}: ${pendingImportProducts.length} produto(s) validado(s) e pronto(s) para importar.`;
    byId('import-products-button').disabled = false;
    setMessage(byId('import-message'), 'Arquivo validado. EANs existentes serão atualizados e novos EANs serão criados.', 'success');
  } catch (error) {
    byId('import-file-summary').textContent = `${file.name}: arquivo com erro.`;
    setMessage(byId('import-message'), error.message, 'error');
  }
});

byId('import-products-button').addEventListener('click', async () => {
  if (!pendingImportProducts.length) return;
  const button = byId('import-products-button');
  const fileInput = byId('product-import-file');
  const batchSize = 50;
  const totals = { total: 0, created: 0, updated: 0, unchanged: 0 };
  let processed = 0;
  setLoading(button, true);
  fileInput.disabled = true;
  setMessage(byId('import-message'));
  setImportProgress(2, 'Preparando produtos…');
  try {
    for (let index = 0; index < pendingImportProducts.length; index += batchSize) {
      const batch = pendingImportProducts.slice(index, index + batchSize);
      setImportProgress(5 + (processed / pendingImportProducts.length) * 90, `Importando produtos ${index + 1} a ${index + batch.length}…`);
      const result = await request('/produtos/importar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ products: batch })
      });
      Object.keys(totals).forEach((key) => { totals[key] += Number(result[key] || 0); });
      processed += batch.length;
      setImportProgress(5 + (processed / pendingImportProducts.length) * 90, `${processed} de ${pendingImportProducts.length} produtos processados…`);
    }
    setImportProgress(97, 'Atualizando o catálogo…');
    await refreshCatalog();
    setImportProgress(100, 'Importação concluída.');
    setMessage(
      byId('import-message'),
      `Importação concluída: ${totals.created} criado(s), ${totals.updated} atualizado(s) e ${totals.unchanged} sem alteração.`,
      'success'
    );
    pendingImportProducts = [];
    fileInput.value = '';
    byId('import-file-summary').textContent = 'Nenhum arquivo selecionado.';
  } catch (error) {
    setMessage(
      byId('import-message'),
      `${error.message} ${processed} de ${pendingImportProducts.length} produtos foram processados; você pode selecionar o arquivo novamente com segurança.`,
      'error'
    );
    setImportProgress(5 + (processed / pendingImportProducts.length) * 90, 'Importação interrompida.');
  } finally {
    setLoading(button, false);
    button.disabled = pendingImportProducts.length === 0;
    fileInput.disabled = false;
  }
});

byId('cancel-edit').addEventListener('click', resetProductForm);
byId('product-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const id = byId('product-id').value;
  const product = {
    ean: byId('catalog-ean').value.trim(),
    sku: byId('catalog-sku').value.trim(),
    name: byId('catalog-name').value.trim(),
    category: byId('catalog-category').value.trim(),
    family: byId('catalog-family').value.trim(),
    volume: byId('catalog-volume').value.trim()
  };
  try {
    await request(id ? `/produtos/${encodeURIComponent(id)}` : '/produtos', {
      method: id ? 'PUT' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(product)
    });
    resetProductForm();
    await refreshCatalog();
    setMessage(byId('catalog-message'), id ? 'Produto atualizado.' : 'Produto cadastrado.', 'success');
  } catch (error) {
    setMessage(byId('catalog-message'), error.message, 'error');
  }
});

byId('cancel-site-edit').addEventListener('click', resetSiteForm);
byId('download-site-template').addEventListener('click', () => {
  if (!globalThis.XLSX) {
    setMessage(byId('site-import-message'), 'O gerador do modelo não foi carregado. Atualize a página e tente novamente.', 'error');
    return;
  }
  const worksheet = XLSX.utils.aoa_to_sheet([['NOME', 'URL DE BUSCA', 'TIPO']]);
  worksheet['!cols'] = [{ wch: 28 }, { wch: 62 }, { wch: 20 }];
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Sites');
  XLSX.writeFile(workbook, 'MODELO_IMPORTACAO_SITES.xlsx');
});
byId('site-import-file').addEventListener('change', async (event) => {
  pendingImportSites = [];
  byId('import-sites-button').disabled = true;
  setMessage(byId('site-import-message'));
  const [file] = event.target.files;
  if (!file) { byId('site-import-summary').textContent = 'Nenhum arquivo selecionado.'; return; }
  byId('site-import-summary').textContent = `Lendo ${file.name}…`;
  try {
    pendingImportSites = await readSiteSpreadsheet(file);
    byId('site-import-summary').textContent = `${file.name}: ${pendingImportSites.length} site(s) pronto(s) para importar.`;
    byId('import-sites-button').disabled = false;
    setMessage(byId('site-import-message'), 'Arquivo validado. Sites existentes serão atualizados pelo nome.', 'success');
  } catch (error) {
    byId('site-import-summary').textContent = `${file.name}: arquivo com erro.`;
    setMessage(byId('site-import-message'), error.message, 'error');
  }
});
byId('import-sites-button').addEventListener('click', async () => {
  if (!pendingImportSites.length) return;
  const button = byId('import-sites-button');
  setLoading(button, true);
  try {
    const result = await request('/sites/importar', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sites: pendingImportSites })
    });
    await loadSites();
    pendingImportSites = [];
    byId('site-import-file').value = '';
    byId('site-import-summary').textContent = 'Nenhum arquivo selecionado.';
    setMessage(byId('site-import-message'), `Importação concluída: ${result.created} criado(s) e ${result.updated} atualizado(s).`, 'success');
  } catch (error) { setMessage(byId('site-import-message'), error.message, 'error'); }
  finally { setLoading(button, false); button.disabled = pendingImportSites.length === 0; }
});
byId('site-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const id = byId('site-id').value;
  const site = {
    name: byId('site-name').value.trim(), type: byId('site-type').value,
    searchUrl: byId('site-search-url').value.trim()
  };
  try {
    await request(id ? `/sites/${encodeURIComponent(id)}` : '/sites', {
      method: id ? 'PUT' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(site)
    });
    resetSiteForm(); await loadSites();
    setMessage(byId('site-message'), id ? 'Site atualizado.' : 'Site cadastrado.', 'success');
  } catch (error) { setMessage(byId('site-message'), error.message, 'error'); }
});

byId('login-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const button = event.currentTarget.querySelector('button[type="submit"]');
  setLoading(button, true);
  setMessage(byId('login-message'), 'Validando acesso…');
  try {
    const data = await request('/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: byId('login-username').value.trim(),
        password: byId('login-password').value
      })
    });
    adminToken = data.token;
    sessionStorage.setItem('priceMonitorAdminToken', adminToken);
    byId('login-form').reset();
    setMessage(byId('login-message'));
    setAdminAccess(true);
    await Promise.all([loadCatalogTable(), loadSites()]);
  } catch (error) {
    setMessage(byId('login-message'), error.message, 'error');
  } finally {
    setLoading(button, false);
  }
});

byId('logout-button').addEventListener('click', () => {
  setAdminAccess(false);
  setMessage(byId('login-message'), 'Sessão encerrada.', 'success');
});

loadApiMode();
restoreAdminSession();
refreshCatalog().catch((error) => {
  byId('product-picker-list').textContent = error.message;
  setMessage(byId('catalog-message'), error.message, 'error');
});
