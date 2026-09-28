import Link from "next/link";
import { PageHeader } from "@/components/ui";

export const dynamic = "force-static";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="card">
      <h2 className="mb-3 text-lg font-bold">{title}</h2>
      <div className="space-y-2 text-sm leading-relaxed text-gray-700">{children}</div>
    </section>
  );
}

/** 운영자용 사용 가이드 — 기능을 추가하면 이 페이지도 함께 고칩니다. */
export default function GuidePage() {
  return (
    <div className="flex flex-col gap-5">
      <PageHeader title="사용 가이드" desc="처음 쓰시는 분을 위한 운영 안내. 기능이 바뀌면 이 페이지도 같이 업데이트됩니다." />

      <Section title="1. 하루 운영 순서">
        <ol className="list-decimal space-y-1 pl-5">
          <li><Link className="text-indigo-600" href="/">대시보드</Link>에서 검수 대기 원고를 확인합니다.</li>
          <li>원고 화면의 <b>승인 전 확인할 사항</b>(노란 상자)과 <b>SEO·AEO·GEO 점검</b>의 ⚠️ 항목을 봅니다.</li>
          <li><b>AI 사실 검수</b>를 눌러 사실 오류·오탈자 제안을 받고, 맞는 것만 골라 적용합니다.</li>
          <li><b>원고 편집</b> 탭에서 노란색 <mark>✍️ [경험 추가: …]</mark> 자리를 실제 경험으로 채웁니다. 마음에 안 드는 섹션은 <b>🤖 다시 쓰기</b>로 그 섹션만 새로 씁니다.</li>
          <li><b>이미지</b> 탭에서 AI 도구 화면을 직접 캡처한 이미지로 바꾸면 신뢰도가 크게 올라갑니다.</li>
          <li>비공개 발행 → <b>승인</b> → 공개 발행. 문제가 크면 <b>반려</b>하고 사유를 남깁니다.</li>
        </ol>
      </Section>

      <Section title="2. 주제 발굴 점수 읽는 법">
        <p><b>우선순위 점수는 &quot;무엇부터 쓸지&quot; 정하는 내부 정렬 지표</b>이며 수익·방문자 예측이 아닙니다.</p>
        <ul className="list-disc space-y-1 pl-5">
          <li><span className="badge bg-emerald-50 text-emerald-700">공식데이터 확인</span> 네이버 검색광고·데이터랩으로 실제 검색 수요를 확인한 키워드</li>
          <li><span className="badge bg-sky-50 text-sky-700">자동완성 확인</span> 자동완성에 실제로 뜨는 키워드 (검색량은 모름)</li>
          <li><span className="badge bg-gray-100 text-gray-500">미검증</span> 실제로 검색되는지 확인하지 못한 키워드 — 기본 목록에서 숨깁니다</li>
          <li><b>미확인</b>으로 표시된 지표는 데이터가 없어 점수 계산에서 빠진 것입니다. 숫자를 지어내지 않습니다.</li>
          <li><b>확인 n/3</b>은 검색량·경쟁·트렌드 중 실제 데이터로 확인된 지표 수입니다.</li>
        </ul>
        <p>정확한 검색량을 보려면 <Link className="text-indigo-600" href="/settings">설정</Link>에서 네이버 검색광고 API 연동 여부를 확인하고, 주제 발굴 화면의 <b>연관 키워드 확장</b>을 사용하세요.</p>
      </Section>

      <Section title="3. AI가 하지 않는 것 (의도된 설계)">
        <ul className="list-disc space-y-1 pl-5">
          <li><b>경험을 지어내지 않습니다.</b> &quot;직접 해보니 3분 걸렸어요&quot; 같은 문장 대신 [경험 추가] 자리만 남깁니다. 비워 둔 자리는 발행본에서 자동으로 빠집니다.</li>
          <li><b>확인되지 않은 요금제명·모델명·수치를 만들지 않습니다.</b> 모르는 내용은 검수 체크리스트에 &quot;확인 필요&quot;로 남깁니다.</li>
          <li><b>사람 승인 없이 공개 발행하지 않습니다.</b> 모든 상태 변경은 버튼을 눌러야만 일어납니다.</li>
          <li><b>자동 점검은 판단을 돕기만 합니다.</b> 확인 사유가 있어도 검수자가 확인 후 승인할 수 있습니다.</li>
        </ul>
      </Section>

      <Section title="4. 고위험 주제 (세금·지원금·청약·금융·법률·건강)">
        <p>제목·소제목에 이런 주제가 감지되면 공식 출처가 필수가 되고, &quot;무조건 받는다&quot; 같은 예측·보장 표현을 점검하며, 글 상단에 고지 문구가 자동으로 붙습니다. 금액·요건·기한은 반드시 공식 공고로 다시 확인하세요.</p>
      </Section>

      <Section title="5. 여러 계정 운영">
        <ul className="list-disc space-y-1 pl-5">
          <li>같은 계정에 같은 키워드 원고는 두 번 만들어지지 않습니다 (표기만 다른 &quot;제미나이 사용법&quot;/&quot;제미나이사용법&quot;도 같은 키워드로 봅니다).</li>
          <li>유사문서 경고는 <b>같은 플랫폼 안에서만</b> 비교합니다. 블로거·네이버용으로 각각 다시 쓴 원고는 정상입니다.</li>
          <li>계정마다 콘셉트를 다르게 적어 두면 같은 주제도 다른 관점으로 작성됩니다.</li>
        </ul>
      </Section>

      <Section title="6. 점검 항목의 &quot;참고&quot; 그룹">
        <p>분량·이미지 수·해시태그 수·표는 플랫폼이 공식적으로 정한 규칙이 아니라 독자 관점의 참고치입니다. 점수 영향이 작으며, 기준보다 짧아도 독자가 충분히 따라 할 수 있다면 괜찮습니다.</p>
      </Section>

      <Section title="7. 수익 · 분석">
        <ul className="list-disc space-y-1 pl-5">
          <li>구글: 계정 관리에서 구글을 연결하고 GA4·서치콘솔 정보를 넣으면 매일 자동 동기화됩니다.</li>
          <li>네이버: 애드포스트·쇼핑커넥트·조회수는 공개 API가 없어 <Link className="text-indigo-600" href="/analytics">분석</Link> 화면에서 CSV 또는 직접 입력합니다.</li>
          <li>제휴 링크가 있는 글에는 대가성 문구가 자동으로 붙으며, 설정에서 이 문구를 비울 수 없습니다.</li>
        </ul>
      </Section>
    </div>
  );
}
