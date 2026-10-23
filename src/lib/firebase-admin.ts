import "server-only";
import { cert, deleteApp, getApp, getApps, initializeApp, type App } from "firebase-admin/app";
import type { Auth } from "firebase-admin/auth";
import { getFirestore, type Firestore } from "firebase-admin/firestore";
import { getStorage, type Storage } from "firebase-admin/storage";
import { env, firebaseAdminConfig } from "@/lib/env";

/**
 * Firebase Admin SDK for Server Actions and route handlers, authenticated with a service
 * account (FIREBASE_CLIENT_EMAIL + FIREBASE_PRIVATE_KEY). Bypasses Security Rules, so only
 * call it after the app's own permission checks. Initialized lazily and once per process
 * (the named app survives dev hot reloads via getApps()).
 *
 * With FIRESTORE_EMULATOR_HOST set (tests, local dev without a project) no credentials are
 * needed; the SDK talks to the emulator.
 */
const APP_NAME = "gaming-lounge-admin";
const EMULATOR_PROJECT_ID = "demo-gaming-lounge";

export class FirebaseAdminNotConfiguredError extends Error {
  constructor(options?: { cause?: unknown }) {
    super(
      options?.cause
        ? "Firebase Admin credentials are invalid. Check FIREBASE_CLIENT_EMAIL and FIREBASE_PRIVATE_KEY (the full PEM, with literal \\n line breaks) in the environment."
        : "Firebase Admin is not configured. Set NEXT_PUBLIC_FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL and FIREBASE_PRIVATE_KEY in .env (or FIRESTORE_EMULATOR_HOST for the emulator).",
      options,
    );
    this.name = "FirebaseAdminNotConfiguredError";
  }
}

const usesEmulator = () => Boolean(process.env.FIRESTORE_EMULATOR_HOST);

export const isFirebaseAdminConfigured = firebaseAdminConfig !== null || usesEmulator();

export function getAdminApp(): App {
  if (getApps().some((a) => a.name === APP_NAME)) return getApp(APP_NAME);
  // The emulator wins over service-account credentials, so every process in a run (seed, tests)
  // uses the same emulator project; `firebase emulators:exec` sets GCLOUD_PROJECT.
  if (usesEmulator()) {
    const projectId = process.env.GCLOUD_PROJECT ?? env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ?? EMULATOR_PROJECT_ID;
    return initializeApp({ projectId }, APP_NAME);
  }
  if (firebaseAdminConfig) {
    const { projectId, clientEmail, privateKey, storageBucket } = firebaseAdminConfig;
    // cert() rejects a malformed key synchronously; surface it as a configuration error callers can handle.
    let credential;
    try {
      credential = cert({ projectId, clientEmail, privateKey });
    } catch (cause) {
      throw new FirebaseAdminNotConfiguredError({ cause });
    }
    return initializeApp({ credential, projectId, storageBucket }, APP_NAME);
  }
  throw new FirebaseAdminNotConfiguredError();
}

/**
 * Loaded on demand: firebase-admin/auth pulls in jwks-rsa, which require()s the ESM-only jose and
 * crashes on runtimes without require(esm) (Netlify's functions), taking every Firestore call with it.
 */
export async function getAdminAuth(): Promise<Auth> {
  const { getAuth } = await import("firebase-admin/auth");
  return getAuth(getAdminApp());
}

const globalForFirestore = globalThis as unknown as { adminFirestore?: Firestore };

export function getAdminDb(): Firestore {
  if (globalForFirestore.adminFirestore) return globalForFirestore.adminFirestore;
  const db = getFirestore(getAdminApp());
  // settings() may only be called once per instance, before first use.
  db.settings({ ignoreUndefinedProperties: true });
  globalForFirestore.adminFirestore = db;
  return db;
}

/** Closes the Admin app (scripts and tests, so the process can exit). The next call reconnects. */
export async function closeAdminApp(): Promise<void> {
  globalForFirestore.adminFirestore = undefined;
  const app = getApps().find((a) => a.name === APP_NAME);
  if (app) await deleteApp(app);
}

export function getAdminStorage(): Storage {
  return getStorage(getAdminApp());
}
