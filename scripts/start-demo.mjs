import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const database = spawnSync("docker", ["compose", "up", "-d"], {
  stdio: "inherit",
});
if (database.error || database.status !== 0) {
  console.error("Start Docker Desktop, then run npm run demo again.");
  process.exit(1);
}
console.log(
  "AFTERSHOCK: http://127.0.0.1:3000/workspace — keep this terminal open. Press Ctrl+C to stop.",
);
const app = spawn(
  process.execPath,
  [
    fileURLToPath(
      new URL("../node_modules/next/dist/bin/next", import.meta.url),
    ),
    "dev",
    "--hostname",
    "127.0.0.1",
  ],
  { stdio: "inherit" },
);
app.on("error", (error) => {
  console.error(error.message);
  process.exitCode = 1;
});
app.on("exit", (code) => {
  process.exitCode = code ?? 0;
});
process.on("SIGINT", () => app.kill("SIGINT"));
process.on("SIGTERM", () => app.kill("SIGTERM"));
