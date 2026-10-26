// ACT: 本地打包桌面入口（不依赖 electrobun 的 package 流程）。
// 用法：bun scripts/bundle-desktop.ts [项目根目录]
import { build } from "bun";
import { statSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(process.argv[2] ?? resolve(import.meta.dir, ".."));
const serverSrc = resolve(root, "apps/server/src");
const devkitMain = resolve(root, ".hutch/devkit/api/sdks/main/index.ts");

function resolveFile(base: string, spec: string) {
  const candidate = resolve(base, spec);
  for (const suffix of ["", ".ts", ".tsx", ".js", ".mjs", ".json", "/index.ts", "/index.js"]) {
    try {
      if (statSync(candidate + suffix).isFile()) return candidate + suffix;
    } catch {}
  }
  throw new Error(`无法解析：${spec}（基准 ${base}）`);
}

const result = await build({
  entrypoints: [resolve(root, "apps/desktop/src/index.ts")],
  target: "bun",
  minify: true,
  outdir: resolve(root, "build/desktop/main"),
  external: ["@silvia-odwyer/photon-node", "@firecrawl/anydoc", "@firecrawl/anydoc-wasm"],
  plugins: [
    {
      name: "workspace-alias",
      setup(api) {
        api.onResolve({ filter: /^@\// }, args => ({ path: resolveFile(serverSrc, args.path.slice(2)) }));
        api.onResolve({ filter: /^electrobun\/main$/ }, () => ({ path: devkitMain }));
        api.onResolve({ filter: /^toonflow$|^electrobun\/[a-z]+$/ }, args => {
          const file = resolve(root, "apps/desktop/node_modules/electrobun", `${args.path}.ts`);
          return statSync(file).isFile() ? { path: file } : undefined;
        });
      },
    },
  ],
});

if (!result.success) {
  for (const log of result.logs) console.error(String(log));
  process.exit(1);
}
for (const output of result.outputs) console.log(output.path, output.size);
