"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import NavBar from "@/components/NavBar";
import ChatComposer from "@/components/ChatComposer";
import type { Post } from "@/lib/types";

export default function PostPage() {
  const params = useParams();
  const id = params.id as string;
  const [post, setPost] = useState<Post | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`/api/posts/${id}`)
      .then((r) => r.json())
      .then((data) => {
        setPost(data);
        setLoading(false);
      });
  }, [id]);

  if (loading) {
    return (
      <div className="min-h-screen bg-[#0a0a0f]">
        <NavBar />
        <div className="py-20 text-center text-zinc-500">加载中…</div>
      </div>
    );
  }

  if (!post || !post.id) {
    return (
      <div className="min-h-screen bg-[#0a0a0f]">
        <NavBar />
        <div className="py-20 text-center text-zinc-500">
          作品不存在 · <Link href="/feed" className="text-cyan-400 hover:underline">返回发布区</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0a0a0f]">
      <NavBar />
      <main className="mx-auto max-w-6xl px-4 py-6">
        <div className="mb-6">
          <Link href="/feed" className="text-sm text-zinc-500 hover:text-zinc-300">
            ← 返回发布区
          </Link>
          <h1 className="mt-2 text-2xl font-bold text-white">{post.title}</h1>
          <p className="text-sm text-zinc-500">@{post.author} · ❤️ {post.likes} · ↗ {post.shares}</p>
        </div>

        <ChatComposer initialState={post.composition} readOnly />

        <div className="mt-6 rounded-2xl border border-white/5 bg-zinc-900/40 p-5">
          <h2 className="text-sm font-semibold text-zinc-300">评论 ({post.comments.length})</h2>
          <div className="mt-3 space-y-2">
            {post.comments.length === 0 ? (
              <p className="text-sm text-zinc-500">暂无评论</p>
            ) : (
              post.comments.map((c) => (
                <div key={c.id} className="text-sm">
                  <span className="font-medium text-cyan-400">@{c.author}</span>
                  <span className="ml-2 text-zinc-400">{c.content}</span>
                </div>
              ))
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
