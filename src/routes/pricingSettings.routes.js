const { Router } = require('express');
const { z } = require('zod');
const validate = require('../middleware/validate');
const auth = require('../middleware/auth');
const authorize = require('../middleware/authorize');
const pricingSettingsController = require('../controllers/pricingSettings.controller');

const router = Router();

const glassVariantSchema = z.object({
  pricePerSqFt: z.number().min(0),
  grindingRate:  z.number().min(0),
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

router.get('/',  auth, pricingSettingsController.get);
router.put('/',  auth, authorize('admin', 'manager'), validate(updateSchema), pricingSettingsController.update);

module.exports = router;
