import { ref } from "vue";
import { useAssetLibraryStore } from "@/stores/assetLibrary";
import { getTree } from "../api";
import type { AssetLibraryKind } from "../types";
import { resolveSaveDestination } from "./saveDestination";

/**
 * 保存弹窗的「目标素材库 + 保存位置」状态。
 *
 * ACT: 目标库与保存位置按项目记住上次成功保存的选择；打开时回填后异步探一次，
 * 记住的目录可能已在 Finder/素材库里被删除或改名，失效就回落到默认位置，
 * 否则打开就报错、且保存必然 ENOENT。
 */
export function useSaveDestination(source: {
  /** 当前浏览的库；无记忆时作为目标库回落。 */
  library: () => AssetLibraryKind;
  directory: () => string | undefined;
}) {
  const store = useAssetLibraryStore();
  const targetLibrary = ref<AssetLibraryKind>(source.library());
  const destination = ref("");
  // ACT: AssetDestinationTree 是受控组件，换库/回落时必须强制重建，否则树还停在旧库的数据上。
  const destinationKey = ref(0);
  const error = ref("");

  function restore(fallbackPath: string) {
    const directory = source.directory();
    const defaults = store.getSaveDefaults(directory ?? "");
    const resolved = resolveSaveDestination({ defaults, library: source.library(), directory, fallbackPath });
    targetLibrary.value = resolved.library;
    destination.value = resolved.path;
    destinationKey.value++;
    error.value = "";
    const remembered = destination.value;
    if (!remembered) return;
    void getTree({ library: targetLibrary.value, directory }, remembered).catch(() => {
      // 探测期间用户可能已经重选，只回滚仍是旧记忆值的情况。
      if (destination.value !== remembered) return;
      destination.value = fallbackPath;
      // 目标树先于探测挂载时可能已经报过错，回落后一起清掉。
      error.value = "";
      destinationKey.value++;
    });
  }

  // ACT: 只响应用户切换，不用 watch——restore() 回填记忆值时也会改 targetLibrary，
  // watch 会立刻把保存位置重置回当前浏览目录，把记忆覆盖掉。
  function switchLibrary(currentPath: string) {
    // ACT: 有当前浏览目录就用它（单节点保存）；没有（批量入口）则切回该库上次记住的目录，
    // 否则「全局 → 本项目」会把手动回填的文件夹丢掉，确认后落到根目录并覆盖记忆。
    const remembered = store.getSaveDefaults(source.directory() ?? "");
    destination.value = currentPath || (remembered?.library === targetLibrary.value ? remembered.path : "");
    destinationKey.value++;
    error.value = "";
  }

  /** 保存成功后记住落点；必须用请求发出时的快照，不能用保存过程中可能被改动的 ref。 */
  function remember(library: AssetLibraryKind, path: string) {
    store.setSaveDefaults({ library, path }, source.directory() ?? "");
  }

  return { targetLibrary, destination, destinationKey, error, restore, switchLibrary, remember };
}
