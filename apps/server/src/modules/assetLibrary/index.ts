import type { ModuleContext, ServerModule } from "@/types/module";
import { internalAssetDirectories } from "./assets/roots";

export { internalAssetDirectories };

// ACT: 步骤 5 缩略图预热：非阻塞（void）、静默吞错（空 catch）；清扫体内部的 warn 由 assets/thumb 自行记录。
export function warmup(_context: ModuleContext) {
  void import("./assets/thumb").then(({ sweepThumbnailCache }) => sweepThumbnailCache()).catch(() => {});
}

const module: ServerModule = {
  id: "assetLibrary",
  routePrefixes: ["/api/assets"],
  dependencies: ["localRuntime", "mediaGeneration", "platformCore"],
  exports: ["warmup"],
  warmup,
};
export default module;
