const { Router } = require('express');
const { z } = require('zod');
const validate = require('../middleware/validate');
const auth = require('../middleware/auth');
const requirePermission = require('../middleware/requirePermission');
const authorize = require('../middleware/authorize');
const pricingSettingsController = require('../controllers/pricingSettings.controller');

const router = Router();

const grindingRateSchema = z.union([
  z.number().min(0),
  z.record(z.string(), z.number().min(0)),
]);

const glassVariantSchema = z.object({
  pricePerSqFt: z.number().min(0),
  grindingRate:  grindingRateSchema,
});

const updateSchema = z.object({
  body: z.object({
    glassPrices: z
      .record(z.string(), z.record(z.string(), glassVariantSchema))
      .optional(),
    holePriceEach: z.number().min(0).optional(),
    notchPrice:    z.number().min(0).optional(),
  }),
});

router.get('/',  auth, authorize('settings:view', 'orders:view', 'orders:create'), pricingSettingsController.get);
router.put('/',  auth, requirePermission('settings:manage'), validate(updateSchema), pricingSettingsController.update);

module.exports = router;
