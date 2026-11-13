// Starts the API server (:4300) and the web dashboard (:5173) together.
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const procs = [
  { name: "server", cwd: "server", args: ["run", "start"], color: "\x1b[36m" },
  { name: "web", cwd: "web", args: ["run", "dev"], color: "\x1b[35m" },
];

const children = procs.map(({ name, cwd, args, color }) => {
  const child = spawn("npm", args, { cwd: path.join(root, cwd), shell: true, env: process.env });
  const tag = `${color}[${name}]\x1b[0m `;
  const pipe = (stream, out) =>
    stream.on("data", (d) => d.toString().split(/\r?\n/).filter(Boolean).forEach((l) => out.write(tag + l + "\n")));
  pipe(child.stdout, process.stdout);
  pipe(child.stderr, process.stderr);
  child.on("exit", (code) => console.log(`${tag}exited with code ${code}`));
  return child;
});

console.log("\nSocial MCP Studio starting…  Dashboard: http://localhost:5173   API: http://localhost:4300\n");

const stop = () => {
  for (const c of children) {
    if (process.platform === "win32") spawn("taskkill", ["/pid", String(c.pid), "/t", "/f"], { shell: true });
    else c.kill("SIGTERM");
  }
  setTimeout(() => process.exit(0), 500);
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
