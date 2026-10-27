import { Router } from "express";
import { validateAssetFields, directoryField, libraryField, requestLibrary } from "@/modules/assetLibrary/assets/routeSchema";
import { subscribeLibraryChanges, type LibraryChangeEvent } from "@/modules/assetLibrary/assets/watch";

const router = Router();

type StreamFrame = LibraryChangeEvent | { type: "ready" } | { type: "ping" };

export default router.get("/", validateAssetFields({ library: libraryField, directory: directoryField }, "query"), async (req, res) => {
  let closed = false;
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  let unsubscribe = () => {};
  const cleanup = () => {
    if (closed) return;
    closed = true;
    if (heartbeat) clearInterval(heartbeat);
    unsubscribe();
  };

  try {
    const library = await requestLibrary(req, {
      library: req.query.library as "global" | "project" | undefined,
      directory: req.query.directory as string | undefined,
    });
    res.set({
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    res.flushHeaders();

    const send = (frame: StreamFrame) => {
      if (!res.destroyed && !res.writableEnded) res.write(`${JSON.stringify(frame)}\n`);
    };
    // ACT: 前端逐行 JSON.parse，心跳必须是非空 JSON 帧，不能发空行。
    heartbeat = setInterval(() => send({ type: "ping" }), 20000);
    req.once("close", cleanup);
    res.once("close", cleanup);

    send({ type: "ready" });
    const stop = subscribeLibraryChanges(library.root, event => {
      send(event);
      // ACT: 库根消失后 watcher 已清理，结束流让前端稍后重连并重新尝试订阅。
      if (event.type === "gone") {
        cleanup();
        if (!res.writableEnded) res.end();
      }
    });
    if (closed) stop();
    else unsubscribe = stop;
  } catch (error) {
    cleanup();
    // ACT: 已经按 NDJSON 推送时不能再让错误中间件写 JSON/HTML 错误页。
    if (res.headersSent) {
      if (!res.writableEnded) res.end();
      return;
    }
    throw error;
  }
});
