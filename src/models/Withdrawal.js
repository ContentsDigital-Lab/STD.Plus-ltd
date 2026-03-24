const mongoose = require('mongoose');

const withdrawalSchema = new mongoose.Schema({
  order: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Order',
    default: null,
  },
  withdrawnBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Worker',
    required: true,
  },
  material: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Material',
    required: true,
  },
  quantity: {
    type: Number,
    required: true,
    min: 1,
  },
  stockType: {
    type: String,
    enum: ['Raw', 'Reuse'],
    required: true,
  },
  status: {
    type: String,
    enum: ['pending', 'approved', 'rejected'],
    default: 'pending',
  },
  approvedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Worker',
    default: null,
  },
  pane: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Pane',
    default: null,
  },
  withdrawnDimensions: {
    width: { type: Number, default: null },
    height: { type: Number, default: null },
    thickness: { type: Number, default: null },
  },
  notes: {
    type: String,
    default: '',
  },
  withdrawnDate: {
    type: Date,
    default: Date.now,
  },
}, { timestamps: true });

module.exports = mongoose.model('Withdrawal', withdrawalSchema);
