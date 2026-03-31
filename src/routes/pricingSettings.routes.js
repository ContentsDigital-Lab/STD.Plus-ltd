const { Router } = require('express');
const { z } = require('zod');
const validate = require('../middleware/validate');
const auth = require('../middleware/auth');
const requirePermission = require('../middleware/requirePermission');
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

router.get('/',  auth, requirePermission('pricing:view'), pricingSettingsController.get);
router.put('/',  auth, requirePermission('pricing:manage'), validate(updateSchema), pricingSettingsController.update);

module.exports = router;
