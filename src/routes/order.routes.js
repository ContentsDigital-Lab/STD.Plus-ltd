const { Router } = require('express');
const { z } = require('zod');
const validate = require('../middleware/validate');
const auth = require('../middleware/auth');
const orderController = require('../controllers/order.controller');

const router = Router();

const createSchema = z.object({
  body: z.object({
    request: z.string().min(1).optional(),
    priority: z.number().min(0).optional(),
    customer: z.string().min(1),
    material: z.string().min(1),
    quantity: z.number().min(1),
    stations: z.array(z.string().min(1)).optional(),
    status: z.enum(['pending', 'in_progress', 'completed', 'cancelled']).optional(),
    claim: z.string().min(1).optional(),
    withdrawal: z.string().min(1).optional(),
    assignedTo: z.string().min(1).optional(),
  }),
});

const updateSchema = z.object({
  body: z.object({
    request: z.string().min(1).optional(),
    priority: z.number().min(0).optional(),
    customer: z.string().min(1).optional(),
    material: z.string().min(1).optional(),
    quantity: z.number().min(1).optional(),
    stations: z.array(z.string().min(1)).optional(),
    status: z.enum(['pending', 'in_progress', 'completed', 'cancelled']).optional(),
    claim: z.string().min(1).optional(),
    withdrawal: z.string().min(1).optional(),
    assignedTo: z.string().min(1).optional(),
  }),
});

const deleteManySchema = z.object({
  body: z.object({
    ids: z.array(z.string().min(1)).min(1),
  }),
});

router.get('/', auth, orderController.getAll);
router.get('/:id', auth, orderController.getById);
router.post('/', auth, validate(createSchema), orderController.create);
router.patch('/:id', auth, validate(updateSchema), orderController.update);
router.delete('/', auth, validate(deleteManySchema), orderController.deleteMany);
router.delete('/:id', auth, orderController.deleteOne);

module.exports = router;
