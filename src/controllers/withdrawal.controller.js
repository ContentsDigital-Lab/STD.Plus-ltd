const Withdrawal = require('../models/Withdrawal');
const Inventory = require('../models/Inventory');
const Material = require('../models/Material');
const Worker = require('../models/Worker');
const Order = require('../models/Order');
const AppError = require('../utils/AppError');
const { success, fail } = require('../utils/response');
const emit = require('../utils/emitEvent');
const { verifyReferences } = require('../services/integrity');
const paginate = require('../utils/paginate');

const Pane = require('../models/Pane');

const POPULATE_FIELDS = ['order', 'pane', 'withdrawnBy', 'material', 'approvedBy', 'inventory'];

const deductInventory = async (materialId, stockType, quantity, inventoryId = null) => {
  if (inventoryId) {
    const inv = await Inventory.findById(inventoryId);
    if (!inv) throw new AppError('Specific inventory record not found', 404);
    if (inv.material.toString() !== materialId.toString()) throw new AppError('Material mismatch for the specified inventory', 400);
    if (inv.quantity < quantity) {
      throw new AppError(`Insufficient stock in specified inventory. Available: ${inv.quantity}, Requested: ${quantity}`, 400);
    }
    inv.quantity -= quantity;
    await inv.save();
    return;
  }

  const inventories = await Inventory.find({ material: materialId, stockType }).sort({ createdAt: 1 });
  const total = inventories.reduce((sum, inv) => sum + inv.quantity, 0);
  if (total < quantity) {
    throw new AppError(`Insufficient ${stockType} stock. Available: ${total}, Requested: ${quantity}`, 400);
  }
  let remaining = quantity;
  for (const inv of inventories) {
    if (remaining <= 0) break;
    const deduct = Math.min(inv.quantity, remaining);
    inv.quantity -= deduct;
    remaining -= deduct;
    await inv.save();
  }
};

const restoreInventory = async (materialId, stockType, quantity, inventoryId = null) => {
  if (inventoryId) {
    const inv = await Inventory.findById(inventoryId);
    if (inv) {
      inv.quantity += quantity;
      await inv.save();
      return;
    }
  }

  const inventory = await Inventory.findOne({ material: materialId, stockType }).sort({ createdAt: 1 });
  if (inventory) {
    inventory.quantity += quantity;
    await inventory.save();
  }
};

exports.getAll = async (req, res, next) => {
  try {
    const filter = req.user.role === 'worker' ? { withdrawnBy: req.user._id } : {};
    const { data, pagination } = await paginate(Withdrawal, {
      filter,
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
    const withdrawal = await Withdrawal.findById(req.params.id).populate(POPULATE_FIELDS);
    if (!withdrawal) return fail(res, 'Withdrawal not found', 404);
    if (req.user.role === 'worker' && withdrawal.withdrawnBy._id.toString() !== req.user._id.toString()) {
      return fail(res, 'Not authorized', 403);
    }
    success(res, withdrawal);
  } catch (err) {
    next(err);
  }
};

exports.create = async (req, res, next) => {
  try {
    const { material, withdrawnBy, order, approvedBy, pane, quantity, stockType } = req.validated.body;
    await verifyReferences([
      { model: Material, id: material, label: 'Material' },
      { model: Worker, id: withdrawnBy, label: 'Worker (withdrawnBy)' },
      { model: Worker, id: approvedBy, label: 'Worker (approvedBy)' },
      { model: Order, id: order, label: 'Order' },
      { model: Pane, id: pane, label: 'Pane' },
    ]);

    await deductInventory(material, stockType, quantity, req.validated.body.inventory);

    const withdrawal = await Withdrawal.create(req.validated.body);
    const populated = await withdrawal.populate(POPULATE_FIELDS);
    emit(req, 'withdrawal:updated', { action: 'created', data: populated }, ['dashboard', 'withdrawal']);
    emit(req, 'inventory:updated', { action: 'adjusted' }, ['dashboard', 'inventory']);
    success(res, populated, 'Withdrawal created', 201);
  } catch (err) {
    next(err);
  }
};

exports.update = async (req, res, next) => {
  try {
    const oldWithdrawal = await Withdrawal.findById(req.params.id);
    if (!oldWithdrawal) return fail(res, 'Withdrawal not found', 404);

    const updates = req.validated.body;
    const refs = [];
    if (updates.material) refs.push({ model: Material, id: updates.material, label: 'Material' });
    if (updates.withdrawnBy) refs.push({ model: Worker, id: updates.withdrawnBy, label: 'Worker (withdrawnBy)' });
    if (updates.approvedBy) refs.push({ model: Worker, id: updates.approvedBy, label: 'Worker (approvedBy)' });
    if (updates.order) refs.push({ model: Order, id: updates.order, label: 'Order' });
    if (updates.pane) refs.push({ model: Pane, id: updates.pane, label: 'Pane' });
    if (refs.length) await verifyReferences(refs);

    const inventoryAffected = updates.material || updates.stockType || updates.quantity !== undefined;

    if (inventoryAffected) {
      const newMaterial = updates.material || oldWithdrawal.material.toString();
      const newStockType = updates.stockType || oldWithdrawal.stockType;
      const newQuantity = updates.quantity !== undefined ? updates.quantity : oldWithdrawal.quantity;

      await restoreInventory(oldWithdrawal.material, oldWithdrawal.stockType, oldWithdrawal.quantity, oldWithdrawal.inventory);
      try {
        await deductInventory(newMaterial, newStockType, newQuantity, updates.inventory || oldWithdrawal.inventory);
      } catch (err) {
        await deductInventory(oldWithdrawal.material, oldWithdrawal.stockType, oldWithdrawal.quantity, oldWithdrawal.inventory);
        throw err;
      }
    }

    const withdrawal = await Withdrawal.findByIdAndUpdate(req.params.id, updates, {
      returnDocument: 'after',
      runValidators: true,
    }).populate(POPULATE_FIELDS);

    emit(req, 'withdrawal:updated', { action: 'updated', data: withdrawal }, ['dashboard', 'withdrawal']);
    if (inventoryAffected) {
      emit(req, 'inventory:updated', { action: 'adjusted' }, ['dashboard', 'inventory']);
    }
    success(res, withdrawal, 'Withdrawal updated');
  } catch (err) {
    next(err);
  }
};

exports.deleteOne = async (req, res, next) => {
  try {
    const withdrawal = await Withdrawal.findById(req.params.id);
    if (!withdrawal) return fail(res, 'Withdrawal not found', 404);

    await restoreInventory(withdrawal.material, withdrawal.stockType, withdrawal.quantity, withdrawal.inventory);
    await Withdrawal.findByIdAndDelete(req.params.id);

    emit(req, 'withdrawal:updated', { action: 'deleted', data: withdrawal }, ['dashboard', 'withdrawal']);
    emit(req, 'inventory:updated', { action: 'adjusted' }, ['dashboard', 'inventory']);
    success(res, null, 'Withdrawal deleted');
  } catch (err) {
    next(err);
  }
};

exports.deleteMany = async (req, res, next) => {
  try {
    const { ids } = req.validated.body;
    const withdrawals = await Withdrawal.find({ _id: { $in: ids } });

    for (const w of withdrawals) {
      await restoreInventory(w.material, w.stockType, w.quantity, w.inventory);
    }

    const result = await Withdrawal.deleteMany({ _id: { $in: ids } });
    emit(req, 'withdrawal:updated', { action: 'deleted', data: { ids } }, ['dashboard', 'withdrawal']);
    emit(req, 'inventory:updated', { action: 'adjusted' }, ['dashboard', 'inventory']);
    success(res, { deletedCount: result.deletedCount }, 'Withdrawals deleted');
  } catch (err) {
    next(err);
  }
};
