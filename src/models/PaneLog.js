const mongoose = require('mongoose');

const paneLogSchema = new mongoose.Schema({
  pane:     { type: mongoose.Schema.Types.ObjectId, ref: 'Pane',     required: true },
  order:    { type: mongoose.Schema.Types.ObjectId, ref: 'Order',    default: null },
  material: { type: mongoose.Schema.Types.ObjectId, ref: 'Material', default: null },
  worker:   { type: mongoose.Schema.Types.ObjectId, ref: 'Worker',   default: null },
  station:  { type: mongoose.Schema.Types.ObjectId, ref: 'Station', required: true },
  action:   { type: String, enum: ['scan_in', 'start', 'complete', 'scan_out'],  required: true },
  completedAt: { type: Date, default: null },
}, { timestamps: true });

paneLogSchema.index({ pane: 1, createdAt: -1 });
paneLogSchema.index({ order: 1 });
paneLogSchema.index({ material: 1, createdAt: -1 });
paneLogSchema.index({ station: 1, action: 1 });

module.exports = mongoose.model('PaneLog', paneLogSchema);
