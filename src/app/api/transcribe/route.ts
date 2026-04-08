import { NextResponse } from "next/server";

export async function POST() {
  return NextResponse.json(
    { error: "Not implemented yet. Scheduled for Phase 4." },
    { status: 501 },
  );
}
