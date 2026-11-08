import { describe, expect, test } from "bun:test";
import { awaitAbortable } from "./abortable";

describe("awaitAbortable", () => {
  test("没有信号时直接等待任务", async () => {
    await expect(awaitAbortable(Promise.resolve(1))).resolves.toBe(1);
  });

  test("共享任务建立后取消，只结束本次等待，任务本身继续完成", async () => {
    const controller = new AbortController();
    let finished = false;
    const task = Bun.sleep(20).then(() => { finished = true; return "done"; });
    const waiting = awaitAbortable(task, controller.signal);
    controller.abort();
    await expect(waiting).rejects.toThrow();
    expect(finished).toBe(false);
    await expect(task).resolves.toBe("done");
    expect(finished).toBe(true);
  });

  test("任务成功后正常返回，任务失败时原样抛出", async () => {
    await expect(awaitAbortable(Promise.resolve("ok"), new AbortController().signal)).resolves.toBe("ok");
    const error = new Error("失败");
    await expect(awaitAbortable(Promise.reject(error), new AbortController().signal)).rejects.toBe(error);
  });

  test("已取消的信号立即拒绝，不等待任务", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(awaitAbortable(Bun.sleep(50), controller.signal)).rejects.toThrow();
  });
});
