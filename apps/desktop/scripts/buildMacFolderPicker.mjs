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
  "-O2",
  "-o", resolve(contents, "MacOS/folder-picker"),
  resolve(here, "../native/folderPicker.m"),
], { stdio: "inherit" });

console.log("已生成 macOS 目录选择器：", resolve(contents, "MacOS/folder-picker"));
