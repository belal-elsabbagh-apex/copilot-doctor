import { createWriteStream, existsSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { ZipArchive } = require("archiver");

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const dist = join(root, "dist");
const outPath = join(root, "copilot-doctor.zip");

const manifestPath = join(dist, "manifest.json");
if (!existsSync(manifestPath)) {
  console.error("dist/ not found. Run `npm run build` first.");
  process.exit(1);
}

const manifest = JSON.parse(readFileSync(manifestPath, "utf-8"));
const version = manifest.version || "0.0.0";

const output = createWriteStream(outPath);
const archive = new ZipArchive();

output.on("close", () => {
  console.log(`Packaged v${version} → ${outPath} (${archive.pointer()} bytes)`);
});

archive.on("error", (err) => {
  throw err;
});

archive.pipe(output);
archive.directory(dist, false);
archive.finalize();
