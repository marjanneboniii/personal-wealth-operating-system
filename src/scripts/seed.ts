import { runSeed } from "@/db/seed";

async function main() {
  console.log("Running manual demo database seed...");
  await runSeed();
  console.log("Seed completed successfully.");
  process.exit(0);
}

main().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
