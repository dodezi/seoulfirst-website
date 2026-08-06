# 서울퍼스트내과의원 홈페이지

# 🚨🚨🚨 최우선 경고 — 실제 운영 사이트는 이 저장소가 아니다 🚨🚨🚨

- **실제 라이브 사이트 = Firebase Hosting** → https://seoulfirst-ba9d4.web.app
  - `www.seoulfirst.co.kr` 는 여기(Firebase)를 가리킨다. (가비아 DNS: `www` CNAME → `seoulfirst-ba9d4.web.app`)
  - 라이브 관리시스템도 여기: https://seoulfirst-ba9d4.web.app/admin ("의료관리시스템" SPA)
- **⚠️ 이 GitHub 저장소(dodezi/seoulfirst-website)는 몇 주 전의 옛 복사본이다. 라이브가 아니다.**
  - 이 저장소의 파일 날짜/`git push`가 최신처럼 보여도 **실제 방문자가 보는 화면과 다르다.**
- **🚫 절대 금지 (2026-08-06 이걸로 대형 사고남):**
  - 이 저장소를 최신으로 착각하고 `www` DNS를 `dodezi.github.io`(GitHub Pages)로 돌리지 말 것.
    → 홈페이지·관리시스템이 전부 옛 버전으로 바뀌는 사고 발생.
  - `www` CNAME 값은 반드시 **`seoulfirst-ba9d4.web.app`** 로 유지.
- **홈페이지/관리시스템을 실제로 수정하려면 Firebase 쪽 소스에서 작업해야 한다.**
  - (❓확인 필요: Firebase 배포 소스 폴더/방법. `Documents/clinic-portal` 가능성. 수정·배포 전 반드시 확인.)
- 어느 버전이 진짜인지 헷갈리면 **`https://seoulfirst-ba9d4.web.app` 를 직접 열어** 눈으로 확인할 것. 그게 라이브다.

---

## 프로젝트 정보 (이 저장소 = 옛 복사본)

- **이 GitHub 저장소**: https://github.com/dodezi/seoulfirst-website  ← 옛 복사본(라이브 아님)
- **노트북 파일 경로**: `C:\Users\dodez\Downloads\seoulfirst_multipage\`

> ⚠️ (옛 메모, 지금은 틀림) "호스팅=GitHub Pages"는 **더 이상 사실이 아니다.**
> 실제 라이브는 위 경고대로 **Firebase Hosting**이다.
> 브라우저에 옛 화면이 남으면: 시크릿 창(Ctrl+Shift+N) 또는 F12→Application→Storage→Clear site data.

## 기술 스택

- 순수 HTML/CSS/JavaScript (프레임워크 없음)
- `multipage.css` — 전체 공통 스타일
- `multipage.js` — 공통 스크립트 (햄버거 메뉴, 스크롤 등)
- `health-posts.json` — 건강소식 글 데이터

---

# 🔴 가장 중요한 규칙 (노트북·병원 PC 공통)

## 1. 작업 시작 전 — 반드시 `git pull` 먼저

```bash
git pull
```

다른 PC(노트북 또는 병원)에서 수정한 최신 내용을 먼저 받아야 합니다.
**이 단계를 건너뛰면 상대방 작업을 덮어쓸 수 있습니다.**

## 2. 작업 후 — `git push`

```bash
git add .
git commit -m "홈페이지 수정"
git push
```

GitHub Pages가 1~2분 내 자동 배포합니다.

## 3. 절대 금지 — `git push --force` (강제 푸시)

**`--force` / `-f` 푸시는 어떤 경우에도 사용하지 마세요.**
지난번 병원 PC가 강제 푸시를 해서 노트북 작업이 통째로 사라지고
배포가 멈추는 사고가 있었습니다.

- `git pull`이 충돌(conflict)로 막히면, 강제로 밀어붙이지 말고
  **무엇이 충돌했는지 사용자에게 먼저 보고**한 뒤 함께 해결하세요.
- 정상 흐름(pull → 수정 → push)만 지키면 충돌은 거의 생기지 않습니다.

## 4. 병원 PC는 반드시 `git clone` 폴더에서 작업

병원 PC에서 작업할 폴더는 **구글 드라이브 동기화 폴더가 아니라
`git clone`으로 받은 폴더**여야 합니다.
(구글 드라이브 + git을 섞으면 히스토리가 꼬여 강제 푸시 사고로 이어집니다.)

---

## 병원 PC 최초 설정 (한 번만)

1. https://git-scm.com 에서 git 설치
2. 명령 프롬프트(CMD)에서:

```bash
git config --global user.name "dodezi"
git config --global user.email "GitHub 이메일"
cd %USERPROFILE%\Documents
git clone https://github.com/dodezi/seoulfirst-website.git
```

3. GitHub 토큰 파일 생성: `C:\Users\(현재사용자)\github-token.txt`
   안에 토큰 한 줄만 저장 (이 파일은 .gitignore로 git에 안 올라감)
4. 이후 작업은 `Documents\seoulfirst-website` 폴더 안에서 진행

---

## 건강소식 자동 발행 (`/publish-health-post` 스킬)

- 이 스킬은 **GitHub API로 `health-posts.json`만 안전하게 추가**합니다.
- git 명령·다른 파일 수정이 전혀 없어, **병원 PC에 git이 없어도 동작**하고
  다른 작업을 덮어쓸 위험이 없습니다.
- 토큰은 현재 사용자 홈 폴더의 `github-token.txt`에서 자동으로 읽습니다.
  (PC·사용자명 무관)
