import { promises as fs } from "fs";
import path from "path";
import type { Comment, CompositionState, Post } from "./types";
import { createInitialState } from "./prompt-parser";

const DATA_DIR = path.join(process.cwd(), "data");
const POSTS_FILE = path.join(DATA_DIR, "posts.json");

async function ensureDataDir() {
  await fs.mkdir(DATA_DIR, { recursive: true });
}

async function readPosts(): Promise<Post[]> {
  await ensureDataDir();
  try {
    const raw = await fs.readFile(POSTS_FILE, "utf-8");
    return JSON.parse(raw) as Post[];
  } catch {
    return getSeedPosts();
  }
}

async function writePosts(posts: Post[]) {
  await ensureDataDir();
  await fs.writeFile(POSTS_FILE, JSON.stringify(posts, null, 2));
}

function getSeedPosts(): Post[] {
  const demo: CompositionState = {
    ...createInitialState(),
    title: "Midnight Warehouse",
    bpm: 127,
    noteCount: 4,
    pattern: [0, 1, 2, 3],
    speedMultiplier: 2,
    layers: {
      ...createInitialState().layers,
      kick: { ...createInitialState().layers.kick, enabled: true },
      bass: { ...createInitialState().layers.bass, enabled: true, volume: 1 },
      hat: { ...createInitialState().layers.hat, enabled: true },
      lead: { ...createInitialState().layers.lead, enabled: true },
      pad: { ...createInitialState().layers.pad, enabled: false },
    },
    effects: { reverb: 0.85, distortion: 0.75, bassPower: 1, drop: true },
  };

  return [
    {
      id: "seed-1",
      title: "Midnight Warehouse",
      author: "DJ_Vibe",
      composition: demo,
      likes: 128,
      likedBy: [],
      comments: [
        {
          id: "c1",
          author: "techno_fan",
          content: "这个 drop 太炸了 🔥",
          createdAt: Date.now() - 3600000,
        },
      ],
      shares: 23,
      createdAt: Date.now() - 86400000,
    },
    {
      id: "seed-2",
      title: "Berlin Basement",
      author: "MinimalQueen",
      composition: {
        ...createInitialState(),
        title: "Berlin Basement",
        bpm: 130,
        noteCount: 6,
        pattern: [0, 2, 1, 3, 0, 2],
        layers: {
          ...createInitialState().layers,
          kick: { ...createInitialState().layers.kick, enabled: true },
          bass: { ...createInitialState().layers.bass, enabled: true },
        },
        effects: { reverb: 0.3, distortion: 0, bassPower: 0.5, drop: false },
      },
      likes: 87,
      likedBy: [],
      comments: [],
      shares: 12,
      createdAt: Date.now() - 172800000,
    },
    {
      id: "seed-3",
      title: "Acid Dreams",
      author: "303Lover",
      composition: {
        ...createInitialState(),
        title: "Acid Dreams",
        bpm: 135,
        noteCount: 8,
        pattern: [0, 1, 2, 3, 2, 1, 0, 3],
        speedMultiplier: 1,
        layers: {
          ...createInitialState().layers,
          bass: { ...createInitialState().layers.bass, enabled: true, volume: 1 },
          lead: { ...createInitialState().layers.lead, enabled: true },
        },
        effects: { reverb: 0.5, distortion: 0.9, bassPower: 1, drop: true },
      },
      likes: 256,
      likedBy: [],
      comments: [
        {
          id: "c2",
          author: "rave_kid",
          content: "distort bass 绝了",
          createdAt: Date.now() - 7200000,
        },
        {
          id: "c3",
          author: "studio_rat",
          content: "能分享工程吗？",
          createdAt: Date.now() - 5400000,
        },
      ],
      shares: 45,
      createdAt: Date.now() - 259200000,
    },
  ];
}

export async function getAllPosts(): Promise<Post[]> {
  const posts = await readPosts();
  return posts.sort((a, b) => b.createdAt - a.createdAt);
}

export async function getHotPosts(limit = 10): Promise<Post[]> {
  const posts = await readPosts();
  return [...posts].sort((a, b) => b.likes - a.likes).slice(0, limit);
}

export async function getPostById(id: string): Promise<Post | null> {
  const posts = await readPosts();
  return posts.find((p) => p.id === id) ?? null;
}

export async function createPost(
  title: string,
  author: string,
  composition: CompositionState
): Promise<Post> {
  const posts = await readPosts();
  const post: Post = {
    id: `post-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    title,
    author,
    composition,
    likes: 0,
    likedBy: [],
    comments: [],
    shares: 0,
    createdAt: Date.now(),
  };
  posts.unshift(post);
  await writePosts(posts);
  return post;
}

export async function toggleLike(
  postId: string,
  userId: string
): Promise<Post | null> {
  const posts = await readPosts();
  const idx = posts.findIndex((p) => p.id === postId);
  if (idx === -1) return null;

  const post = posts[idx];
  const liked = post.likedBy.includes(userId);
  if (liked) {
    post.likedBy = post.likedBy.filter((u) => u !== userId);
    post.likes = Math.max(0, post.likes - 1);
  } else {
    post.likedBy.push(userId);
    post.likes += 1;
  }
  posts[idx] = post;
  await writePosts(posts);
  return post;
}

export async function addComment(
  postId: string,
  author: string,
  content: string
): Promise<Post | null> {
  const posts = await readPosts();
  const idx = posts.findIndex((p) => p.id === postId);
  if (idx === -1) return null;

  const comment: Comment = {
    id: `comment-${Date.now()}`,
    author,
    content,
    createdAt: Date.now(),
  };
  posts[idx].comments.push(comment);
  await writePosts(posts);
  return posts[idx];
}

export async function incrementShare(postId: string): Promise<Post | null> {
  const posts = await readPosts();
  const idx = posts.findIndex((p) => p.id === postId);
  if (idx === -1) return null;
  posts[idx].shares += 1;
  await writePosts(posts);
  return posts[idx];
}
