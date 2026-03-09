const Inventory = require('../models/Inventory');
const Material = require('../models/Material');
const { success, fail } = require('../utils/response');
const emit = require('../utils/emitEvent');
const { verifyReferences } = require('../services/integrity');

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
    await verifyReferences([
      { model: Material, id: req.validated.body.material, label: 'Material' },
    ]);

    const inventory = await Inventory.create(req.validated.body);
    const populated = await inventory.populate('material');
    emit(req, 'inventory:updated', { action: 'created', data: populated }, ['dashboard', 'inventory']);
    success(res, populated, 'Inventory created', 201);
  } catch (err) {
    next(err);
  }
};

exports.update = async (req, res, next) => {
  try {
    await verifyReferences([
      { model: Material, id: req.validated.body.material, label: 'Material' },
    ]);

    const inventory = await Inventory.findByIdAndUpdate(req.params.id, req.validated.body, {
      new: true,
      runValidators: true,
    }).populate('material');
    if (!inventory) return fail(res, 'Inventory not found', 404);
    emit(req, 'inventory:updated', { action: 'updated', data: inventory }, ['dashboard', 'inventory']);
    success(res, inventory, 'Inventory updated');
  } catch (err) {
    next(err);
  }
};

exports.deleteOne = async (req, res, next) => {
  try {
    const inventory = await Inventory.findByIdAndDelete(req.params.id);
    if (!inventory) return fail(res, 'Inventory not found', 404);
    emit(req, 'inventory:updated', { action: 'deleted', data: inventory }, ['dashboard', 'inventory']);
    success(res, null, 'Inventory deleted');
  } catch (err) {
    next(err);
  }
};

exports.deleteMany = async (req, res, next) => {
  try {
    const { ids } = req.validated.body;
    const result = await Inventory.deleteMany({ _id: { $in: ids } });
    emit(req, 'inventory:updated', { action: 'deleted', data: { ids } }, ['dashboard', 'inventory']);
    success(res, { deletedCount: result.deletedCount }, 'Inventories deleted');
  } catch (err) {
    next(err);
  }
};
