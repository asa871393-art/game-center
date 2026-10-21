import { getApp, getApps, initializeApp, type FirebaseApp, type FirebaseOptions } from "firebase/app";
import { getAuth, type Auth } from "firebase/auth";
import { getFirestore, type Firestore } from "firebase/firestore";
import { getStorage, type FirebaseStorage } from "firebase/storage";

/**
 * Firebase client SDK (browser). Values must be read as literal `process.env.NEXT_PUBLIC_*`
 * expressions so Next can inline them into the client bundle.
 *
 * Instances are created lazily: importing this module never initializes Firebase, so pages
 * keep working (and prerendering on the server doesn't touch it) when Firebase isn't configured.
 * Note: app sign-in is Auth.js; Firebase Auth here is a separate, optional identity.
 */
const config: FirebaseOptions = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

const REQUIRED = ["apiKey", "authDomain", "projectId", "appId"] as const;

export const isFirebaseClientConfigured = REQUIRED.every((key) => Boolean(config[key]));

export class FirebaseNotConfiguredError extends Error {
  constructor(missing: string[]) {
    super(`Firebase client is not configured. Missing: ${missing.join(", ")} (set NEXT_PUBLIC_FIREBASE_* in .env).`);
    this.name = "FirebaseNotConfiguredError";
  }
}

/** The client app, reusing the existing one across hot reloads (getApps() check). */
export function getFirebaseApp(): FirebaseApp {
  if (!isFirebaseClientConfigured) throw new FirebaseNotConfiguredError(REQUIRED.filter((key) => !config[key]));
  return getApps().length > 0 ? getApp() : initializeApp(config);
}

export function getFirebaseAuth(): Auth {
  return getAuth(getFirebaseApp());
}

export function getDb(): Firestore {
  return getFirestore(getFirebaseApp());
}

export function getFirebaseStorage(): FirebaseStorage {
  return getStorage(getFirebaseApp());
}
