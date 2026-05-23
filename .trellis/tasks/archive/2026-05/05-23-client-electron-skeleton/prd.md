# Task: Client Electron Skeleton（切片 0 - 第 3 个）

## 目标

在 `packages/client` 下建 Electron + React + Vite 桌面客户端骨架，能 `pnpm dev` 启动一个 Hello World 窗口。

## 输入

- 参考：`docs/spec/00-overview.md §3`（主进程/渲染进程职责）
- 参考：`docs/spec/09-cross-cutting.md §10`（打包配置）

## 验收标准

- [ ] `packages/client/package.json`，依赖：electron 33+, electron-vite, react 18+, react-dom, react-router-dom, tailwindcss, @tailwindcss/postcss, zustand, better-sqlite3, pino, zod
- [ ] `packages/client/electron.vite.config.ts`
- [ ] `packages/client/tsconfig.json`（继承 base，含 React JSX）
- [ ] 主进程入口 `src/main/index.ts`：创建 BrowserWindow，加载 renderer
- [ ] preload `src/preload/index.ts`：暴露最小 IPC API
- [ ] 渲染进程入口 `src/renderer/index.html` + `src/renderer/src/main.tsx`
- [ ] 一个简单的 App 组件，显示"腾域 aipod - Hello World - 版本 X.Y.Z"
- [ ] Tailwind 配好（`tailwind.config.ts` + `postcss.config.cjs` + `src/renderer/src/index.css`）
- [ ] shadcn/ui 初始化（`components.json`），先装一个 `button` 组件做演示
- [ ] `pnpm -F @tengyu-aipod/client dev` 能启动桌面窗口
- [ ] 渲染进程加载完成后 < 5 秒

## 不做

- 不实现任何业务功能
- 不连数据库
- 不连服务端
- 不写 IPC handler 业务逻辑
- 暂不集成 shadcn 全套组件

## 实施提示

依赖 `@tengyu-aipod/shared`：

```json
{
  "dependencies": {
    "@tengyu-aipod/shared": "workspace:*"
  }
}
```

主进程窗口配置：

```ts
const mainWindow = new BrowserWindow({
  width: 1400,
  height: 900,
  minWidth: 1100,
  minHeight: 700,
  webPreferences: {
    preload: path.join(__dirname, '../preload/index.js'),
    contextIsolation: true,
    nodeIntegration: false,
  },
  title: '腾域 aipod',
})
```

shadcn 安装：
```bash
cd packages/client
pnpm dlx shadcn@latest init
pnpm dlx shadcn@latest add button
```

## 完成后

```bash
git add -A
git commit -m "feat(task-03): client electron skeleton with hello world"
python3 .trellis/scripts/task.py archive 05-23-client-electron-skeleton
```
