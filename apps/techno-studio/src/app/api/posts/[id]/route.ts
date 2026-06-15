import { NextResponse } from "next/server";
import { getPostById } from "@/lib/db";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const post = await getPostById(id);
  if (!post) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  return NextResponse.json(post);
}
