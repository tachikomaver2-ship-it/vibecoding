import { NextResponse } from "next/server";
import { toggleLike } from "@/lib/db";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = (await request.json()) as { userId?: string };
  const userId = body.userId || "anonymous";

  const post = await toggleLike(id, userId);
  if (!post) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  return NextResponse.json(post);
}
