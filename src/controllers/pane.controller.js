const Pane = require('../models/Pane');
const Counter = require('../models/Counter');
const Request = require('../models/Request');
const Order = require('../models/Order');
const Withdrawal = require('../models/Withdrawal');
const ProductionLog = require('../models/ProductionLog');
const { success, fail } = require('../utils/response');
const emit = require('../utils/emitEvent');
const { verifyReferences, blockDeleteIfReferenced, blockDeleteManyIfReferenced } = require('../services/integrity');
const paginate = require('../utils/paginate');

const POPULATE_FIELDS = ['request', 'order', 'withdrawal', 'remakeOf'];

const PANE_DEPENDENTS = [
  { model: ProductionLog, field: 'pane', label: 'production log(s)' },
];

exports.getAll = async (req, res, next) => {
  try {
    const { data, pagination } = await paginate(Pane, {
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
    const pane = await Pane.findById(req.params.id).populate(POPULATE_FIELDS);
    if (!pane) return fail(res, 'Pane not found', 404);
    success(res, pane);
  } catch (err) {
    next(err);
  }
};

exports.create = async (req, res, next) => {
  try {
    const { request, order, withdrawal, remakeOf } = req.validated.body;
    await verifyReferences([
      { model: Request, id: request, label: 'Request' },
      { model: Order, id: order, label: 'Order' },
      { model: Withdrawal, id: withdrawal, label: 'Withdrawal' },
      { model: Pane, id: remakeOf, label: 'Pane (remakeOf)' },
    ]);

    const paneNumber = await Counter.getNext('pane', 'PNE');
    const qrCode = `STDPLUS:${paneNumber}`;
    const pane = await Pane.create({ ...req.validated.body, paneNumber, qrCode });
    const populated = await pane.populate(POPULATE_FIELDS);
    emit(req, 'pane:updated', { action: 'created', data: populated }, ['dashboard', 'pane', 'production']);
    success(res, populated, 'Pane created', 201);
  } catch (err) {
    next(err);
  }
};

exports.update = async (req, res, next) => {
  try {
    const { request, order, withdrawal, remakeOf } = req.validated.body;
    await verifyReferences([
      { model: Request, id: request, label: 'Request' },
      { model: Order, id: order, label: 'Order' },
      { model: Withdrawal, id: withdrawal, label: 'Withdrawal' },
      { model: Pane, id: remakeOf, label: 'Pane (remakeOf)' },
    ]);

    const pane = await Pane.findByIdAndUpdate(req.params.id, req.validated.body, {
      new: true,
      runValidators: true,
    }).populate(POPULATE_FIELDS);
    if (!pane) return fail(res, 'Pane not found', 404);
    emit(req, 'pane:updated', { action: 'updated', data: pane }, ['dashboard', 'pane', 'production']);
    success(res, pane, 'Pane updated');
  } catch (err) {
    next(err);
  }
};

exports.deleteOne = async (req, res, next) => {
  try {
    await blockDeleteIfReferenced(req.params.id, PANE_DEPENDENTS);
    const pane = await Pane.findByIdAndDelete(req.params.id);
    if (!pane) return fail(res, 'Pane not found', 404);
    emit(req, 'pane:updated', { action: 'deleted', data: pane }, ['dashboard', 'pane', 'production']);
    success(res, null, 'Pane deleted');
  } catch (err) {
    next(err);
  }
};

exports.deleteMany = async (req, res, next) => {
  try {
    const { ids } = req.validated.body;
    await blockDeleteManyIfReferenced(ids, PANE_DEPENDENTS);
    const result = await Pane.deleteMany({ _id: { $in: ids } });
    emit(req, 'pane:updated', { action: 'deleted', data: { ids } }, ['dashboard', 'pane', 'production']);
    success(res, { deletedCount: result.deletedCount }, 'Panes deleted');
  } catch (err) {
    next(err);
  }
};
