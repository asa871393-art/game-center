import type { Dictionary } from "@/i18n/dictionaries/ar";

type AuthDict = Dictionary["auth"];

/** Maps an Auth.js error code to its message; v4 names (OAuthCallback, ...) are accepted too. */
export function signInErrorMessage(code: string, auth: AuthDict): string {
  const normalized = code === "OAuthCallback" || code === "OAuthSignin" ? "OAuthCallbackError" : code;
  return Object.hasOwn(auth.signInErrors, normalized)
    ? auth.signInErrors[normalized as keyof AuthDict["signInErrors"]]
    : auth.oauthError;
}
