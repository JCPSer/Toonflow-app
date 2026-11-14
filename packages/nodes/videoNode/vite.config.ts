import { createNodeConfig } from "@toonflow/nodes-scaffold";

export default createNodeConfig({
  name: "videoNode",
  displayName: "视频",
  author: "Toonflow",
  github: "https://github.com/HBAI-Ltd/Toonflow-app",
  // ACT: Agent 对宫格联系表的识别准确度不稳定，默认关闭；需要时在插件设置里打开，保存即生效。
  configRules: [{ type: "switch", field: "agentGridInspect", title: "允许 Agent 宫格查看", value: false }],
}, import.meta.url);
