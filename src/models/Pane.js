const mongoose = require('mongoose');

const edgeTaskSchema = new mongoose.Schema({
  side:        { type: String, default: '' },
  edgeProfile: { type: String, default: '' },
  machineType: { type: String, default: '' },
  status:      { type: String, enum: ['pending', 'in_progress', 'completed'], default: 'pending' },
}, { _id: false });

const vertexSchema = new mongoose.Schema({
  x: { type: Number, required: true },
  y: { type: Number, required: true },
}, { _id: false });

const holeNotchSchema = new mongoose.Schema({
  id:       { type: String, required: true },
  type:     { type: String, enum: ['circle', 'rectangle', 'slot', 'custom'], required: true },
  x:        { type: Number, required: true },
  y:        { type: Number, required: true },
  diameter: { type: Number },
  width:    { type: Number },
  height:   { type: Number },
  length:   { type: Number },
  vertices: { type: [vertexSchema], default: undefined },
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
  currentStatus:  { type: String, enum: ['pending', 'in_progress', 'awaiting_scan_out', 'completed', 'claimed', 'defected'], default: 'pending' },

  routing:      { type: [mongoose.Schema.Types.ObjectId], ref: 'Station', default: [] },
  customRouting:{ type: Boolean, default: false },

  dimensions: {
    width:     { type: Number, default: 0 },
    height:    { type: Number, default: 0 },
    thickness: { type: Number, default: 0 },
    area:      { type: Number, default: 0 },
  },

  jobType:        { type: String, default: '' },
  rawGlass: {
    glassType:     { type: String, default: '' },
    color:         { type: String, default: '' },
    thickness:     { type: Number, default: 0  },
    sheetsPerPane: { type: Number, default: 1  },
  },

  glassType:           { type: String, default: '' },
  glassTypeLabel:      { type: String, default: '' },
  cornerSpec:          { type: String, default: '' },
  dimensionTolerance:  { type: String, default: '' },
  holes:          { type: [holeNotchSchema], default: [] },
  notches:        { type: [holeNotchSchema], default: [] },
  processes:      { type: [String], default: [] },
  edgeTasks:      { type: [edgeTaskSchema], default: [] },

  laminateRole:    { type: String, enum: ['single', 'parent', 'sheet'], default: 'single' },
  parentPane:      { type: mongoose.Schema.Types.ObjectId, ref: 'Pane', default: null },
  childPanes:      { type: [mongoose.Schema.Types.ObjectId], ref: 'Pane', default: [] },
  sheetLabel:      { type: String, default: '' },
  laminateStation: { type: mongoose.Schema.Types.ObjectId, ref: 'Station', default: null },

  startedAt:   { type: Date, default: null },
  completedAt: { type: Date, default: null },
  deliveredAt: { type: Date, default: null },
}, { timestamps: true });

paneSchema.index({ order: 1 });
paneSchema.index({ currentStation: 1, currentStatus: 1 });
paneSchema.index({ parentPane: 1 });
paneSchema.index({ 'dimensions.area': 1 });

paneSchema.pre('save', async function () {
  if (this.dimensions && this.dimensions.width && this.dimensions.height) {
    this.dimensions.area = this.dimensions.width * this.dimensions.height;
  } else if (this.dimensions) {
    this.dimensions.area = 0;
  }
});

module.exports = mongoose.model('Pane', paneSchema);
