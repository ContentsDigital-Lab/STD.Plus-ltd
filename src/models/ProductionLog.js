const mongoose = require('mongoose');

const qcResultSchema = new mongoose.Schema({
  label: { type: String },
  passed: { type: Boolean },
  note: { type: String, default: '' },
}, { _id: false });

const productionLogSchema = new mongoose.Schema({
  pane: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Pane',
    required: true,
  },
  order: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Order',
    required: true,
  },
  station: {
    type: String,
    required: true,
  },
  action: {
    type: String,
    enum: ['scan_in', 'start', 'complete', 'fail', 'rework', 'qc_pass', 'qc_fail', 'batch_start', 'batch_complete'],
    required: true,
  },
  operator: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Worker',
    default: null,
  },
  defectCode: {
    type: String,
    default: null,
  },
  reworkReason: {
    type: String,
    default: null,
  },
  qcResults: {
    type: [qcResultSchema],
    default: [],
  },
  status: {
    type: String,
    enum: ['pass', 'fail', 'rework'],
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
  durationMs: {
    type: Number,
    default: null,
  },
}, { timestamps: true });

module.exports = mongoose.model('ProductionLog', productionLogSchema);
