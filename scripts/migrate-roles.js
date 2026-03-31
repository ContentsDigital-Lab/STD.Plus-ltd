require('dotenv').config();

const mongoose = require('mongoose');
const env = require('../src/config/env');
const Role = require('../src/models/Role');
const Worker = require('../src/models/Worker');
const { SYSTEM_ROLES } = require('../src/config/permissions');

async function main() {
  await mongoose.connect(env.MONGODB_URI);
  const db = mongoose.connection.db;

  console.log('━━ Seeding system roles ━━');
  const roleMap = {};

  for (const [slug, def] of Object.entries(SYSTEM_ROLES)) {
    let role = await Role.findOne({ slug });
    if (role) {
      role.permissions = def.permissions;
      role.isSystem = def.isSystem;
      role.name = def.name;
      await role.save();
      console.log(`  ✓ Updated existing role: ${slug}`);
    } else {
      role = await Role.create(def);
      console.log(`  ✓ Created role: ${slug}`);
    }
    roleMap[slug] = role._id;
  }

  console.log('\n━━ Migrating workers ━━');
  const workers = await db.collection('workers').find({
    role: { $type: 'string' },
  }).toArray();

  console.log(`  ${workers.length} worker(s) with string role`);
  let updated = 0;

  for (const worker of workers) {
    const roleName = worker.role;
    const roleId = roleMap[roleName];
    if (!roleId) {
      console.warn(`  ⚠  Worker "${worker.username}" has unknown role "${roleName}" — assigning "worker"`);
      await db.collection('workers').updateOne(
        { _id: worker._id },
        { $set: { role: roleMap.worker } },
      );
    } else {
      await db.collection('workers').updateOne(
        { _id: worker._id },
        { $set: { role: roleId } },
      );
    }
    updated++;
    console.log(`  ✓ ${worker.username}: "${roleName}" → ${roleId || roleMap.worker}`);
  }

  console.log(`\n━━ Done ━━  ${Object.keys(roleMap).length} role(s) seeded, ${updated} worker(s) migrated.`);
  process.exit(0);
}

main().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
