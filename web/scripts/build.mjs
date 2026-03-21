import { cp, mkdir, rm } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import esbuild from "esbuild";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");
const dist = resolve(root, "dist");

await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });

await esbuild.build({
  absWorkingDir: root,
  assetNames: "assets/[name]",
  bundle: true,
  entryPoints: ["src/main.ts"],
  format: "iife",
  outfile: "dist/main.js",
  platform: "browser",
  sourcemap: true,
  target: ["es2020"]
});

await cp(resolve(root, "src/index.html"), resolve(dist, "index.html"));
