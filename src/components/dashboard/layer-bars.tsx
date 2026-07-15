"use client";

export interface LayerRate {
  name: string;
  rate: number;
}

interface LayerBarsProps {
  layers: LayerRate[];
}

function getColor(rate: number) {
  if (rate >= 85) return { bar: "bg-emerald-500", text: "text-emerald-400" };
  if (rate >= 60) return { bar: "bg-amber-500", text: "text-amber-400" };
  return { bar: "bg-rose-500", text: "text-rose-400" };
}

function getGradientId(rate: number) {
  if (rate >= 85) return "from-emerald-600 to-emerald-400";
  if (rate >= 60) return "from-amber-600 to-amber-400";
  return "from-rose-600 to-rose-400";
}

export default function LayerBars({ layers }: LayerBarsProps) {
  return (
    <div className="bg-gray-900 rounded-xl border border-gray-800 p-5">
      <h3 className="text-sm font-semibold text-white mb-4">分层自愈成功率</h3>
      <div className="space-y-4">
        {layers.map((layer) => {
          const colors = getColor(layer.rate);
          const gradient = getGradientId(layer.rate);
          return (
            <div key={layer.name} className="space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-gray-300 w-24 truncate">
                  {layer.name}
                </span>
                <span className={`text-xs font-bold tabular-nums ${colors.text}`}>
                  {layer.rate.toFixed(1)}%
                </span>
              </div>
              <div className="h-2 bg-gray-800 rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full bg-gradient-to-r ${gradient} transition-all duration-700`}
                  style={{ width: `${Math.min(layer.rate, 100)}%` }}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
