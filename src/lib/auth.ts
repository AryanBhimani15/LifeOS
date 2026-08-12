import NextAuth, { type DefaultSession } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { PrismaAdapter } from "@auth/prisma-adapter";
import { db } from "@/lib/db";
import { accountExists } from "@/lib/authz";
import { DUMMY_HASH, verifyPassword } from "@/lib/password";
import { credentialsSchema } from "@/lib/validation/auth";
import { recordAudit } from "@/lib/audit";
import { consumeRateLimit } from "@/lib/rate-limit";

/**
 * Auth.js configuration.
 *
 * Session strategy is JWT rather than database-backed: the Credentials provider
 * cannot issue database sessions in Auth.js v5. The Prisma adapter is still
 * wired up so user records live in our schema and adding an OAuth provider
 * later does not require a migration.
 */

declare module "next-auth" {
  interface Session {
    user: { id: string } & DefaultSession["user"];
  }
}

if (!process.env.AUTH_SECRET) {
  throw new Error("AUTH_SECRET is not set. Generate one with: openssl rand -base64 32");
}

export { hashPassword, verifyPassword } from "@/lib/password";

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: PrismaAdapter(db),
  session: { strategy: "jwt", maxAge: 60 * 60 * 24 * 30 },
  pages: { signIn: "/login" },
  trustHost: true,
  providers: [
    Credentials({
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(raw) {
        const parsed = credentialsSchema.safeParse(raw);
        if (!parsed.success) return null;

        const { email, password } = parsed.data;
        const normalized = email.trim().toLowerCase();

        // Throttle by email so password spraying against one account is capped
        // regardless of source address.
        const limit = await consumeRateLimit(`login:${normalized}`, {
          limit: 8,
          windowMs: 15 * 60 * 1000,
        });
        if (!limit.allowed) return null;

        const user = await db.user.findUnique({ where: { email: normalized } });

        // Always run a comparison, even with no user, to keep timing flat.
        const ok = await verifyPassword(password, user?.passwordHash ?? DUMMY_HASH);

        if (!user || !user.passwordHash || !ok) {
          await recordAudit({
            userId: user?.id ?? null,
            action: "LOGIN_FAILED",
            summary: `Failed sign-in for ${normalized}`,
          });
          return null;
        }

        await recordAudit({
          userId: user.id,
          action: "LOGIN",
          summary: "Signed in with email and password",
        });

        return { id: user.id, email: user.email, name: user.name, image: user.image };
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user?.id) token.sub = user.id;
      return token;
    },
    async session({ session, token }) {
      // Leaving `id` unset is what marks a session as signed-out to every
      // consumer, so a cookie naming a user who no longer exists resolves to
      // "not signed in" rather than to an id that breaks the next query.
      if (token.sub && (await accountExists(token.sub))) session.user.id = token.sub;
      return session;
    },
  },
});

/**
 * Returns the signed-in user's id, or null.
 *
 * Route handlers should use `requireUserId` from src/lib/api.ts instead — it
 * throws the correct 401 rather than making every caller remember to check.
 */
export async function currentUserId(): Promise<string | null> {
  const session = await auth();
  return session?.user?.id ?? null;
}
