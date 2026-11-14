import { Prisma, PrismaClient } from '@prisma/client';
import { hash } from 'bcryptjs';

// Must match prisma/seed.ts and the LoginDto limits.
const SALT_ROUNDS = 12;
const MIN_PASSWORD_LENGTH = 12;
const MAX_PASSWORD_LENGTH = 128;

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is required to reset the admin credentials.`);
  }
  return value;
}

async function main(): Promise<void> {
  const username = requireEnv('ADMIN_USERNAME');
  const email = requireEnv('ADMIN_EMAIL').toLowerCase();
  const password = requireEnv('ADMIN_PASSWORD');

  if (username.length > 50) {
    throw new Error('ADMIN_USERNAME must be 50 characters or fewer.');
  }
  if (email.length > 254 || !EMAIL_PATTERN.test(email)) {
    throw new Error('ADMIN_EMAIL is not a valid email address.');
  }
  if (password.length < MIN_PASSWORD_LENGTH || password.length > MAX_PASSWORD_LENGTH) {
    throw new Error(
      `ADMIN_PASSWORD must be between ${MIN_PASSWORD_LENGTH} and ${MAX_PASSWORD_LENGTH} characters.`,
    );
  }

  const prisma = new PrismaClient();
  try {
    const passwordHash = await hash(password, SALT_ROUNDS);

    const result = await prisma.$transaction(async (tx) => {
      const byUsername = await tx.admin.findUnique({ where: { username } });
      const byEmail = await tx.admin.findUnique({ where: { email } });

      // Refuse to merge two different accounts; nothing is written.
      if (byUsername && byEmail && byUsername.id !== byEmail.id) {
        throw new Error(
          `Username "${username}" and email "${email}" belong to different admin accounts. Nothing was changed.`,
        );
      }

      const existing = byUsername ?? byEmail;

      if (!existing) {
        const created = await tx.admin.create({
          data: { username, email, passwordHash },
          select: { id: true, username: true, email: true },
        });
        return { action: 'created' as const, admin: created };
      }

      // Reuse the matched row so no duplicate admin is created.
      const updated = await tx.admin.update({
        where: { id: existing.id },
        data: { username, email, passwordHash },
        select: { id: true, username: true, email: true },
      });
      return { action: 'updated' as const, admin: updated };
    });

    console.log(
      `Admin "${result.admin.username}" (${result.admin.email}) ${result.action}; password hash refreshed.`,
    );
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      throw new Error(
        'Another admin already uses that username or email. Nothing was changed.',
      );
    }
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  // Only the message is printed: never the password or the hash.
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
