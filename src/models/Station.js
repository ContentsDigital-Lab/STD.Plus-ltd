const mongoose = require('mongoose');

const STATION_COLORS = ['sky', 'blue', 'violet', 'pink', 'red', 'orange', 'yellow', 'green', 'teal', 'slate'];

const stationSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true,
  },
  templateId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'StationTemplate',
    required: true,
  },
  colorId: {
    type: String,
    enum: STATION_COLORS,
    default: 'sky',
  },
  status: {
    type: String,
    enum: ['online', 'offline', 'maintenance'],
    default: 'offline',
  },
  isLaminateStation: {
    type: Boolean,
    default: false,
  },
  notes: {
    type: String,
    default: '',
    trim: true,
  },
}, { timestamps: true });

module.exports = mongoose.model('Station', stationSchema);
