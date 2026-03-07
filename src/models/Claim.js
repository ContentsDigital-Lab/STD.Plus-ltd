const mongoose = require('mongoose');

const claimSchema = new mongoose.Schema({
  order: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Order',
    required: true,
  },
  source: {
    type: String,
    enum: ['customer', 'worker'],
    required: true,
  },
  material: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Material',
    required: true,
  },
  description: {
    type: String,
    required: true,
    trim: true,
  },
  decision: {
    type: String,
    enum: ['destroy', 'keep'],
    default: null,
  },
  reportedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Worker',
    required: true,
  },
  approvedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Worker',
    default: null,
  },
  claimDate: {
    type: Date,
    default: Date.now,
  },
}, { timestamps: true });

module.exports = mongoose.model('Claim', claimSchema);
