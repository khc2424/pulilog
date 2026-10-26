# 풀이로그

학원 선생님의 반·학생·영상 관리와 학생 영상 강의실. 숙제 기능은 포함하지 않습니다.

## 현재 완성한 기능

- 선생님 코드 로그인, 등록된 학생 전화번호 로그인과 30일 기억하기.
- 반 등록·수업 요일 설정(월~일 버튼 복수 선택), 반별 접고 펼치는 학생 목록, 학생 추가·반 이동·이용 중지.
- 강의 등록·수정·여러 반 배정·학생 표시 여부 설정.
- 학생의 현재 반 영상만 조회, 제목·교재·과목·단원 검색, 개인 즐겨찾기.
- 원본 영상 팝업과 문제별 타임라인. 타임라인 임시 저장과 학생 반영 분리.
- 선생님 전용 특이사항·보충 필요 기록.
- 로컬 SQLite 및 Supabase 저장 연결, 배포 설정과 GitHub 자동 검사.

유튜브 자동 가져오기는 연결되어 있습니다. 자막 기반 Claude 타임라인 초안 생성은 ANTHROPIC_API_KEY 설정 후 사용할 수 있습니다. 수업 스타일·속도 분석, PDF 등록·분석, 커리큘럼 자동 생성은 다음 개발 단계입니다. 해당 기능이 연결된 것처럼 샘플 결과를 표시하지 않습니다. 운영 버전은 가상 학생·강의를 자동 생성하지 않습니다.

## 로컬 실행

Node.js 24에서 실행합니다. 외부 라이브러리를 설치할 필요가 없습니다.

```sh
npm start
```

- 선생님: http://127.0.0.1:8766/#overview
- 학생: http://127.0.0.1:8766/#student
- 로컬 접속 코드: `2424`. 운영에서도 사용자 요청에 따라 4자 이상 코드를 허용합니다. 운영 코드는 환경 변수 `ADMIN_CODE`에 직접 설정하며, 소스에는 저장하지 않습니다.
- 먼저 반을 등록하고, 해당 반 학생과 영상 링크를 추가합니다. 처음에는 비어 있습니다.
- `.private/`의 로컬 데이터는 Git에서 제외되며 외부로 제공하지 않습니다. 기존 `clinic-demo` 데이터와 분리되어 있습니다.

## GitHub와 Supabase 연결

1. GitHub에 **빈 비공개 저장소**를 만듭니다. 이 폴더 전체를 저장소 루트로 사용합니다. `.private/`, `.env`, 기존 데모 폴더는 올리지 않습니다.
2. Supabase에 풀이로그 전용 프로젝트를 만듭니다. 프로젝트 비밀번호는 따로 보관합니다.
3. 해당 프로젝트 SQL Editor에서 `supabase/migrations/001_initial.sql`을 실행합니다. 기존 다른 프로젝트에 실행하지 않습니다.
4. Render 등 Node 서버 호스팅에 GitHub 저장소를 연결합니다. Render Blueprint용 `render.yaml`을 포함했습니다.
5. 호스팅의 환경 변수 설정에 아래 값을 입력합니다. 비밀 키를 채팅이나 GitHub 파일에 넣지 않습니다.

| 항목 | 값 |
|---|---|
| `NODE_ENV` | `production` |
| `DATABASE_DRIVER` | `supabase` |
| `APP_ORIGIN` | Render에서는 입력 불필요. 자동 제공 주소 사용. 커스텀 도메인 적용 시 HTTPS 주소를 경로 없이 입력 |
| `SUPABASE_URL` | Supabase 프로젝트 URL |
| `SUPABASE_SECRET_KEY` | 해당 프로젝트 서버 전용 secret key (`sb_secret_...`) |
| `ADMIN_CODE` | 운영용 선생님 접속 코드, 4자 이상. 긴 코드를 권장 |
| `SESSION_SECRET` | 32자 이상 무작위 값. Render Blueprint에서는 자동 생성 |
| `TRUST_PROXY` | Render의 프록시 뒤에서 실행할 때 `true` |

6. Build: `npm ci && npm run check && npm test`, Start: `npm start`, Health: `/healthz`.
7. 배포 후 반 등록 → 학생 등록 → 강의 등록 → 다른 반 학생의 접근 제한을 실제로 확인합니다.

외부 계정과 데이터베이스 연결 전까지 로컬 개발·검증 상태입니다. Supabase SQL과 원격 저장 경로는 프로젝트 연결 후 실제 데이터베이스에서 추가 검증해야 합니다. GitHub 저장소와 Render 서비스는 아직 생성·연결하지 않았습니다.

### 기존 데이터베이스의 수업 요일 확장

이미 초기 SQL을 실행한 프로젝트는 `supabase/migrations/003_flexible_weekdays.sql`을 SQL Editor에서 한 번 실행합니다. 002를 건너뛰어도 됩니다. 기존 반과 학생은 유지하면서 월~일의 임의 조합 저장을 허용합니다. 기존 MWF·TTS·MW·TT 값은 자동으로 해당 요일 선택 상태로 표시합니다. 새 프로젝트는 최신 `supabase/setup.sql`만 실행하면 됩니다.

## 접근 구조

브라우저는 이 사이트의 서버에만 요청합니다. 서버가 학생 세션과 현재 반을 확인한 뒤 Supabase에 요청합니다. Supabase 비밀 키는 서버 환경 변수에만 있으며, public 폴더나 응답에 포함하지 않습니다. 모든 데이터 테이블은 RLS를 켜고 브라우저 역할(`anon`, `authenticated`)에 직접 조회·쓰기를 허용하지 않습니다. RPC도 서버 역할에만 허용합니다.

로그인은 사용자가 요청한 전화번호 조회 방식입니다. 문자 본인 인증이 아니므로 등록된 다른 학생의 번호를 아는 사람이 해당 학생으로 접속할 수 있습니다. 유튜브 일부 공개 링크의 전달을 막는 구조는 아닙니다.

가져오기·반 배정·타임라인 검토는 서로 다른 기능으로 관리합니다. 학생에게는 교사 메모나 검토 중인 타임라인을 전달하지 않습니다. 개인정보, 토큰, 비밀 키를 요청 로그에 남기지 않습니다.

## 검사

```sh
npm run check
npm test
```

테스트는 격리된 임시 저장소에서 실행하며 실제 학생 데이터나 데모 데이터에 쓰지 않습니다. 원격 Supabase 호출 형식은 대체 응답으로 검사하며, 실제 클라우드 연결 성공을 뜻하지 않습니다.


## 자막 기반 AI 타임라인 초안

- Render Environment에 `ANTHROPIC_API_KEY`를 저장합니다. 기본 모델은 `claude-haiku-5-5`이며 `ANTHROPIC_MODEL`로 변경할 수 있습니다. 채팅 구독과 별도 API 이용입니다. 키를 GitHub·브라우저·채팅에 넣지 않습니다.
- 강의 관리 → 영상 상세 → 타임라인 편집 → AI 초안 생성에서 한 영상만 분석합니다. 자동 가져오기 예약은 AI를 호출하지 않습니다.
- SRT/VTT 파일(240KB 이하)을 넣거나, Google 자막 권한을 별도로 승인한 계정에서 유튜브 자막을 가져옵니다. 기존 youtube.readonly 연결만으로는 captions.list/download를 사용할 수 없습니다.
- 자막 연결 선택 시에만 Google `youtube.force-ssl` 권한을 요청합니다. 이 범위는 관리·삭제 권한도 포함하므로 연결 안내에서 범위를 명확히 설명합니다. 풀이로그는 captions.list/download만 호출하며 업로드·수정·삭제 API를 호출하지 않습니다. 자막 트랙이 없거나 다운로드가 허용되지 않으면 Studio의 SRT/VTT 파일을 사용합니다.
- 자막의 번호·주제·시작 구간을 Claude Messages API의 구조화된 출력으로 추출합니다. 서버가 실제 자막 cue와 원문 근거를 검증하며 시간은 모델이 만든 숫자가 아니라 해당 cue 시작 시각을 사용합니다.
- 결과는 timeline_draft에만 저장하고 기존 공개 타임라인·메모·반·숨김 상태를 보존합니다. 모르는 문제 번호는 `번호 확인 필요`로 남기며 그 상태로 학생 반영은 차단합니다. 교재 쪽수는 추측하지 않습니다.
- 기존 초안 교체는 확인을 받고, 분석 중 타임라인 수정·영상 삭제가 발생하면 덮어쓰지 않습니다. API 오류·잘린 응답·잘못된 근거·빈 결과는 초안을 변경하지 않습니다.
- 현재는 자막 내용 분석이며 영상 화면·판서·교재 PDF·수업 스타일 분석은 아닙니다. 실제 강의 한 개로 품질·비용을 검증한 뒤 사용 범위를 넓힙니다.

공식 문서: [Claude Messages](https://platform.claude.com/docs/en/build-with-claude/working-with-messages), [구조화된 출력](https://platform.claude.com/docs/en/build-with-claude/structured-outputs), [YouTube 자막 다운로드](https://developers.google.com/youtube/data/reference/rest/v3/captions/download).
