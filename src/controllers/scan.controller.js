const Pane = require('../models/Pane');
const Order = require('../models/Order');
const ProductionLog = require('../models/ProductionLog');
const Notification = require('../models/Notification');
const Worker = require('../models/Worker');
const { success, fail } = require('../utils/response');
const emit = require('../utils/emitEvent');

const PANE_POPULATE = ['request', 'order', 'withdrawal', 'remakeOf'];
const LOG_POPULATE = ['pane', 'order', 'operator'];
const ORDER_POPULATE = ['request', 'customer', 'material', 'claim', 'withdrawal', 'assignedTo'];

exports.scan = async (req, res, next) => {
  try {
    const { paneNumber: rawPaneNumber } = req.params;
    const { station, action, operator } = req.validated.body;

    const pane = await Pane.findOne({
      $or: [{ paneNumber: rawPaneNumber }, { qrCode: rawPaneNumber }],
    });
    if (!pane) return fail(res, 'Pane not found', 404);

    if (!pane.currentStation && pane.currentStatus === 'completed') {
      return fail(res, 'Pane is already completed', 400);
    }

    const currentStationStr = pane.currentStation ? pane.currentStation.toString() : null;
    if (currentStationStr !== station) {
      return fail(res, `Pane is at "${currentStationStr}", not "${station}"`, 400);
    }

    const orderId = pane.order;
    const operatorId = operator || req.user._id;

    if (operator) {
      const exists = await Worker.exists({ _id: operator });
      if (!exists) return fail(res, 'Operator (Worker) not found', 400);
    }

    const now = new Date();

    if (action === 'scan_in') {
      if (!pane.startedAt) pane.startedAt = now;
      await pane.save();

      const log = await ProductionLog.create({
        pane: pane._id, order: orderId, station,
        action: 'scan_in', operator: operatorId, startedAt: now,
      });

      const populatedPane = await pane.populate(PANE_POPULATE);
      const populatedLog = await log.populate(LOG_POPULATE);

      emit(req, 'production-log:updated', { action: 'created', data: populatedLog }, ['dashboard', 'production']);
      emit(req, 'pane:updated', { action: 'updated', data: populatedPane }, ['dashboard', 'pane', 'production', `station:${station}`]);

      return success(res, { pane: populatedPane, log: populatedLog }, 'Pane scanned in');
    }

    if (action === 'start') {
      pane.currentStatus = 'in_progress';
      if (!pane.startedAt) pane.startedAt = now;
      await pane.save();

      const log = await ProductionLog.create({
        pane: pane._id, order: orderId, station,
        action: 'start', operator: operatorId, startedAt: now,
      });

      const populatedPane = await pane.populate(PANE_POPULATE);
      const populatedLog = await log.populate(LOG_POPULATE);

      emit(req, 'production-log:updated', { action: 'created', data: populatedLog }, ['dashboard', 'production']);
      emit(req, 'pane:updated', { action: 'updated', data: populatedPane }, ['dashboard', 'pane', 'production', `station:${station}`]);

      return success(res, { pane: populatedPane, log: populatedLog }, 'Pane work started');
    }

    if (action === 'complete') {
      const routingIndex = pane.routing.indexOf(station);
      const hasRouting = pane.routing.length > 0;

      let nextStation;
      let isLastStation;

      if (!hasRouting) {
        nextStation = 'ready';
        isLastStation = true;
      } else if (routingIndex === -1) {
        nextStation = pane.routing[0];
        isLastStation = false;
      } else if (routingIndex >= pane.routing.length - 1) {
        nextStation = 'ready';
        isLastStation = true;
      } else {
        nextStation = pane.routing[routingIndex + 1];
        isLastStation = false;
      }

      pane.currentStation = nextStation;
      pane.currentStatus = isLastStation ? 'completed' : 'pending';
      if (isLastStation) pane.completedAt = now;
      await pane.save();

      const log = await ProductionLog.create({
        pane: pane._id, order: orderId, station,
        action: 'complete', operator: operatorId, completedAt: now, status: 'pass',
      });

      let order = null;
      if (orderId) {
        order = await Order.findById(orderId);
        if (order) {
          const breakdown = order.stationBreakdown instanceof Map
            ? order.stationBreakdown
            : new Map(Object.entries(order.stationBreakdown || {}));

          const prevCount = breakdown.get(station) || 0;
          if (prevCount > 0) breakdown.set(station, prevCount - 1);
          breakdown.set(nextStation, (breakdown.get(nextStation) || 0) + 1);
          order.stationBreakdown = breakdown;

          if (isLastStation) {
            order.panesCompleted = (order.panesCompleted || 0) + 1;
            if (order.paneCount > 0) {
              order.progressPercent = Math.round((order.panesCompleted / order.paneCount) * 100);
            }
            if (order.panesCompleted >= order.paneCount && order.paneCount > 0) {
              order.status = 'completed';
            }
          }

          await order.save();
          const populatedOrder = await order.populate(ORDER_POPULATE);
          emit(req, 'order:updated', { action: 'updated', data: populatedOrder }, ['dashboard', 'order']);
        }
      }

      const populatedPane = await pane.populate(PANE_POPULATE);
      const populatedLog = await log.populate(LOG_POPULATE);

      emit(req, 'pane:updated', { action: 'updated', data: populatedPane },
        ['dashboard', 'pane', 'production', `station:${station}`, `station:${nextStation}`]);
      emit(req, 'production-log:updated', { action: 'created', data: populatedLog },
        ['dashboard', 'production']);
      emit(req, 'station:pane_arrived', {
        paneNumber: pane.paneNumber, paneId: pane._id,
        fromStation: station, toStation: nextStation, orderId,
      }, [`station:${nextStation}`, 'station']);

      const recipientId = order?.assignedTo?._id || order?.assignedTo;
      if (recipientId) {
        const title = isLastStation ? 'Pane completed' : 'Pane arrived';
        const message = isLastStation
          ? `Pane ${pane.paneNumber} completed all stations`
          : `Pane ${pane.paneNumber} arrived at ${nextStation}`;

        const notification = await Notification.create({
          recipient: recipientId,
          type: 'pane_arrived',
          title,
          message,
          referenceId: pane._id,
          referenceType: 'Pane',
          priority: isLastStation ? 'low' : 'medium',
        });
        const populatedNotif = await notification.populate('recipient');
        emit(req, 'notification', populatedNotif, [`user:${recipientId}`]);
      }

      return success(res, { pane: populatedPane, log: populatedLog, nextStation }, 'Pane completed and advanced');
    }

    return fail(res, `Unsupported action: "${action}"`, 400);
  } catch (err) {
    next(err);
  }
};
