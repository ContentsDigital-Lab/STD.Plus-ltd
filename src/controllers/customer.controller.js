const Customer = require('../models/Customer');
const { success, fail } = require('../utils/response');

exports.getAll = async (req, res, next) => {
  try {
    const customers = await Customer.find();
    success(res, customers);
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
    const result = await Customer.deleteMany({ _id: { $in: ids } });
    success(res, { deletedCount: result.deletedCount }, 'Customers deleted');
  } catch (err) {
    next(err);
  }
};
