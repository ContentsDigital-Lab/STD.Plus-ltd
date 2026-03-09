const Order = require('../models/Order');
const Customer = require('../models/Customer');
const Material = require('../models/Material');
const Worker = require('../models/Worker');
const Request = require('../models/Request');
const Claim = require('../models/Claim');
const Withdrawal = require('../models/Withdrawal');
const MaterialLog = require('../models/MaterialLog');
const { success, fail } = require('../utils/response');
const emit = require('../utils/emitEvent');
const { verifyReferences, blockDeleteIfReferenced, blockDeleteManyIfReferenced } = require('../services/integrity');

const POPULATE_FIELDS = ['request', 'customer', 'material', 'claim', 'withdrawal', 'assignedTo'];

const ORDER_DEPENDENTS = [
  { model: Claim, field: 'order', label: 'claim(s)' },
  { model: Withdrawal, field: 'order', label: 'withdrawal(s)' },
  { model: MaterialLog, field: 'order', label: 'material log(s)' },
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
    const orders = await Order.find(filter).populate(POPULATE_FIELDS);
    success(res, orders);
  } catch (err) {
    next(err);
  }
};

exports.getById = async (req, res, next) => {
  try {
    const order = await Order.findById(req.params.id).populate(POPULATE_FIELDS);
    if (!order) return fail(res, 'Order not found', 404);
    if (req.user.role === 'worker' && order.assignedTo?._id.toString() !== req.user._id.toString()) {
      return fail(res, 'Not authorized', 403);
    }
    success(res, order);
  } catch (err) {
    next(err);
  }
};

exports.create = async (req, res, next) => {
  try {
    await verifyReferences(buildRefs(req.validated.body));

    const order = await Order.create(req.validated.body);
    const populated = await order.populate(POPULATE_FIELDS);
    emit(req, 'order:updated', { action: 'created', data: populated }, ['dashboard', 'order']);
    success(res, populated, 'Order created', 201);
  } catch (err) {
    next(err);
  }
};

exports.update = async (req, res, next) => {
  try {
    if (req.user.role === 'worker') {
      const existing = await Order.findById(req.params.id);
      if (!existing) return fail(res, 'Order not found', 404);
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
    success(res, order, 'Order updated');
  } catch (err) {
    next(err);
  }
};

exports.deleteOne = async (req, res, next) => {
  try {
    await blockDeleteIfReferenced(req.params.id, ORDER_DEPENDENTS);
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
    await blockDeleteManyIfReferenced(ids, ORDER_DEPENDENTS);
    const result = await Order.deleteMany({ _id: { $in: ids } });
    emit(req, 'order:updated', { action: 'deleted', data: { ids } }, ['dashboard', 'order']);
    success(res, { deletedCount: result.deletedCount }, 'Orders deleted');
  } catch (err) {
    next(err);
  }
};
