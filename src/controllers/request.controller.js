const Request = require('../models/Request');
const { success, fail } = require('../utils/response');

const POPULATE_FIELDS = ['customer', 'assignedTo'];

exports.getAll = async (req, res, next) => {
  try {
    const requests = await Request.find().populate(POPULATE_FIELDS);
    success(res, requests);
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
    const request = await Request.create(req.validated.body);
    const populated = await request.populate(POPULATE_FIELDS);
    success(res, populated, 'Request created', 201);
  } catch (err) {
    next(err);
  }
};

exports.update = async (req, res, next) => {
  try {
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
    success(res, request, 'Request updated');
  } catch (err) {
    next(err);
  }
};

exports.deleteOne = async (req, res, next) => {
  try {
    const request = await Request.findByIdAndDelete(req.params.id);
    if (!request) return fail(res, 'Request not found', 404);
    success(res, null, 'Request deleted');
  } catch (err) {
    next(err);
  }
};

exports.deleteMany = async (req, res, next) => {
  try {
    const { ids } = req.validated.body;
    const result = await Request.deleteMany({ _id: { $in: ids } });
    success(res, { deletedCount: result.deletedCount }, 'Requests deleted');
  } catch (err) {
    next(err);
  }
};
