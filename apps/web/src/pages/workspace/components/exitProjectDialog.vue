<template>
  <el-dialog v-model="visible" title="退出项目" width="380px" alignCenter appendToBody>
    <span v-if="runningCount > 0">当前有 {{ runningCount }} 个节点正在运行，退出项目会中断它们的任务。是否仍要退出？</span>
    <span v-else>是否退出当前项目并返回首页？</span>
    <template #footer>
      <el-button @click="cancel">{{ runningCount > 0 ? "留在此页" : "取消" }}</el-button>
      <el-button :type="runningCount > 0 ? 'danger' : 'primary'" :loading="leaving" @click="confirm">{{ runningCount > 0 ? "仍然退出" : "退出项目" }}</el-button>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { onUnmounted } from "vue";
import { useExitProject } from "../exitProject";

const { visible, leaving, runningCount, confirm, cancel } = useExitProject();
// ACT: 状态是模块级单例；工作区被销毁（切路由、退出）时收起，避免下次进入残留一个确认框。
onUnmounted(cancel);
</script>
