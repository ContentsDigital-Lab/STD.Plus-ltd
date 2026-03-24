const Inventory = require('../models/Inventory');
const Material = require('../models/Material');
const { success, fail } = require('../utils/response');
const emit = require('../utils/emitEvent');
const { verifyReferences } = require('../services/integrity');
const paginate = require('../utils/paginate');

exports.getAll = async (req, res, next) => {
  try {
    const { data, pagination } = await paginate(Inventory, {
      populate: ['material'],
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

exports.move = async (req, res, next) => {
  try {
    const source = await Inventory.findById(req.params.id).populate('material');
    if (!source) return fail(res, 'Source inventory not found', 404);

    const { quantity, toLocation, toStorageColor } = req.validated.body;

    if (quantity > source.quantity) {
      return fail(res, `Insufficient stock. Available: ${source.quantity}, Requested: ${quantity}`, 400);
    }

    source.quantity -= quantity;
    await source.save();

    let target = await Inventory.findOne({
      material: source.material._id,
      stockType: source.stockType,
      location: toLocation,
    });

    if (target) {
      target.quantity += quantity;
      if (toStorageColor !== undefined) target.storageColor = toStorageColor;
      await target.save();
    } else {
      target = await Inventory.create({
        material: source.material._id,
        stockType: source.stockType,
        quantity,
        location: toLocation,
        storageColor: toStorageColor || '',
      });
    }

    const populatedSource = await source.populate('material');
    const populatedTarget = await target.populate('material');

    emit(req, 'inventory:updated', { action: 'moved', data: { source: populatedSource, target: populatedTarget, quantity } }, ['dashboard', 'inventory']);
    success(res, { source: populatedSource, target: populatedTarget, movedQuantity: quantity }, 'Inventory moved');
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
