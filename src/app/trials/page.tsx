"use client";

import { useState, useEffect } from "react";
import { Beaker, ChevronDown, ChevronUp, CheckCircle, XCircle, Minus } from "lucide-react";
import Sidebar from "@/components/dashboard/sidebar";

// -- Types --
interface TrialItem {
  id: string;
  benchmarkId: string;
  benchmarkName: string;
  result: "pass" | "fail" | "skip";
  duration: string;
  tokenUsed: number;
  detail: string;
}

interface TrialGroup {
  id: string;
  name: string;
  description: string;
  createdAt: string;
  totalTrials: number;
  passAtK: number;
  passCaretK: number;
  gap: number;
  items: TrialItem[];
}

const resultConfig = {
  pass: { icon: CheckCircle, color: "text-emerald-400", bg: "bg-emerald-500/20", label: "通过" },
  fail: { icon: XCircle, color: "text-rose-400", bg: "bg-rose-500/20", label: "失败" },
  skip: { icon: Minus, color: "text-gray-400", bg: "bg-gray-500/20", label: "跳过" },
};

// -- Mock data --
function getMockTrialGroups(): TrialGroup[] {
  const benchmarks = [
    "Pod CrashLoop 恢复", "DNS 解析失败修复", "磁盘空间清理",
    "证书自动续签", "配置回滚操作", "服务限流恢复",
    "数据库连接池恢复", "网络分区自愈", "OOM 进程恢复", "日志采集修复",
  ];

  return Array.from({ length: 6 }, (_, gi) => {
    const items: TrialItem[] = Array.from({ length: 10 }, (_, ii) => ({
      id: `TR-${gi + 1}-${ii + 1}`,
      benchmarkId: `BM-${ii + 1}`,
      benchmarkName: benchmarks[ii],
      result: (["pass", "pass", "pass", "fail", "skip"] as const)[Math.floor(Math.random() * 5)],
      duration: `${Math.floor(Math.random() * 15)}m ${Math.floor(Math.random() * 60)}s`,
      tokenUsed: Math.floor(5000 + Math.random() * 50000),
      detail: `在第 ${ii + 1} 个 Benchmark 场景下的自愈试验结果。`,
    }));

    const passCount = items.filter((i) => i.result === "pass").length;
    const failCount = items.filter((i) => i.result === "fail").length;

    return {
      id: `TG-${String(gi + 1).padStart(3, "0")}`,
      name: `试验组 #${gi + 1}`,
      description: `基于 ${["qwen-max", "qwen-plus", "qwen-turbo"][gi % 3]} 模型的第 ${gi + 1} 轮评测`,
      createdAt: `2025-07-${String(10 + gi).padStart(2, "0")}`,
      totalTrials: items.length,
      passAtK: (passCount / items.length) * 100,
      passCaretK: ((passCount - failCount) / items.length) * 100,
      gap: Math.abs((passCount / items.length) * 100 - ((passCount - failCount) / items.length) * 100),
      items,
    };
  });
}

export default function TrialsPage() {
  const [groups, setGroups] = useState<TrialGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch("/api/trials");
        if (res.ok) {
          const json = await res.json();
          setGroups(json);
        } else {
          setGroups(getMockTrialGroups());
        }
      } catch {
        setGroups(getMockTrialGroups());
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  return (
    <div className="flex min-h-screen bg-gray-950">
      <Sidebar />
      <main className="flex-1 ml-56 p-6 space-y-6">
        <div>
          <h1 className="text-xl font-bold text-white flex items-center gap-2">
            <Beaker className="w-5 h-5 text-blue-400" />
            试验管理
          </h1>
          <p className="text-sm text-gray-400 mt-1">
            查看试验组的 Pass@k、Pass^k 及 Gap 指标
          </p>
        </div>

        {/* Trial groups table */}
        <div className="bg-gray-900 rounded-xl border border-gray-800 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-800">
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-400 uppercase tracking-wider">试验组</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-400 uppercase tracking-wider">模型</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-400 uppercase tracking-wider">日期</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-400 uppercase tracking-wider">试验数</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-400 uppercase tracking-wider">Pass@k</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-400 uppercase tracking-wider">Pass^k</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-400 uppercase tracking-wider">Gap</th>
                <th className="w-8" />
              </tr>
            </thead>
            <tbody>
              {loading ? (
                Array.from({ length: 4 }).map((_, i) => (
                  <tr key={i} className="border-b border-gray-800/50">
                    {Array.from({ length: 8 }).map((__, j) => (
                      <td key={j} className="px-4 py-3">
                        <div className="skeleton h-4 w-20" />
                      </td>
                    ))}
                  </tr>
                ))
              ) : (
                groups.map((group) => {
                  const expanded = expandedId === group.id;
                  return (
                    <tbody key={group.id}>
                      <tr
                        className="border-b border-gray-800/50 hover:bg-gray-800/30 cursor-pointer transition-colors"
                        onClick={() => setExpandedId(expanded ? null : group.id)}
                      >
                        <td className="px-4 py-3">
                          <span className="text-xs font-semibold text-white">{group.name}</span>
                          <p className="text-[10px] text-gray-500 mt-0.5">{group.description}</p>
                        </td>
                        <td className="px-4 py-3">
                          <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-blue-500/20 text-blue-400">
                            {group.description.match(/qwen-\w+|gpt-\w+/)?.[0] ?? "N/A"}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-xs text-gray-400">{group.createdAt}</td>
                        <td className="px-4 py-3 text-xs text-gray-300 tabular-nums">{group.totalTrials}</td>
                        <td className="px-4 py-3">
                          <span className={`text-xs font-bold tabular-nums ${group.passAtK >= 70 ? "text-emerald-400" : group.passAtK >= 50 ? "text-amber-400" : "text-rose-400"}`}>
                            {group.passAtK.toFixed(1)}%
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <span className={`text-xs font-bold tabular-nums ${group.passCaretK >= 50 ? "text-emerald-400" : group.passCaretK >= 20 ? "text-amber-400" : "text-rose-400"}`}>
                            {group.passCaretK.toFixed(1)}%
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <span className={`text-xs font-bold tabular-nums ${group.gap <= 10 ? "text-emerald-400" : group.gap <= 25 ? "text-amber-400" : "text-rose-400"}`}>
                            {group.gap.toFixed(1)}
                          </span>
                        </td>
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
                          <td colSpan={8} className="px-4 py-4 bg-gray-800/20">
                            <div className="overflow-x-auto">
                              <table className="w-full text-xs">
                                <thead>
                                  <tr className="border-b border-gray-700/50">
                                    <th className="text-left px-3 py-2 text-gray-500 font-medium">试验 ID</th>
                                    <th className="text-left px-3 py-2 text-gray-500 font-medium">Benchmark</th>
                                    <th className="text-left px-3 py-2 text-gray-500 font-medium">结果</th>
                                    <th className="text-left px-3 py-2 text-gray-500 font-medium">耗时</th>
                                    <th className="text-left px-3 py-2 text-gray-500 font-medium">Token</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {group.items.map((item) => {
                                    const cfg = resultConfig[item.result];
                                    const Icon = cfg.icon;
                                    return (
                                      <tr key={item.id} className="border-b border-gray-800/30">
                                        <td className="px-3 py-2 font-mono text-blue-400">{item.id}</td>
                                        <td className="px-3 py-2 text-gray-300">{item.benchmarkName}</td>
                                        <td className="px-3 py-2">
                                          <span className={`inline-flex items-center gap-1 text-[10px] font-bold px-1.5 py-0.5 rounded ${cfg.bg} ${cfg.color}`}>
                                            <Icon className="w-3 h-3" />
                                            {cfg.label}
                                          </span>
                                        </td>
                                        <td className="px-3 py-2 text-gray-400 tabular-nums">{item.duration}</td>
                                        <td className="px-3 py-2 text-gray-400 tabular-nums">{item.tokenUsed.toLocaleString()}</td>
                                      </tr>
                                    );
                                  })}
                                </tbody>
                              </table>
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
      </main>
    </div>
  );
}
