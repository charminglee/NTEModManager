/**
 * lucide-react 只为 barrel(dist/lucide-react.d.ts)提供类型,深路径单图标模块
 * (dist/esm/icons/*.js)没有 .d.ts —— 而 icons.ts 正是走深路径以绕开 barrel 的
 * 打包开销。这里给这些深路径补一份环境声明,保持图标组件的类型和 barrel 一致。
 */
declare module 'lucide-react/dist/esm/icons/*.js' {
  import type { LucideIcon } from 'lucide-react/dist/lucide-react'
  const Icon: LucideIcon
  export default Icon
}
