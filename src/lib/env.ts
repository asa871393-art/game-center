import "server-only";
import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z.url(),
  AUTH_SECRET: z.string().min(32, "AUTH_SECRET must be at least 32 characters"),
  /** Google OAuth is enabled only when both are set. */
  AUTH_GOOGLE_ID: z.string().min(1).optional(),
  AUTH_GOOGLE_SECRET: z.string().min(1).optional(),
  NEXT_PUBLIC_APP_URL: z.url().default("http://localhost:3000"),
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

export const isGoogleAuthEnabled = Boolean(env.AUTH_GOOGLE_ID && env.AUTH_GOOGLE_SECRET);
