import { NextResponse } from "next/server";

export async function POST() {
  return NextResponse.json(
    { error: "Not implemented yet. Scheduled for Phase 7." },
    { status: 501 },
  );
}
