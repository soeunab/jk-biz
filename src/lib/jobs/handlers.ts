import { discoverTopics, type DiscoverOptions } from "../topics/discover";
import { runGeneratePost } from "../content/service";
import { buildPostImages } from "../images/pipeline";
import { rerenderPost, readManuscript } from "../content/service";
import { runGenerateCardNews } from "../cardnews";
import { publishPrivate, publishPublic, publishSocial } from "../publishers";
import { syncAnalytics } from "../analytics/sync";
import { generateInsights } from "../insights/engine";
import { db } from "../db";
import type { JobContext, JobType } from "./queue";

type Handler = (payload: Record<string, unknown>, ctx: JobContext) => Promise<unknown>;

export const handlers: Record<JobType, Handler> = {
  "topic.discover": (p, ctx) => discoverTopics(p as DiscoverOptions, ctx),
  "post.generate": (p, ctx) => runGeneratePost(String(p.postId), ctx),
  "post.images": async (p, ctx) => {
    const post = await db.post.findUniqueOrThrow({ where: { id: String(p.postId) } });
    const m = readManuscript(post.content);
    if (!m) throw new Error("원고가 없습니다.");
    await buildPostImages(post.id, m, post.platform as "NAVER" | "BLOGGER", (msg) => ctx.log(msg));
    return rerenderPost(post.id).then((r) => ({ seoScore: r.score }));
  },
  "post.publishPrivate": async (p, ctx) => {
    try {
      return await publishPrivate(String(p.postId), ctx);
    } catch (e) {
      await db.post.update({ where: { id: String(p.postId) }, data: { error: (e as Error).message } });
      throw e;
    }
  },
  "post.publishPublic": async (p, ctx) => {
    try {
      return await publishPublic(String(p.postId), ctx);
    } catch (e) {
      await db.post.update({ where: { id: String(p.postId) }, data: { error: (e as Error).message } });
      throw e;
    }
  },
  "cardnews.generate": (p, ctx) => runGenerateCardNews(String(p.cardNewsId), ctx),
  "cardnews.publish": (p, ctx) => publishSocial(String(p.socialPostId), ctx),
  "analytics.sync": (_p, ctx) => syncAnalytics(ctx),
  "insights.generate": (_p, ctx) => generateInsights(ctx),
};
