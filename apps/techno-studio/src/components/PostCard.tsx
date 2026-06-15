"use client";

import { useState } from "react";
import Link from "next/link";
import type { Post } from "@/lib/types";

interface PostCardProps {
  post: Post;
  userId: string;
  onLike?: (postId: string) => Promise<void>;
  onComment?: (postId: string, content: string) => Promise<void>;
  onShare?: (postId: string) => Promise<void>;
}

export default function PostCard({
  post,
  userId,
  onLike,
  onComment,
  onShare,
}: PostCardProps) {
  const [liked, setLiked] = useState(post.likedBy.includes(userId));
  const [likes, setLikes] = useState(post.likes);
  const [shares, setShares] = useState(post.shares);
  const [commentText, setCommentText] = useState("");
  const [comments, setComments] = useState(post.comments);
  const [showComments, setShowComments] = useState(false);
  const [loading, setLoading] = useState(false);

  const comp = post.composition;
  const activeLayers = Object.values(comp.layers).filter((l) => l.enabled);

  async function handleLike() {
    if (!onLike || loading) return;
    setLoading(true);
    try {
      await onLike(post.id);
      setLiked(!liked);
      setLikes(liked ? likes - 1 : likes + 1);
    } finally {
      setLoading(false);
    }
  }

  async function handleComment(e: React.FormEvent) {
    e.preventDefault();
    if (!onComment || !commentText.trim() || loading) return;
    setLoading(true);
    try {
      await onComment(post.id, commentText.trim());
      setComments((prev) => [
        ...prev,
        {
          id: `local-${Date.now()}`,
          author: userId,
          content: commentText.trim(),
          createdAt: Date.now(),
        },
      ]);
      setCommentText("");
    } finally {
      setLoading(false);
    }
  }

  async function handleShare() {
    const url = `${window.location.origin}/post/${post.id}`;
    await navigator.clipboard.writeText(url);
    if (onShare) {
      await onShare(post.id);
      setShares((s) => s + 1);
    }
    alert("链接已复制，分享给朋友吧！");
  }

  return (
    <article className="rounded-2xl border border-white/5 bg-zinc-900/60 overflow-hidden transition-all hover:border-cyan-500/20">
      <div className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="font-semibold text-white">{post.title}</h3>
            <p className="mt-0.5 text-xs text-zinc-500">
              @{post.author} · {comp.bpm} BPM · ×{comp.speedMultiplier}
            </p>
          </div>
          <div className="flex items-center gap-1 rounded-full bg-orange-500/10 px-2.5 py-1 text-xs font-medium text-orange-300">
            ❤️ {likes}
          </div>
        </div>

        <div className="mt-3 flex flex-wrap gap-1.5">
          {activeLayers.map((l) => (
            <span
              key={l.id}
              className="rounded-full px-2 py-0.5 text-xs ring-1 ring-white/10"
              style={{ color: l.color, backgroundColor: `${l.color}15` }}
            >
              {l.label}
            </span>
          ))}
          {comp.effects.drop && (
            <span className="rounded-full bg-red-500/10 px-2 py-0.5 text-xs text-red-300">DROP</span>
          )}
        </div>
      </div>

      <div className="flex border-t border-white/5">
        <button
          onClick={handleLike}
          disabled={loading}
          className={`flex-1 py-2.5 text-sm transition-colors ${
            liked ? "text-red-400" : "text-zinc-400 hover:text-red-400"
          }`}
        >
          {liked ? "❤️ 已赞" : "🤍 点赞"}
        </button>
        <button
          onClick={() => setShowComments(!showComments)}
          className="flex-1 py-2.5 text-sm text-zinc-400 hover:text-cyan-400 transition-colors"
        >
          💬 {comments.length}
        </button>
        <button
          onClick={handleShare}
          className="flex-1 py-2.5 text-sm text-zinc-400 hover:text-fuchsia-400 transition-colors"
        >
          ↗ 分享 {shares > 0 && `(${shares})`}
        </button>
        <Link
          href={`/post/${post.id}`}
          className="flex-1 py-2.5 text-center text-sm text-zinc-400 hover:text-white transition-colors"
        >
          🎧 试听
        </Link>
      </div>

      {showComments && (
        <div className="border-t border-white/5 p-4 space-y-3">
          {comments.map((c) => (
            <div key={c.id} className="text-sm">
              <span className="font-medium text-cyan-400">@{c.author}</span>
              <span className="text-zinc-400 ml-2">{c.content}</span>
            </div>
          ))}
          {onComment && (
            <form onSubmit={handleComment} className="flex gap-2">
              <input
                value={commentText}
                onChange={(e) => setCommentText(e.target.value)}
                placeholder="写评论…"
                className="flex-1 rounded-lg border border-white/10 bg-zinc-800 px-3 py-1.5 text-sm text-white outline-none focus:border-cyan-500/50"
              />
              <button
                type="submit"
                disabled={loading}
                className="rounded-lg bg-zinc-700 px-3 py-1.5 text-sm text-zinc-200 hover:bg-zinc-600"
              >
                发送
              </button>
            </form>
          )}
        </div>
      )}
    </article>
  );
}
