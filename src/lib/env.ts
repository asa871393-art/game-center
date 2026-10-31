import "server-only";
import { z } from "zod";

/** Unset, empty or blank all mean "not configured" (.env.example ships empty placeholders). */
const optionalString = z
  .string()
  .optional()
  .transform((v) => v?.trim() || undefined);

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  /** Signs session JWTs. NEXTAUTH_SECRET (the Auth.js v4 name) is accepted when AUTH_SECRET is unset. */
  AUTH_SECRET: optionalString,
  NEXTAUTH_SECRET: optionalString,
  NEXT_PUBLIC_APP_URL: z.url().default("http://localhost:3000"),
  /**
   * Firebase. Firestore is the database: the Admin SDK needs project id + service-account email + private key
   * at runtime (or FIRESTORE_EMULATOR_HOST). Optional here so builds need no secrets; uploads also need the bucket.
   */
  NEXT_PUBLIC_FIREBASE_PROJECT_ID: optionalString,
  NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET: optionalString,
  FIREBASE_CLIENT_EMAIL: optionalString,
  FIREBASE_PRIVATE_KEY: optionalString,
  /** The one branch this deployment runs (a lounge id). Unset: the oldest lounge. */
  PRIMARY_LOUNGE_ID: optionalString,
});

const MIN_SECRET_LENGTH = 32;
/** The value shipped in .env.example; public, so never a real secret. */
const PLACEHOLDER_SECRET = "replace-with-a-32+-character-random-string";

const parsed = envSchema
  .superRefine((e, ctx) => {
    const secret = e.AUTH_SECRET ?? e.NEXTAUTH_SECRET;
    if (!secret || secret.length < MIN_SECRET_LENGTH || secret === PLACEHOLDER_SECRET) {
      ctx.addIssue({
        code: "custom",
        path: ["AUTH_SECRET"],
        message: `Set AUTH_SECRET (or NEXTAUTH_SECRET) to a random string of at least ${MIN_SECRET_LENGTH} characters: npx auth secret, or openssl rand -base64 32`,
      });
    }
  })
  .safeParse(process.env);

if (!parsed.success) {
  console.error("Invalid environment variables:", z.flattenError(parsed.error).fieldErrors);
  throw new Error("Invalid environment variables");
}

export const env = parsed.data;

/** The session-signing secret, under whichever name the deployment set it. */
export const authSecret: string = (env.AUTH_SECRET ?? env.NEXTAUTH_SECRET)!;

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
