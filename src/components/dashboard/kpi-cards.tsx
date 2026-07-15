"use client";

import {
  TrendingUp,
  TrendingDown,
  Zap,
  Clock,
  Timer,
  AlertCircle,
} from "lucide-react";

export interface KPIMetrics {
  successRate: number;
  eventCount: number;
  mttd: string;
  mttr: string;
  pendingManual: number;
  successRateTrend: number;
}

interface KPICardsProps {
  metrics: KPIMetrics;
}

const cards = [
  {
    key: "successRate" as const,
    label: "当前自愈成功率",
    format: (v: number) => `${v.toFixed(1)}%`,
    icon: TrendingUp,
    color: "text-emerald-400",
    bgColor: "bg-emerald-500/10",
    showTrend: true,
  },
  {
    key: "eventCount" as const,
    label: "今日自愈事件数",
    format: (v: number) => String(v),
    icon: Zap,
    color: "text-blue-400",
    bgColor: "bg-blue-500/10",
    showTrend: false,
  },
  {
    key: "mttd" as const,
    label: "当前 MTTD",
    format: (v: string) => v,
    icon: Clock,
    color: "text-amber-400",
    bgColor: "bg-amber-500/10",
    showTrend: false,
  },
  {
    key: "mttr" as const,
    label: "当前 MTTR",
    format: (v: string) => v,
    icon: Timer,
    color: "text-violet-400",
    bgColor: "bg-violet-500/10",
    showTrend: false,
  },
  {
    key: "pendingManual" as const,
    label: "待人工处理",
    format: (v: number) => String(v),
    icon: AlertCircle,
    color: "text-rose-400",
    bgColor: "bg-rose-500/10",
    showTrend: false,
  },
];

export default function KPICards({ metrics }: KPICardsProps) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
      {cards.map((card) => {
        const Icon = card.icon;
        const value = metrics[card.key];
        return (
          <div
            key={card.key}
            className="bg-gray-900 rounded-xl border border-gray-800 p-5 flex flex-col gap-3"
          >
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-gray-400 uppercase tracking-wide">
                {card.label}
              </span>
              <div className={`${card.bgColor} p-1.5 rounded-lg`}>
                <Icon className={`w-4 h-4 ${card.color}`} />
              </div>
            </div>
            <div className="flex items-end gap-2">
              <span className="text-2xl font-bold text-white tabular-nums">
                {card.format(value as number & string)}
              </span>
              {card.showTrend && metrics.successRateTrend !== 0 && (
                <span
                  className={`flex items-center text-xs font-medium mb-0.5 ${
                    metrics.successRateTrend >= 0
                      ? "text-emerald-400"
                      : "text-rose-400"
                  }`}
                >
                  {metrics.successRateTrend >= 0 ? (
                    <TrendingUp className="w-3 h-3 mr-0.5" />
                  ) : (
                    <TrendingDown className="w-3 h-3 mr-0.5" />
                  )}
                  {Math.abs(metrics.successRateTrend).toFixed(1)}%
                </span>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
