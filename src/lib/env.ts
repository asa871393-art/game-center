import "server-only";
import { z } from "zod";

/** Unset, empty or blank all mean "not configured" (.env.example ships empty placeholders). */
const optionalString = z
  .string()
  .optional()
  .transform((v) => v?.trim() || undefined);

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z.url(),
  AUTH_SECRET: z.string().min(32, "AUTH_SECRET must be at least 32 characters"),
  /** Google OAuth is enabled only when both are set (GOOGLE_CLIENT_* or Auth.js's AUTH_GOOGLE_* names). */
  GOOGLE_CLIENT_ID: optionalString,
  GOOGLE_CLIENT_SECRET: optionalString,
  AUTH_GOOGLE_ID: optionalString,
  AUTH_GOOGLE_SECRET: optionalString,
  NEXT_PUBLIC_APP_URL: z.url().default("http://localhost:3000"),
  /** Firebase (optional). Admin SDK = project id + service-account email + private key; uploads also need the bucket. */
  NEXT_PUBLIC_FIREBASE_PROJECT_ID: optionalString,
  NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET: optionalString,
  FIREBASE_CLIENT_EMAIL: optionalString,
  FIREBASE_PRIVATE_KEY: optionalString,
  /**
   * "mock" routes ZainCash/FastPay through the in-app sandbox gateway.
   * "disabled" hides online payment methods. Real providers plug in later.
   */
  PAYMENTS_MODE: z.enum(["mock", "disabled"]).default("mock"),
  /** Minutes an unpaid online booking holds its slot. */
  PAYMENT_HOLD_MINUTES: z.coerce.number().int().min(5).max(60).default(15),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error("Invalid environment variables:", z.flattenError(parsed.error).fieldErrors);
  throw new Error("Invalid environment variables");
}

export const env = parsed.data;

export const googleOAuth = {
  clientId: env.GOOGLE_CLIENT_ID ?? env.AUTH_GOOGLE_ID,
  clientSecret: env.GOOGLE_CLIENT_SECRET ?? env.AUTH_GOOGLE_SECRET,
};

export const isGoogleAuthEnabled = Boolean(googleOAuth.clientId && googleOAuth.clientSecret);

/** Service-account credentials for the Admin SDK, or null when Firebase isn't configured. */
export const firebaseAdminConfig =
  env.NEXT_PUBLIC_FIREBASE_PROJECT_ID && env.FIREBASE_CLIENT_EMAIL && env.FIREBASE_PRIVATE_KEY
    ? {
        projectId: env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
        clientEmail: env.FIREBASE_CLIENT_EMAIL,
        // .env files usually hold the PEM on one line with literal "\n"; strip optional wrapping quotes too.
        privateKey: env.FIREBASE_PRIVATE_KEY.replace(/^"|"$/g, "").replace(/\\n/g, "\n"),
        storageBucket: env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
      }
    : null;

/** Product-image uploads go through the Admin SDK, so they need its credentials plus a bucket. */
export const isFirebaseStorageEnabled = Boolean(firebaseAdminConfig?.storageBucket);
