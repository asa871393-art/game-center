import "server-only";
import "next-auth/jwt";
import NextAuth, { type DefaultSession } from "next-auth";
import type { Provider } from "next-auth/providers";
import Google from "next-auth/providers/google";
import type { Role } from "@/lib/db/types";
import { authSecret, googleOAuth, isGoogleAuthEnabled } from "@/lib/env";
import { firestoreAdapter } from "@/server/auth-adapter";
import { db } from "@/server/db";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      role: Role;
      /** How this session signed in: always "google". */
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

/**
 * Google is the only way in. Staff are pre-registered by email (dashboard or `npm run staff:grant`);
 * their first Google sign-in links to that account, so it keeps its role.
 */
const providers: Provider[] = isGoogleAuthEnabled
  ? [
      Google({
        clientId: googleOAuth.clientId,
        clientSecret: googleOAuth.clientSecret,
        // Link to an existing account with the same email. Safe only because signIn below
        // requires a Google-verified email and linkAccount drops unverified passwords.
        allowDangerousEmailAccountLinking: true,
      }),
    ]
  : [];

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: firestoreAdapter(),
  // JWT sessions: the adapter stores users and accounts only.
  session: { strategy: "jwt" },
  // AUTH_SECRET, or NEXTAUTH_SECRET on deployments configured with the v4 name.
  secret: authSecret,
  // Take the host from the request (Netlify's deploy and branch URLs); AUTH_URL / NEXTAUTH_URL override it.
  trustHost: true,
  providers,
  pages: { signIn: "/ar/pos/login", error: "/ar/pos/login" },
  callbacks: {
    async jwt({ token, user, account, profile, trigger }) {
      if (user?.id) {
        token.id = user.id;
        if (account) token.provider = account.provider;
        // OAuth users come from the adapter without our custom fields.
        const stored = await db.user.findUnique({ where: { id: user.id }, select: { role: true, name: true, image: true } });
        token.role = user.role ?? stored?.role;
        // The adapter only copies the Google profile on first sign-in; keep the avatar current after
        // that and fill a missing name, but keep a name an admin entered (e.g. for pre-registered staff).
        if (account?.provider === "google" && stored) {
          const image = typeof profile?.picture === "string" ? profile.picture : null;
          const name = stored.name ?? profile?.name ?? null;
          if ((image && image !== stored.image) || name !== stored.name) {
            await db.user.update({ where: { id: user.id }, data: { ...(image ? { image } : {}), name } });
          }
          token.picture = image ?? stored.image;
          token.name = name;
        }
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
      // Only Google, and only addresses Google has verified, may create or link an account.
      if (account?.provider !== "google" || profile?.email_verified !== true) return false;
      // Block OAuth sign-in for deactivated accounts.
      if (!user.email) return false;
      const existing = await db.user.findUnique({ where: { email: user.email.toLowerCase() }, select: { isActive: true } });
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
