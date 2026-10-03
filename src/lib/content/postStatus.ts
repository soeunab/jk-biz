/**
 * 원고 상태별로 허용되는 작업 — API 와 화면이 같은 기준을 쓰도록 한곳에 모았습니다.
 * 원칙: 승인·공개된 글은 프로그램이 내용을 바꾸지 않습니다(사람이 [승인 취소] 후 수정하거나 블로그에서 직접 수정).
 */

/** AI 로 다시 쓰기(📎 내 자료로 다시 쓰기 포함)가 허용되는 상태 */
export const REGENERATE_ALLOWED = ["DRAFT", "PRIVATE", "FAILED", "REJECTED", "WAITING_MANUAL"] as const;

/** 원고 편집(직접 수정·섹션 다시 쓰기·AI 검수 적용·이미지 재생성)이 막히는 상태 */
export const EDIT_LOCKED = ["APPROVED", "PUBLISHED", "GENERATING"] as const;

/** 비공개 발행(블로거 초안 / 네이버 비공개)이 허용되는 상태 */
export const PUBLISH_PRIVATE_ALLOWED = ["DRAFT", "PRIVATE", "FAILED"] as const;

/** [직접 발행함으로 표시] 가 허용되는 상태 */
export const MARK_PUBLISHED_ALLOWED = ["PRIVATE", "APPROVED"] as const;

/** [직접 발행함으로 표시] 가능 여부 — 네이버 발행 확인 불가(DRAFT + 확인 필요 표시)도 허용 */
export function canMarkPublished(post: { status: string; remoteId: string | null }) {
  return (MARK_PUBLISHED_ALLOWED as readonly string[]).includes(post.status) || (post.status === "DRAFT" && post.remoteId === NAVER_UNCONFIRMED);
}

/** [네이버 연결 해제] 가 허용되는 상태 */
export const UNLINK_ALLOWED = ["DRAFT", "PRIVATE", "FAILED"] as const;

/**
 * 네이버 발행 버튼을 눌렀는데 글 주소(logNo)를 확인하지 못했을 때 remoteId 에 넣는 표시.
 * 실제로는 올라갔을 수 있으므로 다시 올리기를 막고(중복 글 방지), 사람이 네이버에서 확인한 뒤
 * [직접 발행함으로 표시] 또는 [네이버 연결 해제]로 정리합니다.
 */
export const NAVER_UNCONFIRMED = "unconfirmed";
export const NAVER_UNCONFIRMED_MSG =
  "발행됐을 수 있음 — 글 주소를 확인하지 못했어요. 네이버 '내 글'에서 확인 후, 올라갔으면 [직접 발행함으로 표시], 없으면 [네이버 연결 해제] 후 다시 올리세요.";

const has = (list: readonly string[], status: string) => list.includes(status);

export const canRegenerate = (status: string) => has(REGENERATE_ALLOWED, status);
export const isEditLocked = (status: string) => has(EDIT_LOCKED, status);

export const REGENERATE_BLOCKED_MSG = "공개(또는 승인)된 글은 프로그램에서 다시 쓸 수 없어요. 블로그 편집 화면에서 직접 수정하세요.";

/** 편집이 막혔을 때 보여 줄 문구 */
export function editLockedMessage(status: string) {
  if (status === "GENERATING") return "원고를 만드는 중이에요. 끝난 뒤에 수정하세요.";
  if (status === "PUBLISHED") return "공개된 글은 프로그램에서 수정하지 않아요. 블로그 편집 화면에서 직접 수정하세요.";
  return "승인된 글은 [승인 취소] 후 수정하세요(블로그에 이미 올라간 내용은 [비공개 저장 다시 하기]로 갱신).";
}

/** 캐노니컬·백링크·카드뉴스 캡션에 쓸 수 있는 공개 주소 — 공개(PUBLISHED)된 글의 주소만 */
export function publicUrlOf(post: { status: string; remoteUrl: string | null } | null | undefined): string | undefined {
  return post?.status === "PUBLISHED" && post.remoteUrl ? post.remoteUrl : undefined;
}

/** 긴 AI 작업이 도는 사이 사람이 원고를 저장했을 때 — 덮어쓰지 않고 이 문구로 실패 처리 */
export const STALE_EDIT_MSG = "작업 중 원고가 수정되어 결과를 적용하지 않았어요. 다시 실행하세요.";
