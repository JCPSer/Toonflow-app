import type { Application } from "express";
import { resolveRequestLocale, runWithLocale, translateError, translateMessage } from "@/lib/i18n";
import type { ModuleContext, ServerModule } from "@/types/module";
import { getMcpSettings } from "./mcp/control";

export { getMcpSettings };

// ACT: 步骤 11：对外 MCP 网关；4 个依赖并发动态加载（保持 B0 的装载形态与本地化包装）。
export async function mount(app: Application, _context: ModuleContext) {
  const [{ createMcpRouter }, { getMcpTools }, { authorizeMcp }, { skillResources }] = await Promise.all([
    import("@toonflow/mcp"),
    import("./mcp/tools"),
    import("./mcp/control"),
    import("./mcp/resources"),
  ]);
  app.use("/mcp", createMcpRouter({ getTools: getMcpTools, authorize: authorizeMcp, resources: skillResources,
    runInRequest: (request, operation) => runWithLocale(resolveRequestLocale(request.get("accept-language")), operation),
    translate: translateMessage,
    translateError,
  }));
}

const module: ServerModule = {
  id: "mcpIntegration",
  routePrefixes: ["/api/mcp"],
  gateways: ["/mcp"],
  dependencies: ["localRuntime", "mediaGeneration", "platformCore", "pluginMarket"],
  exports: ["mount"],
  mount,
};
export default module;
