/**
 * lucide-react 图标的集中转出口。
 *
 * 不直接用 `import { X } from 'lucide-react'`:那个 barrel 有 1555 行 re-export、
 * 指到 3496 个图标模块,rollup 必须逐个读取/解析,实测拖慢渲染层打包约 1.1s
 * (1689 → 180 个模块)。这里按需转出真正用到的图标,走 .js 深路径直接命中单图标模块。
 *
 * 新增图标:在此加一行 `export { default as Xxx } from 'lucide-react/dist/esm/icons/xxx.js'`
 * (文件名是图标名的 kebab-case,如 RefreshCcw → refresh-ccw.js,Trash2 → trash-2.js)。
 * 忘了加会在 `npm run typecheck` 直接报错(tsconfig.web.json 把 bare `lucide-react`
 * 映射到本文件),这是有意为之的护栏。
 */
export { default as ArrowDown } from 'lucide-react/dist/esm/icons/arrow-down.js'
export { default as ArrowUpDown } from 'lucide-react/dist/esm/icons/arrow-up-down.js'
export { default as Blocks } from 'lucide-react/dist/esm/icons/blocks.js'
export { default as Check } from 'lucide-react/dist/esm/icons/check.js'
export { default as ChevronDown } from 'lucide-react/dist/esm/icons/chevron-down.js'
export { default as ChevronRight } from 'lucide-react/dist/esm/icons/chevron-right.js'
export { default as ChevronUp } from 'lucide-react/dist/esm/icons/chevron-up.js'
export { default as Circle } from 'lucide-react/dist/esm/icons/circle.js'
export { default as CircleArrowUp } from 'lucide-react/dist/esm/icons/circle-arrow-up.js'
export { default as CircleCheck } from 'lucide-react/dist/esm/icons/circle-check.js'
export { default as CircleX } from 'lucide-react/dist/esm/icons/circle-x.js'
export { default as Download } from 'lucide-react/dist/esm/icons/download.js'
export { default as File } from 'lucide-react/dist/esm/icons/file.js'
export { default as FileText } from 'lucide-react/dist/esm/icons/file-text.js'
export { default as Folder } from 'lucide-react/dist/esm/icons/folder.js'
export { default as FolderInput } from 'lucide-react/dist/esm/icons/folder-input.js'
export { default as FolderOpen } from 'lucide-react/dist/esm/icons/folder-open.js'
export { default as Import } from 'lucide-react/dist/esm/icons/import.js'
export { default as Info } from 'lucide-react/dist/esm/icons/info.js'
export { default as Layers } from 'lucide-react/dist/esm/icons/layers.js'
export { default as ListChecks } from 'lucide-react/dist/esm/icons/list-checks.js'
export { default as LoaderCircle } from 'lucide-react/dist/esm/icons/loader-circle.js'
export { default as MoreHorizontal } from 'lucide-react/dist/esm/icons/more-horizontal.js'
export { default as Package } from 'lucide-react/dist/esm/icons/package.js'
export { default as PackageCheck } from 'lucide-react/dist/esm/icons/package-check.js'
export { default as PackageOpen } from 'lucide-react/dist/esm/icons/package-open.js'
export { default as Pencil } from 'lucide-react/dist/esm/icons/pencil.js'
export { default as Play } from 'lucide-react/dist/esm/icons/play.js'
export { default as RefreshCcw } from 'lucide-react/dist/esm/icons/refresh-ccw.js'
export { default as RefreshCw } from 'lucide-react/dist/esm/icons/refresh-cw.js'
export { default as Search } from 'lucide-react/dist/esm/icons/search.js'
export { default as Settings } from 'lucide-react/dist/esm/icons/settings.js'
export { default as Trash2 } from 'lucide-react/dist/esm/icons/trash-2.js'
export { default as TriangleAlert } from 'lucide-react/dist/esm/icons/triangle-alert.js'
export { default as Upload } from 'lucide-react/dist/esm/icons/upload.js'
export { default as Wrench } from 'lucide-react/dist/esm/icons/wrench.js'
export { default as X } from 'lucide-react/dist/esm/icons/x.js'
// 类型走深层 d.ts:本文件被 tsconfig 映射为 `lucide-react` 本体,直接用裸包名会自引用
export type { LucideIcon } from 'lucide-react/dist/lucide-react'
