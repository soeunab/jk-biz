/**
 * jk-biz MCP 서버 — MCP SDK 클라이언트로 실제로 띄워 도구 목록·읽기 전용 조회·오류 안내를 확인합니다.
 * 로컬 DB(npm run setup)가 있을 때만 실행됩니다.
 */
import { existsSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const ready = existsSync(".env") && existsSync("prisma/dev.db");
const text = (r: unknown) => (r as { content: { text: string }[] }).content[0].text;

describe.skipIf(!ready)("jk-biz MCP 서버", () => {
  let client: Client;
  beforeAll(async () => {
    client = new Client({ name: "test", version: "1" });
    await client.connect(new StdioClientTransport({ command: "npx", args: ["tsx", "scripts/mcp-server.ts"], stderr: "pipe" }));
  }, 60_000);
  afterAll(() => client?.close());

  it("읽기 전용 도구만 노출", async () => {
    const names = (await client.listTools()).tools.map((t) => t.name).sort();
    expect(names).toEqual(["adsense_report", "db_summary", "ga4_report", "gsc_query", "list_manual_tasks", "list_posts", "naver_selector_check", "post_detail", "recent_jobs"]);
    expect(names.some((n) => /publish|delete|update|approve|write/.test(n))).toBe(false);
  });

  it("db_summary 는 인증정보를 내보내지 않음", async () => {
    const r = await client.callTool({ name: "db_summary", arguments: {} });
    const s = JSON.parse(text(r));
    expect(s).toHaveProperty("posts");
    expect(s).toHaveProperty("manualPending");
    expect(text(r)).not.toMatch(/credentials|refresh_token|access_token/);
  });

  it("list_posts → post_detail", async () => {
    const posts = JSON.parse(text(await client.callTool({ name: "list_posts", arguments: { limit: 2 } })));
    if (!posts.length) return;
    const d = JSON.parse(text(await client.callTool({ name: "post_detail", arguments: { id: posts[0].id } })));
    expect(d.id).toBe(posts[0].id);
    expect(Array.isArray(d.readinessIssues)).toBe(true);
  });

  it("없는 계정·잘못된 플랫폼은 한국어 오류", async () => {
    const r = await client.callTool({ name: "gsc_query", arguments: { account: "존재하지않는계정" } });
    expect(r.isError).toBe(true);
    expect(text(r)).toContain("찾지 못했어요");
  });
});
