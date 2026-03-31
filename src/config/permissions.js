const ALL_PERMISSIONS = [
  'workers:view',
  'workers:manage',

  'customers:view',
  'customers:manage',

  'materials:view',
  'materials:manage',

  'inventory:view',
  'inventory:move',
  'inventory:manage',

  'material_logs:view',
  'material_logs:manage',

  'requests:view',
  'requests:manage',

  'orders:view',
  'orders:create',
  'orders:manage',

  'claims:view',
  'claims:create',
  'claims:approve',
  'claims:manage',

  'panes:view',
  'panes:create',
  'panes:scan',
  'panes:manage',

  'pane_logs:view',

  'production_logs:view',
  'production_logs:create',
  'production_logs:manage',

  'stations:view',
  'stations:manage',

  'station_templates:view',
  'station_templates:manage',

  'sticker_templates:view',
  'sticker_templates:manage',

  'job_types:view',
  'job_types:manage',

  'pricing:view',
  'pricing:manage',

  'notifications:view',
  'notifications:create',
  'notifications:manage',

  'withdrawals:view',
  'withdrawals:create',
  'withdrawals:manage',

  'roles:view',
  'roles:manage',
];

const SYSTEM_ROLES = {
  admin: {
    name: 'Admin',
    slug: 'admin',
    permissions: ['*'],
    isSystem: true,
  },
  manager: {
    name: 'Manager',
    slug: 'manager',
    permissions: ALL_PERMISSIONS.filter(p => !['workers:manage', 'roles:manage'].includes(p)),
    isSystem: true,
  },
  worker: {
    name: 'Worker',
    slug: 'worker',
    permissions: [
      'workers:view',
      'customers:view',
      'materials:view',
      'inventory:view',
      'inventory:move',
      'material_logs:view',
      'requests:view',
      'orders:view',
      'claims:view',
      'claims:create',
      'panes:view',
      'panes:scan',
      'pane_logs:view',
      'production_logs:view',
      'production_logs:create',
      'stations:view',
      'station_templates:view',
      'sticker_templates:view',
      'job_types:view',
      'pricing:view',
      'notifications:view',
      'withdrawals:view',
      'withdrawals:create',
      'roles:view',
    ],
    isSystem: true,
  },
};

const hasPermission = (user, ...perms) => {
  const userPerms = user.role?.permissions || [];
  if (userPerms.includes('*')) return true;
  return perms.every(p => userPerms.includes(p));
};

module.exports = { ALL_PERMISSIONS, SYSTEM_ROLES, hasPermission };
