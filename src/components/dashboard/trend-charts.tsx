"use client";

import dynamic from "next/dynamic";
import {
  LineChart,
  Line,
  AreaChart,
  Area,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";

// -- Types --
export interface TrendDataPoint {
  time: string;
  [key: string]: string | number;
}

export interface TrendChartsProps {
  successRateData: TrendDataPoint[];
  tokenData: TrendDataPoint[];
  runbookHitData: TrendDataPoint[];
  doomLoopData: TrendDataPoint[];
}

const LAYER_COLORS = ["#3b82f6", "#8b5cf6", "#f59e0b", "#10b981", "#ef4444"];
const LAYER_KEYS = ["L1", "L2", "L3", "L4", "L5"];
const LAYER_NAMES = ["L1 沙箱层", "L2 模型网关", "L3 MCP工具", "L4 平台运行", "L5 Skill"];

const MODEL_COLORS = ["#3b82f6", "#8b5cf6", "#f59e0b", "#10b981"];
const MODEL_KEYS = ["qwen-max", "qwen-plus", "qwen-turbo", "gpt-4o"];

const chartCard = "bg-gray-900 rounded-xl border border-gray-800 p-5";
const chartTitle = "text-sm font-semibold text-white mb-4";

function SuccessRateChart({ data }: { data: TrendDataPoint[] }) {
  return (
    <div className={chartCard}>
      <h3 className={chartTitle}>自愈成功率趋势</h3>
      <ResponsiveContainer width="100%" height={220}>
        <LineChart data={data}>
          <CartesianGrid stroke="#1f2937" strokeDasharray="3 3" />
          <XAxis dataKey="time" stroke="#6b7280" fontSize={11} />
          <YAxis stroke="#6b7280" fontSize={11} domain={[0, 100]} unit="%" />
          <Tooltip
            contentStyle={{ backgroundColor: "#111827", border: "1px solid #1f2937", borderRadius: 8 }}
            labelStyle={{ color: "#f9fafb" }}
          />
          <Legend wrapperStyle={{ fontSize: 11, color: "#9ca3af" }} />
          {LAYER_KEYS.map((key, i) => (
            <Line
              key={key}
              type="monotone"
              dataKey={key}
              name={LAYER_NAMES[i]}
              stroke={LAYER_COLORS[i]}
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 4 }}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

function TokenChart({ data }: { data: TrendDataPoint[] }) {
  return (
    <div className={chartCard}>
      <h3 className={chartTitle}>Token 消耗趋势</h3>
      <ResponsiveContainer width="100%" height={220}>
        <AreaChart data={data}>
          <CartesianGrid stroke="#1f2937" strokeDasharray="3 3" />
          <XAxis dataKey="time" stroke="#6b7280" fontSize={11} />
          <YAxis stroke="#6b7280" fontSize={11} />
          <Tooltip
            contentStyle={{ backgroundColor: "#111827", border: "1px solid #1f2937", borderRadius: 8 }}
            labelStyle={{ color: "#f9fafb" }}
          />
          <Legend wrapperStyle={{ fontSize: 11, color: "#9ca3af" }} />
          {MODEL_KEYS.map((key, i) => (
            <Area
              key={key}
              type="monotone"
              dataKey={key}
              name={key}
              stackId="1"
              stroke={MODEL_COLORS[i]}
              fill={MODEL_COLORS[i]}
              fillOpacity={0.4}
            />
          ))}
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

function RunbookChart({ data }: { data: TrendDataPoint[] }) {
  return (
    <div className={chartCard}>
      <h3 className={chartTitle}>Runbook 命中率趋势</h3>
      <ResponsiveContainer width="100%" height={220}>
        <LineChart data={data}>
          <CartesianGrid stroke="#1f2937" strokeDasharray="3 3" />
          <XAxis dataKey="time" stroke="#6b7280" fontSize={11} />
          <YAxis stroke="#6b7280" fontSize={11} domain={[0, 100]} unit="%" />
          <Tooltip
            contentStyle={{ backgroundColor: "#111827", border: "1px solid #1f2937", borderRadius: 8 }}
            labelStyle={{ color: "#f9fafb" }}
          />
          <Line
            type="monotone"
            dataKey="hitRate"
            name="命中率"
            stroke="#10b981"
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 4 }}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

function DoomLoopChart({ data }: { data: TrendDataPoint[] }) {
  return (
    <div className={chartCard}>
      <h3 className={chartTitle}>Doom-Loop 触发次数</h3>
      <ResponsiveContainer width="100%" height={220}>
        <BarChart data={data}>
          <CartesianGrid stroke="#1f2937" strokeDasharray="3 3" />
          <XAxis dataKey="time" stroke="#6b7280" fontSize={11} />
          <YAxis stroke="#6b7280" fontSize={11} />
          <Tooltip
            contentStyle={{ backgroundColor: "#111827", border: "1px solid #1f2937", borderRadius: 8 }}
            labelStyle={{ color: "#f9fafb" }}
          />
          <Bar
            dataKey="count"
            name="触发次数"
            fill="#ef4444"
            radius={[4, 4, 0, 0]}
            maxBarSize={32}
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export default function TrendCharts({
  successRateData,
  tokenData,
  runbookHitData,
  doomLoopData,
}: TrendChartsProps) {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <SuccessRateChart data={successRateData} />
      <TokenChart data={tokenData} />
      <RunbookChart data={runbookHitData} />
      <DoomLoopChart data={doomLoopData} />
    </div>
  );
}
