// ACT: 隐藏项目的系统验证。用 LocalAuthentication 而不是自建密码：生物识别与系统登录密码的
// 校验都由系统完成，应用既不接触也不存储任何凭据。
//
// 为什么是 dylib 而不是子进程：dlopen 进 Bun 主进程后，系统弹窗归属于 Toonflow 应用本身；
// 独立可执行文件弹出时只会显示进程名（如 bun），用户无法确认是谁在要指纹。
// 实测（macOS 15.7）：未签名/临时签名的进程同样可以正常弹出并完成验证。
#import <Foundation/Foundation.h>
#import <LocalAuthentication/LocalAuthentication.h>

// 回调码约定：0 成功；1 用户/系统取消；2 系统不可用；3 验证失败；4 无法交互（后台/无界面）。
typedef void (*tnf_auth_callback)(int code);

// ACT: 同一时刻只允许一个系统验证弹窗；超时/取消时要能主动 dismiss，否则弹窗会一直挂着，
// 用户再点一次会叠出第二个面板（会话表已经完成，拦不住）。
static LAContext *gActiveContext = nil;
static NSLock *gContextLock = nil;
static void tnf_context_lock_once(void) {
  static dispatch_once_t once;
  dispatch_once(&once, ^{ gContextLock = [[NSLock alloc] init]; });
}

// ACT: 返回 0 = 有生物识别；1 = 只能系统密码；2 = 完全不可用。仅用于界面提示，不参与放行判断。
int tnf_auth_available(void) {
  LAContext *context = [[LAContext alloc] init];
  NSError *error = nil;
  if ([context canEvaluatePolicy:LAPolicyDeviceOwnerAuthenticationWithBiometrics error:&error]) return 0;
  if ([context canEvaluatePolicy:LAPolicyDeviceOwnerAuthentication error:&error]) return 1;
  return 2;
}

// ACT: 评估必须放到后台队列：JS 线程在调用瞬间可能是主线程或事件循环线程，任何阻塞都会
// 卡住 HTTP 服务；回调由 Bun 的 JSCallback 调度回 JS，不要求同线程。
void tnf_authenticate(const char *reason, tnf_auth_callback callback) {
  if (!callback) return;
  NSString *text = reason ? [NSString stringWithUTF8String:reason] : @"验证身份";
  if (!text.length) text = @"验证身份";
  tnf_context_lock_once();
  dispatch_async(dispatch_get_global_queue(QOS_CLASS_USER_INTERACTIVE, 0), ^{
    LAContext *context = [[LAContext alloc] init];
    [gContextLock lock];
    if (gActiveContext) {
      [gContextLock unlock];
      callback(3);
      return;
    }
    gActiveContext = context;
    [gContextLock unlock];
    NSError *availabilityError = nil;
    // ACT: 选 DeviceOwnerAuthentication 而不是 WithBiometrics：没有 Touch ID 或识别失败时，
    // 系统弹窗自带「输入密码」回落，不会把用户锁死。
    if (![context canEvaluatePolicy:LAPolicyDeviceOwnerAuthentication error:&availabilityError]) {
      [gContextLock lock];
      if (gActiveContext == context) gActiveContext = nil;
      [gContextLock unlock];
      callback(2);
      return;
    }
    [context evaluatePolicy:LAPolicyDeviceOwnerAuthentication localizedReason:text reply:^(BOOL success, NSError *error) {
      [gContextLock lock];
      if (gActiveContext == context) gActiveContext = nil;
      [gContextLock unlock];
      if (success) {
        callback(0);
        return;
      }
      NSInteger code = error ? error.code : -1;
      if (code == LAErrorUserCancel || code == LAErrorSystemCancel || code == LAErrorAppCancel) {
        callback(1);
        return;
      }
      if (code == LAErrorNotInteractive) {
        callback(4);
        return;
      }
      NSLog(@"[toonflow-auth] failed code=%ld %@", (long)code, error.localizedDescription);
      callback(3);
    }];
  });
}

// ACT: 超时或会话过期时主动关掉系统弹窗，避免弹窗悬空、后续验证全被「已有弹窗」挡住。
void tnf_cancel(void) {
  if (!gContextLock) return;
  [gContextLock lock];
  LAContext *context = gActiveContext;
  gActiveContext = nil;
  [gContextLock unlock];
  if (!context) return;
  dispatch_async(dispatch_get_main_queue(), ^{ [context invalidate]; });
}
