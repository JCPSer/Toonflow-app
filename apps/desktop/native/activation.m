// ACT: 协作式激活的「让权」侧实现。
// macOS 14 起，App 激活是由用户意图驱动的**请求**，可能被系统拒绝；被拒绝时，子进程自己怎么
// 重试都是碰运气（实测同一份代码 5 次点击里 2 次成功、3 次失败）。Apple 给的确定性路径是：
// 当前 active 的 App 用 yieldActivationToApplication: 把激活权交给目标 App，之后目标 App 再
// activate 就一定成功。
//
// 这里把这段能力暴露成一个 C 函数供 Bun 侧 FFI 调用：JS 线程不是 Cocoa 主线程，所以必须
// dispatch 到主队列执行；目标进程刚 spawn，NSRunningApplication 可能还查不到，因此带重试。
#import <Cocoa/Cocoa.h>

static void yieldToProcess(pid_t pid, int attempt) {
  if (@available(macOS 14.0, *)) {
    NSRunningApplication *target = [NSRunningApplication runningApplicationWithProcessIdentifier:pid];
    if (target) {
      [NSApp yieldActivationToApplication:target];
      return;
    }
  }
  // 最多重试约 1 秒（50 × 20ms）；找不到就放弃，由 helper 自己的重试兜底。
  if (attempt >= 50) return;
  dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(20 * NSEC_PER_MSEC)), dispatch_get_main_queue(), ^{
    yieldToProcess(pid, attempt + 1);
  });
}

void tnf_yield_activation_to_pid(int pid) {
  if (pid <= 0) return;
  if ([NSThread isMainThread]) {
    yieldToProcess((pid_t)pid, 0);
  } else {
    // dispatch_sync 只等「排上主队列」这一瞬间，真正的重试在主线程异步进行，不会长时间卡 JS。
    dispatch_sync(dispatch_get_main_queue(), ^{
      yieldToProcess((pid_t)pid, 0);
    });
  }
}
