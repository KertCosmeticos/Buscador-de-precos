const mongoose = require('mongoose');

const schema = new mongoose.Schema({
  ownBrands: { type: [String], default: [] },
  lines: {
    type: [{
      id: { type: String, required: true },
      label: { type: String, required: true },
      anchors: { type: [String], required: true },
      detectPattern: { type: String, required: true },
    }],
    default: [],
    _id: false,
  },
  types: {
    type: [{
      id: { type: String, required: true },
      label: { type: String, required: true },
      alternatives: { type: [[String]], required: true },
      detectPattern: { type: String, required: true },
    }],
    default: [],
    _id: false,
  },
}, { timestamps: true, versionKey: false });

module.exports = mongoose.model('SearchConfig', schema);
