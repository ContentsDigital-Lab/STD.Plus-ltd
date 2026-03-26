const mongoose = require('mongoose');

const jobTypeSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true,
  },
  code: {
    type: String,
    required: true,
    unique: true,
    trim: true,
  },
  description:          { type: String, default: '' },
  sheetsPerPane:        { type: Number, default: 1 },
  defaultRawGlassTypes: { type: [String], default: [] },
  isActive:             { type: Boolean, default: true },
}, { timestamps: true });

module.exports = mongoose.model('JobType', jobTypeSchema);
