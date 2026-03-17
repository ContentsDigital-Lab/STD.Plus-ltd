const mongoose = require('mongoose');

const counterSchema = new mongoose.Schema({
  _id: { type: String, required: true },
  seq: { type: Number, default: 0 },
});

counterSchema.statics.getNext = async function (name, prefix) {
  const counter = await this.findOneAndUpdate(
    { _id: name },
    { $inc: { seq: 1 } },
    { upsert: true, returnDocument: 'after' },
  );
  return `${prefix}-${String(counter.seq).padStart(4, '0')}`;
};

module.exports = mongoose.model('Counter', counterSchema);
