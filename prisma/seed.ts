import { PrismaClient } from '@prisma/client';
import { hash } from 'bcryptjs';
import { MAX_PASSWORD_BYTES, isPasswordWithinBcryptLimit } from '../src/auth/password';

const SALT_ROUNDS = 12;
const MIN_PASSWORD_LENGTH = 12;

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is required to seed the admin account.`);
  }
  return value;
}

async function main(): Promise<void> {
  const username = requireEnv('ADMIN_USERNAME');
  const email = requireEnv('ADMIN_EMAIL').toLowerCase();
  const password = requireEnv('ADMIN_PASSWORD');

  if (password.length < MIN_PASSWORD_LENGTH) {
    throw new Error(
      `ADMIN_PASSWORD must be at least ${MIN_PASSWORD_LENGTH} characters.`,
    );
  }
  if (!isPasswordWithinBcryptLimit(password)) {
    throw new Error(
      `ADMIN_PASSWORD must be at most ${MAX_PASSWORD_BYTES} UTF-8 bytes (bcrypt limit).`,
    );
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error('ADMIN_EMAIL is not a valid email address.');
  }

  const prisma = new PrismaClient();
  try {
    const passwordHash = await hash(password, SALT_ROUNDS);
    const existing = await prisma.admin.findFirst({
      where: { OR: [{ username }, { email }] },
    });

    if (!existing) {
      await prisma.admin.create({ data: { username, email, passwordHash } });
      console.log(`Seeded admin "${username}".`);
      return;
    }

    // Never overwrite an unrelated account that happens to share the email.
    if (existing.username !== username || existing.email !== email) {
      throw new Error(
        `An admin already exists with username "${existing.username}" or email "${existing.email}". Refusing to overwrite it.`,
      );
    }

    await prisma.admin.update({
      where: { id: existing.id },
      data: { passwordHash },
    });
    console.log(`Admin "${username}" already existed; password hash refreshed.`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
