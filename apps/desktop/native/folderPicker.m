// ACT: 目录选择器的原生实现。
// 不能直接用 Electrobun 的 openFileDialog：它的 FFI 没有 canCreateDirectories 参数，面板里没有
// 「新建文件夹」；也不能用 osascript——那个进程的 NSBundle 只声明了英文，面板永远英文。
// 所以做一个自带 zh-Hans 本地化的小 .app，由主进程以子进程方式调用：面板归它自己的 NSApp，
// 既能本地化，也能精确居中。
#import <Cocoa/Cocoa.h>

int main(int argc, const char *argv[]) {
  @autoreleasepool {
    NSString *start = nil;
    for (int i = 1; i + 1 < argc; i++) {
      if (strcmp(argv[i], "--start") == 0) start = [NSString stringWithUTF8String:argv[i + 1]];
    }

    [NSApplication sharedApplication];
    // ACT: 无 Dock 图标的辅助 App；面板弹出后不会占住主窗口的常驻位置。
    [NSApp setActivationPolicy:NSApplicationActivationPolicyAccessory];
    [NSApp activateIgnoringOtherApps:YES];

    NSOpenPanel *panel = [NSOpenPanel openPanel];
    panel.canChooseFiles = NO;
    panel.canChooseDirectories = YES;
    panel.canCreateDirectories = YES;
    panel.allowsMultipleSelection = NO;
    panel.resolvesAliases = YES;
    panel.prompt = @"选择";
    panel.message = @"选择工作目录";
    if (start.length) panel.directoryURL = [NSURL fileURLWithPath:start];

    // ACT: 子进程不一定是前台 App，普通窗口会被主窗口盖住；提到状态窗层级保证可见。
    panel.level = NSStatusWindowLevel;
    [panel makeKeyAndOrderFront:nil];

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
