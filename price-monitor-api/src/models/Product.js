const mongoose = require('mongoose');

const productSchema = new mongoose.Schema({
  ean: { type: String, required: true, unique: true, index: true, trim: true },
  sku: { type: String, trim: true, default: '' },
  name: { type: String, required: true, trim: true, index: true },
  category: { type: String, required: true, trim: true, index: true },
  family: { type: String, required: true, trim: true, index: true },
  active: { type: Boolean, default: true, index: true }
}, { timestamps: true, versionKey: false });

module.exports = mongoose.model('Product', productSchema);
