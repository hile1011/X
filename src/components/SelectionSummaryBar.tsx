/**
 * 在线表格选中单元格汇总状态栏
 *
 * 功能：
 *   - 显示选中单元格的 求和/平均值/计数/数值计数/最小值/最大值
 *   - 实时随选区变化与单元格值修改更新（由父组件传入 summary）
 *   - 齿轮按钮打开设置面板，自定义默认显示的指标（持久化到 localStorage）
 *   - 清晰标识当前展示的指标（chip 形式，标签 + 值）
 *   - 无选区或单格时仍可展示单值
 */
import { useState, useEffect, useRef } from 'react'
import { Settings2, Check, RotateCcw, X } from 'lucide-react'
import {
  type SelectionSummary,
  type MetricKey,
  METRIC_CONFIGS,
  ALL_METRICS,
  DEFAULT_METRICS,
  loadVisibleMetrics,
  saveVisibleMetrics,
} from '../utils/SelectionSummary'

interface SelectionSummaryBarProps {
  /** 汇总结果；null 表示当前无选区 */
  summary: SelectionSummary | null
}

export default function SelectionSummaryBar({ summary }: SelectionSummaryBarProps) {
  const [visibleMetrics, setVisibleMetrics] = useState<MetricKey[]>(() => loadVisibleMetrics())
  const [showSettings, setShowSettings] = useState(false)
  const settingsRef = useRef<HTMLDivElement>(null)

  // 设置变化时持久化
  useEffect(() => {
    saveVisibleMetrics(visibleMetrics)
  }, [visibleMetrics])

  // 点击外部关闭设置面板
  useEffect(() => {
    if (!showSettings) return
    const handleClickOutside = (e: MouseEvent) => {
      if (settingsRef.current && !settingsRef.current.contains(e.target as Node)) {
        setShowSettings(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [showSettings])

  const toggleMetric = (key: MetricKey) => {
    setVisibleMetrics((prev) =>
      prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key],
    )
  }

  const resetMetrics = () => setVisibleMetrics([...DEFAULT_METRICS])

  // 无选区时显示提示文本
  const hasSelection = summary !== null && summary.count > 0

  return (
    <div className="relative flex items-center gap-3 px-3 py-1.5 bg-gray-50 border-t border-gray-200 text-xs text-gray-600 select-none">
      {/* 左侧：选区信息 */}
      <div className="flex items-center gap-2 flex-shrink-0">
        {hasSelection ? (
          <>
            <span className="inline-flex items-center gap-1 text-gray-500">
              <span className="font-medium text-gray-700">{summary!.count}</span>
              <span>个单元格</span>
            </span>
            {summary!.numericCount > 0 && summary!.numericCount !== summary!.count && (
              <span className="text-gray-400">·</span>
            )}
            {summary!.numericCount > 0 && (
              <span className="inline-flex items-center gap-1 text-gray-500">
                <span className="font-medium text-primary-600">{summary!.numericCount}</span>
                <span>个数值</span>
              </span>
            )}
          </>
        ) : (
          <span className="text-gray-400">选择单元格以查看汇总</span>
        )}
      </div>

      {/* 分隔线 */}
      {hasSelection && visibleMetrics.length > 0 && (
        <div className="w-px h-4 bg-gray-300 flex-shrink-0" />
      )}

      {/* 中间：指标 chips */}
      <div className="flex items-center gap-1.5 flex-wrap flex-1 min-w-0">
        {hasSelection &&
          visibleMetrics.map((key) => {
            const config = METRIC_CONFIGS[key]
            if (!config) return null
            const value = config.format(summary!)
            return (
              <div
                key={key}
                className="inline-flex items-center gap-1.5 px-2 py-0.5 bg-white border border-gray-200 rounded-md shadow-sm"
                title={config.label}
              >
                <span className="text-gray-400">{config.label}</span>
                <span className="font-semibold text-gray-800 tabular-nums">{value}</span>
              </div>
            )
          })}
      </div>

      {/* 右侧：设置按钮 */}
      <div className="relative flex-shrink-0" ref={settingsRef}>
        <button
          onClick={() => setShowSettings((v) => !v)}
          className={`flex items-center gap-1 px-2 py-1 rounded-md transition-colors min-h-[28px] ${
            showSettings
              ? 'bg-primary-100 text-primary-700'
              : 'text-gray-400 hover:text-gray-600 hover:bg-gray-100'
          }`}
          title="自定义汇总指标"
          aria-label="自定义汇总指标"
        >
          <Settings2 size={14} />
        </button>

        {showSettings && (
          <div className="absolute right-0 bottom-full mb-1 w-56 bg-white border border-gray-200 rounded-lg shadow-lg z-30">
            <div className="flex items-center justify-between px-3 py-2 border-b border-gray-100">
              <span className="text-xs font-semibold text-gray-700">显示指标</span>
              <div className="flex items-center gap-1">
                <button
                  onClick={resetMetrics}
                  className="text-gray-400 hover:text-primary-600 p-1 rounded transition-colors"
                  title="恢复默认"
                >
                  <RotateCcw size={12} />
                </button>
                <button
                  onClick={() => setShowSettings(false)}
                  className="text-gray-400 hover:text-gray-600 p-1 rounded transition-colors"
                  title="关闭"
                >
                  <X size={14} />
                </button>
              </div>
            </div>
            <div className="py-1">
              {ALL_METRICS.map((key) => {
                const config = METRIC_CONFIGS[key]
                const checked = visibleMetrics.includes(key)
                return (
                  <button
                    key={key}
                    onClick={() => toggleMetric(key)}
                    className="flex items-center gap-2 w-full px-3 py-1.5 text-left hover:bg-gray-50 transition-colors"
                  >
                    <span
                      className={`flex items-center justify-center w-4 h-4 rounded border flex-shrink-0 ${
                        checked
                          ? 'bg-primary-600 border-primary-600 text-white'
                          : 'border-gray-300 bg-white'
                      }`}
                    >
                      {checked && <Check size={11} strokeWidth={3} />}
                    </span>
                    <span className="text-xs text-gray-700">{config.label}</span>
                  </button>
                )
              })}
            </div>
            <div className="px-3 py-1.5 border-t border-gray-100 text-[10px] text-gray-400">
              设置自动保存，下次打开仍生效
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
