const { Router } = require('express');
const { z } = require('zod');
const validate = require('../middleware/validate');
const auth = require('../middleware/auth');
const authorize = require('../middleware/authorize');
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

router.get('/', auth, stationTemplateController.getAll);
router.get('/:id', auth, stationTemplateController.getById);
router.post('/', auth, authorize('admin', 'manager'), validate(createSchema), stationTemplateController.create);
router.patch('/:id', auth, authorize('admin', 'manager'), validate(updateSchema), stationTemplateController.update);
router.delete('/', auth, authorize('admin'), validate(deleteManySchema), stationTemplateController.deleteMany);
router.delete('/:id', auth, authorize('admin'), stationTemplateController.deleteOne);

module.exports = router;
