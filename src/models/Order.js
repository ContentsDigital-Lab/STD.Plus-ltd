const mongoose = require('mongoose');

const orderSchema = new mongoose.Schema({
  request: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Request',
    default: null,
  },
  priority: {
    type: Number,
    default: 0,
  },
  customer: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Customer',
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
  stations: {
    type: [String],
    default: [],
  },
  status: {
    type: String,
    enum: ['pending', 'in_progress', 'completed', 'cancelled'],
    default: 'pending',
  },
  claim: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Claim',
    default: null,
  },
  withdrawal: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Withdrawal',
    default: null,
  },
  assignedTo: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Worker',
    default: null,
  },
}, { timestamps: true });

module.exports = mongoose.model('Order', orderSchema);
