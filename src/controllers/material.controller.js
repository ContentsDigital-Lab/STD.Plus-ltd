const Material = require('../models/Material');
const Inventory = require('../models/Inventory');
const Order = require('../models/Order');
const Claim = require('../models/Claim');
const Withdrawal = require('../models/Withdrawal');
const MaterialLog = require('../models/MaterialLog');
const { success, fail } = require('../utils/response');
const emit = require('../utils/emitEvent');
const { blockDeleteIfReferenced, blockDeleteManyIfReferenced } = require('../services/integrity');

const MATERIAL_DEPENDENTS = [
  { model: Inventory, field: 'material', label: 'inventory record(s)' },
  { model: Order, field: 'material', label: 'order(s)' },
  { model: Claim, field: 'material', label: 'claim(s)' },
  { model: Withdrawal, field: 'material', label: 'withdrawal(s)' },
  { model: MaterialLog, field: 'material', label: 'material log(s)' },
];

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
    emit(req, 'material:updated', { action: 'created', data: material }, ['dashboard', 'inventory']);
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
    emit(req, 'material:updated', { action: 'updated', data: material }, ['dashboard', 'inventory']);
    success(res, material, 'Material updated');
  } catch (err) {
    next(err);
  }
};

exports.deleteOne = async (req, res, next) => {
  try {
    await blockDeleteIfReferenced(req.params.id, MATERIAL_DEPENDENTS);
    const material = await Material.findByIdAndDelete(req.params.id);
    if (!material) return fail(res, 'Material not found', 404);
    emit(req, 'material:updated', { action: 'deleted', data: material }, ['dashboard', 'inventory']);
    success(res, null, 'Material deleted');
  } catch (err) {
    next(err);
  }
};

exports.deleteMany = async (req, res, next) => {
  try {
    const { ids } = req.validated.body;
    await blockDeleteManyIfReferenced(ids, MATERIAL_DEPENDENTS);
    const result = await Material.deleteMany({ _id: { $in: ids } });
    emit(req, 'material:updated', { action: 'deleted', data: { ids } }, ['dashboard', 'inventory']);
    success(res, { deletedCount: result.deletedCount }, 'Materials deleted');
  } catch (err) {
    next(err);
  }
};
