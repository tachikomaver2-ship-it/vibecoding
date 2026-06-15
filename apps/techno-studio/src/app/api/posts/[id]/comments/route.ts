import { NextResponse } from "next/server";
import { addComment } from "@/lib/db";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = (await request.json()) as { author?: string; content?: string };

  if (!body.content?.trim()) {
    return NextResponse.json({ error: "content required" }, { status: 400 });
  }

  const post = await addComment(id, body.author || "anonymous", body.content.trim());
  if (!post) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  return NextResponse.json(post);
}
