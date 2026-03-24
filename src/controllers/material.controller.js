const Material = require('../models/Material');
const Inventory = require('../models/Inventory');
const Order = require('../models/Order');
const Claim = require('../models/Claim');
const Withdrawal = require('../models/Withdrawal');
const MaterialLog = require('../models/MaterialLog');
const { success, fail } = require('../utils/response');
const emit = require('../utils/emitEvent');
const { cascadeDeleteReferenced, cascadeDeleteManyReferenced } = require('../services/integrity');
const Pane = require('../models/Pane');
const ProductionLog = require('../models/ProductionLog');
const PaneLog = require('../models/PaneLog');
const paginate = require('../utils/paginate');

const restoreInventory = async (materialId, stockType, quantity) => {
  const inventory = await Inventory.findOne({ material: materialId, stockType }).sort({ createdAt: 1 });
  if (inventory) {
    inventory.quantity += quantity;
    await inventory.save();
  }
};

const PANE_CASCADE = [
  { model: PaneLog, field: 'pane' },
  { model: ProductionLog, field: 'pane' },
  { model: MaterialLog, field: 'pane' },
];

const ORDER_CASCADE = [
  { model: Claim, field: 'order' },
  { model: Withdrawal, field: 'order', beforeDelete: async (docs) => {
    for (const w of docs) await restoreInventory(w.material, w.stockType, w.quantity);
  }},
  { model: MaterialLog, field: 'order' },
  { model: PaneLog, field: 'order' },
  { model: ProductionLog, field: 'order' },
  { model: Pane, field: 'order', cascade: PANE_CASCADE },
];

const MATERIAL_DEPENDENTS = [
  { model: Inventory, field: 'material' },
  { model: Order, field: 'material', cascade: ORDER_CASCADE },
  { model: Claim, field: 'material' },
  { model: Withdrawal, field: 'material', beforeDelete: async (docs) => {
    for (const w of docs) await restoreInventory(w.material, w.stockType, w.quantity);
  }},
  { model: MaterialLog, field: 'material' },
];

exports.getAll = async (req, res, next) => {
  try {
    const { data, pagination } = await paginate(Material, {
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
    await cascadeDeleteReferenced(req.params.id, MATERIAL_DEPENDENTS);
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
    await cascadeDeleteManyReferenced(ids, MATERIAL_DEPENDENTS);
    const result = await Material.deleteMany({ _id: { $in: ids } });
    emit(req, 'material:updated', { action: 'deleted', data: { ids } }, ['dashboard', 'inventory']);
    success(res, { deletedCount: result.deletedCount }, 'Materials deleted');
  } catch (err) {
    next(err);
  }
};
