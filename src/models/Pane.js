const mongoose = require('mongoose');

const edgeTaskSchema = new mongoose.Schema({
  side:        { type: String, default: '' },
  edgeProfile: { type: String, default: '' },
  machineType: { type: String, default: '' },
  status:      { type: String, enum: ['pending', 'in_progress', 'completed'], default: 'pending' },
}, { _id: false });

const paneSchema = new mongoose.Schema({
  paneNumber: {
    type:     String,
    required: true,
    unique:   true,
    uppercase: true,
    trim:     true,
  },
  qrCode: { type: String, default: '' },
  order:      { type: mongoose.Schema.Types.ObjectId, ref: 'Order',      default: null },
  request:    { type: mongoose.Schema.Types.ObjectId, ref: 'Request',    default: null },
  withdrawal: { type: mongoose.Schema.Types.ObjectId, ref: 'Withdrawal', default: null },
  remakeOf:   { type: mongoose.Schema.Types.ObjectId, ref: 'Pane',       default: null },
  material:   { type: mongoose.Schema.Types.ObjectId, ref: 'Material',   default: null },
  inventory:  { type: mongoose.Schema.Types.ObjectId, ref: 'Inventory',  default: null },

  currentStation: { type: mongoose.Schema.Types.ObjectId, ref: 'Station', default: null },
  currentStatus:  { type: String, enum: ['pending', 'in_progress', 'awaiting_scan_out', 'completed', 'claimed'], default: 'pending' },

  routing:      { type: [mongoose.Schema.Types.ObjectId], ref: 'Station', default: [] },
  customRouting:{ type: Boolean, default: false },

  dimensions: {
    width:     { type: Number, default: 0 },
    height:    { type: Number, default: 0 },
    thickness: { type: Number, default: 0 },
  },

  jobType:        { type: String, default: '' },
  rawGlass: {
    glassType:     { type: String, default: '' },
    color:         { type: String, default: '' },
    thickness:     { type: Number, default: 0  },
    sheetsPerPane: { type: Number, default: 1  },
  },

  glassType:      { type: String, default: '' },
  glassTypeLabel: { type: String, default: '' },
  processes:      { type: [String], default: [] },
  edgeTasks:      { type: [edgeTaskSchema], default: [] },

  startedAt:   { type: Date, default: null },
  completedAt: { type: Date, default: null },
  deliveredAt: { type: Date, default: null },
}, { timestamps: true });

paneSchema.index({ order: 1 });
paneSchema.index({ currentStation: 1, currentStatus: 1 });
module.exports = mongoose.model('Pane', paneSchema);
