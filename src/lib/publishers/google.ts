import { createHmac } from "node:crypto";
import { google } from "googleapis";
import { db } from "../db";
import { decryptJson, encryptJson } from "../crypto";
import { env } from "../env";

export const GOOGLE_SCOPES = [
  "https://www.googleapis.com/auth/blogger",
  "https://www.googleapis.com/auth/analytics.readonly",
  "https://www.googleapis.com/auth/webmasters.readonly",
  "https://www.googleapis.com/auth/adsense.readonly",
  "openid",
  "email",
];

export type GoogleCreds = { refresh_token?: string | null; access_token?: string | null; expiry_date?: number | null; email?: string };

function redirectUri() {
  return `${env.publicBaseUrl}/api/oauth/google/callback`;
}

export function oauthClient() {
  const g = env.google;
  if (!g) throw new Error("GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET 이 설정되지 않았습니다.");
  return new google.auth.OAuth2(g.id, g.secret, redirectUri());
}

function sign(v: string) {
  return createHmac("sha256", env.appSecret).update(v).digest("hex").slice(0, 16);
}

/** 계정별 구글 연결 URL (블로거 계정마다 다른 구글 아이디 사용 가능) */
export function googleAuthUrl(accountId: string) {
  return oauthClient().generateAuthUrl({
    access_type: "offline",
    prompt: "consent select_account",
    scope: GOOGLE_SCOPES,
    state: `${accountId}.${sign(accountId)}`,
  });
}

export async function handleGoogleCallback(code: string, state: string) {
  const [accountId, sig] = state.split(".");
  if (!accountId || sig !== sign(accountId)) throw new Error("잘못된 OAuth state 입니다.");
  const client = oauthClient();
  const { tokens } = await client.getToken(code);
  client.setCredentials(tokens);
  let email: string | undefined;
  if (tokens.id_token) {
    const ticket = await client.verifyIdToken({ idToken: tokens.id_token, audience: env.google!.id });
    email = ticket.getPayload()?.email;
  }
  const account = await db.account.findUniqueOrThrow({ where: { id: accountId } });
  const prev = decryptJson<GoogleCreds>(account.credentials) ?? {};
  const creds: GoogleCreds = { ...prev, ...tokens, refresh_token: tokens.refresh_token ?? prev.refresh_token, email };

  // 블로그 ID 가 비어 있으면 첫 번째 블로그로 자동 설정
  let externalId = account.externalId;
  let url = account.url;
  if (!externalId) {
    const blogs = await google.blogger({ version: "v3", auth: client }).blogs.listByUser({ userId: "self" });
    const first = blogs.data.items?.[0];
    if (first?.id) [externalId, url] = [first.id, first.url ?? url];
  }
  await db.account.update({ where: { id: accountId }, data: { credentials: encryptJson(creds), externalId, url } });
  return accountId;
}

/** 저장된 토큰으로 인증된 클라이언트. 토큰이 갱신되면 DB 에도 반영합니다. */
export async function authedClient(accountId: string) {
  const account = await db.account.findUniqueOrThrow({ where: { id: accountId } });
  const creds = decryptJson<GoogleCreds>(account.credentials);
  if (!creds?.refresh_token) throw new Error(`"${account.name}" 계정의 구글 연결이 필요합니다. [계정 관리]에서 연결해 주세요.`);
  const client = oauthClient();
  client.setCredentials(creds);
  client.on("tokens", (t) => {
    db.account
      .update({ where: { id: accountId }, data: { credentials: encryptJson({ ...creds, ...t, refresh_token: t.refresh_token ?? creds.refresh_token }) } })
      .catch(() => undefined);
  });
  return client;
}
