import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Playwright, Prisma, googleapis 는 서버 번들에서 제외 (Node 런타임에서 직접 로드)
  serverExternalPackages: ["playwright", "@prisma/client", "googleapis"],
};

export default nextConfig;
