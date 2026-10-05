import { createContext, createElement, useContext, type ReactNode } from 'react'
import { Vaso, type VasoProps } from 'vaso'
import { LIQUID_GLASS_DEFAULTS, type LiquidGlassArea, type LiquidGlassConfig } from '@shared/types'
import { cn } from '@/lib/utils'

/** 与 Vaso 的 prop 默认值保持一致,用于效果开关关闭后的零值判断 */
const VASO_BLUR_DEFAULT = 0.1
const VASO_SPECULAR_DEFAULT = 0.5
/** 组件未显式开启色散时的基准强度(Vaso 默认 0.5),供全局色散滑条驱动 */
const VASO_DISPERSION_DEFAULT = 0.5

const LiquidGlassConfigContext = createContext<LiquidGlassConfig>(LIQUID_GLASS_DEFAULTS)

/** 玻璃不可用时的统一回退外观:高透毛玻璃(近全透底色 + backdrop 模糊),可被 fallbackClassName 覆盖 */
const FROSTED_FALLBACK_CLASS = 'frosted-hi'

export function LiquidGlassConfigProvider({
  config,
  children
}: {
  config: LiquidGlassConfig
  children: ReactNode
}) {
  return (
    <LiquidGlassConfigContext.Provider value={{ ...LIQUID_GLASS_DEFAULTS, ...config }}>
      {children}
    </LiquidGlassConfigContext.Provider>
  )
}

export function useLiquidGlassConfig(): LiquidGlassConfig {
  return useContext(LiquidGlassConfigContext)
}

export interface LiquidGlassProps extends VasoProps {
  /**
   * 内容包一层 relative 置于玻璃层上方,保持清晰不被模糊/折射。
   * false 时不额外包层(子元素需自行保证层级),让内容真正「浸」在玻璃下。
   */
  crisp?: boolean
  /** crisp 内容包装层的类名:布局类写在内容层,尺寸/外观类写在外层容器 */
  contentClassName?: string
  /** 关闭玻璃效果回退为高透毛玻璃时附加的类名;不填用默认的 frosted-hi,填了则完全替代默认回退 */
  fallbackClassName?: string
  /** 所属界面区域;设置中可按区域单独关闭玻璃效果,不填则只受总开关与效果开关控制 */
  area?: LiquidGlassArea
}

/**
 * 液态玻璃容器:Vaso 用 backdrop-filter + SVG 位移滤镜折射背后的背景图,
 * 玻璃层是覆盖在静态子元素之上的绝对定位层,所以默认给内容包 relative 提到玻璃上方。
 * 设置(context)可整体或按区域关闭:关闭后退化为高透毛玻璃(见 FROSTED_FALLBACK_CLASS),
 * 不再渲染 Vaso 玻璃层。
 */
export function LiquidGlass({
  children,
  className,
  crisp = true,
  contentClassName,
  fallbackClassName,
  area,
  component,
  depth = 0,
  blur,
  dispersion = false,
  specular,
  ...props
}: LiquidGlassProps) {
  const glass = useLiquidGlassConfig()

  // 效果强度滑条(0-100)乘算各面板自身的基础值,保持面板间的相对设计比例
  const effectiveDepth = glass.refraction > 0 ? depth * (glass.refraction / 100) : 0
  const effectiveBlur = glass.blur > 0 ? (blur ?? VASO_BLUR_DEFAULT) * (glass.blur / 100) : 0
  const effectiveDispersion: number | false =
    glass.dispersion > 0
      ? (dispersion === false ? VASO_DISPERSION_DEFAULT : dispersion) * (glass.dispersion / 100)
      : false
  const specularBase = specular === false || specular === undefined ? VASO_SPECULAR_DEFAULT : specular
  const effectiveSpecular: number | false =
    glass.specular > 0 ? specularBase * (glass.specular / 100) : false
  const areaEnabled = area === undefined || glass[area]

  // 四项效果全为零时玻璃层不可见,直接跳过 Vaso 省掉 backdrop-filter 开销
  const rendersGlass =
    glass.enabled &&
    areaEnabled &&
    (effectiveDepth !== 0 ||
      effectiveBlur > 0 ||
      (effectiveDispersion !== false && effectiveDispersion > 0) ||
      effectiveSpecular !== false)

  if (!rendersGlass) {
    return createElement(
      component ?? 'div',
      { ...props, className: cn(className, fallbackClassName ?? FROSTED_FALLBACK_CLASS) },
      crisp ? <div className={cn('relative', contentClassName)}>{children}</div> : children
    )
  }

  return (
    <Vaso
      {...props}
      component={component}
      depth={effectiveDepth}
      blur={effectiveBlur}
      dispersion={effectiveDispersion}
      specular={effectiveSpecular}
      className={className}
    >
      {crisp ? <div className={cn('relative', contentClassName)}>{children}</div> : children}
    </Vaso>
  )
}
