"use server";

import bcrypt from "bcryptjs";
import { AuthError } from "next-auth";
import { z } from "zod";
import { credentialsSchema, signIn, signOut } from "@/auth";
import { isLocale, localePath } from "@/i18n/config";
import { getDictionaryFor } from "@/i18n/server";
import { isGoogleAuthEnabled } from "@/lib/env";
import { prisma } from "@/lib/prisma";

export interface AuthFormState {
  error?: string;
  fieldErrors?: Partial<Record<"name" | "email" | "password", string>>;
  values?: { name?: string; email?: string };
}

/** Only allow same-origin relative redirects ("/ar/..."), never "//evil.com". */
function safeRedirect(target: FormDataEntryValue | null, locale: string): string {
  const fallback = localePath(isLocale(locale) ? locale : "ar");
  if (typeof target !== "string" || !target.startsWith("/") || target.startsWith("//") || target.startsWith("/\\")) {
    return fallback;
  }
  return target;
}

export async function signInWithCredentials(_prev: AuthFormState, formData: FormData): Promise<AuthFormState> {
  const locale = String(formData.get("locale") ?? "ar");
  const dict = await getDictionaryFor(locale);
  const email = String(formData.get("email") ?? "");
  const parsed = credentialsSchema.safeParse({ email, password: formData.get("password") });
  if (!parsed.success) return { error: dict.auth.invalidCredentials, values: { email } };

  try {
    await signIn("credentials", { ...parsed.data, redirectTo: safeRedirect(formData.get("callbackUrl"), locale) });
    return {};
  } catch (error) {
    if (error instanceof AuthError) return { error: dict.auth.invalidCredentials, values: { email } };
    throw error; // NEXT_REDIRECT on success
  }
}

const registerSchema = z.object({
  name: z.string().trim().min(2).max(80),
  email: z.email().trim().toLowerCase(),
  password: z.string().min(8).max(128),
});

export async function registerWithCredentials(_prev: AuthFormState, formData: FormData): Promise<AuthFormState> {
  const locale = String(formData.get("locale") ?? "ar");
  const dict = await getDictionaryFor(locale);
  const values = { name: String(formData.get("name") ?? ""), email: String(formData.get("email") ?? "") };
  const parsed = registerSchema.safeParse({ ...values, password: formData.get("password") });

  if (!parsed.success) {
    const fields = z.flattenError(parsed.error).fieldErrors;
    return {
      error: dict.errors.validation,
      values,
      fieldErrors: {
        name: fields.name ? dict.errors.validation : undefined,
        email: fields.email ? dict.errors.validation : undefined,
        password: fields.password ? dict.auth.passwordHint : undefined,
      },
    };
  }

  const existing = await prisma.user.findUnique({ where: { email: parsed.data.email }, select: { id: true } });
  if (existing) return { error: dict.auth.emailTaken, values, fieldErrors: { email: dict.auth.emailTaken } };

  await prisma.user.create({
    data: {
      name: parsed.data.name,
      email: parsed.data.email,
      passwordHash: await bcrypt.hash(parsed.data.password, 12),
      role: "CUSTOMER",
      wallet: { create: {} },
    },
  });

  try {
    await signIn("credentials", {
      email: parsed.data.email,
      password: parsed.data.password,
      redirectTo: safeRedirect(formData.get("callbackUrl"), locale),
    });
    return {};
  } catch (error) {
    if (error instanceof AuthError) return { error: dict.errors.generic, values };
    throw error;
  }
}

export async function signInWithGoogle(formData: FormData): Promise<void> {
  if (!isGoogleAuthEnabled) return;
  const locale = String(formData.get("locale") ?? "ar");
  await signIn("google", { redirectTo: safeRedirect(formData.get("callbackUrl"), locale) });
}

export async function signOutAction(formData: FormData): Promise<void> {
  const locale = String(formData.get("locale") ?? "ar");
  await signOut({ redirectTo: localePath(isLocale(locale) ? locale : "ar") });
}
