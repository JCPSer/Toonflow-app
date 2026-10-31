// ACT: 把 apps/desktop/native/folderPicker.m 编译成带 zh-Hans 本地化的小 .app，
// 供主进程以子进程方式调用（目录选择器）。非 macOS 直接跳过，Windows 构建不受影响。
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

if (process.platform !== "darwin") process.exit(0);

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../../..");
const out = resolve(root, "build/desktop/mac/folder-picker.app");
const contents = resolve(out, "Contents");

rmSync(out, { recursive: true, force: true });
mkdirSync(resolve(contents, "MacOS"), { recursive: true });
mkdirSync(resolve(contents, "Resources/zh-Hans.lproj"), { recursive: true });
mkdirSync(resolve(contents, "Resources/en.lproj"), { recursive: true });

// ACT: CFBundleLocalizations 声明中文，AppKit 才会把面板的侧栏与按钮本地化；缺这一项时
// 系统组件一律回落英文（osascript 子进程就是这种情况）。
writeFileSync(resolve(contents, "Info.plist"), `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleIdentifier</key><string>local.toonflow.folderpicker</string>
  <key>CFBundleName</key><string>Toonflow</string>
  <key>CFBundleDisplayName</key><string>Toonflow</string>
  <key>CFBundleExecutable</key><string>folder-picker</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>1.0</string>
  <key>CFBundleVersion</key><string>1</string>
  <key>CFBundleDevelopmentRegion</key><string>zh-Hans</string>
  <key>CFBundleLocalizations</key><array><string>zh-Hans</string><string>en</string></array>
  <key>LSMinimumSystemVersion</key><string>11.0</string>
  <key>NSHighResolutionCapable</key><true/>
  <key>LSBackgroundOnly</key><false/>
</dict>
</plist>
`);

execFileSync("clang", [
  "-fobjc-arc",
  "-framework", "Cocoa",
  // ACT: 文件模式用 UTType 做扩展名过滤（allowedFileTypes 已废弃），需要单独链接该框架。
  "-framework", "UniformTypeIdentifiers",
  "-O2",
  "-o", resolve(contents, "MacOS/folder-picker"),
  resolve(here, "../native/folderPicker.m"),
], { stdio: "inherit" });

// ACT: 链接器签好的只是单个可执行文件；bundle 里还有 zh-Hans.lproj 等资源，必须整体重签，
// 否则 `codesign -v` 会报「code has no resources but signature indicates they must be present」，
// 被替换后的 helper 可能被 Gatekeeper 拒绝执行。
execFileSync("codesign", ["--force", "--sign", "-", out], { stdio: "inherit" });

// ACT: 协作式激活的让权库。主进程（Bun）用 dlopen 加载，在 spawn 选择器之后把激活权交给它，
// 否则 helper 自己 activate 只有约 40% 成功率（实测 5 次里 3 次失败）。
const activationDylib = resolve(root, "build/desktop/mac/libToonflowActivation.dylib");
execFileSync("clang", [
  "-fobjc-arc",
  "-framework", "Cocoa",
  "-dynamiclib",
  "-O2",
  "-o", activationDylib,
  resolve(here, "../native/activation.m"),
], { stdio: "inherit" });
execFileSync("codesign", ["--force", "--sign", "-", activationDylib], { stdio: "inherit" });
console.log("已生成 macOS 激活辅助库：", activationDylib);

console.log("已生成 macOS 目录选择器：", resolve(contents, "MacOS/folder-picker"));
