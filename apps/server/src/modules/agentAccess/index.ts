import type { Application } from "express";
import type { ModuleContext, ServerModule } from "@/types/module";

// ACT: 步骤 12：A2A 路由必须保持动态 import（静态化会让 agentAccess→agent 的边增加并提前求值）。
export async function mount(app: Application, _context: ModuleContext) {
  const { createA2aRouter } = await import("@/agent/a2a");
  app.use("/a2a", createA2aRouter());
}

const module: ServerModule = {
  id: "agentAccess",
  routePrefixes: ["/api/agent", "/api/browser", "/api/sessionState", "/api/singleAgent"],
  gateways: ["/a2a"],
  dependencies: ["platformCore", "pluginMarket"],
  exports: ["mount"],
  mount,
};
export default module;
