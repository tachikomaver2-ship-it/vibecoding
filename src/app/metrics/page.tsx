"use client";

import { useState, useEffect } from "react";
import {
  BarChart3,
  TrendingUp,
  TrendingDown,
  CheckCircle,
  Clock,
  Shield,
  BookOpen,
  Zap,
  Activity,
} from "lucide-react";
import Sidebar from "@/components/dashboard/sidebar";

// -- Types --
interface MetricCard {
  name: string;
  value: string;
  formula: string;
  trend: number;
  unit?: string;
  description: string;
}

interface MetricDimension {
  key: string;
  label: string;
  icon: React.ElementType;
  metrics: MetricCard[];
}

const dimensions: MetricDimension[] = [
  {
    key: "result",
    label: "结果",
    icon: CheckCircle,
    metrics: [
      { name: "自愈成功率", value: "87.3%", formula: "成功自愈数 / 总事件数 x 100%", trend: 2.1, description: "Agent 自主完成自愈的比率" },
      { name: "首次修复率", value: "72.8%", formula: "首次自愈成功数 / 总事件数 x 100%", trend: 1.5, description: "第一次尝试即成功的比率" },
      { name: "Runbook 命中率", value: "73.2%", formula: "Runbook 匹配数 / 总事件数 x 100%", trend: -0.8, description: "知识库中 Runbook 覆盖的比率" },
      { name: "升级率", value: "12.7%", formula: "升级人工数 / 总事件数 x 100%", trend: -1.3, description: "需要升级到人工处理的比率" },
      { name: "二次故障率", value: "3.2%", formula: "二次故障数 / 自愈成功数 x 100%", trend: -0.5, description: "自愈后再次发生故障的比率" },
    ],
  },
  {
    key: "process",
    label: "过程",
    icon: Activity,
    metrics: [
      { name: "诊断准确率", value: "91.5%", formula: "正确诊断数 / 总诊断数 x 100%", trend: 0.8, description: "根因分析的正确率" },
      { name: "方案选择准确率", value: "85.2%", formula: "正确方案数 / 总方案选择数 x 100%", trend: 1.2, description: "选择正确修复方案的比率" },
      { name: "Doom-Loop 触发率", value: "4.1%", formula: "循环触发事件数 / 总事件数 x 100%", trend: -0.3, description: "Agent 陷入死循环的比率" },
      { name: "工具调用成功率", value: "93.7%", formula: "工具成功调用数 / 总调用数 x 100%", trend: 0.5, description: "MCP 工具调用成功的比率" },
      { name: "平均步骤数", value: "6.8", formula: "总步骤数 / 事件数", trend: -0.2, unit: "步", description: "完成自愈所需的平均步骤" },
    ],
  },
  {
    key: "efficiency",
    label: "效率",
    icon: Clock,
    metrics: [
      { name: "MTTD", value: "2m 15s", formula: "sum(检测时间) / 事件数", trend: -5.2, description: "平均故障检测时间" },
      { name: "MTTR", value: "8m 42s", formula: "sum(恢复时间) / 事件数", trend: -8.1, description: "平均故障恢复时间" },
      { name: "MTTA", value: "45s", formula: "sum(确认时间) / 事件数", trend: -2.3, description: "平均确认时间" },
      { name: "Token 效率", value: "12.5K", formula: "总 Token / 事件数", trend: -3.1, unit: "tokens/事件", description: "平均每个事件消耗的 Token" },
      { name: "并发处理能力", value: "8", formula: "max(同时处理事件数)", trend: 1.0, unit: "事件", description: "系统同时处理的最大事件数" },
    ],
  },
  {
    key: "safety",
    label: "安全",
    icon: Shield,
    metrics: [
      { name: "误操作率", value: "0.8%", formula: "误操作数 / 总操作数 x 100%", trend: -0.2, description: "执行了错误操作的比率" },
      { name: "断路器触发次数", value: "3", formula: "count(断路器 OPEN 事件)", trend: 1.0, unit: "次", description: "断路器被触发的总次数" },
      { name: "沙箱逃逸次数", value: "0", formula: "count(沙箱隔离突破事件)", trend: 0, unit: "次", description: "沙箱隔离被突破的次数" },
      { name: "权限越界次数", value: "1", formula: "count(权限越界告警)", trend: -1.0, unit: "次", description: "Agent 超越授权范围操作的次数" },
      { name: "人工拦截率", value: "95.2%", formula: "人工拦截数 / 高风险操作数 x 100%", trend: 2.0, description: "高风险操作被人工拦截的比率" },
    ],
  },
  {
    key: "learning",
    label: "学习",
    icon: BookOpen,
    metrics: [
      { name: "Runbook 新增率", value: "5/日", formula: "今日新增 Runbook 数", trend: 12.5, description: "每天新增的 Runbook 条目数" },
      { name: "知识库覆盖率", value: "78.5%", formula: "有 Runbook 覆盖的场景数 / 总场景数 x 100%", trend: 3.2, description: "知识库覆盖的场景比率" },
      { name: "自愈策略进化次数", value: "12", formula: "count(策略更新事件)", trend: 4.0, unit: "次", description: "自愈策略被优化更新的次数" },
      { name: "模型微调数据量", value: "2.3K", formula: "sum(采集的训练样本)", trend: 8.5, unit: "条", description: "采集用于模型微调的数据量" },
    ],
  },
  {
    key: "business",
    label: "业务",
    icon: Zap,
    metrics: [
      { name: "服务可用率提升", value: "0.3%", formula: "启用 Agent 后可用率 - 启用前可用率", trend: 0.1, description: "引入 Agent 后服务可用率的提升" },
      { name: "人力节省", value: "42h/周", formula: "sum(自愈事件 * 平均人工处理时间)", trend: 5.5, unit: "小时/周", description: "每周节省的人工处理时间" },
      { name: "告警降噪率", value: "35.2%", formula: "被 Agent 消化的告警数 / 总告警数 x 100%", trend: 2.8, description: "Agent 自动消化无需人工关注的告警比率" },
      { name: "故障影响范围缩减", value: "28.5%", formula: "(启用前影响范围 - 启用后影响范围) / 启用前影响范围", trend: 3.2, description: "故障影响范围的平均缩减比率" },
    ],
  },
];

export default function MetricsPage() {
  const [activeTab, setActiveTab] = useState("result");
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const currentDimension = dimensions.find((d) => d.key === activeTab)!;

  return (
    <div className="flex min-h-screen bg-gray-950">
      <Sidebar />
      <main className="flex-1 ml-56 p-6 space-y-6">
        <div>
          <h1 className="text-xl font-bold text-white flex items-center gap-2">
            <BarChart3 className="w-5 h-5 text-blue-400" />
            指标探索
          </h1>
          <p className="text-sm text-gray-400 mt-1">
            六维度评测指标体系：结果、过程、效率、安全、学习、业务
          </p>
        </div>

        {/* Dimension tabs */}
        <div className="flex bg-gray-900 rounded-xl border border-gray-800 p-1 gap-1 overflow-x-auto">
          {dimensions.map((dim) => {
            const Icon = dim.icon;
            const active = activeTab === dim.key;
            return (
              <button
                key={dim.key}
                onClick={() => setActiveTab(dim.key)}
                className={`flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium transition-colors whitespace-nowrap ${
                  active
                    ? "bg-blue-600 text-white"
                    : "text-gray-400 hover:text-gray-200 hover:bg-gray-800"
                }`}
              >
                <Icon className="w-4 h-4" />
                {dim.label}
              </button>
            );
          })}
        </div>

        {/* Metric cards */}
        {mounted && (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {currentDimension.metrics.map((metric) => (
              <div
                key={metric.name}
                className="bg-gray-900 rounded-xl border border-gray-800 p-5 space-y-3 hover:border-gray-700 transition-colors"
              >
                <div className="flex items-start justify-between">
                  <h3 className="text-sm font-semibold text-white">
                    {metric.name}
                  </h3>
                  <div
                    className={`flex items-center gap-0.5 text-xs font-medium ${
                      metric.trend > 0
                        ? "text-emerald-400"
                        : metric.trend < 0
                        ? "text-rose-400"
                        : "text-gray-500"
                    }`}
                  >
                    {metric.trend > 0 ? (
                      <TrendingUp className="w-3 h-3" />
                    ) : metric.trend < 0 ? (
                      <TrendingDown className="w-3 h-3" />
                    ) : null}
                    {metric.trend !== 0 && Math.abs(metric.trend).toFixed(1)}
                  </div>
                </div>

                <div className="flex items-baseline gap-1.5">
                  <span className="text-2xl font-bold text-white tabular-nums">
                    {metric.value}
                  </span>
                  {metric.unit && (
                    <span className="text-xs text-gray-500">{metric.unit}</span>
                  )}
                </div>

                <p className="text-xs text-gray-400 leading-relaxed">
                  {metric.description}
                </p>

                <div className="pt-2 border-t border-gray-800">
                  <code className="text-[10px] text-gray-500 font-mono bg-gray-800/50 px-2 py-1 rounded block">
                    {metric.formula}
                  </code>
                </div>

                {/* Mini trend bar (visual only) */}
                <div className="flex items-end gap-0.5 h-6">
                  {Array.from({ length: 12 }, (_, i) => {
                    const height = 20 + Math.random() * 80;
                    return (
                      <div
                        key={i}
                        className={`flex-1 rounded-t-sm ${
                          i === 11
                            ? "bg-blue-500"
                            : "bg-gray-700"
                        }`}
                        style={{ height: `${height}%` }}
                      />
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
