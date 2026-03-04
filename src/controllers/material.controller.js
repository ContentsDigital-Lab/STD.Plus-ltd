const Material = require('../models/Material');
const { success, fail } = require('../utils/response');

exports.getAll = async (req, res, next) => {
  try {
    const materials = await Material.find();
    success(res, materials);
  } catch (err) {
    next(err);
  }
};

exports.getById = async (req, res, next) => {
  try {
    const material = await Material.findById(req.params.id);
    if (!material) return fail(res, 'Material not found', 404);
    success(res, material);
  } catch (err) {
    next(err);
  }
};

exports.create = async (req, res, next) => {
  try {
    const material = await Material.create(req.validated.body);
    success(res, material, 'Material created', 201);
  } catch (err) {
    next(err);
  }
};

exports.update = async (req, res, next) => {
  try {
    const material = await Material.findByIdAndUpdate(req.params.id, req.validated.body, {
      new: true,
      runValidators: true,
    });
    if (!material) return fail(res, 'Material not found', 404);
    success(res, material, 'Material updated');
  } catch (err) {
    next(err);
  }
};

exports.deleteOne = async (req, res, next) => {
  try {
    const material = await Material.findByIdAndDelete(req.params.id);
    if (!material) return fail(res, 'Material not found', 404);
    success(res, null, 'Material deleted');
  } catch (err) {
    next(err);
  }
};

exports.deleteMany = async (req, res, next) => {
  try {
    const { ids } = req.validated.body;
    const result = await Material.deleteMany({ _id: { $in: ids } });
    success(res, { deletedCount: result.deletedCount }, 'Materials deleted');
  } catch (err) {
    next(err);
  }
};
