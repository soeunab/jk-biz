/**
 * 네이버 애드포스트 통합 정산 배분.
 * 네이버 2·3번째 계정을 1번 계정 애드포스트의 "미디어"로 묶으면 광고 수익이 하나로 합산 정산됩니다.
 * 이때 각 계정을 독립 수익원으로 보면 RPM 이 왜곡되므로, 그룹 수익을 기간 내 계정별 조회수 비중으로 나눕니다.
 */
export type AdpostRow = {
  accountId: string;
  name: string;
  /** 정산(대표) 계정 ID — 없으면 자기 자신이 정산 계정 */
  masterId?: string | null;
  pageviews: number;
  /** 이 계정 이름으로 입력된 애드포스트 수익 (그룹 어디에 입력돼 있어도 합산됨) */
  adpostRevenue: number;
};

export type AdpostAllocation = {
  groupId: string;
  groupName: string;
  groupSize: number;
  groupRevenue: number;
  /** 이 계정 몫 (배분 결과) */
  allocated: number;
  /** 조회수 비중 0~1 */
  share: number;
  note?: string;
};

/** 정산 계정 체인을 따라가 최종 그룹 ID 를 찾음 (잘못된 순환 설정은 자기 자신으로 처리) */
function resolveGroup(id: string, masters: Map<string, string | null | undefined>): string {
  let cur = id;
  for (let i = 0; i < 5; i++) {
    const next = masters.get(cur);
    if (!next || next === cur || !masters.has(next)) return cur;
    cur = next;
  }
  return id;
}

export function allocateAdpost(rows: AdpostRow[]): Map<string, AdpostAllocation> {
  const masters = new Map(rows.map((r) => [r.accountId, r.masterId]));
  const names = new Map(rows.map((r) => [r.accountId, r.name]));
  const groups = new Map<string, AdpostRow[]>();
  for (const r of rows) {
    const g = resolveGroup(r.accountId, masters);
    groups.set(g, [...(groups.get(g) ?? []), r]);
  }
  const out = new Map<string, AdpostAllocation>();
  for (const [groupId, members] of groups) {
    const revenue = members.reduce((s, m) => s + m.adpostRevenue, 0);
    const pv = members.reduce((s, m) => s + m.pageviews, 0);
    for (const m of members) {
      const base = { groupId, groupName: names.get(groupId) ?? groupId, groupSize: members.length, groupRevenue: revenue };
      if (pv > 0) {
        const share = m.pageviews / pv;
        out.set(m.accountId, { ...base, share, allocated: revenue * share });
      } else {
        // 조회수 데이터가 없으면 나눌 근거가 없음 → 정산 계정에 그대로 둠
        const isMaster = m.accountId === groupId;
        out.set(m.accountId, {
          ...base,
          share: isMaster ? 1 : 0,
          allocated: isMaster ? revenue : 0,
          note: members.length > 1 && revenue > 0 ? "조회수 데이터가 없어 배분하지 못하고 정산 계정에 표시" : undefined,
        });
      }
    }
  }
  return out;
}
