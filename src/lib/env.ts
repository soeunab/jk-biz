/** 환경변수 접근 헬퍼. 값이 비어 있으면 undefined 로 취급합니다. */
function read(name: string): string | undefined {
  const v = process.env[name];
  return v && v.trim() !== "" ? v.trim() : undefined;
}

export const env = {
  get dashboardPassword() { return read("DASHBOARD_PASSWORD"); },
  get appSecret() { return read("APP_SECRET") ?? "dev-insecure-secret-change-me-please-32chars"; },
  get publicBaseUrl() { return (read("PUBLIC_BASE_URL") ?? "http://localhost:3000").replace(/\/$/, ""); },

  get llmProvider() { return read("LLM_PROVIDER"); },
  get anthropicKey() { return read("ANTHROPIC_API_KEY"); },
  get anthropicModel() { return read("ANTHROPIC_MODEL") ?? "claude-opus-5"; },
  get geminiKey() { return read("GEMINI_API_KEY"); },
  get geminiTextModel() { return read("GEMINI_TEXT_MODEL") ?? "gemini-2.5-pro"; },
  get geminiImageModel() { return read("GEMINI_IMAGE_MODEL") ?? "gemini-2.5-flash-image"; },

  get unsplashKey() { return read("UNSPLASH_ACCESS_KEY"); },
  get pexelsKey() { return read("PEXELS_API_KEY"); },
  get imageHost() { return read("IMAGE_HOST") ?? "local"; },
  get cloudinary() {
    const cloud = read("CLOUDINARY_CLOUD_NAME"), key = read("CLOUDINARY_API_KEY"), secret = read("CLOUDINARY_API_SECRET");
    return cloud && key && secret ? { cloud, key, secret } : undefined;
  },

  get naverOpenApi() {
    const id = read("NAVER_CLIENT_ID"), secret = read("NAVER_CLIENT_SECRET");
    return id && secret ? { id, secret } : undefined;
  },
  get naverSearchAd() {
    const key = read("NAVER_AD_API_KEY"), secret = read("NAVER_AD_SECRET_KEY"), customer = read("NAVER_AD_CUSTOMER_ID");
    return key && secret && customer ? { key, secret, customer } : undefined;
  },
  get naverHeadful() { return read("NAVER_HEADFUL") === "1"; },

  get google() {
    const id = read("GOOGLE_CLIENT_ID"), secret = read("GOOGLE_CLIENT_SECRET");
    return id && secret ? { id, secret } : undefined;
  },
  get metaGraphVersion() { return read("META_GRAPH_VERSION") ?? "v21.0"; },

  cron(name: "CRON_TOPIC_DISCOVERY" | "CRON_ANALYTICS_SYNC" | "CRON_INSIGHTS") { return read(name); },
};

/** 대시보드 설정 화면에서 보여줄 연동 상태 */
export function integrationStatus() {
  return [
    { key: "llm", label: "글쓰기 AI (Claude / Gemini)", ok: !!(env.anthropicKey || env.geminiKey), hint: "ANTHROPIC_API_KEY 또는 GEMINI_API_KEY" },
    { key: "imagegen", label: "AI 이미지 생성 (Gemini)", ok: !!env.geminiKey, hint: "GEMINI_API_KEY" },
    { key: "stock", label: "스톡 이미지 검색 (Unsplash / Pexels)", ok: !!(env.unsplashKey || env.pexelsKey), hint: "UNSPLASH_ACCESS_KEY / PEXELS_API_KEY" },
    { key: "naverOpen", label: "네이버 검색·데이터랩 API", ok: !!env.naverOpenApi, hint: "NAVER_CLIENT_ID / NAVER_CLIENT_SECRET" },
    { key: "naverAd", label: "네이버 검색광고 API (검색량)", ok: !!env.naverSearchAd, hint: "NAVER_AD_API_KEY / NAVER_AD_SECRET_KEY / NAVER_AD_CUSTOMER_ID" },
    { key: "google", label: "구글 OAuth (블로거·GA4·서치콘솔·애드센스)", ok: !!env.google, hint: "GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET" },
    { key: "imageHost", label: "이미지 외부 호스팅", ok: env.imageHost === "local" ? !env.publicBaseUrl.includes("localhost") : !!env.cloudinary, hint: "PUBLIC_BASE_URL(외부 접속 가능 주소) 또는 CLOUDINARY_*" },
  ];
}
