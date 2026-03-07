const { Router } = require('express');
const healthRoutes = require('./health.routes');
const authRoutes = require('./auth.routes');
const workerRoutes = require('./worker.routes');
const materialRoutes = require('./material.routes');
const inventoryRoutes = require('./inventory.routes');
const customerRoutes = require('./customer.routes');
const claimRoutes = require('./claim.routes');
const requestRoutes = require('./request.routes');
const withdrawalRoutes = require('./withdrawal.routes');
const orderRoutes = require('./order.routes');
const stationRoutes = require('./station.routes');
const materialLogRoutes = require('./materialLog.routes');
const notificationRoutes = require('./notification.routes');

const router = Router();

router.use('/health', healthRoutes);
router.use('/auth', authRoutes);
router.use('/workers', workerRoutes);
router.use('/materials', materialRoutes);
router.use('/inventories', inventoryRoutes);
router.use('/customers', customerRoutes);
router.use('/claims', claimRoutes);
router.use('/requests', requestRoutes);
router.use('/withdrawals', withdrawalRoutes);
router.use('/orders', orderRoutes);
router.use('/stations', stationRoutes);
router.use('/material-logs', materialLogRoutes);
router.use('/notifications', notificationRoutes);

module.exports = router;
