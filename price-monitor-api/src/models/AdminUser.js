const mongoose = require('mongoose');

const adminUserSchema = new mongoose.Schema({
  username:      { type: String, required: true, unique: true, trim: true },
  passwordHash:  { type: String, required: true },
  email:         { type: String, default: '' },
  isRoot:        { type: Boolean, default: false },
  resetToken:    { type: String, default: null },
  resetTokenExp: { type: Date, default: null }
}, { timestamps: true, versionKey: false });

module.exports = mongoose.model('AdminUser', adminUserSchema);
