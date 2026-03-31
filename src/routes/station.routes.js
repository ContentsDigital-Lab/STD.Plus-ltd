const { Router } = require('express');
const { z } = require('zod');
const validate = require('../middleware/validate');
const auth = require('../middleware/auth');
const requirePermission = require('../middleware/requirePermission');
const stationController = require('../controllers/station.controller');

const router = Router();

const stationColors = ['sky', 'blue', 'violet', 'pink', 'red', 'orange', 'yellow', 'green', 'teal', 'slate'];

const createSchema = z.object({
  body: z.object({
    name: z.string().min(1),
    templateId: z.string().min(1),
    colorId: z.enum(stationColors).optional(),
    status: z.enum(['online', 'offline', 'maintenance']).optional(),
    notes: z.string().optional(),
  }),
});

const updateSchema = z.object({
  body: z.object({
    name: z.string().min(1).optional(),
    templateId: z.string().min(1).optional(),
    colorId: z.enum(stationColors).optional(),
    status: z.enum(['online', 'offline', 'maintenance']).optional(),
    notes: z.string().optional(),
  }),
});

const deleteManySchema = z.object({
  body: z.object({
    ids: z.array(z.string().min(1)).min(1),
  }),
});

router.get('/', auth, requirePermission('stations:view'), stationController.getAll);
router.get('/:id', auth, requirePermission('stations:view'), stationController.getById);
router.post('/', auth, requirePermission('stations:manage'), validate(createSchema), stationController.create);
router.patch('/:id', auth, requirePermission('stations:manage'), validate(updateSchema), stationController.update);
router.delete('/', auth, requirePermission('stations:manage'), validate(deleteManySchema), stationController.deleteMany);
router.delete('/:id', auth, requirePermission('stations:manage'), stationController.deleteOne);

module.exports = router;
