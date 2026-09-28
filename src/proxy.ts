import { NextResponse, type NextRequest } from "next/server";

/**
 * 대시보드 보호: DASHBOARD_PASSWORD 가 설정되면 Basic Auth 를 요구합니다.
 * /media (블로거·인스타가 이미지를 가져가는 경로)는 공개합니다.
 */
export function proxy(req: NextRequest) {
  const password = process.env.DASHBOARD_PASSWORD?.trim();
  if (!password) return NextResponse.next();
  const header = req.headers.get("authorization") ?? "";
  if (header.startsWith("Basic ")) {
    const decoded = atob(header.slice(6));
    const pass = decoded.slice(decoded.indexOf(":") + 1);
    if (pass === password) return NextResponse.next();
  }
  return new NextResponse("인증이 필요합니다.", { status: 401, headers: { "WWW-Authenticate": 'Basic realm="jiwon4u-studio", charset="UTF-8"' } });
}

export const config = {
  matcher: ["/((?!media/|_next/static|_next/image|favicon.ico).*)"],
};
