const Customer = require('../models/Customer');
const Order = require('../models/Order');
const Request = require('../models/Request');
const Pane = require('../models/Pane');
const Claim = require('../models/Claim');
const Withdrawal = require('../models/Withdrawal');
const Inventory = require('../models/Inventory');
const MaterialLog = require('../models/MaterialLog');
const ProductionLog = require('../models/ProductionLog');
const PaneLog = require('../models/PaneLog');
const { success, fail } = require('../utils/response');
const { cascadeDeleteReferenced, cascadeDeleteManyReferenced } = require('../services/integrity');
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

const REQUEST_CASCADE = [
  { model: Order, field: 'request', cascade: ORDER_CASCADE },
  { model: Pane, field: 'request', cascade: PANE_CASCADE },
];

const CUSTOMER_DEPENDENTS = [
  { model: Order, field: 'customer', cascade: ORDER_CASCADE },
  { model: Request, field: 'customer', cascade: REQUEST_CASCADE },
];

exports.getAll = async (req, res, next) => {
  try {
    const { data, pagination } = await paginate(Customer, {
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
    const customer = await Customer.findById(req.params.id);
    if (!customer) return fail(res, 'Customer not found', 404);
    success(res, customer);
  } catch (err) {
    next(err);
  }
};

exports.create = async (req, res, next) => {
  try {
    const customer = await Customer.create(req.validated.body);
    success(res, customer, 'Customer created', 201);
  } catch (err) {
    next(err);
  }
};

exports.update = async (req, res, next) => {
  try {
    const customer = await Customer.findByIdAndUpdate(req.params.id, req.validated.body, {
      new: true,
      runValidators: true,
    });
    if (!customer) return fail(res, 'Customer not found', 404);
    success(res, customer, 'Customer updated');
  } catch (err) {
    next(err);
  }
};

exports.deleteOne = async (req, res, next) => {
  try {
    await cascadeDeleteReferenced(req.params.id, CUSTOMER_DEPENDENTS);
    const customer = await Customer.findByIdAndDelete(req.params.id);
    if (!customer) return fail(res, 'Customer not found', 404);
    success(res, null, 'Customer deleted');
  } catch (err) {
    next(err);
  }
};

exports.deleteMany = async (req, res, next) => {
  try {
    const { ids } = req.validated.body;
    await cascadeDeleteManyReferenced(ids, CUSTOMER_DEPENDENTS);
    const result = await Customer.deleteMany({ _id: { $in: ids } });
    success(res, { deletedCount: result.deletedCount }, 'Customers deleted');
  } catch (err) {
    next(err);
  }
};
