"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Zap,
  FlaskConical,
  Beaker,
  BarChart3,
  Settings,
  ShieldCheck,
  User,
} from "lucide-react";

const navItems = [
  { href: "/dashboard", label: "仪表盘", icon: LayoutDashboard },
  { href: "/events", label: "事件", icon: Zap },
  { href: "/benchmarks", label: "Benchmark", icon: FlaskConical },
  { href: "/trials", label: "试验", icon: Beaker },
  { href: "/metrics", label: "指标", icon: BarChart3 },
];

export default function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="fixed left-0 top-0 z-40 h-screen w-56 bg-gray-950 border-r border-gray-800 flex flex-col">
      {/* Logo */}
      <div className="flex items-center gap-2 px-5 py-5 border-b border-gray-800">
        <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-blue-600/20 text-blue-400">
          <ShieldCheck className="w-5 h-5" />
        </div>
        <div>
          <span className="text-sm font-semibold text-white tracking-tight">
            Agent Eval
          </span>
          <p className="text-[10px] text-gray-500 leading-none mt-0.5">
            SRE 评测系统
          </p>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
        {navItems.map(({ href, label, icon: Icon }) => {
          const active =
            pathname === href || pathname.startsWith(href + "/");
          return (
            <Link
              key={href}
              href={href}
              className={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                active
                  ? "bg-blue-600/20 text-blue-400"
                  : "text-gray-400 hover:bg-gray-800 hover:text-gray-200"
              }`}
            >
              <Icon className="w-4 h-4 flex-shrink-0" />
              {label}
            </Link>
          );
        })}
      </nav>

      {/* Bottom */}
      <div className="border-t border-gray-800 px-3 py-4 space-y-1">
        <button className="flex items-center gap-3 px-3 py-2 w-full rounded-lg text-sm font-medium text-gray-400 hover:bg-gray-800 hover:text-gray-200 transition-colors">
          <Settings className="w-4 h-4" />
          设置
        </button>
        <div className="flex items-center gap-3 px-3 py-2">
          <div className="w-7 h-7 rounded-full bg-gray-800 flex items-center justify-center">
            <User className="w-4 h-4 text-gray-400" />
          </div>
          <span className="text-sm text-gray-400">SRE 团队</span>
        </div>
      </div>
    </aside>
  );
}
