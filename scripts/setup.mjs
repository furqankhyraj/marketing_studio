// Installs dependencies in every package (they are independent npm packages).
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
for (const pkg of ["renderer", "hyperframes", "voice", "server", "web", "mcp"]) {
  console.log(`\n=== npm install in ${pkg}/ ===`);
  const r = spawnSync("npm", ["install"], { cwd: path.join(root, pkg), stdio: "inherit", shell: true });
  if (r.status !== 0) {
    console.error(`npm install failed in ${pkg}/`);
    process.exit(r.status ?? 1);
  }
}
console.log("\nAll packages installed. Run: npm start");
