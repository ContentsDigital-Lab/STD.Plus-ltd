const mongoose = require('mongoose');

const stationSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true,
  },
  workType: {
    type: String,
    required: true,
    trim: true,
  },
  variables: {
    type: [String],
    default: [],
  },
  notes: {
    type: String,
    default: '',
    trim: true,
  },
}, { timestamps: true });

module.exports = mongoose.model('Station', stationSchema);
