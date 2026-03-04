const Inventory = require('../models/Inventory');
const { success, fail } = require('../utils/response');

exports.getAll = async (req, res, next) => {
  try {
    const inventories = await Inventory.find().populate('material');
    success(res, inventories);
  } catch (err) {
    next(err);
  }
};

exports.getById = async (req, res, next) => {
  try {
    const inventory = await Inventory.findById(req.params.id).populate('material');
    if (!inventory) return fail(res, 'Inventory not found', 404);
    success(res, inventory);
  } catch (err) {
    next(err);
  }
};

exports.create = async (req, res, next) => {
  try {
    const inventory = await Inventory.create(req.validated.body);
    const populated = await inventory.populate('material');
    success(res, populated, 'Inventory created', 201);
  } catch (err) {
    next(err);
  }
};

exports.update = async (req, res, next) => {
  try {
    const inventory = await Inventory.findByIdAndUpdate(req.params.id, req.validated.body, {
      new: true,
      runValidators: true,
    }).populate('material');
    if (!inventory) return fail(res, 'Inventory not found', 404);
    success(res, inventory, 'Inventory updated');
  } catch (err) {
    next(err);
  }
};

exports.deleteOne = async (req, res, next) => {
  try {
    const inventory = await Inventory.findByIdAndDelete(req.params.id);
    if (!inventory) return fail(res, 'Inventory not found', 404);
    success(res, null, 'Inventory deleted');
  } catch (err) {
    next(err);
  }
};

exports.deleteMany = async (req, res, next) => {
  try {
    const { ids } = req.validated.body;
    const result = await Inventory.deleteMany({ _id: { $in: ids } });
    success(res, { deletedCount: result.deletedCount }, 'Inventories deleted');
  } catch (err) {
    next(err);
  }
};
