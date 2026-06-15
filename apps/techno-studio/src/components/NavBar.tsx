"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const NAV_ITEMS = [
  { href: "/studio", label: "我的编曲", icon: "🎛️" },
  { href: "/feed", label: "编曲发布区", icon: "🔥" },
];

export default function NavBar() {
  const pathname = usePathname();

  return (
    <header className="sticky top-0 z-50 border-b border-white/10 bg-[#0a0a0f]/90 backdrop-blur-xl">
      <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4">
        <Link href="/" className="flex items-center gap-2">
          <span className="text-xl">⚡</span>
          <span className="bg-gradient-to-r from-cyan-400 to-fuchsia-500 bg-clip-text text-lg font-bold tracking-tight text-transparent">
            TechnoStudio
          </span>
        </Link>

        <nav className="flex items-center gap-1">
          {NAV_ITEMS.map((item) => {
            const active = pathname.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`rounded-full px-4 py-1.5 text-sm font-medium transition-all ${
                  active
                    ? "bg-gradient-to-r from-cyan-500/20 to-fuchsia-500/20 text-cyan-300 ring-1 ring-cyan-500/30"
                    : "text-zinc-400 hover:bg-white/5 hover:text-white"
                }`}
              >
                {item.icon} {item.label}
              </Link>
            );
          })}
        </nav>
      </div>
    </header>
  );
}
