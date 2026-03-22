const PricingSettings = require('../models/PricingSettings');
const { success, fail } = require('../utils/response');
const emit = require('../utils/emitEvent');

// Default glassPrices matching frontend DEFAULT_PRICING
const DEFAULT_GLASS_PRICES = {
  Clear:      { '3mm': { pricePerSqFt: 35,  grindingRate: 50 }, '5mm': { pricePerSqFt: 50,  grindingRate: 50 }, '6mm': { pricePerSqFt: 55,  grindingRate: 50 }, '8mm': { pricePerSqFt: 65,  grindingRate: 50 }, '10mm': { pricePerSqFt: 75,  grindingRate: 50 }, '12mm': { pricePerSqFt: 85,  grindingRate: 75 }, '15mm': { pricePerSqFt: 110, grindingRate: 75 }, '19mm': { pricePerSqFt: 140, grindingRate: 75 } },
  Tinted:     { '5mm': { pricePerSqFt: 55,  grindingRate: 50 }, '6mm': { pricePerSqFt: 60,  grindingRate: 50 }, '8mm': { pricePerSqFt: 66,  grindingRate: 50 }, '10mm': { pricePerSqFt: 76,  grindingRate: 75 }, '12mm': { pricePerSqFt: 86,  grindingRate: 75 }, '15mm': { pricePerSqFt: 110, grindingRate: 75 } },
  Tempered:   { '5mm': { pricePerSqFt: 85,  grindingRate: 75 }, '6mm': { pricePerSqFt: 95,  grindingRate: 75 }, '8mm': { pricePerSqFt: 104, grindingRate: 75 }, '10mm': { pricePerSqFt: 114, grindingRate: 75 }, '12mm': { pricePerSqFt: 125, grindingRate: 75 }, '15mm': { pricePerSqFt: 150, grindingRate: 75 }, '19mm': { pricePerSqFt: 180, grindingRate: 75 } },
  Laminated:  { '6mm': { pricePerSqFt: 90,  grindingRate: 75 }, '8mm': { pricePerSqFt: 100, grindingRate: 75 }, '10mm': { pricePerSqFt: 112, grindingRate: 75 }, '12mm': { pricePerSqFt: 125, grindingRate: 75 }, '15mm': { pricePerSqFt: 150, grindingRate: 75 } },
  'Low-E':    { '6mm': { pricePerSqFt: 110, grindingRate: 75 }, '8mm': { pricePerSqFt: 120, grindingRate: 75 }, '10mm': { pricePerSqFt: 135, grindingRate: 75 }, '12mm': { pricePerSqFt: 152, grindingRate: 75 } },
  Frosted:    { '5mm': { pricePerSqFt: 60,  grindingRate: 50 }, '6mm': { pricePerSqFt: 68,  grindingRate: 50 }, '8mm': { pricePerSqFt: 76,  grindingRate: 75 }, '10mm': { pricePerSqFt: 86,  grindingRate: 75 } },
  Reflective: { '6mm': { pricePerSqFt: 85,  grindingRate: 75 }, '8mm': { pricePerSqFt: 95,  grindingRate: 75 }, '10mm': { pricePerSqFt: 108, grindingRate: 75 } },
  Patterned:  { '5mm': { pricePerSqFt: 55,  grindingRate: 50 }, '6mm': { pricePerSqFt: 65,  grindingRate: 50 } },
};

// GET /api/pricing-settings  — any authenticated user
exports.get = async (req, res, next) => {
  try {
    let settings = await PricingSettings.findOne({ singleton: true }).populate('updatedBy', 'name role');

    if (!settings) {
      // Auto-create with defaults on first request
      settings = await PricingSettings.create({ glassPrices: DEFAULT_GLASS_PRICES });
    }

    // Convert Mongoose Maps → plain objects for JSON response
    const plain = settings.toObject({ flattenMaps: true });
    success(res, plain);
  } catch (err) {
    next(err);
  }
};

// PUT /api/pricing-settings  — admin / manager only
exports.update = async (req, res, next) => {
  try {
    const { glassPrices, holePriceEach, notchPrice } = req.validated.body;

    const settings = await PricingSettings.findOneAndUpdate(
      { singleton: true },
      {
        ...(glassPrices    !== undefined && { glassPrices }),
        ...(holePriceEach  !== undefined && { holePriceEach }),
        ...(notchPrice     !== undefined && { notchPrice }),
        updatedBy: req.user._id,
      },
      { new: true, upsert: true, runValidators: true, setDefaultsOnInsert: true }
    ).populate('updatedBy', 'name role');

    const plain = settings.toObject({ flattenMaps: true });

    // Broadcast to all clients subscribed to the 'pricing' room
    emit(req, 'pricing:updated', plain, ['pricing']);

    success(res, plain, 'Pricing settings updated');
  } catch (err) {
    next(err);
  }
};
