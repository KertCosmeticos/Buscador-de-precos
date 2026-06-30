const IS_LOCAL = ['localhost', '127.0.0.1'].includes(window.location.hostname);
const API_URL = IS_LOCAL
  ? 'http://localhost:3000'
  : 'https://sua-api.koyeb.app';

let currentResults = [];
let adminToken = sessionStorage.getItem('priceMonitorAdminToken') || '';
let loggedInUsername = '';
let loggedInIsRoot = false;
let allCatalogProducts = [];
let allSites = [];
let catalogProducts = [];
let pendingImportProducts = [];
let pendingImportSites = [];
let browserExtensionAvailable = false;
const browserSearchRequests = new Map();
const selectedProductEans = new Set();
const selectedNames = new Set();
const selectedCategories = new Set();
const selectedLines = new Set();

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

document.querySelectorAll('.sub-tab').forEach((tab) => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.sub-tab').forEach((item) => {
      const active = item === tab;
      item.classList.toggle('active', active);
      item.setAttribute('aria-selected', String(active));
    });
    document.querySelectorAll('.sub-panel').forEach((panel) => {
      panel.hidden = panel.id !== `${tab.dataset.subtab}-subtab`;
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
    const requiredAliases = {
      ean: ['CODBARRAS', 'COD BARRAS', 'EAN', 'CODIGO DE BARRAS'],
      name: ['NOME', 'PRODUTO', 'NOME DO PRODUTO'],
      category: ['CATEGORIA'],
      line: ['LINHA', 'FAMILIA']
    };
    const optionalAliases = {
      sku: ['COD SFA', 'COD DO SFA', 'SKU', 'CODIGO INTERNO'],
      volume: ['GRAMATURA', 'VOLUME', 'VOLUME GRAMATURA'],
      nuance: ['NUANCE', 'TOM'],
      color: ['COR'],
      variant: ['VARIANTE', 'VARIACAO']
    };
    const allAliases = { ...requiredAliases, ...optionalAliases };
    const positions = Object.fromEntries(Object.entries(allAliases).map(([field, names]) => [
      field,
      headers.findIndex((header) => names.includes(header))
    ]));
    const missing = Object.keys(requiredAliases).filter((field) => positions[field] < 0);
    if (missing.length) {
      throw new Error('Cabeçalhos obrigatórios ausentes. Use a planilha-modelo disponível no painel.');
    }
    const cell = (row, pos) => pos >= 0 ? spreadsheetCell(row[pos]) : '';

    const products = [];
    const errors = [];
    const seenEans = new Map();
    rows.slice(1).forEach((row, offset) => {
      const line = offset + 2;
      if (!row.some((value) => spreadsheetCell(value))) return;
      const product = {
        ean: cell(row, positions.ean),
        name: cell(row, positions.name),
        category: cell(row, positions.category),
        line: cell(row, positions.line),
        sku: cell(row, positions.sku),
        volume: cell(row, positions.volume),
        nuance: cell(row, positions.nuance),
        color: cell(row, positions.color),
        variant: cell(row, positions.variant),
        active: true
      };
      const emptyFields = ['ean', 'name', 'category', 'line'].filter((field) => !product[field]);
      if (emptyFields.length) {
        errors.push(`Linha ${line}: campos obrigatórios vazios (${emptyFields.join(', ')}).`);
      } else if (!/^\d{8,14}$/.test(product.ean)) {
        errors.push(`Linha ${line}: EAN inválido (${product.ean}).`);
      } else if (seenEans.has(product.ean)) {
        errors.push(`Linha ${line}: EAN ${product.ean} duplicado com a linha ${seenEans.get(product.ean)}.`);
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
    if (positions.name < 0 || positions.searchUrl < 0) throw new Error('Use os cabeçalhos NOME e URL DE BUSCA.');
    const typeAliases = { marketplace: 'marketplace', perfumaria: 'perfumaria', drogaria: 'drogaria', 'loja propria': 'loja_propria' };
    const sites = [];
    const errors = [];
    const names = new Set();
    rows.slice(1).forEach((row, offset) => {
      if (!row.some((value) => spreadsheetCell(value))) return;
      const line = offset + 2;
      const name = spreadsheetCell(row[positions.name]);
      const searchUrl = spreadsheetCell(row[positions.searchUrl]);
      const rawType = positions.type >= 0 ? normalizeSpreadsheetHeader(row[positions.type]).toLocaleLowerCase('pt-BR') : '';
      const type = typeAliases[rawType] || 'perfumaria';
      if (!name || !searchUrl) errors.push(`Linha ${line}: nome e URL são obrigatórios.`);
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
  window.__extAvailable = browserExtensionAvailable;
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

function searchWithBrowser(products, sites = []) {
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
      products,
      sites,
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
      return {
        ...summarizeBrowserResult({ ...result, listings: scored.listings }),
        productId: scored.productId,
        discoveredSites: scored.discoveredSites || []
      };
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
    response = await fetch(`${API_URL}${path}`, { cache: 'no-store', ...options, headers });
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

function setAdminAccess(authenticated, username, isRoot) {
  byId('restricted-login').hidden = authenticated;
  byId('admin-content').hidden = !authenticated;
  loggedInUsername = authenticated && username ? username : '';
  loggedInIsRoot = authenticated ? !!isRoot : false;
  const nameEl = byId('logged-user-name');
  if (nameEl) nameEl.textContent = loggedInUsername;
  if (!authenticated) {
    adminToken = '';
    sessionStorage.removeItem('priceMonitorAdminToken');
    resetProductForm();
  }
}

async function restoreAdminSession() {
  if (!adminToken) return setAdminAccess(false);
  try {
    const me = await request('/auth/me');
    setAdminAccess(true, me.user, me.isRoot);
    await loadSites();
  } catch {
    setAdminAccess(false);
  }
}

const filterDefinitions = {
  name: { property: 'name', input: 'name-filter-search', options: 'name-filter-options', selected: selectedNames, placeholder: 'Digite EAN ou Nome do produto para selecionar' },
  category: { property: 'category', input: 'category-filter-search', options: 'category-filter-options', selected: selectedCategories, placeholder: 'Clique para selecionar' },
  line: { property: 'line', input: 'line-filter-search', options: 'line-filter-options', selected: selectedLines, placeholder: 'Clique para selecionar' }
};

function updateFilterPlaceholder(definition) {
  const input = byId(definition.input);
  input.placeholder = definition.selected.size
    ? `${definition.selected.size} opção(ões) selecionada(s)`
    : (definition.placeholder || 'Clique para selecionar');
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
  const values = type === 'name' && term
    ? [...new Set(allCatalogProducts
        .filter((p) => p.name.toLocaleLowerCase('pt-BR').includes(term) || p.ean.toLocaleLowerCase('pt-BR').includes(term))
        .map((p) => p.name))]
        .sort((a, b) => a.localeCompare(b, 'pt-BR'))
    : [...new Set(allCatalogProducts.map((product) => product[definition.property]))]
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
    || selectedLines.size > 0;
}

function renderProductPicker() {
  const list = byId('product-picker-list');
  list.replaceChildren();
  const hasFilter = hasActiveProductFilter();
  list.hidden = !hasFilter;
  byId('filtered-select-all').hidden = !hasFilter || catalogProducts.length === 0;
  if (!catalogProducts.length && hasFilter) {
    const empty = document.createElement('p');
    empty.className = 'picker-product';
    empty.textContent = 'Nenhum produto encontrado com estes filtros.';
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
    const name = document.createElement('span');
    name.textContent = product.name;
    const details = document.createElement('small');
    details.textContent = `${product.ean} · ${product.category} · ${product.line}`;
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
    const matchesSearch = !search || [product.ean, product.sku, product.name, product.category, product.line]
      .some((value) => String(value || '').toLocaleLowerCase('pt-BR').includes(search));
    return matchesSearch
      && (!selectedNames.size || selectedNames.has(product.name))
      && (!selectedCategories.size || selectedCategories.has(product.category))
      && (!selectedLines.size || selectedLines.has(product.line));
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
  byId('catalog-line').value = product.line || product.family || '';
  byId('catalog-volume').value = product.volume || '';
  byId('catalog-nuance').value = product.nuance || '';
  byId('catalog-color').value = product.color || '';
  byId('catalog-variant').value = product.variant || '';
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
    appendCell(viewRow, product.line || product.family || '—');
    appendCell(viewRow, product.nuance || '—');
    appendCell(viewRow, product.color || '—');
    appendCell(viewRow, product.variant || '—');

    const row = body.insertRow();
    appendCell(row, product.ean);
    appendCell(row, product.sku || '—');
    appendCell(row, product.name);
    appendCell(row, product.category);
    appendCell(row, product.line || product.family || '—');
    appendCell(row, product.nuance || '—');
    appendCell(row, product.color || '—');
    appendCell(row, product.variant || '—');
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

function mostExpensiveListing(result) {
  const listings = result.listings || [];
  return listings.filter((listing) => Number.isFinite(listing.price)).reduce(
    (priciest, listing) => !priciest || listing.price > priciest.price ? listing : priciest,
    null
  ) || null;
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
      cell.colSpan = 7;
      cell.textContent = result.error;
      return;
    }

    const cheapest = cheapestListing(result);
    const priciest = mostExpensiveListing(result);
    appendCell(row, cheapest?.title || '—');
    appendCell(row, result.minPrice == null ? '—' : currency.format(result.minPrice));
    appendCell(row, result.maxPrice == null ? '—' : currency.format(result.maxPrice));
    appendCell(row, result.averagePrice == null ? '—' : currency.format(result.averagePrice));
    appendCell(row, String(result.listingsCount ?? 0));
    const cheapestCell = row.insertCell();
    if (cheapest?.link) {
      const link = document.createElement('a');
      link.href = cheapest.link;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.textContent = cheapest.seller;
      cheapestCell.append(link);
    } else {
      cheapestCell.textContent = cheapest?.seller || '—';
    }
    const priesiestCell = row.insertCell();
    if (priciest?.link) {
      const link = document.createElement('a');
      link.href = priciest.link;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.textContent = priciest.seller;
      priesiestCell.append(link);
    } else {
      priesiestCell.textContent = priciest?.seller || '—';
    }
  });

  byId('results-count').textContent = `${results.length} produto(s) consultado(s)`;
  byId('results-card').hidden = false;
  byId('demo-notice').hidden = !results.some((result) =>
    (result.sources || []).some((source) => source.name?.includes('Demonstração'))
  );
  renderDetails(results);
}

function renderDetails(results) {
  const body = byId('details-body');
  body.replaceChildren();
  const siteNames = new Set(allSites.map((s) => s.name.toLowerCase()));
  const offers = results.flatMap((result) =>
    (result.listings || []).map((listing) => {
      const o = { ean: result.ean, productId: result.productId, searchTerm: result.usedSearchTerm, ...listing };
      o.isNew = !!o.seller && !siteNames.has(o.seller.toLowerCase());
      return o;
    })
  ).sort((a, b) => a.ean.localeCompare(b.ean)
    || Number(b.isNew) - Number(a.isNew)
    || (Number.isFinite(b.score) ? b.score : -Infinity) - (Number.isFinite(a.score) ? a.score : -Infinity)
    || (Number.isFinite(a.price) ? a.price : Number.POSITIVE_INFINITY)
      - (Number.isFinite(b.price) ? b.price : Number.POSITIVE_INFINITY));

  offers.forEach((offer) => {
    const row = body.insertRow();
    appendCell(row, offer.ean);
    appendCell(row, offer.title || '—');
    appendCell(row, Number.isFinite(offer.price) ? currency.format(offer.price) : '—');
    appendCell(row, offer.seller || '—');
    const sellerStatusCell = row.insertCell();
    const sellerStatus = document.createElement('span');
    sellerStatus.className = `seller-status ${offer.isNew ? 'new' : 'active'}`;
    sellerStatus.textContent = offer.isNew ? 'Novo' : 'Ativo';
    sellerStatusCell.append(sellerStatus);
    if (offer.isNew) {
      const register = document.createElement('button');
      register.type = 'button';
      register.className = 'register-site-small';
      register.textContent = 'Cadastrar';
      register.addEventListener('click', () => registerSiteInline(offer, register));
      sellerStatusCell.append(register);
    }
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
  });

  byId('details-count').textContent = `${offers.length} oferta(s) B2C com preço e link direto`;
  byId('details-card').hidden = offers.length === 0;
}

async function registerSiteInline(offer, button) {
  if (!offer.link) {
    setMessage(byId('search-message'), 'Não foi possível determinar o site deste vendedor.', 'error');
    return;
  }
  let origin;
  try { origin = new URL(offer.link).origin; } catch {
    setMessage(byId('search-message'), 'Link do produto inválido.', 'error');
    return;
  }
  button.disabled = true;
  button.textContent = 'Salvando…';
  try {
    await request('/sites', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: offer.seller, searchUrl: `${origin}/busca?q={termo}` })
    });
    const cell = button.closest('td');
    cell.replaceChildren();
    const status = document.createElement('span');
    status.className = 'seller-status active';
    status.textContent = 'Ativo';
    cell.append(status);
    await loadSites();
    setMessage(byId('search-message'), `"${offer.seller}" cadastrado. Ajuste a URL de busca em Gerenciar sites se necessário.`, 'success');
  } catch (error) {
    button.disabled = false;
    button.textContent = 'Cadastrar';
    setMessage(byId('search-message'), error.message, 'error');
  }
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
  byId('site-search-url').value = site.searchUrl;
  byId('site-form-title').textContent = 'Editar site monitorado';
  byId('cancel-site-edit').hidden = false;
}

async function loadSites() {
  const { sites = [] } = await request('/sites');
  allSites = sites.filter((site) => site.active !== false);
  const body = byId('sites-body');
  body.replaceChildren();
  sites.forEach((site) => {
    const row = body.insertRow();
    appendCell(row, site.name);
    const urlCell = row.insertCell();
    const url = document.createElement('a'); url.href = site.searchUrl; url.target = '_blank'; url.rel = 'noopener noreferrer'; url.textContent = 'Abrir busca'; urlCell.append(url);
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
    setMessage(byId('search-message'), 'Selecione pelo menos um produto ou digite um EAN valido.', 'error');
    return;
  }
  if (!allSites.length) {
    setMessage(byId('search-message'), 'Cadastre pelo menos um site ativo antes de consultar.', 'error');
    return;
  }

  const button = byId('search-button');
  const products = eans.map((ean) => {
    const catalogProduct = allCatalogProducts.find((product) => product.ean === ean);
    return {
      ean,
      name: catalogProduct?.name || '',
      sku: catalogProduct?.sku || '',
      category: catalogProduct?.category || '',
      line: catalogProduct?.line || catalogProduct?.family || '',
      volume: catalogProduct?.volume || '',
      searchTerm: catalogProduct?.searchTerm || ''
    };
  });
  const sites = allSites;
  setLoading(button, true);
  byId('search-progress').hidden = true;
  setMessage(byId('search-message'), 'Preparando pesquisa no Chrome...');
  try {
    currentResults = await scoreBrowserResults(await searchWithBrowser(products, sites));
    renderResults(currentResults);
    byId('export-button').disabled = currentResults.length === 0;
    const errors = currentResults.filter((item) => item.error).length;
    const sourceDiagnostics = currentResults.flatMap((item) => item.sources || []);
    const sourcesWithOffers = sourceDiagnostics.filter((source) => Number(source.count) > 0).length;
    const failedSources = sourceDiagnostics.filter((source) => source.status === 'error').length;
    const errorGroups = new Map();
    sourceDiagnostics.filter((source) => source.status === 'error').forEach((source) => {
      const reason = source.error || 'Erro nao identificado';
      errorGroups.set(reason, (errorGroups.get(reason) || 0) + 1);
    });
    const mainErrors = [...errorGroups.entries()].sort((a, b) => b[1] - a[1]).slice(0, 2)
      .map(([reason, count]) => `${count}x ${reason}`).join(' | ');
    const diagnosticText = sourceDiagnostics.length
      ? ` ${sourcesWithOffers} fonte(s) com oferta e ${failedSources} com erro tecnico.${mainErrors ? ` Principais erros: ${mainErrors}` : ''}`
      : '';
    setMessage(
      byId('search-message'),
      errors
        ? `Busca concluida com ${errors} item(ns) sem resultado.${diagnosticText}`
        : `Busca concluida com sucesso pelo Chrome.${diagnosticText}`,
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
  const header = ['EAN', 'Produto', 'Preço', 'Vendedor', 'Link', 'Preço mínimo do EAN', 'Preço máximo do EAN', 'Preço médio do EAN'];
  const rows = currentResults.flatMap((result) => (result.listings || []).map((listing) => [
    result.ean, listing.title, listing.price, listing.seller, listing.link,
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
  const allCreatedEans = [];
  const importId = crypto.randomUUID().replace(/-/g, '').slice(0, 16);
  const importArquivo = fileInput.files[0]?.name || '';
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
        body: JSON.stringify({ products: batch, importId })
      });
      Object.keys(totals).forEach((key) => { totals[key] += Number(result[key] || 0); });
      if (result.createdEans?.length) allCreatedEans.push(...result.createdEans);
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
    request('/auth/importacoes', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ importId, tipo: 'produtos', arquivo: importArquivo, total: totals.total, criados: totals.created, atualizados: totals.updated, refs: allCreatedEans })
    }).catch(() => {});
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
    line: byId('catalog-line').value.trim(),
    volume: byId('catalog-volume').value.trim(),
    nuance: byId('catalog-nuance').value.trim(),
    color: byId('catalog-color').value.trim(),
    variant: byId('catalog-variant').value.trim()
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
// ── Modelos de importação personalizados ─────────────────────────────────

function downloadStoredTemplate(key, filename) {
  const data = localStorage.getItem(`pm_tpl_${key}`);
  if (!data) return false;
  const storedName = localStorage.getItem(`pm_tpl_${key}_name`) || filename;
  const link = document.createElement('a');
  link.href = data;
  link.download = storedName;
  link.click();
  return true;
}

function updateTemplateDisplay(key) {
  const storedName = localStorage.getItem(`pm_tpl_${key}_name`);
  const storedDate = localStorage.getItem(`pm_tpl_${key}_date`);
  const nameEl = byId(`template-name-${key}`);
  const resetEl = byId(`template-reset-${key}`);
  const defaultName = key === 'produtos' ? 'MODELO_IMPORTACAO_PRODUTOS.xlsx' : 'MODELO_IMPORTACAO_SITES.xlsx';
  if (nameEl) {
    if (storedName) {
      const dateStr = storedDate ? ` · importado em ${new Date(storedDate).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })}` : '';
      nameEl.innerHTML = `${escHtml(storedName)}<span style="color:var(--muted);font-size:.75rem">${dateStr}</span>`;
    } else {
      nameEl.textContent = defaultName;
    }
  }
  if (resetEl) resetEl.style.display = storedName ? '' : 'none';
}

function resetCustomTemplate(key) {
  localStorage.removeItem(`pm_tpl_${key}`);
  localStorage.removeItem(`pm_tpl_${key}_name`);
  localStorage.removeItem(`pm_tpl_${key}_date`);
  updateTemplateDisplay(key);
  setMessage(byId('modelos-message'), 'Modelo resetado para o padrão.', 'success');
}

function setupCustomTemplateInput(inputId, key) {
  byId(inputId)?.addEventListener('change', (event) => {
    const [file] = event.target.files;
    if (!file) return;
    const hadPrevious = !!localStorage.getItem(`pm_tpl_${key}`);
    const reader = new FileReader();
    reader.onload = (e) => {
      const now = new Date().toISOString();
      localStorage.setItem(`pm_tpl_${key}`, e.target.result);
      localStorage.setItem(`pm_tpl_${key}_name`, file.name);
      localStorage.setItem(`pm_tpl_${key}_date`, now);
      updateTemplateDisplay(key);
      const label = key === 'produtos' ? 'Produtos' : 'Sites';
      const action = hadPrevious ? 'substituído' : 'importado';
      setMessage(byId('modelos-message'), `Modelo de ${label} ${action}: ${file.name}`, 'success');
    };
    reader.readAsDataURL(file);
    event.target.value = '';
  });
  byId(`import-custom-${key}-btn`)?.addEventListener('click', () => byId(inputId)?.click());
  updateTemplateDisplay(key);
}

byId('download-template').addEventListener('click', () => {
  if (downloadStoredTemplate('produtos', 'MODELO_IMPORTACAO_PRODUTOS.xlsx')) return;
  if (!globalThis.XLSX) {
    setMessage(byId('import-message'), 'O gerador do modelo não foi carregado. Atualize a página e tente novamente.', 'error');
    return;
  }
  const rows = [
    ['EAN', 'COD SFA', 'NOME', 'CATEGORIA', 'LINHA', 'GRAMATURA', 'NUANCE', 'COR', 'VARIANTE'],
    ['7891234560001', 'SFA001', 'Shampoo Hidratação Intensa', 'Cabelos', 'Hidratação', '300ml', '', '', ''],
    ['7891234560002', 'SFA002', 'Condicionador Nutrição Profunda', 'Cabelos', 'Nutrição', '250ml', '', '', ''],
    ['7891234560003', 'SFA003', 'Batom Matte Clássico', 'Maquiagem', 'Lips', '', '', 'Vermelho', 'Tom 01'],
    ['7891234560004', 'SFA004', 'Base Líquida Cobertura Total', 'Maquiagem', 'Face', '', 'Bege Médio', '', 'N30'],
    ['7891234560005', 'SFA005', 'Perfume Floral Feminino', 'Fragrâncias', 'Floral', '75ml', '', '', 'EDP'],
  ];
  const worksheet = XLSX.utils.aoa_to_sheet(rows);
  worksheet['!cols'] = [{ wch: 16 }, { wch: 10 }, { wch: 40 }, { wch: 22 }, { wch: 22 }, { wch: 14 }, { wch: 14 }, { wch: 16 }, { wch: 16 }];
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Produtos');
  XLSX.writeFile(workbook, 'MODELO_IMPORTACAO_PRODUTOS.xlsx');
});
byId('download-site-template').addEventListener('click', () => {
  if (downloadStoredTemplate('sites', 'MODELO_IMPORTACAO_SITES.xlsx')) return;
  if (!globalThis.XLSX) {
    setMessage(byId('site-import-message'), 'O gerador do modelo não foi carregado. Atualize a página e tente novamente.', 'error');
    return;
  }
  const rows = [
    ['NOME', 'URL DE BUSCA'],
    ['Beleza na Web', 'https://www.belezanaweb.com.br/search?q='],
    ['Sephora Brasil', 'https://www.sephora.com.br/search?q='],
    ['O Boticário', 'https://www.boticario.com.br/busca?q='],
    ['Natura', 'https://www.natura.com.br/busca#q='],
  ];
  const worksheet = XLSX.utils.aoa_to_sheet(rows);
  worksheet['!cols'] = [{ wch: 28 }, { wch: 62 }];
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Sites');
  XLSX.writeFile(workbook, 'MODELO_IMPORTACAO_SITES.xlsx');
});

setupCustomTemplateInput('custom-produtos-template-file', 'produtos');
setupCustomTemplateInput('custom-sites-template-file', 'sites');
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
  const importArquivo = byId('site-import-file').files[0]?.name || '';
  setLoading(button, true);
  try {
    const result = await request('/sites/importar', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sites: pendingImportSites })
    });
    await loadSites();
    request('/auth/importacoes', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ importId: crypto.randomUUID().replace(/-/g, '').slice(0, 16), tipo: 'sites', arquivo: importArquivo, total: (result.created || 0) + (result.updated || 0), criados: result.created || 0, atualizados: result.updated || 0, refs: result.createdRefs || [] })
    }).catch(() => {});
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
    name: byId('site-name').value.trim(),
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
    setAdminAccess(true, data.user, data.isRoot);
    await Promise.all([loadCatalogTable(), loadSites()]);
  } catch (error) {
    setMessage(byId('login-message'), error.message, 'error');
  } finally {
    setLoading(button, false);
  }
});

byId('logout-button').addEventListener('click', () => {
  sessionStorage.removeItem('priceMonitorAdminToken');
  location.reload(true);
});

// ── Inner tabs (Administradores / Modelos de Importação) ──────────────────
document.querySelectorAll('.user-tab').forEach((tab) => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.user-tab').forEach((t) => t.classList.toggle('active', t === tab));
    document.querySelectorAll('.user-panel').forEach((p) => {
      p.classList.toggle('active', p.id === `user-panel-${tab.dataset.panel}`);
    });
  });
});

// Carrega usuários ao abrir sub-aba
document.querySelector('.sub-tab[data-subtab="users"]')?.addEventListener('click', loadUsers);

// ── Gestão de usuários ────────────────────────────────────────────────────

let changePwdUserId = null;
let editNameUserId = null;
let editEmailUserId = null;

function escHtml(str) {
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function getCurrentUserInfo() {
  try {
    const payload = JSON.parse(atob(adminToken.split('.')[1]));
    return { uid: payload.uid || null, username: payload.sub || null };
  } catch { return { uid: null, username: null }; }
}

async function loadUsers() {
  const tbody = byId('users-tbody');
  if (!tbody) return;
  tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;padding:18px;color:var(--muted)">Carregando…</td></tr>';
  try {
    const [users, me] = await Promise.all([request('/auth/usuarios'), request('/auth/me')]);
    const viewerIsRoot = !!(me?.isRoot);
    byId('users-count').textContent = `${users.length} administrador${users.length !== 1 ? 'es' : ''} cadastrado${users.length !== 1 ? 's' : ''}`;
    if (!users.length) {
      tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;padding:18px;color:var(--muted)">Nenhum usuário cadastrado.</td></tr>';
      return;
    }
    tbody.innerHTML = users.map((u) => {
      const date = u.createdAt ? new Date(u.createdAt).toLocaleDateString('pt-BR') : '—';
      const badge = u.isRoot ? ' <span class="root-badge">PAI</span>' : '';
      const paiSelf = u.isRoot && viewerIsRoot;
      const nomeBtn = (!u.isRoot || paiSelf)
        ? `<button class="table-action" onclick="openEditName('${u._id}','${escHtml(u.username)}')">Nome</button>`
        : `<button class="table-action ghost" disabled>Nome</button>`;
      const emailBtn = (!u.isRoot || paiSelf)
        ? `<button class="table-action" onclick="openEditEmail('${u._id}','${escHtml(u.email || '')}','${escHtml(u.username)}')">E-mail</button>`
        : `<button class="table-action ghost" disabled>E-mail</button>`;
      const pwdBtn = u.isRoot
        ? (paiSelf
            ? `<button class="table-action" onclick="openChangePwd('${u._id}','${escHtml(u.username)}')">Senha</button>`
            : `<button class="table-action ghost" disabled>Senha</button>`)
        : `<button class="table-action" onclick="openChangePwd('${u._id}','${escHtml(u.username)}')">Senha</button>`;
      const deleteBtn = u.isRoot
        ? `<button class="table-action danger ghost" disabled>Excluir</button>`
        : `<button class="table-action danger" onclick="deleteUser('${u._id}','${escHtml(u.username)}')">Excluir</button>`;
      return `<tr>
        <td>${escHtml(u.username)}${badge}</td>
        <td style="color:var(--muted);font-size:.82rem">${escHtml(u.email || '—')}</td>
        <td>${date}</td>
        <td style="text-align:right">${nomeBtn}${emailBtn}${pwdBtn}${deleteBtn}</td>
      </tr>`;
    }).join('');
  } catch (error) {
    tbody.innerHTML = `<tr><td colspan="4" style="text-align:center;padding:18px;color:var(--danger)">${error.message}</td></tr>`;
  }
}

function openChangePwd(id, username) {
  changePwdUserId = id;
  byId('modal-pwd-for').textContent = `Usuário: ${username}`;
  byId('modal-new-pwd').value = '';
  setMessage(byId('modal-change-pwd-msg'));
  setMessage(byId('modal-send-link-msg'));
  byId('modal-change-pwd').hidden = false;
  setTimeout(() => byId('modal-new-pwd').focus(), 50);
}

async function deleteUser(id, username) {
  if (!confirm(`Excluir o usuário "${username}"?\nEsta ação não pode ser desfeita.`)) return;
  try {
    await request(`/auth/usuarios/${id}`, { method: 'DELETE' });
    setMessage(byId('users-message'), `Usuário "${username}" excluído.`, 'success');
    await loadUsers();
  } catch (error) {
    setMessage(byId('users-message'), error.message, 'error');
  }
}

byId('new-admin-btn').addEventListener('click', () => {
  byId('modal-admin-username').value = '';
  byId('modal-admin-email').value = '';
  byId('modal-admin-password').value = '';
  setMessage(byId('modal-new-admin-msg'));
  byId('modal-new-admin').hidden = false;
  setTimeout(() => byId('modal-admin-username').focus(), 50);
});

byId('cancel-new-admin').addEventListener('click', () => { byId('modal-new-admin').hidden = true; });
byId('cancel-change-pwd').addEventListener('click', () => { byId('modal-change-pwd').hidden = true; });

byId('modal-new-admin').addEventListener('click', (e) => { if (e.target === byId('modal-new-admin')) byId('modal-new-admin').hidden = true; });
byId('modal-change-pwd').addEventListener('click', (e) => { if (e.target === byId('modal-change-pwd')) byId('modal-change-pwd').hidden = true; });

byId('confirm-new-admin').addEventListener('click', async () => {
  const username = byId('modal-admin-username').value.trim();
  const email = byId('modal-admin-email').value.trim();
  const password = byId('modal-admin-password').value;
  const msgEl = byId('modal-new-admin-msg');
  if (!username) { setMessage(msgEl, 'Nome de usuário é obrigatório.', 'error'); return; }
  if (!email) { setMessage(msgEl, 'E-mail é obrigatório.', 'error'); return; }
  if (!password) { setMessage(msgEl, 'Senha é obrigatória.', 'error'); return; }
  try {
    await request('/auth/usuarios', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, email, password })
    });
    byId('modal-new-admin').hidden = true;
    setMessage(byId('users-message'), `Usuário "${username}" criado com sucesso.`, 'success');
    await loadUsers();
  } catch (error) { setMessage(msgEl, error.message, 'error'); }
});

byId('confirm-change-pwd').addEventListener('click', async () => {
  const password = byId('modal-new-pwd').value;
  const msgEl = byId('modal-change-pwd-msg');
  if (!password) { setMessage(msgEl, 'Informe a nova senha.', 'error'); return; }
  try {
    await request(`/auth/usuarios/${changePwdUserId}/senha`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password })
    });
    byId('modal-change-pwd').hidden = true;
    setMessage(byId('users-message'), 'Senha alterada com sucesso.', 'success');
  } catch (error) { setMessage(msgEl, error.message, 'error'); }
});

byId('send-reset-link-btn').addEventListener('click', async (e) => {
  const btn = e.currentTarget;
  if (btn.disabled) return;
  btn.disabled = true;
  const msgEl = byId('modal-send-link-msg');
  setMessage(msgEl, 'Enviando link…');
  try {
    const result = await request(`/auth/usuarios/${changePwdUserId}/resetar-senha`, { method: 'POST' });
    if (result.emailSent) {
      setMessage(msgEl, 'E-mail enviado com sucesso!', 'success');
    } else {
      byId('modal-change-pwd').hidden = true;
      const infoEl = byId('modal-reset-link-info');
      const urlWrap = byId('modal-reset-link-url-wrap');
      const urlInput = byId('modal-reset-link-url');
      const copyBtn = byId('copy-reset-link');
      const errMsg = result.emailError ? `Erro ao enviar e-mail: ${result.emailError}` : null;
      infoEl.textContent = !result.hasEmail
        ? 'Usuário sem e-mail cadastrado. Copie e compartilhe o link:'
        : errMsg || 'Não foi possível enviar o e-mail. Copie e compartilhe o link:';
      urlInput.value = result.resetUrl;
      urlWrap.hidden = false;
      copyBtn.hidden = false;
      setMessage(byId('modal-reset-link-msg'), errMsg || null, errMsg ? 'error' : null);
      byId('modal-reset-link').hidden = false;
    }
  } catch (error) {
    setMessage(msgEl, error.message, 'error');
  } finally {
    btn.disabled = false;
  }
});

// ── Editar nome ───────────────────────────────────────────────────────────

function openEditName(id, username) {
  editNameUserId = id;
  byId('modal-edit-name-for').textContent = `Usuário atual: ${username}`;
  byId('modal-new-name').value = username;
  setMessage(byId('modal-edit-name-msg'));
  byId('modal-edit-name').hidden = false;
  setTimeout(() => byId('modal-new-name').focus(), 50);
}

byId('cancel-edit-name').addEventListener('click', () => { byId('modal-edit-name').hidden = true; });
byId('modal-edit-name').addEventListener('click', (e) => { if (e.target === byId('modal-edit-name')) byId('modal-edit-name').hidden = true; });

byId('confirm-edit-name').addEventListener('click', async () => {
  const username = byId('modal-new-name').value.trim();
  const msgEl = byId('modal-edit-name-msg');
  if (!username) { setMessage(msgEl, 'Informe o nome.', 'error'); return; }
  try {
    await request(`/auth/usuarios/${editNameUserId}/nome`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username })
    });
    byId('modal-edit-name').hidden = true;
    setMessage(byId('users-message'), 'Nome atualizado com sucesso.', 'success');
    await loadUsers();
  } catch (error) { setMessage(msgEl, error.message, 'error'); }
});

// ── Editar e-mail ─────────────────────────────────────────────────────────

function openEditEmail(id, email, username) {
  editEmailUserId = id;
  byId('modal-edit-email-for').textContent = `Usuário: ${username}`;
  byId('modal-new-email').value = email;
  setMessage(byId('modal-edit-email-msg'));
  byId('modal-edit-email').hidden = false;
  setTimeout(() => byId('modal-new-email').focus(), 50);
}

byId('cancel-edit-email').addEventListener('click', () => { byId('modal-edit-email').hidden = true; });
byId('modal-edit-email').addEventListener('click', (e) => { if (e.target === byId('modal-edit-email')) byId('modal-edit-email').hidden = true; });

byId('confirm-edit-email').addEventListener('click', async () => {
  const email = byId('modal-new-email').value.trim();
  const msgEl = byId('modal-edit-email-msg');
  try {
    await request(`/auth/usuarios/${editEmailUserId}/email`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email })
    });
    byId('modal-edit-email').hidden = true;
    setMessage(byId('users-message'), 'E-mail atualizado com sucesso.', 'success');
    await loadUsers();
  } catch (error) { setMessage(msgEl, error.message, 'error'); }
});

// ── Redefinir senha por link (admin raiz) ─────────────────────────────────

async function openResetPwdLink(id, username) {
  const infoEl = byId('modal-reset-link-info');
  const urlWrap = byId('modal-reset-link-url-wrap');
  const urlInput = byId('modal-reset-link-url');
  const copyBtn = byId('copy-reset-link');
  setMessage(byId('modal-reset-link-msg'));
  infoEl.textContent = `Gerando link para ${username}…`;
  urlWrap.hidden = true;
  copyBtn.hidden = true;
  byId('modal-reset-link').hidden = false;
  try {
    const result = await request(`/auth/usuarios/${id}/resetar-senha`, { method: 'POST' });
    if (result.emailSent) {
      infoEl.textContent = `Link enviado para ${result.hasEmail ? 'o e-mail cadastrado' : username}.`;
    } else {
      infoEl.textContent = result.hasEmail
        ? 'Não foi possível enviar o e-mail. Copie e compartilhe o link abaixo:'
        : 'Usuário sem e-mail cadastrado. Compartilhe o link manualmente:';
      urlInput.value = result.resetUrl;
      urlWrap.hidden = false;
      copyBtn.hidden = false;
    }
  } catch (error) {
    setMessage(byId('modal-reset-link-msg'), error.message, 'error');
    infoEl.textContent = '';
  }
}

byId('close-reset-link').addEventListener('click', () => { byId('modal-reset-link').hidden = true; });
byId('copy-reset-link').addEventListener('click', () => {
  const url = byId('modal-reset-link-url').value;
  navigator.clipboard.writeText(url).then(() => setMessage(byId('modal-reset-link-msg'), 'Link copiado!', 'success'));
});

// ── Definir nova senha via link de reset ──────────────────────────────────

function handleResetToken() {
  const params = new URLSearchParams(window.location.search);
  const token = params.get('reset_token');
  if (!token) return;
  window.history.replaceState({}, '', window.location.pathname);
  window._resetToken = token;
  byId('set-new-pwd-input').value = '';
  setMessage(byId('modal-set-new-pwd-msg'));
  byId('modal-set-new-pwd').hidden = false;
}

byId('confirm-set-new-pwd').addEventListener('click', async () => {
  const password = byId('set-new-pwd-input').value;
  const msgEl = byId('modal-set-new-pwd-msg');
  if (!password) { setMessage(msgEl, 'Informe a nova senha.', 'error'); return; }
  try {
    await request('/auth/redefinir-senha', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: window._resetToken, password })
    });
    byId('modal-set-new-pwd').hidden = true;
    window._resetToken = null;
    setMessage(byId('login-message'), 'Senha redefinida com sucesso. Faça login com a nova senha.', 'success');
  } catch (error) { setMessage(msgEl, error.message, 'error'); }
});

// ── Esqueci minha senha ───────────────────────────────────────────────────

byId('forgot-pwd-link').addEventListener('click', () => {
  byId('forgot-pwd-email').value = '';
  setMessage(byId('modal-forgot-pwd-msg'));
  byId('modal-forgot-pwd').hidden = false;
  setTimeout(() => byId('forgot-pwd-email').focus(), 50);
});

byId('cancel-forgot-pwd').addEventListener('click', () => { byId('modal-forgot-pwd').hidden = true; });
byId('modal-forgot-pwd').addEventListener('click', (e) => { if (e.target === byId('modal-forgot-pwd')) byId('modal-forgot-pwd').hidden = true; });

byId('confirm-forgot-pwd').addEventListener('click', async () => {
  const email = byId('forgot-pwd-email').value.trim();
  const msgEl = byId('modal-forgot-pwd-msg');
  if (!email) { setMessage(msgEl, 'Informe o e-mail.', 'error'); return; }
  try {
    await request('/auth/esqueci-senha', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email })
    });
    setMessage(msgEl, 'Se este e-mail estiver cadastrado, você receberá o link em breve.', 'success');
    setTimeout(() => { byId('modal-forgot-pwd').hidden = true; }, 3000);
  } catch (error) { setMessage(msgEl, error.message, 'error'); }
});

byId('chrome-ext-link')?.addEventListener('click', () => {
  window.postMessage({ source: 'price-monitor-web', type: 'OPEN_URL', url: 'chrome://extensions/' }, window.location.origin);
  if (!window.__extAvailable) {
    navigator.clipboard.writeText('chrome://extensions/').catch(() => {});
    const hint = byId('chrome-ext-hint');
    if (hint) { hint.hidden = false; clearTimeout(hint._chromeHintTimer); hint._chromeHintTimer = setTimeout(() => { hint.hidden = true; }, 3000); }
  }
});

// ── Histórico de importações ──────────────────────────────────────────────

document.querySelector('.user-tab[data-panel="importacoes"]')?.addEventListener('click', loadImportLogs);

async function loadImportLogs() {
  const tbody = byId('logs-tbody');
  const countEl = byId('logs-count');
  if (!tbody) return;
  tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:18px;color:var(--muted)">Carregando…</td></tr>';
  try {
    const logs = await request('/auth/importacoes');
    if (countEl) countEl.textContent = `${logs.length} importação(ões) registrada(s)`;
    if (!logs.length) {
      tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:18px;color:var(--muted)">Nenhuma importação registrada.</td></tr>';
      return;
    }
    tbody.innerHTML = logs.map((log) => {
      const dt = new Date(log.data);
      const dataStr = dt.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
      const horaStr = dt.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
      const tipo = log.tipo === 'produtos' ? 'Produtos' : 'Sites';
      return `<tr>
        <td style="white-space:nowrap">${dataStr} ${horaStr}</td>
        <td>${escHtml(log.usuario || '?')}</td>
        <td style="max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${escHtml(log.arquivo || '')}">${escHtml(log.arquivo || '?')}</td>
        <td>${escHtml(tipo)}</td>
        <td style="text-align:right">${log.total ?? '?'}</td>
        <td style="text-align:right">${log.criados ?? '?'}</td>
        <td style="text-align:right">
          <button class="table-action danger" onclick="desfazerImportacao('${escHtml(String(log._id))}','${escHtml(log.arquivo || '')}','${escHtml(tipo)}',${log.criados || 0})">Desfazer</button>
        </td>
      </tr>`;
    }).join('');
  } catch (error) {
    tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;padding:18px;color:var(--danger)">${escHtml(error.message)}</td></tr>`;
  }
}

async function desfazerImportacao(id, arquivo, tipo, criados) {
  const aviso = criados > 0
    ? `Desfazer importação "${arquivo}"?\n\n${criados} ${tipo.toLowerCase()} criados nesta importação serão DELETADOS permanentemente.\n\nEsta ação não pode ser desfeita.`
    : `Remover registro da importação "${arquivo}"?\n\nNenhum dado será deletado (esta importação não criou novos registros).`;
  if (!confirm(aviso)) return;
  const msgEl = byId('logs-message');
  setMessage(msgEl, 'Desfazendo importação…');
  try {
    const result = await request(`/auth/importacoes/${id}`, { method: 'DELETE' });
    setMessage(msgEl, result.removidos > 0 ? `Importação desfeita: ${result.removidos} registro(s) deletado(s).` : 'Registro removido do histórico.', 'success');
    await loadImportLogs();
    if (tipo === 'Produtos') await refreshCatalog();
    else if (tipo === 'Sites') await loadSites();
    setTimeout(() => setMessage(msgEl), 4000);
  } catch (error) {
    setMessage(msgEl, error.message, 'error');
  }
}


// ── Tema claro/escuro ─────────────────────────────────────────────────────

(function initTheme() {
  const toggle = byId('theme-toggle');
  if (!toggle) return;
  toggle.addEventListener('click', () => {
    const dark = document.documentElement.getAttribute('data-theme') !== 'dark';
    document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
    localStorage.setItem('pm-theme', dark ? 'dark' : 'light');
  });
})();

loadApiMode();
restoreAdminSession();
handleResetToken();
Promise.all([refreshCatalog(), loadSites()]).catch((error) => {
  byId('product-picker-list').textContent = error.message;
  setMessage(byId('catalog-message'), error.message, 'error');
});
