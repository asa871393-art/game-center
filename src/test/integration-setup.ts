import "dotenv/config";

const testUrl = process.env.TEST_DATABASE_URL;
if (!testUrl) {
  throw new Error("Set TEST_DATABASE_URL to a migrated, seeded test database (see README).");
}
if (testUrl === process.env.DATABASE_URL) {
  throw new Error("TEST_DATABASE_URL must differ from DATABASE_URL; integration tests write data.");
}
process.env.DATABASE_URL = testUrl;
process.env.PAYMENTS_MODE = "mock";
