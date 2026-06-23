const mongoose = require('mongoose');

const productLearningSchema = new mongoose.Schema({
  productId: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true, unique: true, index: true },
  confirmedAliases: { type: [String], default: [] },
  goodTerms: { type: [String], default: [] },
  badTerms: { type: [String], default: [] },
  ignoredTitles: { type: [String], default: [] },
  siteRejections: {
    type: [{ domain: { type: String, required: true }, title: { type: String, required: true }, _id: false }],
    default: []
  },
  excludedWords: { type: [String], default: [] }
}, { timestamps: true, versionKey: false });

module.exports = mongoose.model('ProductLearning', productLearningSchema);
