const mongoose = require('mongoose');

const siteSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true, unique: true },
  baseUrl: { type: String, required: true, trim: true },
  searchUrl: { type: String, required: true, trim: true },
  acceptsEan: { type: Boolean, default: null },
  acceptsName: { type: Boolean, default: null },
  requiresPlaywright: { type: Boolean, default: null },
  requiresPostalCode: { type: Boolean, default: null },
  discoveryStatus: { type: String, enum: ['pending', 'learning', 'learned', 'failed'], default: 'pending', index: true },
  lastDiscoveryAt: { type: Date, default: null },
  active: { type: Boolean, default: true, index: true }
}, { timestamps: true, versionKey: false });

module.exports = mongoose.model('Site', siteSchema);
