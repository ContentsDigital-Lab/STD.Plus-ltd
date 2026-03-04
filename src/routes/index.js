const { Router } = require('express');
const healthRoutes = require('./health.routes');
const authRoutes = require('./auth.routes');
const workerRoutes = require('./worker.routes');
const materialRoutes = require('./material.routes');
const inventoryRoutes = require('./inventory.routes');

const router = Router();

router.use('/health', healthRoutes);
router.use('/auth', authRoutes);
router.use('/workers', workerRoutes);
router.use('/materials', materialRoutes);
router.use('/inventories', inventoryRoutes);

module.exports = router;
