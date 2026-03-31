const { Router } = require('express');
const { z } = require('zod');
const validate = require('../middleware/validate');
const auth = require('../middleware/auth');
const requirePermission = require('../middleware/requirePermission');
const stationTemplateController = require('../controllers/stationTemplate.controller');

const router = Router();

const createSchema = z.object({
  body: z.object({
    name: z.string().min(1),
    uiSchema: z.any().optional(),
  }),
});

const updateSchema = z.object({
  body: z.object({
    name: z.string().min(1).optional(),
    uiSchema: z.any().optional(),
  }),
});

const deleteManySchema = z.object({
  body: z.object({
    ids: z.array(z.string().min(1)).min(1),
  }),
});

router.get('/', auth, requirePermission('station_templates:view'), stationTemplateController.getAll);
router.get('/:id', auth, requirePermission('station_templates:view'), stationTemplateController.getById);
router.post('/', auth, requirePermission('station_templates:manage'), validate(createSchema), stationTemplateController.create);
router.patch('/:id', auth, requirePermission('station_templates:manage'), validate(updateSchema), stationTemplateController.update);
router.delete('/', auth, requirePermission('station_templates:manage'), validate(deleteManySchema), stationTemplateController.deleteMany);
router.delete('/:id', auth, requirePermission('station_templates:manage'), stationTemplateController.deleteOne);

module.exports = router;
