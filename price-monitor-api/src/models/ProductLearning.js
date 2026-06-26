const mongoose = require('mongoose');

const productLearningSchema = new mongoose.Schema({
  productId: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true, unique: true, index: true },
  confirmedAliases: { type: [String], default: [] },
  goodTerms: { type: [String], default: [] },
  badTerms: { type: [String], default: [] },
  ignoredTitles: { type: [String], default: [] },
  excludedWords: { type: [String], default: [] },
  confirmedUrls: { type: [String], default: [] }
}, { timestamps: true, versionKey: false });

module.exports = mongoose.model('ProductLearning', productLearningSchema);
