# 유튜브 연결

1. Google Cloud에서 프로젝트를 선택하고 **YouTube Data API v3**를 사용 설정합니다.
2. **Google Auth Platform → 시작하기**에서 앱 이름 ‘풀이로그’, 지원 이메일, 연락처 이메일을 설정합니다. 개인 Google 계정은 대상 ‘외부’를 선택합니다.
3. **대상 → 테스트 사용자**에 수업 영상을 올리는 Google 계정을 추가합니다.
4. **클라이언트 → 클라이언트 만들기 → 웹 애플리케이션**을 선택합니다.
5. 승인된 리디렉션 URI에 정확히 다음 주소를 추가합니다.

   `https://pulilog.onrender.com/api/youtube/callback`

6. 생성한 클라이언트 ID와 보안 비밀번호를 Render의 **pulilog 서비스 → Environment**에 저장합니다.

   - `GOOGLE_CLIENT_ID`: 생성된 클라이언트 ID
   - `GOOGLE_CLIENT_SECRET`: 생성된 클라이언트 보안 비밀번호

   보안 비밀번호는 채팅이나 GitHub에 올리지 않습니다. Render 저장 후 재배포를 기다립니다.
7. 풀이로그 **연동 설정 → Google 계정 연결**을 누르고 수업 영상을 올리는 계정·채널을 선택한 뒤 영상 읽기 권한을 승인합니다.
8. 연결된 채널 이름이 맞는지 확인하고 가져올 연도(기본 2026년)를 확인하고 **선택 연도 영상 가져오기**를 누릅니다. 강의 관리에서 반·교재·과목·단원을 확인하고 학생에게 표시할 영상을 공개합니다.

## 현재 동작

- 읽기 전용 OAuth 권한 `youtube.readonly`만 요청합니다.
- 연결된 채널의 업로드 목록을 페이지별로 조회한 뒤 선택 연도의 영상만 저장합니다. 기본 연도는 2026년이며 유튜브 게시일(snippet.publishedAt)을 한국시간으로 계산합니다. 제목 속 연도·촬영일 기준이 아닙니다. 날짜를 확인할 수 없는 영상은 건너뜁니다. 공개·일부 공개이며 외부 재생이 가능한 영상만 가져옵니다. 비공개 영상은 학생에게 가져오지 않습니다.
- 제목 첫머리가 기존 반 이름과 일치하면 배정합니다. 공백은 무시하고 긴 반 이름을 우선하며, 일치하지 않으면 반·교재·과목·단원을 미분류 상태로 둡니다. 반은 일치하나 제목 형식이 다르면 확인 가능한 반만 배정하고 나머지는 비워둡니다. 강의 관리의 ‘분류 확인’에서 수정할 수 있습니다. 새 반을 임의로 만들지 않습니다.
- 가져온 영상은 기본적으로 학생 숨김 상태입니다. 기존 영상은 중복 등록하거나 기존 타임라인·메모·공개 설정을 덮어쓰지 않습니다.
- 연결 토큰은 SESSION_SECRET에서 파생한 키로 암호화하여 서버 전용 설정에 보관합니다. 브라우저에는 토큰·클라이언트 보안 비밀번호가 전달되지 않습니다. SESSION_SECRET을 바꾸면 Google 연결을 다시 해야 합니다.
- 연결 해제 시 Google 토큰 취소를 요청하고 사이트의 연결 정보를 제거합니다. 이미 등록한 강의는 유지됩니다.
- 현재 가져오기는 버튼으로 실행합니다. 일정 주기 자동 수집과 AI 영상 분석은 아직 구현하지 않았습니다. 한 번에 최대 5,000개 업로드 항목까지 조회하며, 더 많으면 저장 전에 안내합니다.
- Google의 외부 앱 ‘테스트’ 상태에서는 YouTube 권한의 갱신 토큰이 일반적으로 7일 후 만료됩니다. 장기 운영 전 앱 게시 상태 및 Google 검증 요건을 확인해야 합니다.

## 공식 문서

- [Google 서버용 OAuth](https://developers.google.com/youtube/data/guides/auth/server-side-web-apps)
- [채널 조회](https://developers.google.com/youtube/data/reference/rest/v3/channels/list)
- [업로드 목록 조회](https://developers.google.com/youtube/data/reference/rest/v3/playlistItems/list)
- [OAuth 토큰 만료](https://developers.google.com/identity/protocols/oauth2#expiration)
