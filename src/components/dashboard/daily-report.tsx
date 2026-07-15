"use client";

import {
  TrendingUp,
  TrendingDown,
  FileText,
  AlertTriangle,
  BookOpen,
  Zap,
  Clock,
  Timer,
  ArrowUpRight,
} from "lucide-react";

// -- Types --
export interface DailyReportData {
  overview: {
    eventCount: number;
    successRate: number;
    successRateTrend: number;
    mttd: string;
    mttr: string;
    escalations: number;
  };
  layers: {
    name: string;
    rate: number;
    events: number;
  }[];
  runbook: {
    total: number;
    newToday: number;
    hitRate: number;
  };
  anomalies: {
    doomLoops: number;
    highLatency: number;
  };
}

interface DailyReportProps {
  report: DailyReportData;
}

export default function DailyReport({ report }: DailyReportProps) {
  const { overview, layers, runbook, anomalies } = report;

  return (
    <div className="bg-gray-900 rounded-xl border border-gray-800 p-5 space-y-5">
      {/* Header */}
      <div className="flex items-center gap-2">
        <FileText className="w-4 h-4 text-blue-400" />
        <h3 className="text-sm font-semibold text-white">今日概览日报</h3>
        <span className="ml-auto text-[10px] text-gray-500 bg-gray-800 px-2 py-0.5 rounded">
          钉钉消息预览
        </span>
      </div>

      {/* Overview section */}
      <div className="bg-gray-800/50 rounded-lg p-4 space-y-3">
        <h4 className="text-xs font-semibold text-gray-300 uppercase tracking-wider">
          今日概览
        </h4>
        <div className="grid grid-cols-2 gap-3">
          <div className="flex items-center gap-2">
            <Zap className="w-3.5 h-3.5 text-blue-400" />
            <span className="text-xs text-gray-400">事件数</span>
            <span className="text-xs font-bold text-white ml-auto">
              {overview.eventCount}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <TrendingUp className="w-3.5 h-3.5 text-emerald-400" />
            <span className="text-xs text-gray-400">成功率</span>
            <div className="flex items-center gap-1 ml-auto">
              <span className="text-xs font-bold text-white">
                {overview.successRate.toFixed(1)}%
              </span>
              {overview.successRateTrend !== 0 && (
                <span
                  className={`text-[10px] ${
                    overview.successRateTrend >= 0
                      ? "text-emerald-400"
                      : "text-rose-400"
                  }`}
                >
                  {overview.successRateTrend >= 0 ? (
                    <TrendingUp className="w-3 h-3 inline" />
                  ) : (
                    <TrendingDown className="w-3 h-3 inline" />
                  )}
                </span>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Clock className="w-3.5 h-3.5 text-amber-400" />
            <span className="text-xs text-gray-400">MTTD</span>
            <span className="text-xs font-bold text-white ml-auto">
              {overview.mttd}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <Timer className="w-3.5 h-3.5 text-violet-400" />
            <span className="text-xs text-gray-400">MTTR</span>
            <span className="text-xs font-bold text-white ml-auto">
              {overview.mttr}
            </span>
          </div>
          <div className="flex items-center gap-2 col-span-2">
            <ArrowUpRight className="w-3.5 h-3.5 text-rose-400" />
            <span className="text-xs text-gray-400">升级至人工</span>
            <span className="text-xs font-bold text-white ml-auto">
              {overview.escalations}
            </span>
          </div>
        </div>
      </div>

      {/* Layer breakdown */}
      <div className="bg-gray-800/50 rounded-lg p-4 space-y-3">
        <h4 className="text-xs font-semibold text-gray-300 uppercase tracking-wider">
          分层表现
        </h4>
        <div className="space-y-2">
          {layers.map((layer) => (
            <div
              key={layer.name}
              className="flex items-center justify-between text-xs"
            >
              <span className="text-gray-400">{layer.name}</span>
              <div className="flex items-center gap-3">
                <span className="text-gray-500">{layer.events} 事件</span>
                <span
                  className={`font-bold tabular-nums ${
                    layer.rate >= 85
                      ? "text-emerald-400"
                      : layer.rate >= 60
                      ? "text-amber-400"
                      : "text-rose-400"
                  }`}
                >
                  {layer.rate.toFixed(1)}%
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Runbook knowledge base */}
      <div className="bg-gray-800/50 rounded-lg p-4 space-y-3">
        <h4 className="text-xs font-semibold text-gray-300 uppercase tracking-wider flex items-center gap-1.5">
          <BookOpen className="w-3.5 h-3.5" />
          Runbook 知识库
        </h4>
        <div className="grid grid-cols-3 gap-3">
          <div className="text-center">
            <p className="text-lg font-bold text-white">{runbook.total}</p>
            <p className="text-[10px] text-gray-500">总条目</p>
          </div>
          <div className="text-center">
            <p className="text-lg font-bold text-blue-400">+{runbook.newToday}</p>
            <p className="text-[10px] text-gray-500">今日新增</p>
          </div>
          <div className="text-center">
            <p className="text-lg font-bold text-emerald-400">
              {runbook.hitRate.toFixed(0)}%
            </p>
            <p className="text-[10px] text-gray-500">命中率</p>
          </div>
        </div>
      </div>

      {/* Anomalies */}
      <div className="bg-gray-800/50 rounded-lg p-4 space-y-3">
        <h4 className="text-xs font-semibold text-gray-300 uppercase tracking-wider flex items-center gap-1.5">
          <AlertTriangle className="w-3.5 h-3.5 text-amber-400" />
          异常关注
        </h4>
        <div className="grid grid-cols-2 gap-3">
          <div className="flex items-center justify-between">
            <span className="text-xs text-gray-400">Doom-Loop</span>
            <span
              className={`text-xs font-bold ${
                anomalies.doomLoops > 0 ? "text-rose-400" : "text-emerald-400"
              }`}
            >
              {anomalies.doomLoops} 次
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-xs text-gray-400">高延迟事件</span>
            <span
              className={`text-xs font-bold ${
                anomalies.highLatency > 0 ? "text-amber-400" : "text-emerald-400"
              }`}
            >
              {anomalies.highLatency} 次
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
