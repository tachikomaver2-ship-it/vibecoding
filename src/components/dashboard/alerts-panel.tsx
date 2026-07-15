"use client";

import {
  AlertTriangle,
  CheckCircle,
  XCircle,
  Clock,
  ShieldAlert,
  ListChecks,
} from "lucide-react";

// -- Types --
export interface Alert {
  id: string;
  severity: "P0" | "P1" | "P2" | "P3";
  message: string;
  time: string;
  layer?: string;
}

export interface CircuitBreaker {
  name: string;
  state: "CLOSED" | "OPEN" | "HALF_OPEN";
  lastChanged: string;
}

export interface PendingApproval {
  id: string;
  action: string;
  target: string;
  riskLevel: "high" | "medium" | "low";
  createdAt: string;
}

interface AlertsPanelProps {
  alerts: Alert[];
  circuitBreakers: CircuitBreaker[];
  pendingApprovals: PendingApproval[];
}

const severityConfig = {
  P0: { bg: "bg-rose-500/20", text: "text-rose-400", border: "border-rose-500/30" },
  P1: { bg: "bg-orange-500/20", text: "text-orange-400", border: "border-orange-500/30" },
  P2: { bg: "bg-amber-500/20", text: "text-amber-400", border: "border-amber-500/30" },
  P3: { bg: "bg-blue-500/20", text: "text-blue-400", border: "border-blue-500/30" },
};

const cbStateConfig = {
  CLOSED: { color: "text-emerald-400", bg: "bg-emerald-500/20", icon: CheckCircle, label: "正常" },
  OPEN: { color: "text-rose-400", bg: "bg-rose-500/20", icon: XCircle, label: "熔断" },
  HALF_OPEN: { color: "text-amber-400", bg: "bg-amber-500/20", icon: AlertTriangle, label: "半开" },
};

const riskConfig = {
  high: { bg: "bg-rose-500/20", text: "text-rose-400" },
  medium: { bg: "bg-amber-500/20", text: "text-amber-400" },
  low: { bg: "bg-emerald-500/20", text: "text-emerald-400" },
};

export default function AlertsPanel({
  alerts,
  circuitBreakers,
  pendingApprovals,
}: AlertsPanelProps) {
  return (
    <div className="space-y-4">
      {/* Alerts */}
      <div className="bg-gray-900 rounded-xl border border-gray-800 p-5">
        <div className="flex items-center gap-2 mb-4">
          <ShieldAlert className="w-4 h-4 text-rose-400" />
          <h3 className="text-sm font-semibold text-white">
            近1h 告警聚合列表
          </h3>
          <span className="ml-auto text-xs text-gray-500">
            {alerts.length} 条告警
          </span>
        </div>
        <div className="space-y-2 max-h-48 overflow-y-auto">
          {alerts.length === 0 ? (
            <p className="text-xs text-gray-500 text-center py-4">
              暂无告警
            </p>
          ) : (
            alerts.map((alert) => {
              const sev = severityConfig[alert.severity];
              return (
                <div
                  key={alert.id}
                  className={`flex items-start gap-3 p-2.5 rounded-lg border ${sev.border} ${sev.bg}/5`}
                >
                  <span
                    className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${sev.bg} ${sev.text} flex-shrink-0 mt-0.5`}
                  >
                    {alert.severity}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs text-gray-200 leading-relaxed truncate">
                      {alert.message}
                    </p>
                    <div className="flex items-center gap-2 mt-1">
                      {alert.layer && (
                        <span className="text-[10px] text-gray-500">
                          {alert.layer}
                        </span>
                      )}
                      <span className="text-[10px] text-gray-600">
                        {alert.time}
                      </span>
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* Circuit Breakers */}
      <div className="bg-gray-900 rounded-xl border border-gray-800 p-5">
        <div className="flex items-center gap-2 mb-4">
          <AlertTriangle className="w-4 h-4 text-amber-400" />
          <h3 className="text-sm font-semibold text-white">当前断路器状态</h3>
        </div>
        <div className="space-y-2">
          {circuitBreakers.length === 0 ? (
            <p className="text-xs text-gray-500 text-center py-4">
              暂无断路器数据
            </p>
          ) : (
            circuitBreakers.map((cb) => {
              const cfg = cbStateConfig[cb.state];
              const Icon = cfg.icon;
              return (
                <div
                  key={cb.name}
                  className="flex items-center justify-between p-2.5 rounded-lg bg-gray-800/50"
                >
                  <div className="flex items-center gap-2">
                    <Icon className={`w-4 h-4 ${cfg.color}`} />
                    <span className="text-xs text-gray-300">{cb.name}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span
                      className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${cfg.bg} ${cfg.color}`}
                    >
                      {cfg.label}
                    </span>
                    <span className="text-[10px] text-gray-500">
                      {cb.lastChanged}
                    </span>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* Pending Approvals */}
      <div className="bg-gray-900 rounded-xl border border-gray-800 p-5">
        <div className="flex items-center gap-2 mb-4">
          <ListChecks className="w-4 h-4 text-blue-400" />
          <h3 className="text-sm font-semibold text-white">
            待审批的自愈操作队列
          </h3>
          <span className="ml-auto text-xs text-gray-500">
            {pendingApprovals.length} 项待审
          </span>
        </div>
        <div className="space-y-2 max-h-40 overflow-y-auto">
          {pendingApprovals.length === 0 ? (
            <p className="text-xs text-gray-500 text-center py-4">
              暂无待审批操作
            </p>
          ) : (
            pendingApprovals.map((item) => {
              const risk = riskConfig[item.riskLevel];
              return (
                <div
                  key={item.id}
                  className="flex items-center justify-between p-2.5 rounded-lg bg-gray-800/50"
                >
                  <div className="flex-1 min-w-0">
                    <p className="text-xs text-gray-200 truncate">
                      {item.action}
                    </p>
                    <p className="text-[10px] text-gray-500 mt-0.5">
                      {item.target}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <span
                      className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${risk.bg} ${risk.text}`}
                    >
                      {item.riskLevel === "high"
                        ? "高风险"
                        : item.riskLevel === "medium"
                        ? "中风险"
                        : "低风险"}
                    </span>
                    <Clock className="w-3 h-3 text-gray-500" />
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
