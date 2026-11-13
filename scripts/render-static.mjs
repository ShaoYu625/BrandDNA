import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import nunjucks from "nunjucks";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const templatesDir = path.join(root, "pages", "templates");
const staticDir = path.join(root, "pages", "static");
const publicDir = path.join(root, "pages", "public");
const publicStaticDir = path.join(publicDir, "static");

const pages = [
  ...["", "dashboard", "data-hub", "diagnosis", "generate", "calendar", "orders", "menu", "analytics", "members", "settings", "guide", "login", "register", "gatekeeper", "simulation", "posts", "sources"].map(route => ({ route: `/${route}`, template: "truck.html", output: route ? path.join(route, "index.html") : "index.html" })),
  { route: "/order", template: "order.html", output: path.join("order", "index.html") },
  ...[["", "plan_select.html"],["dashboard", "overview.html"],["data-hub", "data_hub.html"],["diagnosis", "diagnosis.html"],["generate", "generate.html"],["gatekeeper", "gatekeeper.html"]].map(([route, template]) => ({route:`/legacy/${route}`,template,output:path.join("legacy",route,"index.html")}))
];

const env = new nunjucks.Environment(new nunjucks.FileSystemLoader(templatesDir, {
  noCache: true
}), {
  autoescape: false,
  throwOnUndefined: false,
  trimBlocks: false,
  lstripBlocks: false
});

env.addGlobal("range", (start, end, step = 1) => {
  const out = [];
  for (let index = start; step > 0 ? index < end : index > end; index += step) out.push(index);
  return out;
});

fs.mkdirSync(publicDir, { recursive: true });
fs.rmSync(publicStaticDir, { recursive: true, force: true });
fs.cpSync(staticDir, publicStaticDir, { recursive: true });

// Versioned truck bundle: every .mjs/.css is copied to /static/truck/b/<content hash>/ so browsers can cache it
// for a year (see _headers) and still pick up each deploy. Relative imports between the modules keep working.
const truckDir = path.join(staticDir, "truck");
const bundleFiles = [
  ...fs.readdirSync(truckDir).filter(name => /\.(mjs|css)$/.test(name)),
  ...fs.readdirSync(path.join(truckDir, "vendor")).filter(name => name.endsWith(".mjs")).map(name => path.join("vendor", name))
].sort();
const digest = crypto.createHash("sha256");
for (const name of bundleFiles) digest.update(name).update(fs.readFileSync(path.join(truckDir, name)));
const bundleHash = digest.digest("hex").slice(0, 12);
const bundleDir = path.join(publicStaticDir, "truck", "b", bundleHash);
for (const name of bundleFiles) {
  fs.mkdirSync(path.dirname(path.join(bundleDir, name)), { recursive: true });
  fs.copyFileSync(path.join(truckDir, name), path.join(bundleDir, name));
}
env.addGlobal("truckAsset", name => `/static/truck/b/${bundleHash}/${name}`);
console.log(`truck bundle ${bundleHash} (${bundleFiles.length} files)`);

// Cloudflare Pages response headers. Rules must not overlap, otherwise Pages joins the Cache-Control values.
fs.writeFileSync(path.join(publicDir, "_headers"), [
  "/static/truck/b/*",
  "  Cache-Control: public, max-age=31536000, immutable",
  ...["/static/truck/brand/*", "/static/brand/*", "/static/archetypes/*", "/static/demo_sources/*"].flatMap(rule => [rule, "  Cache-Control: public, max-age=86400"]),
  ""
].join("\n"), "utf8");

for (const page of pages) {
  let html = env.render(page.template, { currentPath: page.route.startsWith('/legacy/') ? page.route.replace('/legacy', '') : page.route });
  if (page.route.startsWith('/legacy/')) {
    // Keep original advanced tools in their own namespace, including script redirects.
    html = html.replace(/(["'`])\/(dashboard|data-hub|diagnosis|generate|gatekeeper|simulation)(?=([/"'`?#]))/g, '$1/legacy/$2');
    html = html.replace(/window\.location\.href = ['"]\/['"]/g, 'window.location.href = "/legacy/"');
    html = html.replace(/href="\/"/g, 'href="/legacy/"');
    html = html.replaceAll('`/?next=', '`/legacy/?next=');
  }
  const outputPath = path.join(publicDir, page.output);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, html, "utf8");
  console.log(`rendered ${page.route} -> ${path.relative(root, outputPath)}`);
}
