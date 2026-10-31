// ACT: 目录 / 文件选择器的原生实现。
// 不能直接用 Electrobun 的 openFileDialog：它的 FFI 没有 canCreateDirectories 参数，面板里没有
// 「新建文件夹」；也不能用 osascript——那个进程的 NSBundle 只声明了英文，面板永远英文。
// 所以做一个自带 zh-Hans 本地化的小 .app，由主进程以子进程方式调用：面板归它自己的 NSApp，
// 既能本地化，也能精确居中，还不会阻塞主进程的事件循环。
//
// ACT: 焦点问题（macOS 14+）。Apple 从 Sonoma 起把激活改成「由用户意图驱动的请求」，
// NSApplication.activate(ignoringOtherApps:) 被标注 deprecated 且 no effect；只喊一次的话，
// 由父进程（正被用户点击的 App）拉起的这个 helper 永远拿不到 active，面板可见但不是 key
// window——表现就是「灰的、键盘没反应」。实测把 finishLaunching 补上、用 makeKeyAndOrderFront
// 并每 150ms 重试 [NSApp activate]，约 150ms 后即可拿到 active + key。
// ACT: 这里**不能**用 orderFrontRegardless——它按定义只把窗口提到最前、不改变 key window，
// 实测换成它之后面板再也拿不到键盘焦点（只有 cmd+tab 再点一下才行）。
#import <Cocoa/Cocoa.h>
#import <UniformTypeIdentifiers/UniformTypeIdentifiers.h>

static NSString *argValue(int argc, const char *argv[], const char *flag) {
  for (int i = 1; i + 1 < argc; i++) {
    if (strcmp(argv[i], flag) == 0) return [NSString stringWithUTF8String:argv[i + 1]];
  }
  return nil;
}

int main(int argc, const char *argv[]) {
  @autoreleasepool {
    NSString *start = argValue(argc, argv, "--start");
    NSString *mode = argValue(argc, argv, "--mode") ?: @"dir";
    NSString *extensions = argValue(argc, argv, "--ext");
    BOOL chooseFiles = [mode isEqualToString:@"file"];

    [NSApplication sharedApplication];
    // ACT: 无 Dock 图标的辅助 App；面板弹出后不会占住主窗口的常驻位置。
    [NSApp setActivationPolicy:NSApplicationActivationPolicyAccessory];
    // ACT: 必须先完成启动，AppKit 的激活状态才完整；缺失时 activate 请求会被静默丢弃。
    [NSApp finishLaunching];

    NSOpenPanel *panel = [NSOpenPanel openPanel];
    // 文件模式只选文件、不能建目录；目录模式只选目录、可以新建文件夹。
    panel.canChooseFiles = chooseFiles;
    panel.canChooseDirectories = !chooseFiles;
    panel.canCreateDirectories = !chooseFiles;
    panel.allowsMultipleSelection = NO;
    panel.resolvesAliases = YES;
    panel.prompt = @"选择";
    panel.message = chooseFiles ? @"选择文件" : @"选择工作目录";
    if (start.length) panel.directoryURL = [NSURL fileURLWithPath:start];

    if (chooseFiles && extensions.length) {
      NSMutableArray<UTType *> *types = [NSMutableArray array];
      for (NSString *ext in [extensions componentsSeparatedByString:@","]) {
        NSString *trimmed = [ext stringByTrimmingCharactersInSet:[NSCharacterSet whitespaceCharacterSet]];
        if (!trimmed.length) continue;
        UTType *type = [UTType typeWithFilenameExtension:trimmed];
        if (type) [types addObject:type];
      }
      if (types.count) panel.allowedContentTypes = types;
    }

    // ACT: 保持与系统默认一致的层級（NSModalPanelWindowLevel）。原来用 NSStatusWindowLevel(25)
    // 是为了在拿不到焦点时也不被主窗口盖住；激活修好后没有必要，层级过高反而会让「切到别的
    // App 之后」面板仍浮在最上层、显示成灰色，看起来像卡死。
    panel.level = NSModalPanelWindowLevel;
    [panel makeKeyAndOrderFront:nil];

    // ACT: 激活是「延迟批准」的请求：点击手势结束后系统才会放行，所以必须重试，
    // 且计时器要同时挂在模态循环模式上，否则 runModal 起来后就再也不触发了。
    __block BOOL keyed = NO;
    __block NSInteger ticks = 0;
    NSTimer *activation = [NSTimer timerWithTimeInterval:0.15 repeats:YES block:^(NSTimer *timer) {
      ticks += 1;
      if (!keyed && [NSApp isActive]) {
        keyed = YES;
        [panel makeKeyAndOrderFront:nil];
      } else if (![NSApp isActive]) {
        [NSApp activate];
      }
      // 2 秒仍拿不到激活：放弃抢，但保持可用（用户点一下即可）。
      if (ticks >= 14) [timer invalidate];
    }];
    [[NSRunLoop currentRunLoop] addTimer:activation forMode:NSModalPanelRunLoopMode];
    [[NSRunLoop currentRunLoop] addTimer:activation forMode:NSDefaultRunLoopMode];
    [NSApp activate];

    // ACT: 不要用 [panel center]——多显示器下它按面板"自己所在的屏幕"居中，可能是另一块屏（实测跑到
    // x=-1360）。这里以鼠标所在屏幕为准，给固定尺寸并夹在可视区内；布局完成后再按同一规则校正一次。
    void (^centerOnPointerScreen)(void) = ^{
      NSPoint mouse = [NSEvent mouseLocation];
      NSScreen *target = [NSScreen mainScreen];
      for (NSScreen *screen in [NSScreen screens]) {
        if (NSPointInRect(mouse, screen.frame)) { target = screen; break; }
      }
      NSRect visible = target.visibleFrame;
      CGFloat width = MIN(920, visible.size.width - 80);
      CGFloat height = MIN(580, visible.size.height - 80);
      NSRect frame = panel.frame;
      frame.size = NSMakeSize(width, height);
      frame.origin.x = visible.origin.x + (visible.size.width - width) / 2;
      frame.origin.y = visible.origin.y + (visible.size.height - height) / 2;
      [panel setFrame:frame display:YES];
    };
    centerOnPointerScreen();
    dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(0.1 * NSEC_PER_SEC)), dispatch_get_main_queue(), ^{
      centerOnPointerScreen();
    });
    dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(0.3 * NSEC_PER_SEC)), dispatch_get_main_queue(), ^{
      centerOnPointerScreen();
    });

    NSModalResponse result = [panel runModal];
    [activation invalidate];
    if (result == NSModalResponseOK && panel.URL) {
      NSString *path = [panel.URL path];
      if (path.length) {
        printf("%s\n", path.UTF8String);
        fflush(stdout);
      }
    }
  }
  return 0;
}
