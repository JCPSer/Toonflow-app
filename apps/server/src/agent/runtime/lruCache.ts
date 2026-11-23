/**
 * 小型进程内缓存：Map 插入顺序即 LRU 顺序，命中移到队尾；可选 TTL 与容量上限。
 *
 * ACT: 只服务可重建的派生数据（会话投影、会话列表、节点标记），
 * 进程重启即失效，不落盘、不做持久化。
 */
export function createLruCache<K, V>(limit: number, ttlMs?: number) {
  const map = new Map<K, { value: V; at: number }>();
  return {
    get(key: K): V | undefined {
      const hit = map.get(key);
      if (!hit) return undefined;
      // TTL 从写入时刻算起，读取不续期，避免高频读取让旧数据永远不过期。
      if (ttlMs !== undefined && Date.now() - hit.at >= ttlMs) {
        map.delete(key);
        return undefined;
      }
      map.delete(key);
      map.set(key, hit);
      return hit.value;
    },
    set(key: K, value: V) {
      map.delete(key);
      map.set(key, { value, at: Date.now() });
      while (map.size > Math.max(1, limit)) {
        const oldest = map.keys().next().value;
        if (oldest === undefined) break;
        map.delete(oldest);
      }
    },
    delete(key: K) {
      map.delete(key);
    },
    clear() {
      map.clear();
    },
    keys() {
      return [...map.keys()];
    },
    get size() {
      return map.size;
    },
  };
}
