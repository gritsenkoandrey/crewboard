import { statSync, existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const name = process.platform === "win32" ? "crewboard-cli.exe" : "crewboard-cli";
const candidates = ["debug", "release"].map(mode => path.join(root,"src-tauri","target",mode,name)).filter(existsSync).sort((a,b)=>statSync(b).mtimeMs-statSync(a).mtimeMs);
if (!candidates.length) { console.error("CLI is not built. Run npm run agent:build"); process.exit(1); }
const result = spawnSync(candidates[0], process.argv.slice(2), { stdio: "inherit", shell: false });
if (result.error) console.error(result.error.message);
process.exit(result.status ?? 1);
