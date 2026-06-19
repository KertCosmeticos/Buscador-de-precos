const Product = require('../models/Product');

const demoProducts = [
  { _id: 'demo-1', ean: '7896380606429', sku: 'CAB-001', name: 'Shampoo Love My Hair Curly 300ml', category: 'Cabelos', family: 'Love My Hair', active: true },
  { _id: 'demo-2', ean: '7896380606436', sku: 'CAB-002', name: 'Condicionador Love My Hair Curly 300ml', category: 'Cabelos', family: 'Love My Hair', active: true },
  { _id: 'demo-3', ean: '7896380606504', sku: 'FIN-001', name: 'Óleo Finalizador 60ml', category: 'Finalizadores', family: 'Phyto Gen', active: true },
  { _id: 'demo-4', ean: '7896380606511', sku: 'TRA-001', name: 'Máscara de Tratamento 250g', category: 'Tratamentos', family: 'Phyto Gen', active: true }
];

function isDemo() {
  return process.env.DEMO_MODE === 'true';
}

function matches(product, filters) {
  const search = String(filters.search || '').toLocaleLowerCase('pt-BR');
  return product.active !== false
    && (!search || [product.name, product.ean, product.sku, product.category, product.family].some((value) => String(value).toLocaleLowerCase('pt-BR').includes(search)))
    && (!filters.category || product.category === filters.category)
    && (!filters.family || product.family === filters.family);
}

async function listProducts(filters = {}) {
  if (isDemo()) return demoProducts.filter((product) => matches(product, filters));
  const query = { active: true };
  if (filters.category) query.category = filters.category;
  if (filters.family) query.family = filters.family;
  if (filters.search) {
    const escaped = String(filters.search).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    query.$or = [
      { name: new RegExp(escaped, 'i') },
      { ean: new RegExp(escaped, 'i') },
      { sku: new RegExp(escaped, 'i') },
      { category: new RegExp(escaped, 'i') },
      { family: new RegExp(escaped, 'i') }
    ];
  }
  return Product.find(query).sort({ name: 1 }).lean();
}

async function getFilters() {
  const products = isDemo() ? demoProducts : await Product.find({ active: true }).select('category family').lean();
  return {
    categories: [...new Set(products.map((item) => item.category))].sort((a, b) => a.localeCompare(b, 'pt-BR')),
    families: [...new Set(products.map((item) => item.family))].sort((a, b) => a.localeCompare(b, 'pt-BR'))
  };
}

function cleanProduct(input) {
  return {
    ean: String(input.ean || '').trim(),
    sku: String(input.sku || '').trim(),
    name: String(input.name || '').trim(),
    category: String(input.category || '').trim(),
    family: String(input.family || '').trim(),
    active: input.active !== false
  };
}

async function createProduct(input) {
  const product = cleanProduct(input);
  if (isDemo()) {
    if (demoProducts.some((item) => item.ean === product.ean)) throw Object.assign(new Error('Este EAN já está cadastrado.'), { status: 409 });
    const created = { _id: `demo-${Date.now()}`, ...product };
    demoProducts.push(created);
    return created;
  }
  return Product.create(product);
}

async function updateProduct(id, input) {
  const product = cleanProduct(input);
  if (isDemo()) {
    const index = demoProducts.findIndex((item) => item._id === id);
    if (index < 0) return null;
    if (demoProducts.some((item, itemIndex) => itemIndex !== index && item.ean === product.ean)) throw Object.assign(new Error('Este EAN já está cadastrado.'), { status: 409 });
    demoProducts[index] = { _id: id, ...product };
    return demoProducts[index];
  }
  return Product.findByIdAndUpdate(id, product, { new: true, runValidators: true }).lean();
}

async function deleteProduct(id) {
  if (isDemo()) {
    const index = demoProducts.findIndex((item) => item._id === id);
    if (index < 0) return false;
    demoProducts.splice(index, 1);
    return true;
  }
  return Boolean(await Product.findByIdAndDelete(id));
}

module.exports = { listProducts, getFilters, createProduct, updateProduct, deleteProduct };
