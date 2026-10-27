import type { Application } from "express";
import type { ModuleContext, ServerModule } from "@/types/module";
import { initializeMobileLinkRuntime } from "./mobileLink";

// ACT: 步骤 15：移动互联运行时注册；调用时刻与组合根的步骤顺序一致。
export async function initializeRuntime(app: Application, _context: ModuleContext) {
  initializeMobileLinkRuntime(app);
}

const module: ServerModule = {
  id: "localRuntime",
  routePrefixes: ["/api/workspaces", "/api/desktop", "/api/exec", "/api/mobileLink"],
  dependencies: ["platformCore"],
  exports: ["initializeRuntime"],
};
export default module;
