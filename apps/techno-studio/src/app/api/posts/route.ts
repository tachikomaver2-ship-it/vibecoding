import { NextResponse } from "next/server";
import { getAllPosts, createPost } from "@/lib/db";
import type { CompositionState } from "@/lib/types";

export async function GET() {
  const posts = await getAllPosts();
  return NextResponse.json(posts);
}

export async function POST(request: Request) {
  const body = (await request.json()) as {
    title?: string;
    author?: string;
    composition: CompositionState;
  };

  if (!body.composition) {
    return NextResponse.json({ error: "composition required" }, { status: 400 });
  }

  const post = await createPost(
    body.title || body.composition.title || "Untitled Techno",
    body.author || "anonymous",
    body.composition
  );

  return NextResponse.json(post, { status: 201 });
}
