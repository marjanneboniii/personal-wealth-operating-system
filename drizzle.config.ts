import "dotenv/config";
import { defineConfig } from "drizzle-kit";

// Push to the same database the app uses. DATABASE_URL is loaded from .env;
// the fallback matches the local default documented in README/.env.example.
// (In `memory://` mode there is nothing to push to — use a real Postgres URL.)
const url = process.env.DATABASE_URL ?? "postgresql://postgres:postgres@127.0.0.1:5432/pwos";

if (url.startsWith("memory://")) {
  throw new Error(
    "drizzle-kit push needs a real PostgreSQL DATABASE_URL — the embedded memory:// database has nothing to push to.",
  );
}

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema.ts",
  dbCredentials: { url },
});
