"use client";

import { useState, useEffect } from "react";
import {
  FlaskConical,
  Plus,
  Search,
  Tag,
  Star,
  X,
} from "lucide-react";
import Sidebar from "@/components/dashboard/sidebar";

// -- Types --
interface BenchmarkCase {
  id: string;
  name: string;
  description: string;
  difficulty: "easy" | "medium" | "hard" | "critical";
  source: string;
  layer: string;
  createdAt: string;
  passRate: number;
  avgDuration: string;
}

const difficultyConfig = {
  easy: { bg: "bg-emerald-500/20", text: "text-emerald-400", label: "简单" },
  medium: { bg: "bg-amber-500/20", text: "text-amber-400", label: "中等" },
  hard: { bg: "bg-orange-500/20", text: "text-orange-400", label: "困难" },
  critical: { bg: "bg-rose-500/20", text: "text-rose-400", label: "关键" },
};

const sources = ["全部", "生产故障", "混沌工程", "手动录入", "社区贡献"];
const difficulties = ["全部", "easy", "medium", "hard", "critical"];

// -- Mock data --
function getMockBenchmarks(): BenchmarkCase[] {
  const cases = [
    { name: "Pod CrashLoop 恢复", desc: "检测并恢复 Kubernetes Pod 的 CrashLoopBackOff 状态" },
    { name: "DNS 解析失败修复", desc: "自动诊断和修复 DNS 解析失败问题" },
    { name: "磁盘空间清理", desc: "检测磁盘空间不足并执行自动清理" },
    { name: "证书自动续签", desc: "TLS/SSL 证书到期前自动续签" },
    { name: "配置回滚操作", desc: "检测到配置变更后服务异常时自动回滚" },
    { name: "服务限流恢复", desc: "服务触发限流后的自动降级和恢复策略" },
    { name: "数据库连接池恢复", desc: "数据库连接池耗尽时的自动诊断和恢复" },
    { name: "网络分区自愈", desc: "网络分区检测与自动恢复" },
    { name: "OOM 进程恢复", desc: "OOM Killed 进程的检测、分析和自动重启" },
    { name: "日志采集修复", desc: "日志采集链路中断时的自动诊断和修复" },
    { name: "负载均衡器健康检查", desc: "LB 后端实例健康检查失败的自动处理" },
    { name: "消息队列堆积处理", desc: "消息队列消费者堆积时的自动扩容和恢复" },
  ];
  const diffs: BenchmarkCase["difficulty"][] = ["easy", "medium", "hard", "critical"];
  const srcs = ["生产故障", "混沌工程", "手动录入", "社区贡献"];
  const layerNames = ["L1 沙箱层", "L2 模型网关", "L3 MCP工具", "L4 平台运行", "L5 Skill"];

  return cases.map((c, i) => ({
    id: `BM-${String(i + 1).padStart(3, "0")}`,
    name: c.name,
    description: c.desc,
    difficulty: diffs[Math.floor(Math.random() * diffs.length)],
    source: srcs[Math.floor(Math.random() * srcs.length)],
    layer: layerNames[Math.floor(Math.random() * layerNames.length)],
    createdAt: `2025-07-${String(1 + Math.floor(Math.random() * 14)).padStart(2, "0")}`,
    passRate: 50 + Math.random() * 50,
    avgDuration: `${Math.floor(2 + Math.random() * 15)}m ${Math.floor(Math.random() * 60)}s`,
  }));
}

export default function BenchmarksPage() {
  const [benchmarks, setBenchmarks] = useState<BenchmarkCase[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [sourceFilter, setSourceFilter] = useState("全部");
  const [diffFilter, setDiffFilter] = useState("全部");
  const [showForm, setShowForm] = useState(false);
  const [newBenchmark, setNewBenchmark] = useState({
    name: "",
    description: "",
    difficulty: "medium" as BenchmarkCase["difficulty"],
    source: "手动录入",
    layer: "L3 MCP工具",
  });

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch("/api/benchmarks");
        if (res.ok) {
          const json = await res.json();
          setBenchmarks(json);
        } else {
          setBenchmarks(getMockBenchmarks());
        }
      } catch {
        setBenchmarks(getMockBenchmarks());
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  const filtered = benchmarks.filter((b) => {
    if (sourceFilter !== "全部" && b.source !== sourceFilter) return false;
    if (diffFilter !== "全部" && b.difficulty !== diffFilter) return false;
    if (search && !b.name.toLowerCase().includes(search.toLowerCase()) && !b.id.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  function handleCreate() {
    const created: BenchmarkCase = {
      id: `BM-${String(benchmarks.length + 1).padStart(3, "0")}`,
      ...newBenchmark,
      createdAt: new Date().toISOString().split("T")[0],
      passRate: 0,
      avgDuration: "N/A",
    };
    setBenchmarks([created, ...benchmarks]);
    setShowForm(false);
    setNewBenchmark({ name: "", description: "", difficulty: "medium", source: "手动录入", layer: "L3 MCP工具" });
  }

  return (
    <div className="flex min-h-screen bg-gray-950">
      <Sidebar />
      <main className="flex-1 ml-56 p-6 space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-white flex items-center gap-2">
              <FlaskConical className="w-5 h-5 text-blue-400" />
              Benchmark 管理
            </h1>
            <p className="text-sm text-gray-400 mt-1">
              管理评测用例库，覆盖不同层级和难度场景
            </p>
          </div>
          <button
            onClick={() => setShowForm(!showForm)}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition-colors"
          >
            {showForm ? <X className="w-4 h-4" /> : <Plus className="w-4 h-4" />}
            {showForm ? "取消" : "新建用例"}
          </button>
        </div>

        {/* Create form */}
        {showForm && (
          <div className="bg-gray-900 rounded-xl border border-gray-800 p-5 space-y-4">
            <h3 className="text-sm font-semibold text-white">新建 Benchmark 用例</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="text-xs text-gray-400 block mb-1.5">用例名称</label>
                <input
                  type="text"
                  value={newBenchmark.name}
                  onChange={(e) => setNewBenchmark({ ...newBenchmark, name: e.target.value })}
                  placeholder="输入用例名称"
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200 placeholder:text-gray-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="text-xs text-gray-400 block mb-1.5">所属层级</label>
                <select
                  value={newBenchmark.layer}
                  onChange={(e) => setNewBenchmark({ ...newBenchmark, layer: e.target.value })}
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200 focus:outline-none focus:ring-1 focus:ring-blue-500"
                >
                  {["L1 沙箱层", "L2 模型网关", "L3 MCP工具", "L4 平台运行", "L5 Skill"].map((l) => (
                    <option key={l} value={l}>{l}</option>
                  ))}
                </select>
              </div>
              <div className="md:col-span-2">
                <label className="text-xs text-gray-400 block mb-1.5">描述</label>
                <textarea
                  value={newBenchmark.description}
                  onChange={(e) => setNewBenchmark({ ...newBenchmark, description: e.target.value })}
                  placeholder="描述该用例的测试场景和预期行为"
                  rows={3}
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200 placeholder:text-gray-500 focus:outline-none focus:ring-1 focus:ring-blue-500 resize-none"
                />
              </div>
              <div>
                <label className="text-xs text-gray-400 block mb-1.5">难度</label>
                <select
                  value={newBenchmark.difficulty}
                  onChange={(e) => setNewBenchmark({ ...newBenchmark, difficulty: e.target.value as BenchmarkCase["difficulty"] })}
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200 focus:outline-none focus:ring-1 focus:ring-blue-500"
                >
                  {difficulties.filter(d => d !== "全部").map((d) => (
                    <option key={d} value={d}>{difficultyConfig[d as BenchmarkCase["difficulty"]].label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-xs text-gray-400 block mb-1.5">来源</label>
                <select
                  value={newBenchmark.source}
                  onChange={(e) => setNewBenchmark({ ...newBenchmark, source: e.target.value })}
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200 focus:outline-none focus:ring-1 focus:ring-blue-500"
                >
                  {sources.filter(s => s !== "全部").map((s) => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
              </div>
            </div>
            <div className="flex justify-end">
              <button
                onClick={handleCreate}
                disabled={!newBenchmark.name.trim()}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-700 disabled:text-gray-500 text-white text-sm font-medium rounded-lg transition-colors"
              >
                创建用例
              </button>
            </div>
          </div>
        )}

        {/* Filters */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
            <input
              type="text"
              placeholder="搜索用例名称或 ID..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="bg-gray-900 border border-gray-800 rounded-lg pl-9 pr-4 py-2 text-sm text-gray-200 placeholder:text-gray-500 focus:outline-none focus:ring-1 focus:ring-blue-500 w-64"
            />
          </div>
          <select
            value={sourceFilter}
            onChange={(e) => setSourceFilter(e.target.value)}
            className="bg-gray-900 border border-gray-800 rounded-lg px-3 py-2 text-sm text-gray-200 focus:outline-none focus:ring-1 focus:ring-blue-500"
          >
            {sources.map((s) => (
              <option key={s} value={s}>{s === "全部" ? "全部来源" : s}</option>
            ))}
          </select>
          <select
            value={diffFilter}
            onChange={(e) => setDiffFilter(e.target.value)}
            className="bg-gray-900 border border-gray-800 rounded-lg px-3 py-2 text-sm text-gray-200 focus:outline-none focus:ring-1 focus:ring-blue-500"
          >
            <option value="全部">全部难度</option>
            {difficulties.filter(d => d !== "全部").map((d) => (
              <option key={d} value={d}>{difficultyConfig[d as BenchmarkCase["difficulty"]].label}</option>
            ))}
          </select>
          <span className="text-xs text-gray-500 ml-auto">{filtered.length} 个用例</span>
        </div>

        {/* Benchmark list */}
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {loading ? (
            Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="bg-gray-900 rounded-xl border border-gray-800 p-5 space-y-3">
                <div className="skeleton h-4 w-32" />
                <div className="skeleton h-3 w-full" />
                <div className="skeleton h-3 w-24" />
              </div>
            ))
          ) : filtered.length === 0 ? (
            <div className="col-span-full text-center py-16 text-gray-500 text-sm">
              没有找到匹配的 Benchmark 用例
            </div>
          ) : (
            filtered.map((bm) => {
              const diff = difficultyConfig[bm.difficulty];
              return (
                <div
                  key={bm.id}
                  className="bg-gray-900 rounded-xl border border-gray-800 p-5 space-y-3 hover:border-gray-700 transition-colors"
                >
                  <div className="flex items-start justify-between">
                    <div>
                      <span className="text-[10px] font-mono text-gray-500">{bm.id}</span>
                      <h3 className="text-sm font-semibold text-white mt-0.5">{bm.name}</h3>
                    </div>
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded ${diff.bg} ${diff.text}`}>
                      {diff.label}
                    </span>
                  </div>
                  <p className="text-xs text-gray-400 leading-relaxed line-clamp-2">
                    {bm.description}
                  </p>
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-[10px] px-2 py-0.5 rounded bg-blue-500/20 text-blue-400 flex items-center gap-1">
                      <Tag className="w-3 h-3" />
                      {bm.source}
                    </span>
                    <span className="text-[10px] px-2 py-0.5 rounded bg-gray-800 text-gray-400">
                      {bm.layer}
                    </span>
                  </div>
                  <div className="flex items-center justify-between pt-2 border-t border-gray-800">
                    <div className="flex items-center gap-1.5">
                      <Star className="w-3.5 h-3.5 text-amber-400" />
                      <span className="text-xs text-gray-400">通过率</span>
                      <span className={`text-xs font-bold tabular-nums ${bm.passRate >= 80 ? "text-emerald-400" : bm.passRate >= 50 ? "text-amber-400" : "text-rose-400"}`}>
                        {bm.passRate.toFixed(1)}%
                      </span>
                    </div>
                    <span className="text-[10px] text-gray-500">{bm.createdAt}</span>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </main>
    </div>
  );
}
