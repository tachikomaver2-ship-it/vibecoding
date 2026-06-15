"use client";

import { useRouter } from "next/navigation";
import NavBar from "@/components/NavBar";
import ChatComposer from "@/components/ChatComposer";
import { FREE_SAMPLE_SOURCES } from "@/lib/samples";
import type { CompositionState } from "@/lib/types";

export default function StudioPage() {
  const router = useRouter();

  async function handlePublish(composition: CompositionState) {
    const author =
      typeof window !== "undefined"
        ? localStorage.getItem("techno_username") || prompt("你的 DJ 名:", "DJ_Anon") || "DJ_Anon"
        : "DJ_Anon";

    if (typeof window !== "undefined") {
      localStorage.setItem("techno_username", author);
    }

    const title =
      composition.title !== "Untitled Techno"
        ? composition.title
        : prompt("给这首曲子起个名字:", composition.title) || composition.title;

    const res = await fetch("/api/posts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title, author, composition: { ...composition, title } }),
    });

    if (res.ok) {
      const post = await res.json();
      router.push(`/post/${post.id}`);
    }
  }

  return (
    <div className="min-h-screen bg-[#0a0a0f]">
      <NavBar />
      <main className="mx-auto max-w-6xl px-4 py-6">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-white">🎛️ 我的编曲区</h1>
          <p className="mt-1 text-sm text-zinc-500">
            用自然语言描述，AI 逐步叠加采样与效果 — 随时试听，满意后发布
          </p>
        </div>

        <ChatComposer onPublish={handlePublish} />

        <section className="mt-8 rounded-2xl border border-white/5 bg-zinc-900/40 p-5">
          <h2 className="text-sm font-semibold text-zinc-300">🎵 免费 Techno 采样来源</h2>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            {FREE_SAMPLE_SOURCES.map((src) => (
              <a
                key={src.name}
                href={src.url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center justify-between rounded-xl border border-white/5 bg-zinc-900/60 px-4 py-3 text-sm transition-colors hover:border-cyan-500/30 hover:bg-zinc-800/60"
              >
                <span className="text-zinc-300">{src.name}</span>
                <span className="text-xs text-zinc-500">{src.license}</span>
              </a>
            ))}
          </div>
        </section>
      </main>
    </div>
  );
}
