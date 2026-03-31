const ProductionLog = require('../models/ProductionLog');
const Pane = require('../models/Pane');
const Order = require('../models/Order');
const Worker = require('../models/Worker');
const { success, fail } = require('../utils/response');
const emit = require('../utils/emitEvent');
const { verifyReferences } = require('../services/integrity');
const paginate = require('../utils/paginate');

const POPULATE_FIELDS = ['pane', 'order', 'operator', { path: 'station', select: 'name' }];

exports.getAll = async (req, res, next) => {
  try {
    const { data, pagination } = await paginate(ProductionLog, {
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
    const log = await ProductionLog.findById(req.params.id).populate(POPULATE_FIELDS);
    if (!log) return fail(res, 'Production log not found', 404);
    success(res, log);
  } catch (err) {
    next(err);
  }
};

exports.create = async (req, res, next) => {
  try {
    const { pane, order, operator } = req.validated.body;
    await verifyReferences([
      { model: Pane, id: pane, label: 'Pane' },
      { model: Order, id: order, label: 'Order' },
      { model: Worker, id: operator, label: 'Worker (operator)' },
    ]);

    const log = await ProductionLog.create(req.validated.body);
    const populated = await log.populate(POPULATE_FIELDS);
    emit(req, 'production-log:updated', { action: 'created', data: populated }, ['dashboard', 'production']);
    success(res, populated, 'Production log created', 201);
  } catch (err) {
    next(err);
  }
};

exports.update = async (req, res, next) => {
  try {
    const { pane, order, operator } = req.validated.body;
    await verifyReferences([
      { model: Pane, id: pane, label: 'Pane' },
      { model: Order, id: order, label: 'Order' },
      { model: Worker, id: operator, label: 'Worker (operator)' },
    ]);

    const log = await ProductionLog.findByIdAndUpdate(req.params.id, req.validated.body, {
      new: true,
      runValidators: true,
    }).populate(POPULATE_FIELDS);
    if (!log) return fail(res, 'Production log not found', 404);
    emit(req, 'production-log:updated', { action: 'updated', data: log }, ['dashboard', 'production']);
    success(res, log, 'Production log updated');
  } catch (err) {
    next(err);
  }
};

exports.deleteOne = async (req, res, next) => {
  try {
    const log = await ProductionLog.findByIdAndDelete(req.params.id);
    if (!log) return fail(res, 'Production log not found', 404);
    emit(req, 'production-log:updated', { action: 'deleted', data: log }, ['dashboard', 'production']);
    success(res, null, 'Production log deleted');
  } catch (err) {
    next(err);
  }
};

exports.deleteMany = async (req, res, next) => {
  try {
    const { ids } = req.validated.body;
    const result = await ProductionLog.deleteMany({ _id: { $in: ids } });
    emit(req, 'production-log:updated', { action: 'deleted', data: { ids } }, ['dashboard', 'production']);
    success(res, { deletedCount: result.deletedCount }, 'Production logs deleted');
  } catch (err) {
    next(err);
  }
};
