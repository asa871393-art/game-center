import "dotenv/config";
import { defineConfig } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "tsx prisma/seed.ts",
  },
  datasource: {
    // Not env("DATABASE_URL"): that throws when unset, which breaks `prisma generate`
    // (postinstall) on CI/Netlify installs that have no database. Migrate and seed still need it.
    // Migrations take advisory locks, so prefer the direct URL over a transaction-mode pooler.
    url: process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL,
  },
});
