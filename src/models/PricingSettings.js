const { Schema, model } = require('mongoose');

// Singleton document — only one document ever exists (singleton: true)
const glassVariantSchema = new Schema(
  {
    pricePerSqFt: { type: Number, required: true, min: 0 },
    grindingRate:  { type: Schema.Types.Mixed, required: true },
  },
  { _id: false }
);

const pricingSettingsSchema = new Schema(
  {
    singleton: { type: Boolean, default: true, immutable: true },
    glassPrices: {
      type: Map,
      of: {
        type: Map,
        of: glassVariantSchema,
      },
      default: {},
    },
    holePriceEach: { type: Number, default: 50, min: 0 },
    notchPrice:    { type: Number, default: 100, min: 0 },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'Worker', default: null },
  },
  { timestamps: true }
);

// Enforce singleton — only one document
pricingSettingsSchema.index({ singleton: 1 }, { unique: true });

module.exports = model('PricingSettings', pricingSettingsSchema);
