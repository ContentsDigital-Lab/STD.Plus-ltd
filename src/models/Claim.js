const mongoose = require('mongoose');

const claimSchema = new mongoose.Schema({
  claimNumber: {
    type: String,
    unique: true,
    sparse: true,
  },
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
  pane: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Pane',
    default: null,
  },
  description: {
    type: String,
    required: true,
    trim: true,
  },
  defectCode: {
    type: String,
    enum: ['broken', 'chipped', 'dimension_wrong', 'scratch', 'other'],
    default: null,
  },
  defectStation: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Station',
    default: null,
  },
  status: {
    type: String,
    enum: ['pending', 'approved', 'rejected'],
    default: 'pending',
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
  remadePane: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Pane',
    default: null,
  },
  photos: {
    type: [String],
    default: [],
  },
  claimDate: {
    type: Date,
    default: Date.now,
  },
}, { timestamps: true });

module.exports = mongoose.model('Claim', claimSchema);
