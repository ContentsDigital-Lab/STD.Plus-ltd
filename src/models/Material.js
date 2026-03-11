const mongoose = require('mongoose');

const materialSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true,
  },
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
    width: { type: String, default: '' },
    length: { type: String, default: '' },
  },
}, { timestamps: true });

module.exports = mongoose.model('Material', materialSchema);
