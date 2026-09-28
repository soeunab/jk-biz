import { discoverTopics, type DiscoverOptions } from "../topics/discover";
import { discoverFromChannels, type ChannelDiscoverOptions } from "../topics/channels/discover";
import { runGeneratePost } from "../content/service";
import { buildPostImages } from "../images/pipeline";
import { rerenderPost, readManuscript } from "../content/service";
import { runGenerateCardNews } from "../cardnews";
import { publishPrivate, publishPublic, publishSocial } from "../publishers";
import { syncAnalytics } from "../analytics/sync";
import { generateInsights } from "../insights/engine";
import { db } from "../db";
import { runAiReview } from "../content/review";
import { rewriteSection } from "../content/section";
import type { JobContext, JobType } from "./queue";

type Handler = (payload: Record<string, unknown>, ctx: JobContext) => Promise<unknown>;

export const handlers: Record<JobType, Handler> = {
  "topic.discover": (p, ctx) => discoverTopics(p as DiscoverOptions, ctx),
  "topic.channels": (p, ctx) => discoverFromChannels(p as ChannelDiscoverOptions, ctx),
  "post.generate": (p, ctx) => runGeneratePost(String(p.postId), ctx),
  "post.images": async (p, ctx) => {
    const post = await db.post.findUniqueOrThrow({ where: { id: String(p.postId) } });
    const m = readManuscript(post.content);
    if (!m) throw new Error("원고가 없습니다.");
    await buildPostImages(post.id, m, post.platform as "NAVER" | "BLOGGER", (msg) => ctx.log(msg));
    return rerenderPost(post.id).then((r) => ({ seoScore: r.score }));
  },
  "post.aiReview": (p, ctx) => runAiReview(String(p.postId), ctx),
  "post.rewriteSection": (p, ctx) => rewriteSection(String(p.postId), Number(p.index), String(p.instruction ?? ""), ctx),
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
