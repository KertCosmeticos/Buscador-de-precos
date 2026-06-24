const mongoose = require('mongoose');

const siteSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true, unique: true },
  baseUrl: { type: String, required: true, trim: true },
  searchUrl: { type: String, required: true, trim: true },
  type: { type: String, required: true, enum: ['marketplace', 'perfumaria', 'drogaria', 'loja_propria'] },
  acceptsEan: { type: Boolean, default: true },
  acceptsName: { type: Boolean, default: true },
  requiresPlaywright: { type: Boolean, default: false },
  active: { type: Boolean, default: true, index: true }
}, { timestamps: true, versionKey: false });

module.exports = mongoose.model('Site', siteSchema);
