/**
 * Grant (or revoke) the admin role.
 * Usage: npm run user:promote -- <email> [admin|user]
 */
import { env } from '../src/config/env.js';
import { setUserRoleByEmail } from '../src/modules/auth/auth.service.js';
import { connectDb, disconnectDb } from '../src/utils/db.js';

const [email, role = 'admin'] = process.argv.slice(2);

if (!email) {
  console.error('Usage: npm run user:promote -- <email> [admin|user]');
  process.exit(1);
}

try {
  await connectDb(env.MONGODB_URI);
  const user = await setUserRoleByEmail(email, role);
  console.log(`${user.email} is now "${user.role}". Their existing sessions were revoked.`);
} catch (err) {
  console.error(`Failed: ${err.message}`);
  process.exitCode = 1;
} finally {
  await disconnectDb();
}
