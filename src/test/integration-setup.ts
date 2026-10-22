/**
 * Integration tests run the real services against the Firestore emulator
 * (never a real project): `npm run test:integration` starts it, seeds it and runs
 * the suite. The seed's demo lounges are the fixtures.
 */
if (!process.env.FIRESTORE_EMULATOR_HOST) {
  throw new Error("Integration tests need the Firestore emulator: run `npm run test:integration` (sets FIRESTORE_EMULATOR_HOST).");
}
// Never let a test write to a real project, even if .env holds credentials.
delete process.env.FIREBASE_CLIENT_EMAIL;
delete process.env.FIREBASE_PRIVATE_KEY;
process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID = "demo-gaming-lounge";
process.env.AUTH_SECRET ??= "integration-test-secret-integration-test-secret";
process.env.PAYMENTS_MODE = "mock";
