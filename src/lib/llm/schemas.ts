import type { z } from "zod";
import { ManuscriptSchema, SectionSchema } from "../content/types";
import { ReviewSchema } from "../content/review";
import { ChannelCategorySchema } from "../topics/channels/discover";
import { StorySchema } from "../topics/channels/keywords";
import { RelatedCheckSchema, TitleSchema } from "../topics/expand";
import { CardNewsSchema } from "../cardnews";
import { StrategySchema } from "../insights/engine";

/** 수동 모드에서 붙여 넣은 결과를 즉시 검증하기 위한 스키마 목록 (generateJson 의 name 과 일치) */
export const SCHEMAS: Record<string, z.ZodType> = {
  manuscript: ManuscriptSchema,
  section: SectionSchema,
  factReview: ReviewSchema,
  topicTitles: TitleSchema,
  channelCategories: ChannelCategorySchema,
  channelStories: StorySchema,
  relatedCheck: RelatedCheckSchema,
  cardnews: CardNewsSchema,
  strategy: StrategySchema,
};
