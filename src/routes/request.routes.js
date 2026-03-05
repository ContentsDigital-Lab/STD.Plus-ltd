const { Router } = require('express');
const { z } = require('zod');
const validate = require('../middleware/validate');
const auth = require('../middleware/auth');
const requestController = require('../controllers/request.controller');

const router = Router();

const detailsSchema = z.object({
  type: z.string().min(1),
  estimatedPrice: z.number().min(0).optional(),
  quantity: z.number().min(1),
});

const createSchema = z.object({
  body: z.object({
    details: detailsSchema,
    customer: z.string().min(1),
    deadline: z.string().datetime().optional(),
    deliveryLocation: z.string().optional(),
    assignedTo: z.string().min(1).optional(),
    expectedDeliveryDate: z.string().datetime().optional(),
  }),
});

const updateSchema = z.object({
  body: z.object({
    details: detailsSchema.partial().optional(),
    customer: z.string().min(1).optional(),
    deadline: z.string().datetime().optional(),
    deliveryLocation: z.string().optional(),
    assignedTo: z.string().min(1).optional(),
    expectedDeliveryDate: z.string().datetime().optional(),
  }),
});

const deleteManySchema = z.object({
  body: z.object({
    ids: z.array(z.string().min(1)).min(1),
  }),
});

router.get('/', auth, requestController.getAll);
router.get('/:id', auth, requestController.getById);
router.post('/', auth, validate(createSchema), requestController.create);
router.patch('/:id', auth, validate(updateSchema), requestController.update);
router.delete('/', auth, validate(deleteManySchema), requestController.deleteMany);
router.delete('/:id', auth, requestController.deleteOne);

module.exports = router;
