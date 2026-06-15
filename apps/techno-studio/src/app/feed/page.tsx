"use client";

import { useCallback, useEffect, useState } from "react";
import NavBar from "@/components/NavBar";
import PostCard from "@/components/PostCard";
import HotBoard from "@/components/HotBoard";
import type { Post } from "@/lib/types";

function getUserId() {
  if (typeof window === "undefined") return "anonymous";
  let id = localStorage.getItem("techno_user_id");
  if (!id) {
    id = `user_${Math.random().toString(36).slice(2, 9)}`;
    localStorage.setItem("techno_user_id", id);
  }
  return id;
}

export default function FeedPage() {
  const [posts, setPosts] = useState<Post[]>([]);
  const [hotPosts, setHotPosts] = useState<Post[]>([]);
  const [userId, setUserId] = useState("anonymous");
  const [loading, setLoading] = useState(true);

  const loadPosts = useCallback(async () => {
    const [allRes, hotRes] = await Promise.all([
      fetch("/api/posts"),
      fetch("/api/posts/hot"),
    ]);
    setPosts(await allRes.json());
    setHotPosts(await hotRes.json());
    setLoading(false);
  }, []);

  useEffect(() => {
    setUserId(getUserId());
    loadPosts();
  }, [loadPosts]);

  async function handleLike(postId: string) {
    const res = await fetch(`/api/posts/${postId}/like`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId }),
    });
    if (res.ok) {
      const updated = await res.json();
      setPosts((prev) => prev.map((p) => (p.id === postId ? updated : p)));
      setHotPosts((prev) => {
        const sorted = [...posts.map((p) => (p.id === postId ? updated : p))].sort(
          (a, b) => b.likes - a.likes
        );
        return sorted.slice(0, 10);
      });
    }
  }

  async function handleComment(postId: string, content: string) {
    const username = localStorage.getItem("techno_username") || userId;
    const res = await fetch(`/api/posts/${postId}/comments`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ author: username, content }),
    });
    if (res.ok) {
      const updated = await res.json();
      setPosts((prev) => prev.map((p) => (p.id === postId ? updated : p)));
    }
  }

  async function handleShare(postId: string) {
    await fetch(`/api/posts/${postId}/share`, { method: "POST" });
  }

  return (
    <div className="min-h-screen bg-[#0a0a0f]">
      <NavBar />
      <main className="mx-auto max-w-6xl px-4 py-6">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-white">🔥 编曲发布区</h1>
          <p className="mt-1 text-sm text-zinc-500">
            发现社区作品 · 点赞 · 评论 · 分享给朋友
          </p>
        </div>

        <div className="grid gap-6 lg:grid-cols-3">
          <div className="space-y-4 lg:col-span-2">
            {loading ? (
              <div className="py-20 text-center text-zinc-500">加载中…</div>
            ) : posts.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-zinc-700 py-20 text-center text-zinc-500">
                还没有发布 — 去{" "}
                <a href="/studio" className="text-cyan-400 hover:underline">
                  我的编曲区
                </a>{" "}
                创作第一首
              </div>
            ) : (
              posts.map((post) => (
                <PostCard
                  key={post.id}
                  post={post}
                  userId={userId}
                  onLike={handleLike}
                  onComment={handleComment}
                  onShare={handleShare}
                />
              ))
            )}
          </div>

          <div className="lg:sticky lg:top-20 lg:self-start">
            <HotBoard posts={hotPosts} />
          </div>
        </div>
      </main>
    </div>
  );
}
