"use client";

import type { LayerState } from "@/lib/types";

interface TrackStackProps {
  layers: LayerState[];
}

export default function TrackStack({ layers }: TrackStackProps) {
  const active = layers.filter((l) => l.enabled);

  if (active.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-zinc-700 bg-zinc-900/50 p-6 text-center text-sm text-zinc-500">
        暂无轨道 — 用自然语言描述开始编曲
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {active.map((layer, i) => (
        <div
          key={layer.id}
          className="flex items-center gap-3 rounded-xl border border-white/5 bg-zinc-900/80 px-4 py-3"
          style={{ animationDelay: `${i * 80}ms` }}
        >
          <div
            className="h-3 w-3 rounded-full shadow-lg"
            style={{ backgroundColor: layer.color, boxShadow: `0 0 12px ${layer.color}` }}
          />
          <span className="flex-1 text-sm font-medium text-zinc-200">{layer.label}</span>
          <div className="flex gap-0.5">
            {Array.from({ length: 8 }).map((_, j) => (
              <div
                key={j}
                className="w-1 rounded-full bg-zinc-700"
                style={{
                  height: `${8 + Math.sin(j + i) * 6 + layer.volume * 10}px`,
                  backgroundColor: j % 2 === 0 ? layer.color : undefined,
                  opacity: 0.3 + layer.volume * 0.7,
                }}
              />
            ))}
          </div>
          <span className="text-xs text-zinc-500">{Math.round(layer.volume * 100)}%</span>
        </div>
      ))}
    </div>
  );
}
