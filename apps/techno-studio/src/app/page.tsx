import Link from "next/link";
import NavBar from "@/components/NavBar";

export default function HomePage() {
  return (
    <div className="min-h-screen bg-[#0a0a0f]">
      <NavBar />
      <main className="mx-auto max-w-6xl px-4 py-16">
        <div className="text-center">
          <h1 className="text-5xl font-black tracking-tight">
            <span className="bg-gradient-to-r from-cyan-400 via-fuchsia-400 to-orange-400 bg-clip-text text-transparent">
              AI Techno Studio
            </span>
          </h1>
          <p className="mx-auto mt-4 max-w-xl text-lg text-zinc-400">
            用自然语言描述，AI 逐步叠加采样与效果器。
            <br />
            编曲、试听、发布、点赞 — 一站式 Techno 创作社区。
          </p>

          <div className="mt-10 flex justify-center gap-4">
            <Link
              href="/studio"
              className="rounded-2xl bg-gradient-to-r from-cyan-500 to-fuchsia-500 px-8 py-3.5 text-base font-semibold text-white shadow-lg shadow-cyan-500/20 hover:opacity-90 transition-opacity"
            >
              🎛️ 开始编曲
            </Link>
            <Link
              href="/feed"
              className="rounded-2xl border border-white/10 bg-zinc-900 px-8 py-3.5 text-base font-semibold text-zinc-300 hover:bg-zinc-800 transition-colors"
            >
              🔥 浏览发布区
            </Link>
          </div>
        </div>

        <div className="mt-20 grid gap-6 md:grid-cols-2">
          <div className="rounded-2xl border border-cyan-500/20 bg-gradient-to-br from-cyan-500/5 to-transparent p-6">
            <h2 className="text-xl font-bold text-cyan-300">🎛️ 我的编曲区</h2>
            <p className="mt-2 text-sm text-zinc-400 leading-relaxed">
              像和 DJ 对话一样描述音乐：127bpm, give me 4 notes → double it →
              big hall → distort bass → drop。AI 实时展示阶段性编曲效果，叠加 Kick、Bass、
              Hi-Hat 等免费采样层。
            </p>
            <Link href="/studio" className="mt-4 inline-block text-sm text-cyan-400 hover:underline">
              进入编曲区 →
            </Link>
          </div>

          <div className="rounded-2xl border border-fuchsia-500/20 bg-gradient-to-br from-fuchsia-500/5 to-transparent p-6">
            <h2 className="text-xl font-bold text-fuchsia-300">🔥 编曲发布区</h2>
            <p className="mt-2 text-sm text-zinc-400 leading-relaxed">
              类似 Reddit / 小红书的社区体验 — 浏览所有人的 Techno 作品，
              点赞、评论、转发分享。点赞热榜实时更新，发现最炸的 Drop。
            </p>
            <Link href="/feed" className="mt-4 inline-block text-sm text-fuchsia-400 hover:underline">
              进入发布区 →
            </Link>
          </div>
        </div>

        <div className="mt-12 rounded-2xl border border-white/5 bg-zinc-900/40 p-6">
          <h3 className="text-sm font-semibold text-zinc-300">示例提示词流程</h3>
          <div className="mt-3 flex flex-wrap gap-2">
            {[
              "127bpm, give me 4 notes",
              "double it",
              "put it in big hall",
              "powerful bass",
              "distort bass",
              "drop",
              "kick drum",
            ].map((p, i) => (
              <span key={p} className="flex items-center gap-2">
                <code className="rounded-lg bg-zinc-800 px-3 py-1 text-xs text-cyan-300">{p}</code>
                {i < 6 && <span className="text-zinc-600">→</span>}
              </span>
            ))}
          </div>
        </div>
      </main>
    </div>
  );
}
