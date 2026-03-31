const mongoose = require('mongoose');
const bcrypt = require('bcrypt');

const workerSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true,
  },
  username: {
    type: String,
    required: true,
    unique: true,
    trim: true,
    lowercase: true,
  },
  password: {
    type: String,
    required: true,
    select: false,
  },
  position: {
    type: String,
    required: true,
    trim: true,
  },
  role: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Role',
    required: true,
  },
  notificationPreferences: {
    enabled: { type: Boolean, default: true },
    volume: { type: Number, default: 0.6, min: 0, max: 1 },
    sounds: {
      low: { type: String, default: 'soft_pop', trim: true },
      medium: { type: String, default: 'ding', trim: true },
      high: { type: String, default: 'alert', trim: true },
      urgent: { type: String, default: 'alert', trim: true },
    },
  },
}, { timestamps: true });

workerSchema.pre('save', async function () {
  if (!this.isModified('password')) return;
  this.password = await bcrypt.hash(this.password, 12);
});

workerSchema.methods.comparePassword = async function (candidate) {
  return bcrypt.compare(candidate, this.password);
};

workerSchema.methods.toJSON = function () {
  const obj = this.toObject();
  delete obj.password;
  return obj;
};

module.exports = mongoose.model('Worker', workerSchema);
