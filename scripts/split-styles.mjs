import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..", "public", "assets");
const src = path.join(root, "styles.css");
const raw = fs.readFileSync(src, "utf8");
if (/^\s*@import\s+url/m.test(raw.trimStart()) && raw.split(/\r?\n/).length < 12) {
  console.error("split-styles: styles.css looks like an import barrel already; abort.");
  process.exit(1);
}
const lines = raw.split(/\r?\n/);

function slice(startLine1, endLine1) {
  return lines.slice(startLine1 - 1, endLine1).join("\n") + "\n";
}

const chunks = [
  ["styles-base.css", 1, 2102],
  ["styles-theme-dark.css", 2103, 3236],
  ["styles-layout-responsive.css", 3237, 4407],
  ["styles-admin.css", 4408, lines.length],
];

for (const [name, a, b] of chunks) {
  fs.writeFileSync(path.join(root, name), slice(a, b), "utf8");
}

const imports = chunks
  .map(([name]) => `@import url("${name}");`)
  .join("\n");
fs.writeFileSync(path.join(root, "styles.css"), imports + "\n", "utf8");

console.log("split-styles:", chunks.map((c) => c.join(" ")).join(" | "));
