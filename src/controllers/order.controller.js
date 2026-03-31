const Order = require('../models/Order');
const Counter = require('../models/Counter');
const Customer = require('../models/Customer');
const Material = require('../models/Material');
const Worker = require('../models/Worker');
const Request = require('../models/Request');
const Claim = require('../models/Claim');
const Withdrawal = require('../models/Withdrawal');
const MaterialLog = require('../models/MaterialLog');
const { success, fail } = require('../utils/response');
const emit = require('../utils/emitEvent');
const { verifyReferences, cascadeDeleteReferenced, cascadeDeleteManyReferenced } = require('../services/integrity');
const Inventory = require('../models/Inventory');
const PaneLog = require('../models/PaneLog');
const paginate = require('../utils/paginate');

const POPULATE_FIELDS = [
  'request', 'customer', 'material', 'claim', 'withdrawal', 'assignedTo',
  { path: 'stations', select: 'name' },
  { path: 'stationHistory.station', select: 'name' },
];

const Pane = require('../models/Pane');
const ProductionLog = require('../models/ProductionLog');

const restoreInventory = async (materialId, stockType, quantity) => {
  const inventory = await Inventory.findOne({ material: materialId, stockType }).sort({ createdAt: 1 });
  if (inventory) {
    inventory.quantity += quantity;
    await inventory.save();
  }
};

const PANE_CASCADE = [
  { model: PaneLog, field: 'pane' },
  { model: ProductionLog, field: 'pane' },
  { model: MaterialLog, field: 'pane' },
];

const ORDER_DEPENDENTS = [
  { model: Claim, field: 'order' },
  { model: Withdrawal, field: 'order', beforeDelete: async (docs) => {
    for (const w of docs) await restoreInventory(w.material, w.stockType, w.quantity);
  }},
  { model: MaterialLog, field: 'order' },
  { model: PaneLog, field: 'order' },
  { model: ProductionLog, field: 'order' },
  { model: Pane, field: 'order', cascade: PANE_CASCADE },
];

const buildRefs = (body) => [
  { model: Customer, id: body.customer, label: 'Customer' },
  { model: Material, id: body.material, label: 'Material' },
  { model: Request, id: body.request, label: 'Request' },
  { model: Worker, id: body.assignedTo, label: 'Worker (assignedTo)' },
  { model: Claim, id: body.claim, label: 'Claim' },
  { model: Withdrawal, id: body.withdrawal, label: 'Withdrawal' },
];

exports.getAll = async (req, res, next) => {
  try {
    const filter = req.user.role === 'worker' ? { assignedTo: req.user._id } : {};
    // Filter orders that include a specific station in their route
    if (req.query.stationId) filter.stations = req.query.stationId;
    const { data, pagination } = await paginate(Order, {
      filter,
      populate: POPULATE_FIELDS,
      page: req.query.page,
      limit: req.query.limit,
      sort: req.query.sort,
    });
    success(res, data, 'Success', 200, pagination);
  } catch (err) {
    next(err);
  }
};

exports.getById = async (req, res, next) => {
  try {
    const order = await Order.findById(req.params.id).populate(POPULATE_FIELDS);
    if (!order) return fail(res, 'Order not found', 404);
    success(res, order);
  } catch (err) {
    next(err);
  }
};

exports.create = async (req, res, next) => {
  try {
    await verifyReferences(buildRefs(req.validated.body));

    const orderNumber = await Counter.getNext('order', 'ORD');
    const order = await Order.create({ ...req.validated.body, orderNumber });

    if (order.request) {
      await Pane.updateMany(
        { request: order.request, order: null },
        { order: order._id, material: order.material },
      );
    }

    const populated = await order.populate(POPULATE_FIELDS);
    emit(req, 'order:updated', { action: 'created', data: populated }, ['dashboard', 'order']);

    // Notify the first station when a new order is created
    const firstStationId = Array.isArray(order.stations) && order.stations[0]
      ? order.stations[0].toString()
      : null;
    if (firstStationId) {
      const io = req.app.get('io');
      if (io) {
        io.to(`station:${firstStationId}`).emit('notification', {
          type: 'order_arrived',
          title: 'มีออเดอร์ใหม่เข้า',
          message: `ออเดอร์ ${order.orderNumber || order._id} เข้าสถานีนี้แล้ว`,
          referenceId: order._id,
          referenceType: 'Order',
          priority: 'high',
          readStatus: false,
        });
      }
    }

    success(res, populated, 'Order created', 201);
  } catch (err) {
    next(err);
  }
};

exports.update = async (req, res, next) => {
  try {
    // Fetch existing order first so we can detect station advancement
    const existing = await Order.findById(req.params.id);
    if (!existing) return fail(res, 'Order not found', 404);

    if (req.user.role === 'worker') {
      if (existing.assignedTo?.toString() !== req.user._id.toString()) {
        return fail(res, 'Not authorized', 403);
      }
    }

    await verifyReferences(buildRefs(req.validated.body));

    const order = await Order.findByIdAndUpdate(req.params.id, req.validated.body, {
      returnDocument: 'after',
      runValidators: true,
    }).populate(POPULATE_FIELDS);
    if (!order) return fail(res, 'Order not found', 404);

    emit(req, 'order:updated', { action: 'updated', data: order }, ['dashboard', 'order']);

    const body = req.validated.body;
    if (body.stationHistory || body.currentStationIndex !== undefined) {
      const stationId = order.stations?.[order.currentStationIndex];
      if (stationId) {
        const lastEntry = order.stationHistory?.[order.stationHistory.length - 1];
        const action = lastEntry?.exitedAt ? 'exited' : 'entered';
        emit(req, 'station:check_in', { orderId: order._id, stationId, action }, [`station:${stationId}`]);
      }
    }

    const prevIdx = existing.currentStationIndex ?? 0;
    const newIdx = order.currentStationIndex ?? 0;
    if (newIdx !== prevIdx && Array.isArray(order.stations) && order.stations[newIdx]) {
      const nextStationId = order.stations[newIdx].toString();
      const io = req.app.get('io');
      if (io) {
        io.to(`station:${nextStationId}`).emit('notification', {
          type: 'order_arrived',
          title: 'มีออเดอร์เข้า',
          message: `ออเดอร์ ${order.orderNumber || order._id} เข้าสถานีนี้แล้ว`,
          referenceId: order._id,
          referenceType: 'Order',
          priority: 'high',
          readStatus: false,
        });
      }
    }

    success(res, order, 'Order updated');
  } catch (err) {
    next(err);
  }
};

exports.deleteOne = async (req, res, next) => {
  try {
    await cascadeDeleteReferenced(req.params.id, ORDER_DEPENDENTS);
    const order = await Order.findByIdAndDelete(req.params.id);
    if (!order) return fail(res, 'Order not found', 404);
    emit(req, 'order:updated', { action: 'deleted', data: order }, ['dashboard', 'order']);
    success(res, null, 'Order deleted');
  } catch (err) {
    next(err);
  }
};

exports.deleteMany = async (req, res, next) => {
  try {
    const { ids } = req.validated.body;
    await cascadeDeleteManyReferenced(ids, ORDER_DEPENDENTS);
    const result = await Order.deleteMany({ _id: { $in: ids } });
    emit(req, 'order:updated', { action: 'deleted', data: { ids } }, ['dashboard', 'order']);
    success(res, { deletedCount: result.deletedCount }, 'Orders deleted');
  } catch (err) {
    next(err);
  }
};
