import { mkdirSync, readFileSync, writeFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const src = path.join(root, ".wiki-build");
const dst = path.join(root, "docs", "guide");
mkdirSync(dst, { recursive: true });

const pages = [
  "Home.md",
  "Getting-Started.md",
  "Sites-and-Projects.md",
  "Services-and-Profiles.md",
  "Debugging.md",
  "Database.md",
  "Share.md",
  "Settings.md",
  "CLI.md",
  "MCP.md",
];

const linkNames =
  "Getting-Started|Sites-and-Projects|Services-and-Profiles|Debugging|Database|Share|Settings|CLI|MCP|Home";

for (const page of pages) {
  let content = readFileSync(path.join(src, page), "utf8");
  content = content.replaceAll("(images/", "(../screenshots/");
  content = content.replace(new RegExp(`\\]\\((${linkNames})\\)`, "g"), (_, name) =>
    name === "Home" ? "](README.md)" : `](${name}.md)`
  );
  const out = page === "Home.md" ? "README.md" : page;
  writeFileSync(path.join(dst, out), content);
}

console.log("Wrote", readdirSync(dst).join(", "));
