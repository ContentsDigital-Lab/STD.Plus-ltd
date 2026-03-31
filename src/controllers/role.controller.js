const Role = require('../models/Role');
const Worker = require('../models/Worker');
const { success, fail } = require('../utils/response');
const { ALL_PERMISSIONS } = require('../config/permissions');
const paginate = require('../utils/paginate');

exports.getAll = async (req, res, next) => {
  try {
    const { data, pagination } = await paginate(Role, {
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
    const role = await Role.findById(req.params.id);
    if (!role) return fail(res, 'Role not found', 404);
    success(res, role);
  } catch (err) {
    next(err);
  }
};

exports.getPermissions = async (req, res) => {
  success(res, ALL_PERMISSIONS, 'All available permissions');
};

exports.create = async (req, res, next) => {
  try {
    const { name, slug, permissions } = req.validated.body;
    const role = await Role.create({ name, slug, permissions });
    success(res, role, 'Role created', 201);
  } catch (err) {
    if (err.code === 11000) return fail(res, 'Role slug already exists', 409);
    next(err);
  }
};

exports.update = async (req, res, next) => {
  try {
    const existing = await Role.findById(req.params.id);
    if (!existing) return fail(res, 'Role not found', 404);
    if (existing.isSystem) {
      const { permissions } = req.validated.body;
      if (req.validated.body.slug && req.validated.body.slug !== existing.slug) {
        return fail(res, 'Cannot change slug of a system role', 400);
      }
      const updates = {};
      if (req.validated.body.name) updates.name = req.validated.body.name;
      if (permissions) updates.permissions = permissions;
      const role = await Role.findByIdAndUpdate(req.params.id, updates, { new: true, runValidators: true });
      return success(res, role, 'System role updated');
    }
    const role = await Role.findByIdAndUpdate(req.params.id, req.validated.body, { new: true, runValidators: true });
    success(res, role, 'Role updated');
  } catch (err) {
    if (err.code === 11000) return fail(res, 'Role slug already exists', 409);
    next(err);
  }
};

exports.deleteOne = async (req, res, next) => {
  try {
    const role = await Role.findById(req.params.id);
    if (!role) return fail(res, 'Role not found', 404);
    if (role.isSystem) return fail(res, 'Cannot delete a system role', 400);

    const workerCount = await Worker.countDocuments({ role: role._id });
    if (workerCount > 0) {
      return fail(res, `Cannot delete: ${workerCount} worker(s) still assigned to this role`, 400);
    }

    await Role.findByIdAndDelete(req.params.id);
    success(res, null, 'Role deleted');
  } catch (err) {
    next(err);
  }
};

exports.deleteMany = async (req, res, next) => {
  try {
    const { ids } = req.validated.body;

    const systemRoles = await Role.find({ _id: { $in: ids }, isSystem: true });
    if (systemRoles.length > 0) {
      return fail(res, `Cannot delete system role(s): ${systemRoles.map(r => r.name).join(', ')}`, 400);
    }

    const assignedCount = await Worker.countDocuments({ role: { $in: ids } });
    if (assignedCount > 0) {
      return fail(res, `Cannot delete: ${assignedCount} worker(s) still assigned to these roles`, 400);
    }

    const result = await Role.deleteMany({ _id: { $in: ids } });
    success(res, { deletedCount: result.deletedCount }, 'Roles deleted');
  } catch (err) {
    next(err);
  }
};
