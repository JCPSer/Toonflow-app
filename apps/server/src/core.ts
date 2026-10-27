import fg from "fast-glob";
import path from "node:path";
import { readFile, writeAtomic } from "@toonflow/file";

// ACT: 路由分组只用于可读性；URL 由文件路径生成，分段归属决定注释里的模块名。
const segmentOwner: Record<string, string> = {
  agent: "agentAccess", agents: "pluginMarket", ai: "mediaGeneration", assets: "assetLibrary", browser: "agentAccess",
  desktop: "localRuntime", exec: "localRuntime", ext: "pluginMarket", ffmpeg: "mediaGeneration", mcp: "mcpIntegration",
  mobileLink: "localRuntime", monitor: "platformCore", nodes: "pluginMarket", plugins: "pluginMarket", providers: "mediaGeneration",
  sessionState: "agentAccess", settings: "platformCore", singleAgent: "agentAccess", skills: "pluginMarket", tools: "pluginMarket",
  workspaces: "localRuntime",
};

function fileNameToRoutePath(fileName: string): string {
  let routePath = fileName.replace(/\.(ts)$/, "");
  routePath = routePath.split(path.sep).join("/");
  routePath = routePath.replace(/\[([^\]]+)\]/g, (_, p1: string) => (p1.startsWith("...") ? "*" : `:${p1}`));
  if (routePath === "index") return "/";
  routePath = routePath.replace(/\/index$/, "");
  routePath = "/" + routePath.replace(/\/+/g, "/").replace(/\/$/, "");
  return routePath;
}

export default async function generateRouter(): Promise<void> {
  const sourceRoot = import.meta.dirname;
  const routerPath = path.join(sourceRoot, "router.ts");
  const entries = (await fg(["routes/**/*.ts"], { cwd: sourceRoot })).sort((a, b) => a.localeCompare(b));

  const importLines: string[] = [];
  const routeLines: string[] = [];

  let currentSegment = "";
  entries.forEach((entry: string, i: number) => {
    const varName = `route${i + 1}`;
    let importPath = entry.replace(/\\/g, "/");
    if (!importPath.startsWith(".")) importPath = "./" + importPath;
    importPath = importPath.replace(/\.ts$/, "");
    importLines.push(`import ${varName} from "${importPath}";`);
    const routeKey = path.relative("routes", entry).replace(/\\/g, "/");
    const segment = routeKey.split("/")[0].replace(/\.ts$/, "");
    if (segment !== currentSegment) {
      currentSegment = segment;
      routeLines.push(`  // ${segmentOwner[segment] ?? "unassigned"} · /api/${segment}`);
    }
    const routePath = fileNameToRoutePath(routeKey);
    routeLines.push(`  app.use("/api${routePath}", ${varName});`);
  });

  let content = `import type { Express } from "express";\n\n`;
  content += `${importLines.join("\n")}\n\n`;
  content += `export default (app: Express) => {\n${routeLines.join("\n")}\n`;
  content += `}\n`;

  const current = await readFile(routerPath, "utf8").catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return "";
    throw error;
  });
  // ACT: 比较完整产物，路由模板变化时也重新生成。
  if (current !== content) await writeAtomic(routerPath, content, { mode: 0o666 });
}

if (import.meta.main) await generateRouter();
