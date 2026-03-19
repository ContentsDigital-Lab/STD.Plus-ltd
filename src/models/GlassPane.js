const mongoose = require('mongoose');

const edgeTaskSchema = new mongoose.Schema({
  side: { type: String },
  edgeProfile: { type: String },
  machineType: { type: String },
  status: {
    type: String,
    enum: ['pending', 'in_progress', 'completed'],
    default: 'pending',
  },
}, { _id: false });

const glassPaneSchema = new mongoose.Schema({
  paneNumber: {
    type: String,
    unique: true,
    sparse: true,
  },
  qrCode: {
    type: String,
    unique: true,
    sparse: true,
  },
  order: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Order',
    required: true,
  },
  currentStation: {
    type: String,
    enum: ['queue', 'cutting', 'edging', 'tempering', 'laminating', 'assembly', 'qc', 'ready', 'defected'],
    default: 'queue',
  },
  currentStatus: {
    type: String,
    enum: ['pending', 'in_progress', 'completed'],
    default: 'pending',
  },
  routing: {
    type: [String],
    default: [],
  },
  customRouting: {
    type: Boolean,
    default: false,
  },
  dimensions: {
    width: { type: Number, default: 0 },
    height: { type: Number, default: 0 },
    thickness: { type: Number, default: 0 },
  },
  glassType: {
    type: String,
    default: '',
  },
  glassTypeLabel: {
    type: String,
    default: '',
  },
  processes: {
    type: [String],
    default: [],
  },
  edgeTasks: {
    type: [edgeTaskSchema],
    default: [],
  },
  withdrawal: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Withdrawal',
    default: null,
  },
  remakeOf: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'GlassPane',
    default: null,
  },
  startedAt: {
    type: Date,
    default: null,
  },
  completedAt: {
    type: Date,
    default: null,
  },
  deliveredAt: {
    type: Date,
    default: null,
  },
}, { timestamps: true });

module.exports = mongoose.model('GlassPane', glassPaneSchema);
