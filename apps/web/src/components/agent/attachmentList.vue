<template>
  <div class="attachmentList">
    <attachmentPreview v-for="(attachment, index) in attachments" :key="attachment.path || index" :attachment="attachment" :directory="directory" :removable="removable" :restorable="restorable" :disabled="disabled" :favoritable="favoritable" @remove="emit('remove', index)" @restore="emit('restore', index)" @saved="emit('saved', $event)" />
  </div>
</template>

<script setup lang="ts">
import attachmentPreview from "./attachmentPreview.vue";
import type { AgentAttachment } from "./types";

defineProps<{ attachments: AgentAttachment[]; directory?: string; removable?: boolean; restorable?: boolean; disabled?: boolean; favoritable?: boolean }>();
const emit = defineEmits<{ remove: [index: number]; restore: [index: number]; saved: [path: string] }>();
</script>

<style scoped lang="scss">
.attachmentList {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
</style>
