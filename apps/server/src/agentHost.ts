// ACT: agent 能力的唯一实现点与唯一注入点。本文件位于 bootstrap 层，是唯一允许同时引用 agent 契约与
// 应用域子模块的装配文件；agent 只依赖 agent/host.ts，应用域只被本文件深度引用，依赖方向因此保持单向。
import { configureAgentHost, type AgentHost } from "@/agent/host";
import { getRequestFiles } from "@/modules/mediaGeneration/ai/requestFiles";
import { FileRequestLimitError, createFileTransport } from "@/modules/mediaGeneration/ai/files";
import { getConfiguredModel, getModelLimits, providerSchema, readAiReferences, referenceContent } from "@/modules/mediaGeneration/ai";
import { createWorkspaceFfmpeg } from "@/modules/mediaGeneration/ffmpeg";
import { generateMedia, listMediaModels } from "@/modules/mediaGeneration/media/generation";
import { readDocument as readMediaDocument } from "@/modules/mediaGeneration/documents";
import { isWithin, isHiddenWorkspaceEntry, protectWorkspaceLibraryPath, protectWorkspaceRoot, lockWorkspaceFiles, renameWorkspaceFile, resolveWorkspacePath, writeWorkspaceFile } from "@/modules/localRuntime/workspace/files";
import { importImage } from "@/modules/localRuntime/workspace/chatImages";
import { assertAssetRelativePath, getAssetsDirectory, openAssetLibrary } from "@/modules/assetLibrary/assets/roots";
import { createAssetDirectory, importAssetFile, moveAsset, queryAssets, readAssetFile, removeAsset, writeAssetFile } from "@/modules/assetLibrary/assets";
import { importFileIntoLibrary } from "@/modules/assetLibrary/assets/library";
import { isMemoryEnabled, maxDocumentLength, readDocument as readPersonalizationDocument, saveDocument } from "@/modules/platformCore/personalization";
import { getRemoteTeam, listTeams, readTeam, saveTeamFile } from "@/modules/pluginMarket/teams";
import { listTools, loadTool, validateToolConfig } from "@/modules/pluginMarket/plugins/tools";
import { directory, isEnabled } from "@/modules/pluginMarket/skills/files";
import { callControl, getConnection, resolveAppOrigin } from "@/modules/mcpIntegration/mcp/control";
import { createMcpAgentTools } from "@/modules/mcpIntegration/mcp/servers";
import { createBrowserContext } from "@/modules/agentAccess/browser";
import conf from "@/modules/platformCore/conf";
import { t, translateError, translateMessage } from "@/lib/i18n";
import { getRuntimePlatform } from "@/lib/platform";
import type { ModuleContext } from "@/types/module";

// conf 的键类型来自 settings 形状；此处按「分段名 + 缺省值」的运行时语义调用，收敛成一个局部视图。
const settingsStore = conf as unknown as {
  get(section: string, fallback?: Record<string, unknown>): Record<string, unknown>;
  onDidChange(section: string, callback: (next: unknown, previous: unknown) => void): void;
  path: string;
};

export function createAgentHost(_context: ModuleContext): AgentHost {
  return {
    workspace: {
      resolveWorkspacePath,
      lockWorkspaceFiles,
      writeWorkspaceFile,
      renameWorkspaceFile,
      isWithin,
      isHiddenWorkspaceEntry,
      protectWorkspaceRoot,
      protectWorkspaceLibraryPath,
      importImage,
    },
    settings: {
      get: (section, fallback) => settingsStore.get(section, fallback),
      onChange: (section, callback) => settingsStore.onDidChange(section, callback),
      settingsPath: () => settingsStore.path,
    },
    assets: {
      openAssetLibrary,
      createAssetDirectory,
      importAssetFile,
      importFileIntoLibrary,
      moveAsset,
      readAssetFile,
      writeAssetFile,
      removeAsset,
      getAssetsDirectory,
      assertAssetRelativePath,
      queryAssets,
    },
    models: {
      getConfiguredModel,
      providerSchema,
      getModelLimits,
      readAiReferences,
      referenceContent,
      createFileTransport,
      FileRequestLimitError,
      getRequestFiles,
    },
    personalization: {
      isMemoryEnabled,
      readDocument: readPersonalizationDocument,
      saveDocument,
      maxDocumentLength,
    },
    teams: {
      readTeam,
      saveTeamFile,
      listTeams,
      getRemoteTeam,
    },
    tools: {
      listTools,
      loadTool,
      validateToolConfig,
    },
    skills: {
      directory,
      isEnabled,
    },
    mcp: {
      callControl,
      getConnection,
      getAppOrigin: resolveAppOrigin,
      createMcpAgentTools,
    },
    documents: {
      readDocument: readMediaDocument,
    },
    media: {
      listMediaModels,
      generateMedia,
      createWorkspaceFfmpeg,
    },
    browser: {
      createBrowserContext,
    },
    i18n: {
      t,
      translateMessage,
      translateError,
    },
    platform: {
      getRuntimePlatform,
    },
  };
}

export function initializeAgentHost(context: ModuleContext): void {
  configureAgentHost(createAgentHost(context));
}
