// Child process that runs the CPU-heavy voice work (Kokoro TTS, whisper alignment) so the API's event
// loop stays responsive. Started by engines.ts via child_process.fork; talks over IPC.
import path from "node:path";
import { pathToFileURL } from "node:url";
import { ROOT_DIR } from "./config.ts";

type Req = { id: number; fn: "synthesizeScenes" | "transcribeWords" | "configure"; args: any[] };

const modPromise = import(pathToFileURL(path.join(ROOT_DIR, "voice", "src", "index.ts")).href);

process.on("message", async (msg: Req) => {
  try {
    const mod: any = await modPromise;
    const result = await mod[msg.fn](...msg.args);
    process.send?.({ id: msg.id, ok: true, result: result ?? null });
  } catch (e: any) {
    process.send?.({ id: msg.id, ok: false, error: String(e?.message ?? e) });
  }
});

process.on("disconnect", () => process.exit(0));
