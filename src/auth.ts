import "server-only";
import "next-auth/jwt";
import bcrypt from "bcryptjs";
import NextAuth, { type DefaultSession } from "next-auth";
import type { Provider } from "next-auth/providers";
import Credentials from "next-auth/providers/credentials";
import Google from "next-auth/providers/google";
import { z } from "zod";
import type { Role } from "@/lib/db/types";
import { env, googleOAuth, isGoogleAuthEnabled } from "@/lib/env";
import { firestoreAdapter } from "@/server/auth-adapter";
import { db } from "@/server/db";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      role: Role;
      /** How this session signed in: "credentials" or "google". */
      provider?: string;
    } & DefaultSession["user"];
  }
  interface User {
    role?: Role;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    id?: string;
    role?: Role;
    provider?: string;
  }
}

/** bcrypt hash of a throwaway string, compared when the email is unknown so response time doesn't reveal it. */
const DUMMY_HASH = "$2b$12$zdQSIdJfkheXRPdC7MXAGuDXdwFdCIBV2z2PugIMZviAtslfdpvKW";

export const credentialsSchema = z.object({
  email: z.email().trim().toLowerCase(),
  password: z.string().min(8).max(128),
});

const providers: Provider[] = [
  Credentials({
    credentials: { email: {}, password: {} },
    async authorize(raw) {
      const parsed = credentialsSchema.safeParse(raw);
      if (!parsed.success) return null;
      const user = await db.user.findUnique({ where: { email: parsed.data.email } });
      // Compare against a dummy hash when the user is missing to keep timing uniform.
      const hash = user?.passwordHash ?? DUMMY_HASH;
      const valid = await bcrypt.compare(parsed.data.password, hash);
      if (!user || !user.passwordHash || !valid || !user.isActive) return null;
      return { id: user.id, name: user.name, email: user.email, image: user.image, role: user.role };
    },
  }),
];

if (isGoogleAuthEnabled) {
  providers.push(
    Google({
      clientId: googleOAuth.clientId,
      clientSecret: googleOAuth.clientSecret,
      // Link to an existing account with the same email. Safe only because signIn below
      // requires a Google-verified email and linkAccount drops unverified passwords.
      allowDangerousEmailAccountLinking: true,
    }),
  );
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: firestoreAdapter(),
  // Credentials sign-in requires JWT sessions.
  session: { strategy: "jwt" },
  secret: env.AUTH_SECRET,
  trustHost: true,
  providers,
  pages: { signIn: "/ar/login", error: "/ar/login" },
  callbacks: {
    async jwt({ token, user, account, trigger }) {
      if (user?.id) {
        token.id = user.id;
        if (account) token.provider = account.provider;
        // OAuth users come from the adapter without our custom fields.
        token.role = user.role ?? (await db.user.findUnique({ where: { id: user.id }, select: { role: true } }))?.role;
      } else if (trigger === "update" && token.id) {
        token.role = (await db.user.findUnique({ where: { id: token.id }, select: { role: true } }))?.role;
      }
      return token;
    },
    session({ session, token }) {
      if (token.id) session.user.id = token.id;
      session.user.role = token.role ?? "CUSTOMER";
      if (token.provider) session.user.provider = token.provider;
      return session;
    },
    async signIn({ user, account, profile }) {
      if (account?.provider === "credentials") return true;
      // Only addresses Google has verified may create or link an account.
      if (account?.provider === "google" && profile?.email_verified !== true) return false;
      // Block OAuth sign-in for deactivated accounts.
      if (!user.email) return false;
      const existing = await db.user.findUnique({ where: { email: user.email }, select: { isActive: true } });
      return existing?.isActive ?? true;
    },
  },
  events: {
    /**
     * Runs when a Google account is attached, to a new user (created by the adapter with the
     * schema default role CUSTOMER) or an existing one with the same email. Registration doesn't
     * verify emails, so a password set on a never-verified account may belong to someone who
     * registered this address first; drop it so only the Google-verified owner can sign in.
     */
    async linkAccount({ user, account }) {
      if (account.provider !== "google" || !user.id) return;
      const current = await db.user.findUnique({ where: { id: user.id }, select: { emailVerified: true } });
      if (!current || current.emailVerified) return;
      await db.user.update({ where: { id: user.id }, data: { emailVerified: new Date(), passwordHash: null } });
    },
  },
});
