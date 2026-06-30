const mongoose = require('mongoose');
const importLogSchema = new mongoose.Schema({
  importId:    { type: String, required: true, unique: true },
  tipo:        { type: String, required: true },
  arquivo:     { type: String, default: '' },
  usuario:     { type: String, default: '' },
  total:       { type: Number, default: 0 },
  criados:     { type: Number, default: 0 },
  atualizados: { type: Number, default: 0 },
  refs:        { type: [String], default: [] },
  data:        { type: Date, default: Date.now }
}, { versionKey: false });
module.exports = mongoose.model('ImportLog', importLogSchema);
