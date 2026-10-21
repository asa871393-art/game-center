import "server-only";
import { cert, getApp, getApps, initializeApp, type App } from "firebase-admin/app";
import { getAuth, type Auth } from "firebase-admin/auth";
import { getFirestore, type Firestore } from "firebase-admin/firestore";
import { getStorage, type Storage } from "firebase-admin/storage";
import { firebaseAdminConfig } from "@/lib/env";

/**
 * Firebase Admin SDK for Server Actions and route handlers, authenticated with a service
 * account (FIREBASE_CLIENT_EMAIL + FIREBASE_PRIVATE_KEY). Bypasses Security Rules, so only
 * call it after the app's own permission checks. Initialized lazily and once per process
 * (the named app survives dev hot reloads via getApps()).
 */
const APP_NAME = "gaming-lounge-admin";

export class FirebaseAdminNotConfiguredError extends Error {
  constructor() {
    super(
      "Firebase Admin is not configured. Set NEXT_PUBLIC_FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL and FIREBASE_PRIVATE_KEY in .env.",
    );
    this.name = "FirebaseAdminNotConfiguredError";
  }
}

export const isFirebaseAdminConfigured = firebaseAdminConfig !== null;

export function getAdminApp(): App {
  if (!firebaseAdminConfig) throw new FirebaseAdminNotConfiguredError();
  if (getApps().some((a) => a.name === APP_NAME)) return getApp(APP_NAME);
  const { projectId, clientEmail, privateKey, storageBucket } = firebaseAdminConfig;
  return initializeApp({ credential: cert({ projectId, clientEmail, privateKey }), projectId, storageBucket }, APP_NAME);
}

export function getAdminAuth(): Auth {
  return getAuth(getAdminApp());
}

export function getAdminDb(): Firestore {
  return getFirestore(getAdminApp());
}

export function getAdminStorage(): Storage {
  return getStorage(getAdminApp());
}
