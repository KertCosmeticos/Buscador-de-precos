const mongoose = require('mongoose');

const adminUserSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true, trim: true },
  passwordHash: { type: String, required: true },
  isRoot: { type: Boolean, default: false }
}, { timestamps: true, versionKey: false });

module.exports = mongoose.model('AdminUser', adminUserSchema);
