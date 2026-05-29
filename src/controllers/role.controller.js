const Role = require('../models/Role');
const { success, fail } = require('../utils/response');
const paginate = require('../utils/paginate');
const emit = require('../utils/emitEvent');

const SYSTEM_PERMISSIONS = [
  'users:view',
  'users:manage',
  'roles:manage',
  'inventory:view',
  'inventory:manage',
  'production:view',
  'production:manage',
  'orders:view',
  'orders:create',
  'orders:manage',
  'settings:view',
  'settings:manage',
  'dashboard:view',
  'stations:manage',
  'stickers:manage'
];

exports.getAll = async (req, res, next) => {
  try {
    const { data, pagination } = await paginate(Role, {
      page: req.query.page,
      limit: req.query.limit,
      sort: req.query.sort || 'createdAt',
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

exports.getPermissions = async (req, res, next) => {
  try {
    success(res, SYSTEM_PERMISSIONS);
  } catch (err) {
    next(err);
  }
};

exports.create = async (req, res, next) => {
  try {
    let { name, slug, description, permissions } = req.body;

    if (!slug) {
      slug = name.toLowerCase()
        .replace(/[^a-z0-9\u0e00-\u0e7f]+/g, '-')
        .replace(/(^-|-$)+/g, '');

      if (!slug || slug === '-') {
        slug = 'role-' + Math.random().toString(36).substring(2, 7);
      }
    }

    // Check if role with this slug already exists
    const existingRole = await Role.findOne({ slug: slug.toLowerCase() });
    if (existingRole) {
      return fail(res, 'Role slug already exists', 409);
    }

    const role = await Role.create({
      name,
      slug: slug.toLowerCase(),
      description,
      permissions: permissions || [],
      isSystem: false
    });
    success(res, role, 'Role created', 201);
  } catch (err) {
    next(err);
  }
};

exports.update = async (req, res, next) => {
  try {
    const { name, slug, description, permissions } = req.body;
    const role = await Role.findById(req.params.id);
    if (!role) return fail(res, 'Role not found', 404);

    if (role.isSystem) {
      // Prevent modification of critical system fields for built-in roles if needed
      // but let's allow editing permissions
    }

    if (name) role.name = name;
    if (slug && !role.isSystem) role.slug = slug.toLowerCase();
    if (description !== undefined) role.description = description;
    if (permissions !== undefined) role.permissions = permissions;

    await role.save();
    emit(req, 'role:updated', { _id: role._id, action: 'updated' });
    success(res, role, 'Role updated');
  } catch (err) {
    if (err.code === 11000) {
      return fail(res, 'Role slug already exists', 409);
    }
    next(err);
  }
};

exports.delete = async (req, res, next) => {
  try {
    const role = await Role.findById(req.params.id);
    if (!role) return fail(res, 'Role not found', 404);
    if (role.isSystem) {
      return fail(res, 'Cannot delete system roles', 400);
    }
    await Role.findByIdAndDelete(req.params.id);
    emit(req, 'role:updated', { _id: req.params.id, action: 'deleted' });
    success(res, null, 'Role deleted');
  } catch (err) {
    next(err);
  }
};
