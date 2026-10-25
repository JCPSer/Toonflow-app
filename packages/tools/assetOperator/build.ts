import { createToolConfig } from "@toonflow/tools-scaffold";

await createToolConfig({
  name: "assetOperator",
  displayName: "全局资产管理",
  description: "查询、读取和维护全局素材库，将素材导入工作区或将生成结果归档入库。",
  prompt: `素材库通过 assetOperator 查询和管理，与当前工作区的 assets 文件夹不同；默认全局库，传 library=project 可管理随项目保存的库。
先查询和读取相关素材，再按用户要求维护；沿用当前会话已有授权，只有删除或覆盖不在授权范围内时才询问。
将工作区生成结果入库时使用 sourcePath 或 collect（工作区→库，重名自动改名，不改源文件）；素材用于画布或生成参考前先 import 到当前工作区（库→工作区），使用返回的真实路径。
delete 默认移入回收站，不会立刻释放磁盘；被引用时先向用户确认，再用 force=true 重试。`,
  author: "Toonflow",
  github: "https://github.com/HBAI-Ltd/Toonflow-app",
  configRules: [
    { type: "switch", field: "readOnly", title: "只读模式", value: false, info: "开启后禁止修改全局素材库；仍可查询、读取，以及复制素材到当前工作区。" },
  ],
}, import.meta.url);
