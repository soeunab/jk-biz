import { NextResponse } from "next/server";

export function ok(data: unknown = { ok: true }) {
  return NextResponse.json(data);
}

export function fail(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

/** 라우트 핸들러 공통 에러 처리 */
export function handle<A extends unknown[]>(fn: (...args: A) => Promise<Response>) {
  return async (...args: A) => {
    try {
      return await fn(...args);
    } catch (e) {
      console.error(e);
      return fail((e as Error).message ?? "서버 오류", 500);
    }
  };
}
