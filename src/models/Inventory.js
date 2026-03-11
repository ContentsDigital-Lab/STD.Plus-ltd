const mongoose = require('mongoose');

const inventorySchema = new mongoose.Schema({
  material: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Material',
    required: true,
  },
  stockType: {
    type: String,
    enum: ['Raw', 'Reuse'],
    required: true,
  },
  quantity: {
    type: Number,
    required: true,
    default: 0,
  },
  location: {
    type: String,
    required: true,
    trim: true,
  },
  storageColor: {
    type: String,
    default: '',
    trim: true,
  },
}, { timestamps: true });

module.exports = mongoose.model('Inventory', inventorySchema);
