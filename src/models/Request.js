const mongoose = require('mongoose');

const requestSchema = new mongoose.Schema({
  requestNumber: {
    type: String,
    unique: true,
    sparse: true,
  },
  details: {
    type: {
      type: String,
      required: true,
      trim: true,
    },
    estimatedPrice: {
      type: Number,
      default: 0,
    },
    quantity: {
      type: Number,
      required: true,
      min: 1,
    },
  },
  customer: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Customer',
    required: true,
  },
  deadline: {
    type: Date,
    default: null,
  },
  deliveryLocation: {
    type: String,
    default: '',
    trim: true,
  },
  assignedTo: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Worker',
    default: null,
  },
  expectedDeliveryDate: {
    type: Date,
    default: null,
  },
}, { timestamps: true });

module.exports = mongoose.model('Request', requestSchema);
