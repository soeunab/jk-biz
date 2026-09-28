import { NextResponse } from "next/server";
import { googleAuthUrl } from "@/lib/publishers/google";

export async function GET(req: Request) {
  const accountId = new URL(req.url).searchParams.get("accountId");
  if (!accountId) return NextResponse.json({ error: "accountId 필요" }, { status: 400 });
  try {
    return NextResponse.redirect(googleAuthUrl(accountId));
  } catch (e) {
    return new NextResponse(`구글 연결 설정 오류: ${(e as Error).message}`, { status: 500 });
  }
}
