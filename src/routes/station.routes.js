const { Router } = require('express');
const { z } = require('zod');
const validate = require('../middleware/validate');
const auth = require('../middleware/auth');
const authorize = require('../middleware/authorize');
const stationController = require('../controllers/station.controller');

const router = Router();

const createSchema = z.object({
  body: z.object({
    name: z.string().min(1),
    workType: z.string().min(1),
    variables: z.array(z.string().min(1)).optional(),
    notes: z.string().optional(),
  }),
});

const updateSchema = z.object({
  body: z.object({
    name: z.string().min(1).optional(),
    workType: z.string().min(1).optional(),
    variables: z.array(z.string().min(1)).optional(),
    notes: z.string().optional(),
  }),
});

const deleteManySchema = z.object({
  body: z.object({
    ids: z.array(z.string().min(1)).min(1),
  }),
});

router.get('/', auth, stationController.getAll);
router.get('/:id', auth, stationController.getById);
router.post('/', auth, authorize('admin', 'manager'), validate(createSchema), stationController.create);
router.patch('/:id', auth, authorize('admin', 'manager'), validate(updateSchema), stationController.update);
router.delete('/', auth, authorize('admin'), validate(deleteManySchema), stationController.deleteMany);
router.delete('/:id', auth, authorize('admin'), stationController.deleteOne);

module.exports = router;
