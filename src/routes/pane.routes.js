const { Router } = require('express');
const { z } = require('zod');
const validate = require('../middleware/validate');
const auth = require('../middleware/auth');
const paneController = require('../controllers/pane.controller');

const router = Router();

const createSchema = z.object({
  body: z.object({
    paneNumber:    z.string().min(1).optional(),
    qrCode:        z.string().optional(),
    order:         z.string().optional(),
    request:       z.string().optional(),
    currentStation:z.string().optional(),
    currentStatus: z.enum(['pending', 'in_progress', 'completed']).optional(),
    routing:       z.array(z.string()).optional(),
    customRouting: z.boolean().optional(),
    dimensions:    z.object({ width: z.number(), height: z.number(), thickness: z.number() }).optional(),
    glassType:     z.string().optional(),
    glassTypeLabel:z.string().optional(),
    processes:     z.array(z.string()).optional(),
  }),
});

const scanSchema = z.object({
  body: z.object({
    station: z.string().min(1),
    action:  z.enum(['scan_in', 'start', 'complete']),
  }),
});

router.get('/',                    auth, paneController.getAll);
router.get('/:id',                 auth, paneController.getById);
router.post('/',                   auth, validate(createSchema), paneController.create);
router.patch('/:id',               auth, paneController.update);
router.delete('/:id',              auth, paneController.deleteOne);
router.post('/:paneNumber/scan',   auth, validate(scanSchema), paneController.scan);

module.exports = router;
