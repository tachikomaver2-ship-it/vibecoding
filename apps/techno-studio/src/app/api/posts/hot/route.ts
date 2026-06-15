import { NextResponse } from "next/server";
import { getHotPosts } from "@/lib/db";

export async function GET() {
  const posts = await getHotPosts(10);
  return NextResponse.json(posts);
}
