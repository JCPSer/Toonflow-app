<template>
  <div class="privacy">
    <section v-if="nativeAuth" class="settingSection" aria-labelledby="hiddenProjectsTitle">
      <div class="settingHeader">
        <h3 id="hiddenProjectsTitle">显示隐藏项目</h3>
        <el-switch
          :modelValue="hiddenUnlocked"
          :loading="hiddenVerifying"
          :disabled="hiddenVerifying || hiddenAuthSupported === false"
          aria-label="显示隐藏项目"
          @change="toggleHiddenProjects" />
      </div>
      <p class="description">打开需要 Touch ID 或系统登录密码验证。解锁只在本次运行有效，重启应用后自动锁定。隐藏只是不在界面中显示，项目文件仍在磁盘上。</p>
    </section>

    <section class="settingSection" aria-labelledby="collectionTitle">
      <div class="settingHeader">
        <h3 id="collectionTitle">匿名使用统计</h3>
        <el-switch
          :modelValue="privacySettings.dataCollectionEnabled"
          aria-label="匿名使用统计"
          @change="(value) => settings.privacy = { ...privacySettings, dataCollectionEnabled: value === true }" />
      </div>
      <p class="description">帮助我们了解常用功能，改进使用体验。默认开启，可随时关闭。</p>
    </section>

    <section class="settingSection" aria-labelledby="metricsTitle">
      <h3 id="metricsTitle">统计内容</h3>
      <dl class="metricList">
        <div v-for="metric in metrics" :key="metric.label" class="metricItem">
          <dt>{{ metric.label }}</dt>
          <dd>{{ metric.description }}</dd>
        </div>
      </dl>
      <p class="description">统计不包含提示词、对话、文件内容、项目名称、路径、账号或密钥。</p>
    </section>

    <section class="settingSection" aria-labelledby="anonymousIdTitle">
      <h3 id="anonymousIdTitle">匿名 ID</h3>
      <code class="anonymousId">{{ privacySettings.anonymousId || "开启后自动生成" }}</code>
    </section>
  </div>
</template>

<script setup lang="ts">
import { translate } from "@toonflow/i18n/vue";
import { ElMessage } from "element-plus";

import { lockHiddenProjects, refreshAuthSupport, unlockHiddenProjects, useProjectPrivacy, usesNativeAuth } from "@/lib/projectPrivacy";
import { privacySettings, settings } from "@/stores/settings";

const { unlocked: hiddenUnlocked, verifying: hiddenVerifying, authSupported: hiddenAuthSupported } = useProjectPrivacy();
const nativeAuth = usesNativeAuth();

/** ACT: 开关只是解锁状态的镜像；打开必须过系统验证，关闭立即锁定。 */
async function toggleHiddenProjects(value: string | number | boolean) {
  if (value !== true) {
    lockHiddenProjects();
    return;
  }
  // ACT: 没探测过就先探测；安装包不具备验证能力时不允许打开，否则打开就再也关不回去。
  if (!(await refreshAuthSupport())) {
    ElMessage.warning("当前安装包不支持系统验证");
    return;
  }
  const result = await unlockHiddenProjects();
  if (!result.ok) ElMessage.warning(result.message ?? "验证未通过，隐藏项目保持锁定");
}

const metrics = [
  { get label() { return translate("使用与回访"); }, get description() { return translate("随机匿名标识、访问次数与时间"); } },
  { get label() { return translate("使用活跃"); }, get description() { return translate("使用时长和交互次数，不含输入内容"); } },
  { get label() { return translate("运行环境"); }, get description() { return translate("软件版本、桌面或网页端、系统、浏览器和语言"); } },
  { get label() { return translate("功能使用"); }, get description() { return translate("引导、画布与文档的使用情况"); } },
  { get label() { return translate("使用规模"); }, get description() { return translate("项目、模型配置、节点与连线数量，以及节点类型"); } },
  { get label() { return translate("Agent 使用"); }, get description() { return translate("发送次数、完成情况和耗时"); } },
];
</script>

<style lang="scss" scoped>
.privacy {
  display: flex;
  flex-direction: column;
  gap: 24px;
  padding: 0 4px 8px;

  .settingSection {
    min-width: 0;

    h3 {
      margin: 0 0 12px;
      color: var(--el-text-color-primary);
      font-size: 14px;
      font-weight: 600;
    }

    .settingHeader {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;

      h3 { margin: 0; }
    }

    .description {
      margin: 8px 0 0;
      color: var(--el-text-color-secondary);
      font-size: 13px;
      line-height: 1.6;
    }

    .metricList {
      display: flex;
      flex-direction: column;
      gap: 12px;
      margin: 0;

      .metricItem {
        display: grid;
        grid-template-columns: 88px minmax(0, 1fr);
        gap: 12px;
        font-size: 13px;
        line-height: 1.6;

        dt { color: var(--el-text-color-regular); }
        dd { margin: 0; color: var(--el-text-color-secondary); }
      }
    }

    .anonymousId {
      display: block;
      padding: 10px 12px;
      border-radius: var(--el-border-radius-base);
      background: var(--el-fill-color-light);
      color: var(--el-text-color-regular);
      overflow-wrap: anywhere;
      user-select: text;
      font-family: monospace;
      font-size: 12px;
    }
  }
}
</style>
