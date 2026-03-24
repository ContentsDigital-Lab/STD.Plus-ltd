const mongoose = require('mongoose');
const Pane = require('../models/Pane');
const PaneLog = require('../models/PaneLog');
const Order = require('../models/Order');
const Counter = require('../models/Counter');
const Request = require('../models/Request');
const Withdrawal = require('../models/Withdrawal');
const ProductionLog = require('../models/ProductionLog');
const { success, fail } = require('../utils/response');
const emit = require('../utils/emitEvent');
const { verifyReferences, cascadeDeleteReferenced, cascadeDeleteManyReferenced } = require('../services/integrity');
const paginate = require('../utils/paginate');

const Claim = require('../models/Claim');
const MaterialLog = require('../models/MaterialLog');
const Inventory = require('../models/Inventory');

const POPULATE_FIELDS = [
  { path: 'order',    select: 'orderNumber code customer material' },
  { path: 'request',  select: 'code' },
  { path: 'withdrawal' },
  { path: 'remakeOf' },
  { path: 'material', select: 'name' },
];

const restoreInventory = async (materialId, stockType, quantity) => {
  const inventory = await Inventory.findOne({ material: materialId, stockType }).sort({ createdAt: 1 });
  if (inventory) {
    inventory.quantity += quantity;
    await inventory.save();
  }
};

const PANE_DEPENDENTS = [
  { model: PaneLog, field: 'pane' },
  { model: ProductionLog, field: 'pane' },
  { model: Claim, field: 'pane' },
  { model: MaterialLog, field: 'pane' },
  { model: Withdrawal, field: 'pane', beforeDelete: async (docs) => {
    for (const w of docs) await restoreInventory(w.material, w.stockType, w.quantity);
  }},
];

// ── GET /panes ────────────────────────────────────────────────────────────────
exports.getAll = async (req, res, next) => {
  try {
    const filter = {};
    if (req.query.order)    filter.order    = req.query.order;
    if (req.query.request)  filter.request  = req.query.request;
    if (req.query.material) filter.material = req.query.material;
    if (req.query.station)  filter.currentStation = req.query.station;
    if (req.query.status)   filter.currentStatus  = req.query.status;

    const limit = Math.min(1000, Math.max(1, parseInt(req.query.limit) || 200));
    const sort  = req.query.sort || '-createdAt';

    const data = await Pane.find(filter).sort(sort).limit(limit).populate(POPULATE_FIELDS).lean();
    success(res, data);
  } catch (err) {
    next(err);
  }
};

// ── GET /panes/:id ────────────────────────────────────────────────────────────
exports.getById = async (req, res, next) => {
  try {
    const { id } = req.params;
    const pane = mongoose.Types.ObjectId.isValid(id)
      ? await Pane.findById(id).populate(POPULATE_FIELDS).lean()
      : await Pane.findOne({ paneNumber: id.toUpperCase() }).populate(POPULATE_FIELDS).lean();
    if (!pane) return fail(res, 'Pane not found', 404);
    success(res, pane);
  } catch (err) {
    next(err);
  }
};

// ── POST /panes ───────────────────────────────────────────────────────────────
exports.create = async (req, res, next) => {
  try {
    const { request, order, withdrawal, remakeOf } = req.validated.body;
    await verifyReferences([
      { model: Request,    id: request,    label: 'Request' },
      { model: Order,      id: order,      label: 'Order' },
      { model: Withdrawal, id: withdrawal, label: 'Withdrawal' },
      { model: Pane,       id: remakeOf,   label: 'Pane (remakeOf)' },
    ]);
    const body = { ...req.validated.body };
    if (!body.paneNumber) {
      body.paneNumber = await Counter.getNext('pane', 'PNE');
    }
    body.qrCode = `STDPLUS:${body.paneNumber}`;
    const pane = await Pane.create(body);
    const populated = await pane.populate(POPULATE_FIELDS);

    // If linked to an inventory slot → auto-create a 'cut' MaterialLog for traceability
    if (body.inventory) {
      const inv = await Inventory.findById(body.inventory).lean();
      if (inv) {
        await MaterialLog.create({
          material:        inv.material,
          actionType:      'cut',
          quantityChanged: -1,
          referenceId:     inv._id,
          stockType:       inv.stockType ?? null,
          order:           body.order ?? null,
        }).catch(err => console.error('[pane.create] MaterialLog cut failed:', err));
        emit(req, 'log:updated', { action: 'created' }, ['log']);
      }
    }

    emit(req, 'pane:updated', { action: 'created', data: populated }, ['dashboard', 'pane', 'production']);
    success(res, populated, 'Pane created', 201);
  } catch (err) {
    next(err);
  }
};

// ── PATCH /panes/:id ──────────────────────────────────────────────────────────
exports.update = async (req, res, next) => {
  try {
    const { request, order, withdrawal, remakeOf } = req.validated?.body ?? req.body;
    await verifyReferences([
      { model: Request, id: request, label: 'Request' },
      { model: Order, id: order, label: 'Order' },
      { model: Withdrawal, id: withdrawal, label: 'Withdrawal' },
      { model: Pane, id: remakeOf, label: 'Pane (remakeOf)' },
    ]);
    const pane = await Pane.findByIdAndUpdate(
      req.params.id,
      req.validated?.body ?? req.body,
      { new: true, runValidators: true }
    ).populate(POPULATE_FIELDS).lean();
    if (!pane) return fail(res, 'Pane not found', 404);
    emit(req, 'pane:updated', { action: 'updated', data: pane }, ['dashboard', 'pane', 'production']);
    success(res, pane, 'Pane updated');
  } catch (err) {
    next(err);
  }
};

// ── DELETE /panes/:id ─────────────────────────────────────────────────────────
exports.deleteOne = async (req, res, next) => {
  try {
    await cascadeDeleteReferenced(req.params.id, PANE_DEPENDENTS);
    const pane = await Pane.findByIdAndDelete(req.params.id);
    if (!pane) return fail(res, 'Pane not found', 404);
    emit(req, 'pane:updated', { action: 'deleted', data: { _id: pane._id } }, ['dashboard', 'pane', 'production']);
    success(res, null, 'Pane deleted');
  } catch (err) {
    next(err);
  }
};

exports.deleteMany = async (req, res, next) => {
  try {
    const { ids } = req.validated.body;
    await cascadeDeleteManyReferenced(ids, PANE_DEPENDENTS);
    const result = await Pane.deleteMany({ _id: { $in: ids } });
    emit(req, 'pane:updated', { action: 'deleted', data: { ids } }, ['dashboard', 'pane', 'production']);
    success(res, { deletedCount: result.deletedCount }, 'Panes deleted');
  } catch (err) {
    next(err);
  }
};

// ── POST /panes/:paneNumber/scan ──────────────────────────────────────────────
exports.scan = async (req, res, next) => {
  try {
    const { paneNumber } = req.params;
    const { station, action } = req.body;

    if (!station) return fail(res, 'station is required', 400);
    if (!['scan_in', 'start', 'complete', 'scan_out'].includes(action)) return fail(res, 'Invalid action', 400);

    const pane = await Pane.findOne({ paneNumber: paneNumber.toUpperCase() });
    if (!pane) return fail(res, `ไม่พบกระจก ${paneNumber}`, 404);

    if (pane.currentStatus === 'completed') {
      return fail(res, `กระจก ${pane.paneNumber} already completed`, 400);
    }

    if (['complete', 'scan_out'].includes(action) && pane.currentStation !== station) {
      return fail(res, `กระจกอยู่ที่สถานี ${pane.currentStation} ไม่ใช่ ${station}`, 400);
    }

    const now = new Date();
    let nextStation = null;

    if (action === 'scan_in') {
      pane.currentStation = station;
      pane.currentStatus  = 'in_progress';
      if (!pane.startedAt) pane.startedAt = now;
    }

    if (action === 'start') {
      pane.currentStation = station;
      pane.currentStatus  = 'in_progress';
    }

    if (action === 'complete') {
      pane.currentStation = station;
      pane.currentStatus  = 'awaiting_scan_out';
    }

    if (action === 'scan_out') {
      if (pane.currentStatus !== 'awaiting_scan_out') {
        return fail(res, 'กระจกยังไม่เสร็จสิ้น ต้องกด "เสร็จสิ้น" ก่อน scan out', 400);
      }

      const route = Array.isArray(pane.routing) ? pane.routing : [];
      const idx   = route.indexOf(station);
      nextStation = (idx >= 0 && idx < route.length - 1) ? route[idx + 1] : null;

      if (nextStation) {
        pane.currentStation = nextStation;
        pane.currentStatus  = 'pending';
      } else {
        pane.currentStation = station;
        pane.currentStatus  = 'completed';
        pane.completedAt    = now;
      }
    }

    await pane.save();
    const populated = await pane.populate(POPULATE_FIELDS);

    let materialId = pane.material ?? null;
    if (!materialId && pane.order) {
      const ord = await Order.findById(pane.order).select('material').lean();
      materialId = ord?.material ?? null;
      if (materialId) await Pane.updateOne({ _id: pane._id }, { material: materialId });
    }

    const log = await PaneLog.create({
      pane:        pane._id,
      order:       pane.order ?? null,
      material:    materialId,
      worker:      req.user?._id ?? null,
      station,
      action,
      completedAt: action === 'scan_out' ? now : null,
    });

    // Emit real-time events
    emit(req, 'pane:updated', { action: 'scanned', data: populated },
      ['dashboard', 'pane', 'production', `station:${station}`]);
    // Also notify 'log' room so timeline/material-log views refresh automatically
    emit(req, 'log:updated', { action: 'pane_scanned', data: { paneLog: log, material: materialId } }, ['log']);

    if (action === 'scan_out') {
      const isLastStation = !nextStation;

      if (pane.order) {
        const order = await Order.findById(pane.order);
        if (order) {
          const breakdown = order.stationBreakdown instanceof Map
            ? order.stationBreakdown
            : new Map(Object.entries(order.stationBreakdown || {}));
          const prevCount = breakdown.get(station) || 0;
          if (prevCount > 0) breakdown.set(station, prevCount - 1);
          if (nextStation) breakdown.set(nextStation, (breakdown.get(nextStation) || 0) + 1);
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
          const populatedOrder = await order.populate(['request', 'customer', 'material', 'claim', 'withdrawal', 'assignedTo']);
          emit(req, 'order:updated', { action: 'updated', data: populatedOrder }, ['dashboard', 'order']);

          const recipientId = populatedOrder.assignedTo?._id || populatedOrder.assignedTo;
          if (recipientId) {
            const Notification = require('../models/Notification');
            const title = isLastStation ? 'กระจกเสร็จสมบูรณ์' : 'มีกระจกเข้าสถานี';
            const message = isLastStation
              ? `กระจก ${pane.paneNumber} completed all stations`
              : `กระจก ${pane.paneNumber} เข้าสถานี ${nextStation} แล้ว`;
            const notification = await Notification.create({
              recipient: recipientId,
              type: 'pane_arrived',
              title,
              message,
              referenceId: pane._id,
              referenceType: 'Pane',
              priority: isLastStation ? 'low' : 'medium',
            });
            emit(req, 'notification', notification, [`user:${recipientId}`]);
          }
        }
      }

      if (nextStation) {
        emit(req, 'station:pane_arrived', {
          paneNumber: pane.paneNumber, paneId: pane._id,
          fromStation: station, toStation: nextStation, orderId: pane.order,
        }, [`station:${nextStation}`, 'station']);

        const io = req.app.get('io');
        if (io) {
          io.to(`station:${nextStation}`).emit('notification', {
            type:    'pane_arrived',
            title:   'มีกระจกเข้าสถานี',
            message: `กระจก ${pane.paneNumber} เข้าสถานีนี้แล้ว`,
          });
        }
      }
    }

    success(res, {
      pane:        populated.toObject ? populated.toObject() : populated,
      log:         log.toObject(),
      nextStation: nextStation ?? undefined,
    });
  } catch (err) {
    next(err);
  }
};
