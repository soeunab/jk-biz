import { db } from "../db";

/** 따옴표를 지원하는 간단한 CSV 파서 */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let q = false;
  const s = text.replace(/^﻿/, "");
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) {
      if (c === '"' && s[i + 1] === '"') (cell += '"'), i++;
      else if (c === '"') q = false;
      else cell += c;
    } else if (c === '"') q = true;
    else if (c === ",") row.push(cell.trim()), (cell = "");
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && s[i + 1] === "\n") i++;
      row.push(cell.trim());
      if (row.some((x) => x !== "")) rows.push(row);
      row = [];
      cell = "";
    } else cell += c;
  }
  row.push(cell.trim());
  if (row.some((x) => x !== "")) rows.push(row);
  return rows;
}

const SOURCE_ALIASES: Record<string, string> = {
  애드포스트: "ADPOST", adpost: "ADPOST",
  쇼핑커넥트: "SHOPPING_CONNECT", shopping_connect: "SHOPPING_CONNECT", 쇼핑: "SHOPPING_CONNECT",
  쿠팡: "COUPANG", 쿠팡파트너스: "COUPANG", coupang: "COUPANG",
  애드센스: "ADSENSE", adsense: "ADSENSE",
  메이트: "MATE", 네이버메이트: "MATE", mate: "MATE",
  브랜드커넥트: "BRAND_CONNECT", 협찬: "BRAND_CONNECT", 원고료: "BRAND_CONNECT", brand_connect: "BRAND_CONNECT",
  체험단: "SPONSOR", sponsor: "SPONSOR",
  클립: "CLIP", clip: "CLIP",
};

function parseDate(v: string) {
  const d = new Date(`${v.replace(/\./g, "-").replace(/-$/, "").trim()}T00:00:00`);
  if (isNaN(d.getTime())) throw new Error(`날짜 형식 오류: ${v}`);
  return d;
}

function num(v: string) {
  return Number(v.replace(/[,원\s₩]/g, "")) || 0;
}

async function findPost(url: string) {
  if (!url) return null;
  const logNo = url.match(/(\d{9,})/)?.[1];
  return db.post.findFirst({
    where: { OR: [{ remoteUrl: url }, ...(logNo ? [{ remoteId: logNo }, { remoteUrl: { contains: logNo } }] : [])] },
  });
}

async function findAccount(v: string) {
  if (!v) return null;
  return db.account.findFirst({ where: { OR: [{ name: v }, { externalId: v }, { id: v }] } });
}

/**
 * 조회수 CSV: 날짜,글URL,조회수
 * (네이버 블로그 통계 → 게시물별 조회수를 옮겨 적거나 엑셀에서 저장)
 */
export async function importPostMetrics(csv: string) {
  const rows = parseCsv(csv).filter((r) => !/날짜|date/i.test(r[0]));
  let ok = 0;
  const errors: string[] = [];
  for (const r of rows) {
    try {
      const [d, url, pv] = r;
      const post = await findPost(url);
      if (!post) throw new Error(`글을 찾을 수 없음: ${url}`);
      const date = parseDate(d);
      await db.postMetric.upsert({
        where: { postId_date_source: { postId: post.id, date, source: "NAVER" } },
        create: { postId: post.id, date, source: "NAVER", pageviews: num(pv) },
        update: { pageviews: num(pv) },
      });
      ok++;
    } catch (e) {
      errors.push((e as Error).message);
    }
  }
  return { ok, errors: errors.slice(0, 20) };
}

/**
 * 수익 CSV: 날짜,출처,금액,계정(이름 또는 blogId),글URL(선택),메모(선택)
 * 출처: 애드포스트 | 쇼핑커넥트 | 쿠팡 | 애드센스 | 기타
 */
export async function importRevenue(csv: string) {
  const rows = parseCsv(csv).filter((r) => !/날짜|date/i.test(r[0]));
  let ok = 0;
  const errors: string[] = [];
  for (const r of rows) {
    try {
      const [d, src, amount, acc, url, note] = r;
      const source = SOURCE_ALIASES[src?.toLowerCase()] ?? SOURCE_ALIASES[src] ?? "OTHER";
      const account = await findAccount(acc);
      const post = url ? await findPost(url) : null;
      await db.revenue.create({
        data: { date: parseDate(d), source, amount: num(amount), accountId: account?.id ?? post?.accountId ?? null, postId: post?.id ?? null, note: note ?? "" },
      });
      ok++;
    } catch (e) {
      errors.push((e as Error).message);
    }
  }
  return { ok, errors: errors.slice(0, 20) };
}
