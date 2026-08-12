import { build } from "esbuild";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const projectRoot = resolve(import.meta.dirname, "..");
const packageRoot = join(projectRoot, "packages/r-store");
const temporaryRoot = mkdtempSync(join(tmpdir(), "reactivity-store-pack-"));

const fail = (message) => {
  throw new Error(`[reactivity-store/package] ${message}`);
};

try {
  for (const configName of ["rollupBuild.ts", "rollupWatch.ts"]) {
    const config = readFileSync(join(projectRoot, "scripts", configName), "utf8");
    if (!config.includes('import { generateExternal } from "./rollupExternal"') || !/external:\s*\{\s*generateExternal,?\s*\}/.test(config)) {
      fail(`${configName} does not share the external dependency policy`);
    }
  }

  execFileSync("pnpm", ["pack", "--pack-destination", temporaryRoot], {
    cwd: packageRoot,
    stdio: "pipe",
  });

  const tarball = readdirSync(temporaryRoot).find((name) => name.endsWith(".tgz"));
  if (!tarball) fail("pnpm pack did not create a tarball");
  execFileSync("tar", ["-xzf", join(temporaryRoot, tarball), "-C", temporaryRoot]);

  const packedRoot = join(temporaryRoot, "package");
  const manifest = JSON.parse(readFileSync(join(packedRoot, "package.json"), "utf8"));
  const octaneExport = manifest.exports?.["./octane"];
  if (octaneExport?.import !== "./dist/octane/index.mjs") fail("missing Octane runtime export");
  if (octaneExport?.types !== "./dist/octane/index.d.ts") fail("missing Octane type export");

  const runtimePath = join(packedRoot, "dist/octane/index.mjs");
  const typesPath = join(packedRoot, "dist/octane/index.d.ts");
  if (!existsSync(runtimePath) || !existsSync(typesPath)) fail("Octane runtime or declarations were not packed");

  const runtime = readFileSync(runtimePath, "utf8");
  const types = readFileSync(typesPath, "utf8");
  const forbiddenImport = /(?:from\s*|import\s*\(|require\s*\()\s*["'](?:react(?:-dom)?(?:\/[^"']*)?|use-sync-external-store(?:\/[^"']*)?)["']/;
  if (forbiddenImport.test(runtime)) fail("Octane runtime imports a React-only module");
  if (/from\s+["']react(?:\/[^"']*)?["']|@types\/react|reference types=["']react["']/.test(types)) {
    fail("Octane declarations reference React types");
  }

  const bundle = await build({
    entryPoints: [runtimePath],
    bundle: true,
    format: "esm",
    platform: "browser",
    write: false,
    metafile: true,
    external: ["octane"],
    nodePaths: [join(packageRoot, "node_modules"), join(projectRoot, "node_modules")],
  });
  const forbiddenGraphEntry = Object.keys(bundle.metafile.inputs).find((path) =>
    /node_modules\/(?:react|react-dom|use-sync-external-store)(?:\/|$)/.test(path)
  );
  if (forbiddenGraphEntry) fail(`Octane bundle graph contains ${forbiddenGraphEntry}`);

  const consumerRoot = join(temporaryRoot, "consumer");
  mkdirSync(consumerRoot);
  writeFileSync(
    join(consumerRoot, "package.json"),
    JSON.stringify({
      private: true,
      type: "module",
      dependencies: {
        octane: "0.1.36",
        "reactivity-store": `file:${join(temporaryRoot, tarball)}`,
      },
    })
  );
  const cleanNpmConfig = join(temporaryRoot, "empty.npmrc");
  writeFileSync(cleanNpmConfig, "");
  const npmEnvironment = Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.toLowerCase().startsWith("npm_config_")));
  npmEnvironment.NPM_CONFIG_USERCONFIG = cleanNpmConfig;
  execFileSync("npm", ["install", "--ignore-scripts", "--no-audit", "--no-fund", "--package-lock=false"], {
    cwd: consumerRoot,
    env: npmEnvironment,
    stdio: "pipe",
  });

  const installedForbidden = ["react", "react-dom", "use-sync-external-store"].filter((name) => existsSync(join(consumerRoot, "node_modules", name)));
  const npmList = spawnSync("npm", ["ls", "react", "react-dom", "use-sync-external-store", "--all", "--json"], {
    cwd: consumerRoot,
    env: npmEnvironment,
    encoding: "utf8",
  });
  if (installedForbidden.length > 0) {
    fail(`Octane-only npm install contains ${installedForbidden.join(", ")}\n${npmList.stdout}`);
  }

  writeFileSync(
    join(consumerRoot, "smoke.mjs"),
    `import { createStore, ref } from "reactivity-store/octane";
const count = ref(1);
const store = createStore(() => ({ count }));
store.getReactiveState().count++;
if (store.getReadonlyState().count !== 2) throw new Error("Octane packed consumer failed");
`
  );
  execFileSync("node", ["smoke.mjs"], { cwd: consumerRoot, stdio: "pipe" });

  console.log(`verified ${tarball}: Octane export, types, runtime graph, and React-free npm consumer`);
} finally {
  rmSync(temporaryRoot, { recursive: true, force: true });
}
