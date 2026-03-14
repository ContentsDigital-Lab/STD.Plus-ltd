const StationTemplate = require('../models/StationTemplate');
const Station = require('../models/Station');
const { success, fail } = require('../utils/response');
const { blockDeleteIfReferenced, blockDeleteManyIfReferenced } = require('../services/integrity');
const paginate = require('../utils/paginate');

const TEMPLATE_DEPENDENTS = [
  { model: Station, field: 'templateId', label: 'station(s)' },
];

exports.getAll = async (req, res, next) => {
  try {
    const { data, pagination } = await paginate(StationTemplate, {
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
    const template = await StationTemplate.findById(req.params.id);
    if (!template) return fail(res, 'Station template not found', 404);
    success(res, template);
  } catch (err) {
    next(err);
  }
};

exports.create = async (req, res, next) => {
  try {
    const template = await StationTemplate.create(req.validated.body);
    success(res, template, 'Station template created', 201);
  } catch (err) {
    next(err);
  }
};

exports.update = async (req, res, next) => {
  try {
    const template = await StationTemplate.findByIdAndUpdate(req.params.id, req.validated.body, {
      returnDocument: 'after',
      runValidators: true,
    });
    if (!template) return fail(res, 'Station template not found', 404);
    success(res, template, 'Station template updated');
  } catch (err) {
    next(err);
  }
};

exports.deleteOne = async (req, res, next) => {
  try {
    await blockDeleteIfReferenced(req.params.id, TEMPLATE_DEPENDENTS);
    const template = await StationTemplate.findByIdAndDelete(req.params.id);
    if (!template) return fail(res, 'Station template not found', 404);
    success(res, null, 'Station template deleted');
  } catch (err) {
    next(err);
  }
};

exports.deleteMany = async (req, res, next) => {
  try {
    const { ids } = req.validated.body;
    await blockDeleteManyIfReferenced(ids, TEMPLATE_DEPENDENTS);
    const result = await StationTemplate.deleteMany({ _id: { $in: ids } });
    success(res, { deletedCount: result.deletedCount }, 'Station templates deleted');
  } catch (err) {
    next(err);
  }
};
