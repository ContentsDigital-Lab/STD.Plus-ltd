const mongoose = require('mongoose');

const materialLogSchema = new mongoose.Schema({
  material: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Material',
    required: true,
  },
  panes: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Pane',
  }],
  actionType: {
    type: String,
    enum: ['withdraw', 'claim', 'import', 'cut', 'remake'],
    required: true,
  },
  referenceId: {
    type: mongoose.Schema.Types.ObjectId,
    default: null,
  },
  referenceType: {
    type: String,
    enum: ['claim', 'withdrawal'],
    default: null,
  },
  quantityChanged: {
    type: Number,
    required: true,
  },
  totalPrice: {
    type: Number,
    default: 0,
  },
  stockType: {
    type: String,
    enum: ['Raw', 'Reuse'],
    default: null,
  },
  order: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Order',
    default: null,
  },
  parentLog: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'MaterialLog',
    default: null,
  },
  worker: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Worker',
    default: null,
  },
}, { timestamps: true });

module.exports = mongoose.model('MaterialLog', materialLogSchema);
