const mongoose = require('mongoose');

const siteCandidateSchema = new mongoose.Schema({
  domain: { type: String, required: true, unique: true, index: true, trim: true },
  name: { type: String, required: true, trim: true },
  searchUrl: { type: String, required: true, trim: true },
  type: { type: String, enum: ['marketplace', 'perfumaria', 'drogaria', 'loja_propria'], default: 'perfumaria' },
  status: { type: String, enum: ['ignored', 'approved'], required: true, index: true },
  evidenceTitle: { type: String, trim: true, default: '' },
  evidencePrice: { type: Number, default: null },
  score: { type: Number, default: null }
}, { timestamps: true, versionKey: false });

module.exports = mongoose.model('SiteCandidate', siteCandidateSchema);
