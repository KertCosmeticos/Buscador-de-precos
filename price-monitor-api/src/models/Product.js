const mongoose = require('mongoose');

const productSchema = new mongoose.Schema({
  ean: { type: String, required: true, unique: true, index: true, trim: true },
  sku: { type: String, trim: true, default: '' },
  name: { type: String, required: true, trim: true, index: true },
  category: { type: String, required: true, trim: true, index: true },
  family: { type: String, required: true, trim: true, index: true },
  volume: { type: String, trim: true, default: '' },
  ncm: { type: String, trim: true, default: '' },
  netPrice: { type: Number, min: 0, default: null },
  searchTerm: { type: String, trim: true, default: '' },
  tokens: { type: [String], default: [] },
  aliases: { type: [String], default: [] },
  requiredWords: { type: [String], default: [] },
  forbiddenWords: { type: [String], default: [] },
  palavrasDesejaveis: { type: [String], default: [] },
  aceitaKit: { type: Boolean, default: false },
  familyAliases: { type: [String], default: [] },
  lineBlockWords: { type: [String], default: [] },
  knownUrls: { type: [String], default: [] },
  nuance: { type: String, trim: true, default: '' },
  color: { type: String, trim: true, default: '' },
  variant: { type: String, trim: true, default: '' },
  active: { type: Boolean, default: true, index: true }
}, { timestamps: true, versionKey: false });

module.exports = mongoose.model('Product', productSchema);
