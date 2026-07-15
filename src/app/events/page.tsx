"use client";

import { useState, useEffect } from "react";
import {
  Search,
  ChevronDown,
  ChevronUp,
  ChevronLeft,
  ChevronRight,
  Filter,
} from "lucide-react";
import Sidebar from "@/components/dashboard/sidebar";

// -- Types --
interface HealingEvent {
  id: string;
  errorLayer: string;
  errorType: string;
  outcome: "success" | "failed" | "partial" | "escalated";
  mttd: string;
  mttr: string;
  successRate: number;
  time: string;
  detail: string;
  runbook?: string;
  tokenUsed?: number;
}

const layerColors: Record<string, string> = {
  "L1 沙箱层": "bg-blue-500/20 text-blue-400 border-blue-500/30",
  "L2 模型网关": "bg-violet-500/20 text-violet-400 border-violet-500/30",
  "L3 MCP工具": "bg-amber-500/20 text-amber-400 border-amber-500/30",
  "L4 平台运行": "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
  "L5 Skill": "bg-rose-500/20 text-rose-400 border-rose-500/30",
};

const outcomeConfig: Record<string, { bg: string; text: string; label: string }> = {
  success: { bg: "bg-emerald-500/20", text: "text-emerald-400", label: "成功" },
  failed: { bg: "bg-rose-500/20", text: "text-rose-400", label: "失败" },
  partial: { bg: "bg-amber-500/20", text: "text-amber-400", label: "部分成功" },
  escalated: { bg: "bg-orange-500/20", text: "text-orange-400", label: "已升级" },
};

const layers = ["全部", "L1 沙箱层", "L2 模型网关", "L3 MCP工具", "L4 平台运行", "L5 Skill"];
const outcomes = ["全部", "success", "failed", "partial", "escalated"];

// -- Mock data --
function getMockEvents(): HealingEvent[] {
  const errorTypes = [
    "TimeoutError", "ConnectionRefused", "OOMKilled", "PodCrashLoop",
    "ConfigDrift", "CertificateExpired", "DiskFull", "DNSResolutionFailed",
    "RateLimitExceeded", "DependencyUnavailable",
  ];
  const layerNames = ["L1 沙箱层", "L2 模型网关", "L3 MCP工具", "L4 平台运行", "L5 Skill"];
  const outcomeTypes: HealingEvent["outcome"][] = ["success", "failed", "partial", "escalated"];

  return Array.from({ length: 50 }, (_, i) => ({
    id: `EVT-${String(1000 + i).padStart(6, "0")}`,
    errorLayer: layerNames[Math.floor(Math.random() * layerNames.length)],
    errorType: errorTypes[Math.floor(Math.random() * errorTypes.length)],
    outcome: outcomeTypes[Math.floor(Math.random() * outcomeTypes.length)],
    mttd: `${Math.floor(Math.random() * 5)}m ${Math.floor(Math.random() * 60)}s`,
    mttr: `${Math.floor(Math.random() * 20)}m ${Math.floor(Math.random() * 60)}s`,
    successRate: 60 + Math.random() * 40,
    time: `${String(Math.floor(Math.random() * 24)).padStart(2, "0")}:${String(Math.floor(Math.random() * 60)).padStart(2, "0")}`,
    detail: `自动检测到异常并尝试自愈。执行了诊断脚本并根据Runbook执行恢复操作。`,
    runbook: Math.random() > 0.3 ? `RB-${Math.floor(Math.random() * 100)}` : undefined,
    tokenUsed: Math.floor(5000 + Math.random() * 50000),
  }));
}

export default function EventsPage() {
  const [events, setEvents] = useState<HealingEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [layerFilter, setLayerFilter] = useState("全部");
  const [outcomeFilter, setOutcomeFilter] = useState("全部");
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const pageSize = 10;

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch("/api/events");
        if (res.ok) {
          const json = await res.json();
          setEvents(json);
        } else {
          setEvents(getMockEvents());
        }
      } catch {
        setEvents(getMockEvents());
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  const filtered = events.filter((e) => {
    if (layerFilter !== "全部" && e.errorLayer !== layerFilter) return false;
    if (outcomeFilter !== "全部" && e.outcome !== outcomeFilter) return false;
    if (search && !e.id.toLowerCase().includes(search.toLowerCase()) && !e.errorType.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const paginatedEvents = filtered.slice((page - 1) * pageSize, page * pageSize);

  return (
    <div className="flex min-h-screen bg-gray-950">
      <Sidebar />
      <main className="flex-1 ml-56 p-6 space-y-6">
        {/* Header */}
        <div>
          <h1 className="text-xl font-bold text-white">自愈事件列表</h1>
          <p className="text-sm text-gray-400 mt-1">
            查看历史自愈事件的详细信息
          </p>
        </div>

        {/* Filters */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
            <input
              type="text"
              placeholder="搜索事件 ID 或类型..."
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(1); }}
              className="bg-gray-900 border border-gray-800 rounded-lg pl-9 pr-4 py-2 text-sm text-gray-200 placeholder:text-gray-500 focus:outline-none focus:ring-1 focus:ring-blue-500 w-64"
            />
          </div>

          <div className="flex items-center gap-2">
            <Filter className="w-4 h-4 text-gray-500" />
            <select
              value={layerFilter}
              onChange={(e) => { setLayerFilter(e.target.value); setPage(1); }}
              className="bg-gray-900 border border-gray-800 rounded-lg px-3 py-2 text-sm text-gray-200 focus:outline-none focus:ring-1 focus:ring-blue-500"
            >
              {layers.map((l) => (
                <option key={l} value={l}>{l}</option>
              ))}
            </select>
            <select
              value={outcomeFilter}
              onChange={(e) => { setOutcomeFilter(e.target.value); setPage(1); }}
              className="bg-gray-900 border border-gray-800 rounded-lg px-3 py-2 text-sm text-gray-200 focus:outline-none focus:ring-1 focus:ring-blue-500"
            >
              <option value="全部">全部结果</option>
              {outcomes.filter(o => o !== "全部").map((o) => (
                <option key={o} value={o}>
                  {outcomeConfig[o]?.label ?? o}
                </option>
              ))}
            </select>
          </div>

          <span className="text-xs text-gray-500 ml-auto">
            共 {filtered.length} 条记录
          </span>
        </div>

        {/* Table */}
        <div className="bg-gray-900 rounded-xl border border-gray-800 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-800">
                  <th className="text-left px-4 py-3 text-xs font-medium text-gray-400 uppercase tracking-wider">Event ID</th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-gray-400 uppercase tracking-wider">错误层级</th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-gray-400 uppercase tracking-wider">错误类型</th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-gray-400 uppercase tracking-wider">结果</th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-gray-400 uppercase tracking-wider">MTTD</th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-gray-400 uppercase tracking-wider">MTTR</th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-gray-400 uppercase tracking-wider">成功率</th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-gray-400 uppercase tracking-wider">时间</th>
                  <th className="w-8" />
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  Array.from({ length: 5 }).map((_, i) => (
                    <tr key={i} className="border-b border-gray-800/50">
                      {Array.from({ length: 9 }).map((__, j) => (
                        <td key={j} className="px-4 py-3">
                          <div className="skeleton h-4 w-16" />
                        </td>
                      ))}
                    </tr>
                  ))
                ) : paginatedEvents.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="text-center py-12 text-gray-500 text-sm">
                      没有找到匹配的事件
                    </td>
                  </tr>
                ) : (
                  paginatedEvents.map((event) => {
                    const expanded = expandedId === event.id;
                    const layerStyle = layerColors[event.errorLayer] ?? "bg-gray-500/20 text-gray-400 border-gray-500/30";
                    const outcomeCfg = outcomeConfig[event.outcome];
                    return (
                      <tbody key={event.id}>
                        <tr
                          className="border-b border-gray-800/50 hover:bg-gray-800/30 cursor-pointer transition-colors"
                          onClick={() => setExpandedId(expanded ? null : event.id)}
                        >
                          <td className="px-4 py-3 text-xs font-mono text-blue-400">{event.id}</td>
                          <td className="px-4 py-3">
                            <span className={`text-[10px] font-bold px-2 py-0.5 rounded border ${layerStyle}`}>
                              {event.errorLayer}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-xs text-gray-300">{event.errorType}</td>
                          <td className="px-4 py-3">
                            <span className={`text-[10px] font-bold px-2 py-0.5 rounded ${outcomeCfg.bg} ${outcomeCfg.text}`}>
                              {outcomeCfg.label}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-xs text-gray-400 tabular-nums">{event.mttd}</td>
                          <td className="px-4 py-3 text-xs text-gray-400 tabular-nums">{event.mttr}</td>
                          <td className="px-4 py-3">
                            <span className={`text-xs font-bold tabular-nums ${event.successRate >= 85 ? "text-emerald-400" : event.successRate >= 60 ? "text-amber-400" : "text-rose-400"}`}>
                              {event.successRate.toFixed(1)}%
                            </span>
                          </td>
                          <td className="px-4 py-3 text-xs text-gray-500">{event.time}</td>
                          <td className="px-4 py-3">
                            {expanded ? (
                              <ChevronUp className="w-4 h-4 text-gray-500" />
                            ) : (
                              <ChevronDown className="w-4 h-4 text-gray-500" />
                            )}
                          </td>
                        </tr>
                        {expanded && (
                          <tr className="border-b border-gray-800/50">
                            <td colSpan={9} className="px-4 py-4 bg-gray-800/30">
                              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs">
                                <div>
                                  <span className="text-gray-500 block mb-1">事件详情</span>
                                  <p className="text-gray-300">{event.detail}</p>
                                </div>
                                <div>
                                  <span className="text-gray-500 block mb-1">Runbook</span>
                                  <p className="text-gray-300">{event.runbook ?? "未匹配"}</p>
                                </div>
                                <div>
                                  <span className="text-gray-500 block mb-1">Token 消耗</span>
                                  <p className="text-gray-300">{event.tokenUsed?.toLocaleString() ?? "N/A"}</p>
                                </div>
                              </div>
                            </td>
                          </tr>
                        )}
                      </tbody>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {!loading && filtered.length > 0 && (
            <div className="flex items-center justify-between px-4 py-3 border-t border-gray-800">
              <span className="text-xs text-gray-500">
                第 {(page - 1) * pageSize + 1}-{Math.min(page * pageSize, filtered.length)} 条，共 {filtered.length} 条
              </span>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => setPage(Math.max(1, page - 1))}
                  disabled={page === 1}
                  className="p-1.5 rounded-lg text-gray-400 hover:bg-gray-800 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
                {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                  let pageNum: number;
                  if (totalPages <= 5) {
                    pageNum = i + 1;
                  } else if (page <= 3) {
                    pageNum = i + 1;
                  } else if (page >= totalPages - 2) {
                    pageNum = totalPages - 4 + i;
                  } else {
                    pageNum = page - 2 + i;
                  }
                  return (
                    <button
                      key={pageNum}
                      onClick={() => setPage(pageNum)}
                      className={`w-8 h-8 rounded-lg text-xs font-medium transition-colors ${
                        page === pageNum
                          ? "bg-blue-600 text-white"
                          : "text-gray-400 hover:bg-gray-800"
                      }`}
                    >
                      {pageNum}
                    </button>
                  );
                })}
                <button
                  onClick={() => setPage(Math.min(totalPages, page + 1))}
                  disabled={page === totalPages}
                  className="p-1.5 rounded-lg text-gray-400 hover:bg-gray-800 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
