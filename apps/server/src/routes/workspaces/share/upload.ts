import { createWriteStream, mkdir, rm } from "@toonflow/file";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { join } from "node:path";
import { Router } from "express";
import u from "@/utils";
import { success } from "@/lib/responseFormat";
import { sweepTemporaryShareFiles, temporaryDirectory } from "./tmp";

const MAX_BYTES = 2 * 1024 * 1024 * 1024;

// ACT: 拖拽进来的文件拿不到真实路径，只能把字节传上来。这里不用 express.raw——
// 它会把整包读进内存，几百 MB 直接打爆；改为边收边写临时文件。
export default Router().put("/", async (req, res) => {
  u.mcpControl.assertAppRequest(req);
  const directory = temporaryDirectory();
  await mkdir(directory, { recursive: true });
  void sweepTemporaryShareFiles();
  const target = join(directory, `import-${crypto.randomUUID()}.tfproj`);
  let received = 0;
  const limiter = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      received += chunk.length;
      if (received > MAX_BYTES) callback(Object.assign(new Error("分享文件超过 2 GiB 上限"), { status: 413 }));
      else callback(null, chunk);
    },
  });
  try {
    await pipeline(req, limiter, createWriteStream(target));
    res.json(success({ path: target, size: received }));
  } catch (cause) {
    await rm(target).catch(() => {});
    throw cause;
  }
});

export { MAX_BYTES as SHARE_UPLOAD_LIMIT };
