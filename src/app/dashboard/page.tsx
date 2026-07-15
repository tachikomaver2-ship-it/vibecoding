"use client";

import { useState, useEffect } from "react";
import { CalendarDays, RefreshCw } from "lucide-react";
import Sidebar from "@/components/dashboard/sidebar";
import KPICards, { type KPIMetrics } from "@/components/dashboard/kpi-cards";
import LayerBars, { type LayerRate } from "@/components/dashboard/layer-bars";
import TrendCharts, {
  type TrendDataPoint,
} from "@/components/dashboard/trend-charts";
import AlertsPanel, {
  type Alert,
  type CircuitBreaker,
  type PendingApproval,
} from "@/components/dashboard/alerts-panel";
import DailyReport, {
  type DailyReportData,
} from "@/components/dashboard/daily-report";

// -- Dashboard data shape --
interface DashboardData {
  metrics: KPIMetrics;
  layers: LayerRate[];
  trends: {
    successRate: TrendDataPoint[];
    token: TrendDataPoint[];
    runbookHit: TrendDataPoint[];
    doomLoop: TrendDataPoint[];
  };
  alerts: Alert[];
  circuitBreakers: CircuitBreaker[];
  pendingApprovals: PendingApproval[];
  dailyReport: DailyReportData;
}

// -- Mock data for development --
function getMockData(): DashboardData {
  const hours = Array.from({ length: 24 }, (_, i) => `${String(i).padStart(2, "0")}:00`);

  return {
    metrics: {
      successRate: 87.3,
      eventCount: 142,
      mttd: "2m 15s",
      mttr: "8m 42s",
      pendingManual: 5,
      successRateTrend: 2.1,
    },
    layers: [
      { name: "L1 沙箱层", rate: 95.2 },
      { name: "L2 模型网关", rate: 88.7 },
      { name: "L3 MCP工具", rate: 76.3 },
      { name: "L4 平台运行", rate: 82.1 },
      { name: "L5 Skill", rate: 91.5 },
    ],
    trends: {
      successRate: hours.map((time) => ({
        time,
        L1: 90 + Math.random() * 10,
        L2: 80 + Math.random() * 15,
        L3: 65 + Math.random() * 20,
        L4: 75 + Math.random() * 15,
        L5: 85 + Math.random() * 12,
      })),
      token: hours.map((time) => ({
        time,
        "qwen-max": 50000 + Math.random() * 30000,
        "qwen-plus": 30000 + Math.random() * 20000,
        "qwen-turbo": 20000 + Math.random() * 15000,
        "gpt-4o": 10000 + Math.random() * 10000,
      })),
      runbookHit: hours.map((time) => ({
        time,
        hitRate: 60 + Math.random() * 30,
      })),
      doomLoop: hours.map((time) => ({
        time,
        count: Math.floor(Math.random() * 5),
      })),
    },
    alerts: [
      { id: "a1", severity: "P0", message: "L3 MCP工具层自愈连续失败3次，触发断路器", time: "14:32", layer: "L3 MCP工具" },
      { id: "a2", severity: "P1", message: "模型网关响应超时 >30s，影响5个事件", time: "14:15", layer: "L2 模型网关" },
      { id: "a3", severity: "P2", message: "Runbook匹配率下降至60%以下", time: "13:48" },
      { id: "a4", severity: "P3", message: "沙箱资源使用率达到80%", time: "13:30", layer: "L1 沙箱层" },
      { id: "a5", severity: "P2", message: "Doom-loop检测到异常循环模式", time: "12:55", layer: "L5 Skill" },
    ],
    circuitBreakers: [
      { name: "MCP-Tool-Executor", state: "OPEN", lastChanged: "14:32" },
      { name: "Model-Gateway", state: "HALF_OPEN", lastChanged: "14:20" },
      { name: "Sandbox-Manager", state: "CLOSED", lastChanged: "12:00" },
      { name: "Skill-Runner", state: "CLOSED", lastChanged: "11:45" },
    ],
    pendingApprovals: [
      { id: "p1", action: "重启 Pod k8s-agent-worker-03", target: "生产集群 A", riskLevel: "high", createdAt: "14:35" },
      { id: "p2", action: "回滚配置变更 #4521", target: "网关配置", riskLevel: "medium", createdAt: "14:28" },
      { id: "p3", action: "扩容沙箱实例 3→5", target: "沙箱池", riskLevel: "low", createdAt: "14:10" },
    ],
    dailyReport: {
      overview: {
        eventCount: 142,
        successRate: 87.3,
        successRateTrend: 2.1,
        mttd: "2m 15s",
        mttr: "8m 42s",
        escalations: 5,
      },
      layers: [
        { name: "L1 沙箱层", rate: 95.2, events: 28 },
        { name: "L2 模型网关", rate: 88.7, events: 35 },
        { name: "L3 MCP工具", rate: 76.3, events: 42 },
        { name: "L4 平台运行", rate: 82.1, events: 22 },
        { name: "L5 Skill", rate: 91.5, events: 15 },
      ],
      runbook: {
        total: 328,
        newToday: 5,
        hitRate: 73,
      },
      anomalies: {
        doomLoops: 3,
        highLatency: 8,
      },
    },
  };
}

// -- Loading skeleton --
function SkeletonCard() {
  return (
    <div className="bg-gray-900 rounded-xl border border-gray-800 p-5 space-y-3">
      <div className="skeleton h-3 w-24" />
      <div className="skeleton h-7 w-16" />
    </div>
  );
}

function SkeletonChart() {
  return (
    <div className="bg-gray-900 rounded-xl border border-gray-800 p-5">
      <div className="skeleton h-3 w-32 mb-4" />
      <div className="skeleton h-[220px] w-full" />
    </div>
  );
}

export default function DashboardPage() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [dateRange, setDateRange] = useState("今日");

  useEffect(() => {
    async function fetchData() {
      try {
        const res = await fetch("/api/dashboard");
        if (res.ok) {
          const json = await res.json();
          setData(json);
        } else {
          // Fallback to mock data when API is not ready
          setData(getMockData());
        }
      } catch {
        // API not available, use mock data
        setData(getMockData());
      } finally {
        setLoading(false);
      }
    }
    fetchData();
  }, []);

  const today = new Date().toLocaleDateString("zh-CN", {
    year: "numeric",
    month: "long",
    day: "numeric",
    weekday: "long",
  });

  return (
    <div className="flex min-h-screen bg-gray-950">
      <Sidebar />

      {/* Main content */}
      <main className="flex-1 ml-56 p-6 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-white">SRE Agent 评测大盘</h1>
            <p className="text-sm text-gray-400 mt-1 flex items-center gap-1.5">
              <CalendarDays className="w-3.5 h-3.5" />
              {today}
            </p>
          </div>
          <div className="flex items-center gap-3">
            {/* Date range selector */}
            <div className="flex bg-gray-900 rounded-lg border border-gray-800 p-0.5">
              {["今日", "近7日", "近30日"].map((range) => (
                <button
                  key={range}
                  onClick={() => setDateRange(range)}
                  className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                    dateRange === range
                      ? "bg-blue-600 text-white"
                      : "text-gray-400 hover:text-gray-200"
                  }`}
                >
                  {range}
                </button>
              ))}
            </div>
            <button
              onClick={() => {
                setLoading(true);
                setData(null);
                setTimeout(() => {
                  setData(getMockData());
                  setLoading(false);
                }, 800);
              }}
              className="p-2 rounded-lg bg-gray-900 border border-gray-800 text-gray-400 hover:text-white transition-colors"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
            </button>
          </div>
        </div>

        {/* KPI Cards */}
        {loading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
            {Array.from({ length: 5 }).map((_, i) => (
              <SkeletonCard key={i} />
            ))}
          </div>
        ) : (
          data && <KPICards metrics={data.metrics} />
        )}

        {/* Layer Bars */}
        {loading ? (
          <SkeletonChart />
        ) : (
          data && <LayerBars layers={data.layers} />
        )}

        {/* Trend Charts */}
        {loading ? (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <SkeletonChart key={i} />
            ))}
          </div>
        ) : (
          data && (
            <TrendCharts
              successRateData={data.trends.successRate}
              tokenData={data.trends.token}
              runbookHitData={data.trends.runbookHit}
              doomLoopData={data.trends.doomLoop}
            />
          )
        )}

        {/* Alerts + Daily Report side by side */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {loading ? (
            <>
              <SkeletonChart />
              <SkeletonChart />
            </>
          ) : (
            data && (
              <>
                <AlertsPanel
                  alerts={data.alerts}
                  circuitBreakers={data.circuitBreakers}
                  pendingApprovals={data.pendingApprovals}
                />
                <DailyReport report={data.dailyReport} />
              </>
            )
          )}
        </div>
      </main>
    </div>
  );
}
