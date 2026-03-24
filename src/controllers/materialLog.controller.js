const MaterialLog = require('../models/MaterialLog');
const Material = require('../models/Material');
const Order = require('../models/Order');
const Pane = require('../models/Pane');
const { success, fail } = require('../utils/response');
const emit = require('../utils/emitEvent');
const { verifyReferences, blockDeleteIfReferenced, blockDeleteManyIfReferenced } = require('../services/integrity');
const paginate = require('../utils/paginate');

const POPULATE_FIELDS = ['material', 'pane', 'order', 'parentLog'];

const LOG_DEPENDENTS = [
  { model: MaterialLog, field: 'parentLog', label: 'child log(s)' },
];

exports.getAll = async (req, res, next) => {
  try {
    const filter = {};
    if (req.query.materialId) filter.material = req.query.materialId;
    if (req.query.actionType)  filter.actionType = req.query.actionType;
    const { data, pagination } = await paginate(MaterialLog, {
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
    const log = await MaterialLog.findById(req.params.id).populate(POPULATE_FIELDS);
    if (!log) return fail(res, 'Material log not found', 404);
    success(res, log);
  } catch (err) {
    next(err);
  }
};

exports.create = async (req, res, next) => {
  try {
    const { material, order, parentLog, pane } = req.validated.body;
    await verifyReferences([
      { model: Material, id: material, label: 'Material' },
      { model: Order, id: order, label: 'Order' },
      { model: MaterialLog, id: parentLog, label: 'Parent log' },
      { model: Pane, id: pane, label: 'Pane' },
    ]);

    const log = await MaterialLog.create(req.validated.body);
    const populated = await log.populate(POPULATE_FIELDS);
    emit(req, 'log:updated', { action: 'created', data: populated }, ['dashboard', 'log']);
    success(res, populated, 'Material log created', 201);
  } catch (err) {
    next(err);
  }
};

exports.update = async (req, res, next) => {
  try {
    const { material, order, parentLog, pane } = req.validated.body;
    await verifyReferences([
      { model: Material, id: material, label: 'Material' },
      { model: Order, id: order, label: 'Order' },
      { model: MaterialLog, id: parentLog, label: 'Parent log' },
      { model: Pane, id: pane, label: 'Pane' },
    ]);

    const log = await MaterialLog.findByIdAndUpdate(req.params.id, req.validated.body, {
      returnDocument: 'after',
      runValidators: true,
    }).populate(POPULATE_FIELDS);
    if (!log) return fail(res, 'Material log not found', 404);
    emit(req, 'log:updated', { action: 'updated', data: log }, ['dashboard', 'log']);
    success(res, log, 'Material log updated');
  } catch (err) {
    next(err);
  }
};

exports.deleteOne = async (req, res, next) => {
  try {
    await blockDeleteIfReferenced(req.params.id, LOG_DEPENDENTS);
    const log = await MaterialLog.findByIdAndDelete(req.params.id);
    if (!log) return fail(res, 'Material log not found', 404);
    emit(req, 'log:updated', { action: 'deleted', data: log }, ['dashboard', 'log']);
    success(res, null, 'Material log deleted');
  } catch (err) {
    next(err);
  }
};

exports.deleteMany = async (req, res, next) => {
  try {
    const { ids } = req.validated.body;
    await blockDeleteManyIfReferenced(ids, LOG_DEPENDENTS);
    const result = await MaterialLog.deleteMany({ _id: { $in: ids } });
    emit(req, 'log:updated', { action: 'deleted', data: { ids } }, ['dashboard', 'log']);
    success(res, { deletedCount: result.deletedCount }, 'Material logs deleted');
  } catch (err) {
    next(err);
  }
};
