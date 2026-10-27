# AGENTS.md

## 项目

NTE 模组管理器（ NTEMM ）：Windows 桌面应用，用于导入/安装/卸载/重打包 Neverness To Everness 的模组，并轮播 AI 识别裁剪的背景图。功能、配置、构建细节见 `app/README.md` 与根 `README.md` 。

## 命令（均在 `app/` 下执行）

- `npm run dev` — 日常开发与测试（浏览器模式，自动 mock `window.api` ），所有验证从它起步
- `npm run dev:electron` — 需要 Electron 能力时（玻璃效果、CDP 自动化）
- `npm run typecheck` — 交付前必须通过
- `npm run dist` — 打包绿色版，仅用户明确要求时执行

## 测试铁律

- 一律用 dev 命令启动并在内置浏览器中打开网页进行验证，所有测试一律在内置浏览器中完成，让**禁止** 直接启动 exe 。
- 收尾清理残留 vite/electron 进程与临时截图；残留实例会让下次 dev 静默失败。
- 测试期间临时生成的所有文件统一放到 `.tmp/` 目录。

## 代码规范

- 文件操作要有重试与回滚意识，进度与失败经 logger 推送。
- 所有文本的标点符号（包括 UI 界面、文档、注释等非技术性文本）使用中文标点。
