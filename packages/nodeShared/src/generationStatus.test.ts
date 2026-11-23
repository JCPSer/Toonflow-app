import { describe, expect, it } from "bun:test";
import { nextTick, ref } from "vue";
import { waitForGenerationStatus, type NodeGenerationStatus } from "./generationStatus";

const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

describe("waitForGenerationStatus", () => {
  it("已结束时立即返回", async () => {
    await waitForGenerationStatus(ref<NodeGenerationStatus>("succeeded"));
    await waitForGenerationStatus(ref<NodeGenerationStatus>("idle"));
    expect(true).toBe(true);
  });

  it("running 时等到终态才放行", async () => {
    const status = ref<NodeGenerationStatus>("running");
    let settled = false;
    const pending = waitForGenerationStatus(status).then(() => { settled = true; });
    await wait(10);
    expect(settled).toBe(false);
    status.value = "succeeded";
    await nextTick();
    await pending;
    expect(settled).toBe(true);
  });

  it("failed 同样是终态", async () => {
    const status = ref<NodeGenerationStatus>("running");
    const pending = waitForGenerationStatus(status);
    status.value = "failed";
    await expect(pending).resolves.toBeUndefined();
  });

  it("中断时以 AbortError 结束等待", async () => {
    const controller = new AbortController();
    const status = ref<NodeGenerationStatus>("running");
    const pending = waitForGenerationStatus(status, controller.signal);
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  });

  it("入参 signal 已中断时立即失败", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(waitForGenerationStatus(ref<NodeGenerationStatus>("running"), controller.signal))
      .rejects.toMatchObject({ name: "AbortError" });
  });

  it("终态后再 abort 不会二次结算", async () => {
    const controller = new AbortController();
    const status = ref<NodeGenerationStatus>("running");
    const pending = waitForGenerationStatus(status, controller.signal);
    status.value = "succeeded";
    await pending;
    controller.abort();
    await expect(pending).resolves.toBeUndefined();
  });
});
