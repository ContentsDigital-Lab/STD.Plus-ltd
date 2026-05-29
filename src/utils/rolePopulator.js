const mongoose = require('mongoose');
const Role = require('../models/Role');

const SYSTEM_ROLE_PERMISSIONS = {
  admin: ['*'],
  manager: [],
  worker: ['production:view'],
};

const SYSTEM_ROLE_NAMES = {
  admin: 'Admin',
  manager: 'Manager',
  worker: 'Worker',
};

async function populateWorkerRole(worker) {
  if (!worker) return null;

  const workerObj = worker.toObject ? worker.toObject() : worker;
  const roleVal = workerObj.role;

  if (roleVal && typeof roleVal === 'object' && roleVal._id && roleVal.permissions) {
    // Already populated
    return workerObj;
  }

  if (roleVal && mongoose.Types.ObjectId.isValid(roleVal)) {
    const roleDoc = await Role.findById(roleVal);
    if (roleDoc) {
      workerObj.role = roleDoc;
      return workerObj;
    }
  }

  // Fallback to legacy role slugs or fallback to 'worker'
  const slug = roleVal && typeof roleVal === 'string' ? roleVal : 'worker';
  const name = SYSTEM_ROLE_NAMES[slug] || slug;
  const permissions = SYSTEM_ROLE_PERMISSIONS[slug] || [];

  workerObj.role = {
    _id: slug,
    name,
    slug,
    description: `System Built-in ${name} Role`,
    permissions,
    isSystem: true,
  };

  return workerObj;
}

async function populateWorkerRoles(workers) {
  if (!workers) return [];
  if (Array.isArray(workers)) {
    return Promise.all(workers.map(populateWorkerRole));
  }
  return populateWorkerRole(workers);
}

module.exports = {
  populateWorkerRole,
  populateWorkerRoles,
};
