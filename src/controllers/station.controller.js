const Station = require('../models/Station');
const StationTemplate = require('../models/StationTemplate');
const { success, fail } = require('../utils/response');
const { verifyReferences } = require('../services/integrity');
const paginate = require('../utils/paginate');

const POPULATE_FIELDS = ['templateId'];

exports.getAll = async (req, res, next) => {
  try {
    const { data, pagination } = await paginate(Station, {
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
    const station = await Station.findById(req.params.id).populate(POPULATE_FIELDS);
    if (!station) return fail(res, 'Station not found', 404);
    success(res, station);
  } catch (err) {
    next(err);
  }
};

exports.create = async (req, res, next) => {
  try {
    await verifyReferences([
      { model: StationTemplate, id: req.validated.body.templateId, label: 'Station template' },
    ]);

    const station = await Station.create(req.validated.body);
    const populated = await station.populate(POPULATE_FIELDS);
    success(res, populated, 'Station created', 201);
  } catch (err) {
    next(err);
  }
};

exports.update = async (req, res, next) => {
  try {
    if (req.validated.body.templateId) {
      await verifyReferences([
        { model: StationTemplate, id: req.validated.body.templateId, label: 'Station template' },
      ]);
    }

    const station = await Station.findByIdAndUpdate(req.params.id, req.validated.body, {
      returnDocument: 'after',
      runValidators: true,
    }).populate(POPULATE_FIELDS);
    if (!station) return fail(res, 'Station not found', 404);
    success(res, station, 'Station updated');
  } catch (err) {
    next(err);
  }
};

exports.deleteOne = async (req, res, next) => {
  try {
    const station = await Station.findByIdAndDelete(req.params.id);
    if (!station) return fail(res, 'Station not found', 404);
    success(res, null, 'Station deleted');
  } catch (err) {
    next(err);
  }
};

exports.deleteMany = async (req, res, next) => {
  try {
    const { ids } = req.validated.body;
    const result = await Station.deleteMany({ _id: { $in: ids } });
    success(res, { deletedCount: result.deletedCount }, 'Stations deleted');
  } catch (err) {
    next(err);
  }
};
