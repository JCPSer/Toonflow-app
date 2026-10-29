<template>
  <el-dialog v-model="visible" title="退出项目" width="360px" alignCenter appendToBody>
    <span>是否退出当前项目并返回首页？</span>
    <template #footer>
      <el-button @click="cancel">取消</el-button>
      <el-button type="primary" :loading="leaving" @click="confirm">退出项目</el-button>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { onUnmounted } from "vue";
import { useExitProject } from "../exitProject";

const { visible, leaving, confirm, cancel } = useExitProject();
// ACT: 状态是模块级单例；工作区被销毁（切路由、退出）时收起，避免下次进入残留一个确认框。
onUnmounted(cancel);
</script>
