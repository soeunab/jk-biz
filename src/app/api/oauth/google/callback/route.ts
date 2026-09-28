import { NextResponse } from "next/server";
import { env } from "@/lib/env";
import { handleGoogleCallback } from "@/lib/publishers/google";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  if (!code || !state) return new NextResponse(`구글 연결 취소 또는 오류: ${url.searchParams.get("error") ?? ""}`, { status: 400 });
  try {
    await handleGoogleCallback(code, state);
    return NextResponse.redirect(`${env.publicBaseUrl}/accounts?connected=1`);
  } catch (e) {
    return new NextResponse(`구글 연결 실패: ${(e as Error).message}`, { status: 500 });
  }
}
