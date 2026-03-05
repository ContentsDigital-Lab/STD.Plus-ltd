const mongoose = require('mongoose');

const withdrawalSchema = new mongoose.Schema({
  order: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'ProductionOrder',
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
  withdrawnDate: {
    type: Date,
    default: Date.now,
  },
}, { timestamps: true });

module.exports = mongoose.model('Withdrawal', withdrawalSchema);
