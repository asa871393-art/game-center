import type { Dictionary } from "@/i18n/dictionaries/ar";

type AuthDict = Dictionary["auth"];

/** Maps an Auth.js error code (?error=...) to its message, or a generic one. */
export function signInErrorMessage(code: string, auth: AuthDict): string {
  return Object.hasOwn(auth.signInErrors, code) ? auth.signInErrors[code as keyof AuthDict["signInErrors"]] : auth.signInFailed;
}
