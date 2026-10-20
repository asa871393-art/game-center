import "server-only";
import { connection } from "next/server";
import { auth } from "@/auth";

/**
 * Session for Server Components. Auth.js touches crypto before it reads the
 * request, which Cache Components rejects during prerendering; awaiting
 * `connection()` first marks the caller as request-time.
 */
export async function getSession() {
  await connection();
  return auth();
}
