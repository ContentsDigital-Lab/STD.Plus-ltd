const Request = require('../models/Request');
const Counter = require('../models/Counter');
const Customer = require('../models/Customer');
const Worker = require('../models/Worker');
const Order = require('../models/Order');
const Pane = require('../models/Pane');
const { success, fail } = require('../utils/response');
const emit = require('../utils/emitEvent');
const { verifyReferences, blockDeleteIfReferenced, blockDeleteManyIfReferenced } = require('../services/integrity');
const paginate = require('../utils/paginate');

const POPULATE_FIELDS = ['customer', 'assignedTo'];

const REQUEST_DEPENDENTS = [
  { model: Order, field: 'request', label: 'order(s)' },
  { model: Pane, field: 'request', label: 'pane(s)' },
];

exports.getAll = async (req, res, next) => {
  try {
    const { data, pagination } = await paginate(Request, {
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
    const request = await Request.findById(req.params.id).populate(POPULATE_FIELDS);
    if (!request) return fail(res, 'Request not found', 404);
    success(res, request);
  } catch (err) {
    next(err);
  }
};

exports.create = async (req, res, next) => {
  try {
    const { customer, assignedTo, panes: paneItems, ...rest } = req.validated.body;
    await verifyReferences([
      { model: Customer, id: customer, label: 'Customer' },
      { model: Worker, id: assignedTo, label: 'Worker (assignedTo)' },
    ]);

    const requestNumber = await Counter.getNext('request', 'REQ');
    const request = await Request.create({ ...rest, customer, assignedTo, requestNumber });

    let createdPanes = [];
    if (paneItems && paneItems.length > 0) {
      const panePromises = paneItems.map(async (paneData) => {
        const paneNumber = await Counter.getNext('pane', 'PNE');
        const qrCode = `STDPLUS:${paneNumber}`;
        const hasRouting = paneData.routing?.length > 0;
        const currentStation = hasRouting ? paneData.routing[0] : 'ready';
        const extras = hasRouting ? {} : { currentStatus: 'completed', completedAt: new Date() };
        return Pane.create({ ...paneData, request: request._id, paneNumber, qrCode, currentStation, ...extras });
      });
      createdPanes = await Promise.all(panePromises);
    }

    const populated = await request.populate(POPULATE_FIELDS);
    const responseData = populated.toObject();
    if (createdPanes.length > 0) responseData.panes = createdPanes;

    emit(req, 'request:updated', { action: 'created', data: responseData }, ['dashboard', 'request']);
    success(res, responseData, 'Request created', 201);
  } catch (err) {
    next(err);
  }
};

exports.update = async (req, res, next) => {
  try {
    const { customer, assignedTo } = req.validated.body;
    await verifyReferences([
      { model: Customer, id: customer, label: 'Customer' },
      { model: Worker, id: assignedTo, label: 'Worker (assignedTo)' },
    ]);

    const { details, ...rest } = req.validated.body;
    const updates = { ...rest };

    if (details) {
      for (const [key, value] of Object.entries(details)) {
        updates[`details.${key}`] = value;
      }
    }

    const request = await Request.findByIdAndUpdate(req.params.id, updates, {
      returnDocument: 'after',
      runValidators: true,
    }).populate(POPULATE_FIELDS);
    if (!request) return fail(res, 'Request not found', 404);
    emit(req, 'request:updated', { action: 'updated', data: request }, ['dashboard', 'request']);
    success(res, request, 'Request updated');
  } catch (err) {
    next(err);
  }
};

exports.deleteOne = async (req, res, next) => {
  try {
    await blockDeleteIfReferenced(req.params.id, REQUEST_DEPENDENTS);
    const request = await Request.findByIdAndDelete(req.params.id);
    if (!request) return fail(res, 'Request not found', 404);
    emit(req, 'request:updated', { action: 'deleted', data: request }, ['dashboard', 'request']);
    success(res, null, 'Request deleted');
  } catch (err) {
    next(err);
  }
};

exports.deleteMany = async (req, res, next) => {
  try {
    const { ids } = req.validated.body;
    await blockDeleteManyIfReferenced(ids, REQUEST_DEPENDENTS);
    const result = await Request.deleteMany({ _id: { $in: ids } });
    emit(req, 'request:updated', { action: 'deleted', data: { ids } }, ['dashboard', 'request']);
    success(res, { deletedCount: result.deletedCount }, 'Requests deleted');
  } catch (err) {
    next(err);
  }
};
