#!/usr/bin/env node
// Assembles the public pages that the Worker serves as static assets (wrangler.toml [assets] -> ../site):
//
//   /           hub/index.html                                  showcase of Demos 1, 2 and 4
//   /dewlane/   demos/04-skincare-studio/landing/index.html      Demo 4 page with the "Talk to Elena" widget
//
// wrangler runs this automatically before every `wrangler dev` and `wrangler deploy` ([build] in wrangler.toml),
// so edit the source files above, never site/ (it's generated and git-ignored). Node 18+, no dependencies.
import { cpSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const site = join(root, "site");
const pages = [
  ["hub/index.html", "index.html"],
  ["demos/04-skincare-studio/landing/index.html", "dewlane/index.html"],
];

rmSync(site, { recursive: true, force: true });
for (const [from, to] of pages) {
  mkdirSync(dirname(join(site, to)), { recursive: true });
  cpSync(join(root, from), join(site, to));
}
console.log(`site/: ${pages.map(([, to]) => "/" + to.replace(/index\.html$/, "")).join("  ")}`);
