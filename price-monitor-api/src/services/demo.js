const PRODUCTS = [
  ['Café Premium Torrado 500g', 28.9],
  ['Azeite Extra Virgem 500ml', 42.5],
  ['Chocolate Especial 90g', 12.79],
  ['Kit Produto Original', 64.9]
];

function hash(text) {
  return [...text].reduce((total, char) => total + char.charCodeAt(0), 0);
}

function demoSearch(ean) {
  const seed = hash(ean);
  const [product, basePrice] = PRODUCTS[seed % PRODUCTS.length];
  const offers = [
    ['Mercado Livre', 'Distribuidora Horizonte'],
    ['Amazon', 'Amazon.com.br'],
    ['Shopee', 'Loja Central Oficial'],
    ['Magazine Luiza', 'Comercial Brasil'],
    ['Casas Bahia', 'Mercado Prime']
  ];
  const count = 5;

  return Array.from({ length: count }, (_, index) => ({
    title: product,
    price: Number((basePrice + index * 2.37 + (seed % 7) / 10).toFixed(2)),
    seller: offers[(seed + index) % offers.length][1],
    marketplace: offers[(seed + index) % offers.length][0],
    // Uma busca genérica não deve ser apresentada como se fosse um anúncio real.
    link: '',
    demo: true,
    soldQuantity: 18 + ((seed + index * 13) % 120),
    condition: 'new',
    freeShipping: index % 2 === 0
  }));
}

module.exports = { demoSearch };
