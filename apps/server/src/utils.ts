import * as assets from "@/modules/assetLibrary/assets";
import * as browser from "@/modules/agentAccess/browser";
import * as singleAgent from "@/modules/agentAccess/singleAgent";
import * as desktop from "@/modules/localRuntime/desktop";
import * as providerDebug from "@/modules/mediaGeneration/media/debug";
import * as mediaGeneration from "@/modules/mediaGeneration/media/generation";
import * as mediaTasks from "@/modules/mediaGeneration/media/tasks";
import * as mediaProvider from "@/modules/mediaGeneration/media/provider";
import * as mediaBilling from "@/modules/mediaGeneration/media/billing";
import * as ffmpeg from "@/modules/mediaGeneration/ffmpeg";
import * as exec from "@/modules/localRuntime/exec";
import * as pluginInstall from "@/modules/pluginMarket/plugins/install";
import conf, { cleanNodeMenuSettings, removeLegacySettings } from "@/modules/platformCore/conf";
import * as ai from "@/modules/mediaGeneration/ai";
import * as aiRuns from "@/modules/mediaGeneration/ai/runs";
import * as plugins from "@/modules/pluginMarket/plugins/tools";
import * as nodePlugins from "@/modules/pluginMarket/plugins/nodes";
import * as extPlugins from "@/modules/pluginMarket/plugins/ext";
import * as agent from "@/agent";
import * as canvas from "@/agent/bridge/canvas";
import * as question from "@/agent/bridge/question";
import * as workspace from "@/modules/localRuntime/workspace";
import * as workspaceFile from "@/modules/localRuntime/workspace/files";
import * as workspaceDownload from "@/modules/localRuntime/workspace/download";
import * as chatImages from "@/modules/localRuntime/workspace/chatImages";
import * as skillFile from "@/modules/pluginMarket/skills/files";
import * as mcpControl from "@/modules/mcpIntegration/mcp/control";
import * as mcpRuntime from "@/modules/mcpIntegration/mcp/runtime";
import * as mcpServers from "@/modules/mcpIntegration/mcp/servers";
import * as mcpDxt from "@/modules/mcpIntegration/mcp/dxt";
import * as mobileLink from "@/modules/localRuntime/mobileLink";
import * as teams from "@/modules/pluginMarket/teams";
import * as a2aSettings from "@/agent/a2a/settings";
import * as personalization from "@/modules/platformCore/personalization";
import * as mentionFiles from "@/agent/mentionFiles";

export default {
  assets,
  browser,
  singleAgent,
  desktop,
  providerDebug,
  mediaGeneration,
  mediaTasks,
  mediaProvider,
  mediaBilling,
  ffmpeg,
  exec,
  pluginInstall,
  conf,
  cleanNodeMenuSettings,
  removeLegacySettings,
  ai,
  aiRuns,
  plugins,
  nodePlugins,
  extPlugins,
  agent,
  canvas,
  question,
  workspace,
  workspaceFile,
  workspaceDownload,
  chatImages,
  skillFile,
  mcpControl,
  mcpRuntime,
  mcpServers,
  mcpDxt,
  mobileLink,
  teams,
  a2aSettings,
  personalization,
  mentionFiles,
};
