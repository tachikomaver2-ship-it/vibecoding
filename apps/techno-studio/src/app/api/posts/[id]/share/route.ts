import { NextResponse } from "next/server";
import { incrementShare } from "@/lib/db";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const post = await incrementShare(id);
  if (!post) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  return NextResponse.json(post);
}
