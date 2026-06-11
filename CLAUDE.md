# 서울퍼스트내과의원 홈페이지

## 프로젝트 정보

- **GitHub**: https://github.com/dodezi/seoulfirst-website
- **라이브 사이트**: https://dreamy-granita-8790e2.netlify.app
- **노트북 파일 경로**: `C:\Users\dodez\Downloads\seoulfirst_multipage\`

## 기술 스택

- 순수 HTML/CSS/JavaScript (프레임워크 없음)
- `multipage.css` — 전체 공통 스타일
- `multipage.js` — 공통 스크립트 (햄버거 메뉴, 스크롤 등)
- `health-posts.json` — 건강소식 글 데이터

---

## ⚠️ 파일 수정 전 반드시 먼저 실행 (pull)

**어느 PC에서든 작업 시작 전에 반드시 최신 버전을 받아야 합니다.**
안 하면 다른 PC의 수정 내용을 덮어쓸 수 있습니다.

```bash
git pull
```

## 파일 수정 후 반드시 실행 (push)

```bash
git add .
git commit -m "홈페이지 수정"
git push
```

Netlify가 GitHub 변경을 감지해서 2~3분 내에 자동 배포됩니다.

---

## 병원 PC 최초 설정 (한 번만)

병원 PC에 git이 없으면 https://git-scm.com 에서 설치 후:

```bash
git config --global user.name "dodezi"
git config --global user.email "GitHub 이메일"
git clone https://github.com/dodezi/seoulfirst-website.git
```

클론한 폴더 안에서 작업하면 됩니다.

## 건강소식 자동 발행

병원 PC의 Claude가 `/publish-health-post` 스킬로 `health-posts.json`을 GitHub API로 직접 업데이트합니다.
