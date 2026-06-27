const mongoose = require('mongoose');

const materialSchema = new mongoose.Schema({
  code: { type: String, trim: true },
  name: {
    type: String,
    required: true,
    trim: true,
  },
  brand: { type: String, trim: true },
  unit: {
    type: String,
    required: true,
    trim: true,
  },
  reorderPoint: {
    type: Number,
    required: true,
    default: 0,
  },
  specDetails: {
    thickness: { type: String, default: '' },
    color: { type: String, default: '' },
    glassType: { type: String, default: '' },
    width:  { type: Number, default: 0 },
    length: { type: Number, default: 0 },
    sqft: { type: String, default: '' },
  },
  isActive: { type: Boolean, default: true },
}, { timestamps: true });

module.exports = mongoose.model('Material', materialSchema);
