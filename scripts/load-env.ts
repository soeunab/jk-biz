// Next.js 밖(워커·스크립트)에서도 .env 를 읽도록
import { existsSync } from "node:fs";
for (const f of [".env.local", ".env"]) {
  if (existsSync(f)) process.loadEnvFile(f);
}
