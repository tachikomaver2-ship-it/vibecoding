import Link from "next/link";
import type { Post } from "@/lib/types";

interface HotBoardProps {
  posts: Post[];
}

export default function HotBoard({ posts }: HotBoardProps) {
  return (
    <aside className="rounded-2xl border border-white/5 bg-zinc-900/60 p-4">
      <h2 className="flex items-center gap-2 text-sm font-bold text-orange-300">
        🏆 点赞热榜
      </h2>
      <ol className="mt-3 space-y-2">
        {posts.map((post, i) => (
          <li key={post.id}>
            <Link
              href={`/post/${post.id}`}
              className="flex items-center gap-3 rounded-lg px-2 py-1.5 transition-colors hover:bg-white/5"
            >
              <span
                className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold ${
                  i === 0
                    ? "bg-orange-500/20 text-orange-300"
                    : i === 1
                      ? "bg-zinc-500/20 text-zinc-300"
                      : i === 2
                        ? "bg-amber-700/20 text-amber-400"
                        : "bg-zinc-800 text-zinc-500"
                }`}
              >
                {i + 1}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm text-zinc-200">{post.title}</p>
                <p className="text-xs text-zinc-500">@{post.author}</p>
              </div>
              <span className="text-xs font-medium text-red-400">❤️ {post.likes}</span>
            </Link>
          </li>
        ))}
      </ol>
    </aside>
  );
}
