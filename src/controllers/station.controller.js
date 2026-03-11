const Station = require('../models/Station');
const { success, fail } = require('../utils/response');
const paginate = require('../utils/paginate');

exports.getAll = async (req, res, next) => {
  try {
    const { data, pagination } = await paginate(Station, {
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
    const station = await Station.findById(req.params.id);
    if (!station) return fail(res, 'Station not found', 404);
    success(res, station);
  } catch (err) {
    next(err);
  }
};

exports.create = async (req, res, next) => {
  try {
    const station = await Station.create(req.validated.body);
    success(res, station, 'Station created', 201);
  } catch (err) {
    next(err);
  }
};

exports.update = async (req, res, next) => {
  try {
    const station = await Station.findByIdAndUpdate(req.params.id, req.validated.body, {
      returnDocument: 'after',
      runValidators: true,
    });
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
