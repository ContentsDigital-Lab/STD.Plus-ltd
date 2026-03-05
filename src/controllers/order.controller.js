const Order = require('../models/Order');
const { success, fail } = require('../utils/response');

const POPULATE_FIELDS = ['request', 'customer', 'material', 'claim', 'withdrawal', 'assignedTo'];

exports.getAll = async (req, res, next) => {
  try {
    const orders = await Order.find().populate(POPULATE_FIELDS);
    success(res, orders);
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
    const order = await Order.create(req.validated.body);
    const populated = await order.populate(POPULATE_FIELDS);
    success(res, populated, 'Order created', 201);
  } catch (err) {
    next(err);
  }
};

exports.update = async (req, res, next) => {
  try {
    const order = await Order.findByIdAndUpdate(req.params.id, req.validated.body, {
      returnDocument: 'after',
      runValidators: true,
    }).populate(POPULATE_FIELDS);
    if (!order) return fail(res, 'Order not found', 404);
    success(res, order, 'Order updated');
  } catch (err) {
    next(err);
  }
};

exports.deleteOne = async (req, res, next) => {
  try {
    const order = await Order.findByIdAndDelete(req.params.id);
    if (!order) return fail(res, 'Order not found', 404);
    success(res, null, 'Order deleted');
  } catch (err) {
    next(err);
  }
};

exports.deleteMany = async (req, res, next) => {
  try {
    const { ids } = req.validated.body;
    const result = await Order.deleteMany({ _id: { $in: ids } });
    success(res, { deletedCount: result.deletedCount }, 'Orders deleted');
  } catch (err) {
    next(err);
  }
};
