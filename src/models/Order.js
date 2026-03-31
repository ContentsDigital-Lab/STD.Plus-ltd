const mongoose = require('mongoose');

const orderSchema = new mongoose.Schema({
  orderNumber: {
    type: String,
    unique: true,
    sparse: true,
  },
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
    type: [mongoose.Schema.Types.ObjectId],
    ref: 'Station',
    default: [],
  },
  currentStationIndex: {
    type: Number,
    default: 0,
  },
  stationHistory: {
    type: [{
      station: { type: mongoose.Schema.Types.ObjectId, ref: 'Station', required: true },
      enteredAt: { type: Date, default: Date.now },
      exitedAt: { type: Date, default: null },
      completedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Worker', default: null },
    }],
    default: [],
  },
  stationData: {
    type: Map,
    of: mongoose.Schema.Types.Mixed,
    default: () => new Map(),
  },
  paneCount: {
    type: Number,
    default: 0,
  },
  panesCompleted: {
    type: Number,
    default: 0,
  },
  progressPercent: {
    type: Number,
    default: 0,
  },
  stationBreakdown: {
    type: Map,
    of: Number,
    default: () => new Map(),
  },
  notes: {
    type: String,
    default: '',
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
