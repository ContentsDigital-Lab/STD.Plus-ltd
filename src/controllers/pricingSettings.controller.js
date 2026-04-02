const PricingSettings = require('../models/PricingSettings');
const { success, fail } = require('../utils/response');
const emit = require('../utils/emitEvent');

// Mongoose toObject({ flattenMaps: true }) only flattens one level of Map.
// glassPrices is Map<string, Map<string, schema>> so inner Maps stay as Map objects
// and serialize to {} in JSON. This helper manually converts both levels.
function flattenSettings(settings) {
  const base = settings.toObject({ flattenMaps: true });
  const glassPrices = {};
  if (settings.glassPrices instanceof Map) {
    for (const [glassType, thicknessMap] of settings.glassPrices.entries()) {
      glassPrices[glassType] = {};
      if (thicknessMap instanceof Map) {
        for (const [thickness, price] of thicknessMap.entries()) {
          glassPrices[glassType][thickness] = price.toObject ? price.toObject() : { ...price };
        }
      } else if (thicknessMap && typeof thicknessMap === 'object') {
        glassPrices[glassType] = thicknessMap;
      }
    }
  } else {
    Object.assign(glassPrices, base.glassPrices ?? {});
  }
  return { ...base, glassPrices };
}

// Default glassPrices matching frontend DEFAULT_PRICING
const DEFAULT_GLASS_PRICES = {
  Clear:      { '3mm': { pricePerSqFt: 35,  grindingRate: { rough: 50, polished: 70 } }, '5mm': { pricePerSqFt: 50,  grindingRate: { rough: 50, polished: 70 } }, '6mm': { pricePerSqFt: 55,  grindingRate: { rough: 50, polished: 70 } }, '8mm': { pricePerSqFt: 65,  grindingRate: { rough: 50, polished: 75 } }, '10mm': { pricePerSqFt: 75,  grindingRate: { rough: 50, polished: 75 } }, '12mm': { pricePerSqFt: 85,  grindingRate: { rough: 75, polished: 100 } }, '15mm': { pricePerSqFt: 110, grindingRate: { rough: 75, polished: 100 } }, '19mm': { pricePerSqFt: 140, grindingRate: { rough: 75, polished: 100 } } },
  Tinted:     { '5mm': { pricePerSqFt: 55,  grindingRate: { rough: 50, polished: 70 } }, '6mm': { pricePerSqFt: 60,  grindingRate: { rough: 50, polished: 70 } }, '8mm': { pricePerSqFt: 66,  grindingRate: { rough: 50, polished: 75 } }, '10mm': { pricePerSqFt: 76,  grindingRate: { rough: 75, polished: 100 } }, '12mm': { pricePerSqFt: 86,  grindingRate: { rough: 75, polished: 100 } }, '15mm': { pricePerSqFt: 110, grindingRate: { rough: 75, polished: 100 } } },
  Tempered:   { '5mm': { pricePerSqFt: 85,  grindingRate: { rough: 75, polished: 100 } }, '6mm': { pricePerSqFt: 95,  grindingRate: { rough: 75, polished: 100 } }, '8mm': { pricePerSqFt: 104, grindingRate: { rough: 75, polished: 100 } }, '10mm': { pricePerSqFt: 114, grindingRate: { rough: 75, polished: 100 } }, '12mm': { pricePerSqFt: 125, grindingRate: { rough: 75, polished: 100 } }, '15mm': { pricePerSqFt: 150, grindingRate: { rough: 75, polished: 100 } }, '19mm': { pricePerSqFt: 180, grindingRate: { rough: 75, polished: 100 } } },
  Laminated:  { '6mm': { pricePerSqFt: 90,  grindingRate: { rough: 75, polished: 100 } }, '8mm': { pricePerSqFt: 100, grindingRate: { rough: 75, polished: 100 } }, '10mm': { pricePerSqFt: 112, grindingRate: { rough: 75, polished: 100 } }, '12mm': { pricePerSqFt: 125, grindingRate: { rough: 75, polished: 100 } }, '15mm': { pricePerSqFt: 150, grindingRate: { rough: 75, polished: 100 } } },
  'Low-E':    { '6mm': { pricePerSqFt: 110, grindingRate: { rough: 75, polished: 100 } }, '8mm': { pricePerSqFt: 120, grindingRate: { rough: 75, polished: 100 } }, '10mm': { pricePerSqFt: 135, grindingRate: { rough: 75, polished: 100 } }, '12mm': { pricePerSqFt: 152, grindingRate: { rough: 75, polished: 100 } } },
  Frosted:    { '5mm': { pricePerSqFt: 60,  grindingRate: { rough: 50, polished: 70 } }, '6mm': { pricePerSqFt: 68,  grindingRate: { rough: 50, polished: 70 } }, '8mm': { pricePerSqFt: 76,  grindingRate: { rough: 75, polished: 100 } }, '10mm': { pricePerSqFt: 86,  grindingRate: { rough: 75, polished: 100 } } },
  Reflective: { '6mm': { pricePerSqFt: 85,  grindingRate: { rough: 75, polished: 100 } }, '8mm': { pricePerSqFt: 95,  grindingRate: { rough: 75, polished: 100 } }, '10mm': { pricePerSqFt: 108, grindingRate: { rough: 75, polished: 100 } } },
  Patterned:  { '5mm': { pricePerSqFt: 55,  grindingRate: { rough: 50, polished: 70 } }, '6mm': { pricePerSqFt: 65,  grindingRate: { rough: 50, polished: 70 } } },
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
    // toObject({ flattenMaps: true }) only flattens one level; manually flatten nested Maps
    const plain = flattenSettings(settings);
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

    const plain = flattenSettings(settings);

    // Broadcast to all clients subscribed to the 'pricing' room
    emit(req, 'pricing:updated', plain, ['pricing']);

    success(res, plain, 'Pricing settings updated');
  } catch (err) {
    next(err);
  }
};
