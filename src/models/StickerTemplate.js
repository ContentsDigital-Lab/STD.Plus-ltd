const mongoose = require('mongoose');

const stickerTemplateSchema = new mongoose.Schema({
  name: {
    type: String,
    unique: true,
    default: 'default',
    trim: true,
  },
  width: {
    type: Number,
    required: true,
  },
  height: {
    type: Number,
    required: true,
  },
  elements: {
    type: mongoose.Schema.Types.Mixed,
    default: [],
  },
}, { timestamps: true });

module.exports = mongoose.model('StickerTemplate', stickerTemplateSchema);
