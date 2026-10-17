import {
  createContext,
  createElement,
  forwardRef,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentType,
  type ForwardedRef,
  type HTMLAttributes,
  type ReactNode
} from 'react'
import type { GlassConfig } from '@ybouane/liquidglass'
import { createGlassEngine, type GlassEngine, type SceneLayer } from '@/lib/liquid-glass/engine'
import {
  LIQUID_GLASS_DEFAULTS,
  UI_CORNER_RADIUS_DEFAULT,
  type LiquidGlassArea,
  type LiquidGlassConfig
} from '@shared/types'
import { cn } from '@/lib/utils'

/**
 * 液态玻璃(WebGL 版):面板/控件背后的画面由「场景链」提供 —— 应用背景图 + 遮罩
 * 由 BackgroundLayer 注册为全局场景;面板里的玻璃片(按钮/输入框覆盖层)改以所在
 * 面板的玻璃画布为场景,看到的是面板已折射后的画面,而不是生背景。
 *
 * 与旧实现(backdrop-filter 位移贴图)的关键差别:
 *   · 玻璃内容始终是活的 DOM(可交互、可选中),折射层是注入的 canvas(z-index:-1),
 *     内容因此永远清晰;
 *   · 玻璃元素所在元素必须自成层叠上下文(.glass-surface 提供 isolation:isolate),
 *     否则负 z-index 的注入画布会挂到更外层去,被祖先内容盖住。
 */

/** 效果强度低于该阈值视为关闭(浮点比较容差) */
const STRENGTH_EPSILON = 0.001

const LiquidGlassConfigContext = createContext<LiquidGlassConfig>(LIQUID_GLASS_DEFAULTS)

/**
 * 全局圆角(px)。玻璃圆角由 shader 自绘,必须与元素 CSS 的 rounded-* 一致,
 * 因此与 CSS 侧同源于设置里的「全局圆角」。
 */
const UICornerRadiusContext = createContext<number>(UI_CORNER_RADIUS_DEFAULT)

/** 最近的可作为场景来源的玻璃面板;玻璃片(按钮/输入框覆盖层)用它当背景 */
const ParentGlassContext = createContext<HTMLElement | null>(null)

const GlassRuntimeContext = createContext<GlassRuntime | null>(null)

export function useUICornerRadius(): number {
  return useContext(UICornerRadiusContext)
}

export function useLiquidGlassConfig(): LiquidGlassConfig {
  return useContext(LiquidGlassConfigContext)
}

/** 玻璃不可用时的统一回退外观:高透毛玻璃(近全透底色 + backdrop 模糊),可被 fallbackClassName 覆盖 */
const FROSTED_FALLBACK_CLASS = 'frosted-hi'

/** 引擎缺省参数:各面板具体数值由 LiquidGlass 逐个下发(data-config) */
const ENGINE_DEFAULTS: Partial<GlassConfig> = {
  opacity: 1,
  saturation: 0,
  distortion: 0
}

/**
 * 玻璃运行时:持有引擎并维护「元素 → 场景」注册表。
 * React 子组件的 effect 先于 Provider 的 effect 执行,故先收集注册,引擎就绪后统一接入。
 */
class GlassRuntime {
  private engine: GlassEngine | null = null
  private readonly pending = new Map<HTMLElement, SceneLayer[] | null>()
  private backgroundLayers: SceneLayer[] = []
  private suspended = false
  private failed = false
  private readonly failureListeners = new Set<() => void>()

  /** 引擎因环境原因(无 WebGL 等)不可用 */
  get unavailable(): boolean {
    return this.failed
  }

  onFailureChange(listener: () => void): () => void {
    this.failureListeners.add(listener)
    return () => {
      this.failureListeners.delete(listener)
    }
  }

  attach(engine: GlassEngine): void {
    this.engine = engine
    engine.setDefaultScene(this.backgroundLayers)
    engine.setSuspended(this.suspended)
    for (const [el, layers] of this.pending) {
      engine.addGlass(el, layers)
    }
  }

  detach(): void {
    this.engine?.destroy()
    this.engine = null
  }

  /** 判断某个引擎是否仍是当前接入的实例(旧实例的异步回调用它做自我检查) */
  isCurrent(engine: GlassEngine): boolean {
    return this.engine === engine
  }

  markFailed(): void {
    this.failed = true
    this.engine = null
    for (const listener of this.failureListeners) listener()
  }

  register(el: HTMLElement, layers: SceneLayer[] | null): () => void {
    this.pending.set(el, layers)
    this.engine?.addGlass(el, layers)
    return () => {
      this.pending.delete(el)
      this.engine?.removeGlass(el)
    }
  }

  setConfig(el: HTMLElement, config: Partial<GlassConfig>): void {
    this.engine?.setConfig(el, config)
  }

  setBackgroundLayers(layers: SceneLayer[]): void {
    this.backgroundLayers = layers
    this.engine?.setDefaultScene(layers)
    this.engine?.markAll()
  }

  invalidateScene(el: HTMLElement | null): void {
    this.engine?.invalidateScene(el)
  }

  setSuspended(suspended: boolean): void {
    this.suspended = suspended
    this.engine?.setSuspended(suspended)
  }

  /** 诊断快照(devtools 用):玻璃数量、帧率、当前场景层 */
  debugSnapshot(): {
    glassCount: number
    fps: number
    unavailable: boolean
    backgroundLayers: string[]
  } {
    return {
      glassCount: this.engine?.glassCount ?? 0,
      fps: this.engine?.fps ?? 0,
      unavailable: this.failed,
      backgroundLayers: this.backgroundLayers.map((layer) =>
        'color' in layer
          ? `color:${layer.color}`
          : 'paint' in layer
            ? 'paint'
            : `${layer.el.tagName}.${layer.el.className || '-'}`
      )
    }
  }

  /** 诊断用:拿到引擎实例 */
  debugEngine(): GlassEngine | null {
    return this.engine
  }
}

/**
 * 应用级液态玻璃 Provider:下发配置/圆角并持有唯一玻璃引擎(一个 WebGL 上下文)。
 * 它同时渲染坐标基准容器 —— 必须覆盖整个视口;玻璃元素可以在其下任意层级。
 */
export function LiquidGlassProvider({
  config,
  cornerRadius,
  className,
  suspended = false,
  children
}: {
  config: LiquidGlassConfig
  /** 全局圆角(px);同时下发 CSS 侧与玻璃 shader 侧 */
  cornerRadius?: number
  className?: string
  /** 界面整体隐藏(F9)时暂停玻璃渲染,恢复后统一重画 */
  suspended?: boolean
  children: ReactNode
}) {
  const rootRef = useRef<HTMLDivElement | null>(null)
  const runtime = useMemo(() => new GlassRuntime(), [])
  const [, forceUpdate] = useState(0)
  const radius = cornerRadius ?? UI_CORNER_RADIUS_DEFAULT

  useEffect(
    () =>
      runtime.onFailureChange(() => {
        forceUpdate((n) => n + 1)
      }),
    [runtime]
  )

  useEffect(() => {
    const root = rootRef.current
    if (!root || runtime.unavailable) return
    let engine: GlassEngine
    try {
      engine = createGlassEngine({ root, defaults: ENGINE_DEFAULTS })
    } catch (error) {
      console.error('[liquid-glass] 玻璃引擎创建失败,已回退毛玻璃', error)
      runtime.markFailed()
      return
    }
    runtime.attach(engine)
    void engine.start().catch((error) => {
      // 旧实例的启动失败可能晚于新实例接管(开发态 StrictMode 双挂载/热更新),
      // 这种迟到回调不能误伤当前引擎
      if (!runtime.isCurrent(engine)) return
      console.error('[liquid-glass] 玻璃引擎启动失败,已回退毛玻璃', error)
      runtime.detach()
      runtime.markFailed()
    })
    return () => {
      runtime.detach()
    }
    // unavailable 变化时重新评估(从失败恢复不了,只是保持分支一致)
  }, [runtime, runtime.unavailable])

  useEffect(() => {
    runtime.setSuspended(suspended)
  }, [runtime, suspended])

  // 开发期调试钩子(打包版不含):control 台里可以直接观察/驱动玻璃引擎
  useEffect(() => {
    if (!import.meta.env.DEV) return
    ;(window as unknown as Record<string, unknown>).__ntemmGlass = runtime
  }, [runtime])

  const value = useMemo(() => ({ ...LIQUID_GLASS_DEFAULTS, ...config }), [config])

  return (
    <LiquidGlassConfigContext.Provider value={value}>
      <UICornerRadiusContext.Provider value={radius}>
        <GlassRuntimeContext.Provider value={runtime}>
          <div ref={rootRef} className={cn('relative', className)}>
            {children}
          </div>
        </GlassRuntimeContext.Provider>
      </UICornerRadiusContext.Provider>
    </LiquidGlassConfigContext.Provider>
  )
}

/**
 * 全局场景(背景图与遮罩)的注册入口,供 BackgroundLayer 使用。
 * 换代/淡入淡出时更新场景链并触发整体重画。
 */
export function useGlassScene(): {
  setBackgroundLayers(layers: SceneLayer[]): void
  invalidateScene(el: HTMLElement | null): void
} {
  const runtime = useContext(GlassRuntimeContext)
  return useMemo(
    () => ({
      setBackgroundLayers: (layers: SceneLayer[]) => runtime?.setBackgroundLayers(layers),
      invalidateScene: (el: HTMLElement | null) => runtime?.invalidateScene(el)
    }),
    [runtime]
  )
}

/** 引擎不可用(无 WebGL 等)时全部玻璃退回毛玻璃外观 */
function useGlassUnavailable(): boolean {
  const runtime = useContext(GlassRuntimeContext)
  const [, forceUpdate] = useState(0)
  useEffect(() => {
    if (!runtime) return
    return runtime.onFailureChange(() => {
      forceUpdate((n) => n + 1)
    })
  }, [runtime])
  return !runtime || runtime.unavailable
}

export interface LiquidGlassProps<E extends HTMLElement = HTMLDivElement>
  extends Omit<HTMLAttributes<E>, 'ref'> {
  /** 内容包一层 relative 置于玻璃层上方,保持清晰;false 时不额外包层 */
  crisp?: boolean
  /** crisp 内容包装层的类名:布局类写在内容层,尺寸/外观类写在外层容器 */
  contentClassName?: string
  /** 玻璃不可用/关闭时附加的类名;不填用默认的 frosted-hi,填了则完全替代默认回退 */
  fallbackClassName?: string
  /** 所属界面区域;设置中可按区域单独关闭玻璃效果,不填则只受总开关与效果开关控制 */
  area?: LiquidGlassArea
  /** 宽松化宿主元素类型:自定义宿主组件常携带更具体的元素属性(如按钮的 disabled) */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  component?: string | ComponentType<any>
  /**
   * 玻璃层叠在另一块玻璃之上(面板里的按钮/输入框等):以所在面板的玻璃为背景来源,
   * 折射的是面板已渲染的画面,与面板保持同一层视觉。
   */
  overlay?: boolean
  /**
   * 参数档位:
   *   panel   —— 大面板:blur 0.3 / 色散 0.2 / 折射 1.2
   *   control —— 按钮与输入框:blur 0.3 / 折射 0.69,带悬浮压按反馈
   *   pill    —— 细条指示器:不模糊 / 内沿高光 0.2 / 投影 0.25
   */
  variant?: LiquidGlassVariant
  /** 玻璃自身不透明度:彩色按钮(实心变体)用它把底色透出来,形成有色玻璃 */
  opacity?: number
  /** 交互反馈:悬浮提亮、按下压平棱面 */
  button?: boolean
  /** 多态宿主:允许透传具体元素专有的属性(如 button 的 disabled / type) */
  [key: string]: unknown
}

export type LiquidGlassVariant = 'panel' | 'control' | 'pill'

/**
 * 三档玻璃参数。
 * 除下面这些键以外全部沿用库默认值:specular 0、fresnel 1、tint 0、distortion 0、
 * opacity 1、shadowSpread 10 …;zRadius 与 cornerRadius 取齐(60/60、20/20、16/16),
 * 即「玻璃厚度 = 圆角」的对应关系。
 */
const GLASS_PRESETS: Record<
  LiquidGlassVariant,
  {
    blurAmount: number
    chromAberration: number
    refraction: number
    edgeHighlight: number
    shadowOpacity: number
    button: boolean
  }
> = {
  panel: {
    blurAmount: 0.3,
    chromAberration: 0.2,
    refraction: 1.2,
    edgeHighlight: 0.05,
    shadowOpacity: 0,
    button: false
  },
  control: {
    blurAmount: 0.3,
    chromAberration: 0.05,
    refraction: 0.69,
    edgeHighlight: 0.05,
    shadowOpacity: 0,
    button: true
  },
  pill: {
    blurAmount: 0,
    chromAberration: 0.05,
    refraction: 0.69,
    edgeHighlight: 0.2,
    shadowOpacity: 0.25,
    button: false
  }
}

/**
 * 档位基准参数 × 设置项 → 库配置。
 *
 * 强度四项(折射/模糊/边缘高光/色散)是**乘算**相对的百分比;材质与光学各项是
 * **绝对值**,直接覆盖基准(这些键本就是 0 / 1 这类中性值);
 * 不透明度、倒角厚度按各档位基准缩放;投影是「基准 + 额外投影」叠加。
 */
function buildGlassConfig(
  variant: LiquidGlassVariant,
  opacity: number,
  button: boolean,
  glass: LiquidGlassConfig,
  cornerRadius: number
): Partial<GlassConfig> {
  const preset = GLASS_PRESETS[variant]
  const percent = (value: number) => Math.max(0, value) / 100

  return {
    // 强度相对档位基准缩放
    blurAmount: preset.blurAmount * percent(glass.blur),
    chromAberration: preset.chromAberration * percent(glass.dispersion),
    refraction: preset.refraction * percent(glass.refraction),
    edgeHighlight: preset.edgeHighlight * percent(glass.edgeHighlight),
    // 材质与光学:绝对值
    brightness: glass.brightness / 100,
    saturation: glass.saturation / 100,
    tintStrength: percent(glass.tint),
    distortion: percent(glass.distortion),
    specular: percent(glass.gloss),
    fresnel: glass.fresnel / 100,
    bevelMode: glass.bevelMode,
    // 形状:厚度按「圆角 = 厚度」的关系缩放,至少留 1px 避免除零
    zRadius: Math.max(1, cornerRadius * percent(glass.bevel)),
    cornerRadius,
    // 不透明度:按各面板基准(面板 1、有色按钮 0.6)缩放
    opacity: opacity * percent(glass.opacity),
    // 投影:面板基准 + 额外投影
    shadowOpacity: Math.min(1, preset.shadowOpacity + percent(glass.shadow)),
    shadowSpread: glass.shadowSpread,
    shadowOffsetY: glass.shadowOffsetY,
    button: button && glass.buttonFeedback
  }
}

/**
 * 液态玻璃容器。默认作为「面板」:背景来源是应用背景图 + 遮罩(BackgroundLayer 注册);
 * overlay 模式叠在面板玻璃之上:背景来源是所在面板的玻璃画布。
 */
export const LiquidGlass = forwardRef<HTMLElement, LiquidGlassProps<HTMLElement>>(function LiquidGlass(
  {
    children,
    className,
    style,
    crisp = true,
    contentClassName,
    fallbackClassName,
    area,
    component,
    overlay = false,
    variant = 'panel',
    opacity = 1,
    button = false,
    ...props
  }: LiquidGlassProps<HTMLElement>,
  forwardedRef: ForwardedRef<HTMLElement>
) {
  const glass = useLiquidGlassConfig()
  const cornerRadius = useUICornerRadius()
  const runtime = useContext(GlassRuntimeContext)
  const parentGlass = useContext(ParentGlassContext)
  const unavailable = useGlassUnavailable()
  const [element, setElement] = useState<HTMLElement | null>(null)

  const preset = GLASS_PRESETS[variant]
  const effective = useMemo(
    () => ({
      refraction: preset.refraction * (glass.refraction / 100),
      blurAmount: preset.blurAmount * (glass.blur / 100),
      dispersionAmount: preset.chromAberration * (glass.dispersion / 100),
      edgeHighlight: preset.edgeHighlight * (glass.edgeHighlight / 100),
      gloss: glass.gloss / 100,
      distortion: glass.distortion / 100
    }),
    [preset, glass]
  )

  const areaEnabled = area === undefined || glass[area]
  const rendersGlass =
    !unavailable &&
    glass.enabled &&
    areaEnabled &&
    (effective.refraction > STRENGTH_EPSILON ||
      effective.blurAmount > STRENGTH_EPSILON ||
      effective.dispersionAmount > STRENGTH_EPSILON ||
      effective.edgeHighlight > STRENGTH_EPSILON ||
      effective.gloss > STRENGTH_EPSILON ||
      effective.distortion > STRENGTH_EPSILON)

  const config = useMemo(
    () => buildGlassConfig(variant, opacity, button, glass, cornerRadius),
    [variant, opacity, button, glass, cornerRadius]
  )

  // 先写配置再注册:注册当帧即按正确参数渲染
  useEffect(() => {
    if (!runtime || !element) return
    if (!rendersGlass) {
      delete element.dataset.config
      return
    }
    runtime.setConfig(element, config)
  }, [runtime, element, rendersGlass, config])

  useEffect(() => {
    if (!runtime || !element || !rendersGlass) return
    const scene: SceneLayer[] | null = overlay && parentGlass ? [{ el: parentGlass }] : null
    return runtime.register(element, scene)
  }, [runtime, element, rendersGlass, overlay, parentGlass])

  // ref 必须保持稳定:内联回调每次渲染都会换来一轮「先 null 再节点」的调用,
  // 会让 element 状态与玻璃注册反复抖动
  const assignRef = useCallback(
    (node: HTMLElement | null) => {
      setElement((prev) => (prev === node ? prev : node))
      if (typeof forwardedRef === 'function') {
        forwardedRef(node)
      } else if (forwardedRef) {
        forwardedRef.current = node
      }
    },
    [forwardedRef]
  )

  const content = crisp ? (
    <div className={cn('relative', contentClassName)}>{children}</div>
  ) : (
    children
  )

  if (!rendersGlass) {
    return createElement(
      (component ?? 'div') as string,
      {
        ...props,
        ref: assignRef,
        style,
        className: cn(className, fallbackClassName ?? FROSTED_FALLBACK_CLASS)
      },
      content
    )
  }

  return createElement(
    (component ?? 'div') as string,
    {
      ...props,
      ref: assignRef,
      style,
      className: cn('glass-surface', className)
    },
    // overlay 之外的玻璃都把自己登记为「场景来源」,供内部玻璃片采样
    overlay ? (
      content
    ) : (
      <ParentGlassContext.Provider value={element}>{content}</ParentGlassContext.Provider>
    )
  )
})
