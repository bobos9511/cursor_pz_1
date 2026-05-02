import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pub = path.join(__dirname, "..", "public");
const indexPath = path.join(pub, "index.html");
const partialDir = path.join(pub, "partials");
const rawIndex = fs.readFileSync(indexPath, "utf8");
if (rawIndex.includes("<!-- @include:partial-")) {
  console.error("extract-index-partials: index.html already uses @include partials; abort.");
  process.exit(1);
}
const lines = rawIndex.split(/\r?\n/);

function slice(a, b) {
  return lines.slice(a - 1, b).join("\n") + "\n";
}

const ranges = [
  ["partial-icons-sprite.html", 33, 71],
  ["partial-chrome-toast.html", 73, 76],
  ["partial-login-and-error.html", 78, 147],
  ["partial-modals-auth.html", 149, 347],
  ["partial-app-shell.html", 349, 1383],
  ["partial-modals-app.html", 1385, 1615],
];

fs.mkdirSync(partialDir, { recursive: true });
for (const [name, a, b] of ranges) {
  fs.writeFileSync(path.join(partialDir, name), slice(a, b), "utf8");
}

const head = lines.slice(0, 31).join("\n");
const scripts = lines.slice(1615).join("\n");

const body = `${head}
<body>
<!-- @include:partial-icons-sprite.html -->

<!-- @include:partial-chrome-toast.html -->

<!-- @include:partial-login-and-error.html -->

<!-- @include:partial-modals-auth.html -->

<!-- @include:partial-app-shell.html -->

<!-- @include:partial-modals-app.html -->

${scripts}`;

fs.writeFileSync(indexPath, body, "utf8");
console.log("extract-index-partials: wrote", ranges.length, "partials + slim index.html");
