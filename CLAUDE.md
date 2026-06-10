# 서울퍼스트내과의원 홈페이지

## 중요: 파일 수정 후 반드시 실행

홈페이지 파일을 수정한 후에는 항상 아래 명령어를 실행해서 GitHub에 자동 배포하세요.

```bash
cd "C:/Users/dodez/Downloads/seoulfirst_multipage"
git add .
git commit -m "홈페이지 수정"
git push
```

Netlify가 GitHub 변경을 감지해서 2~3분 내에 자동 배포됩니다.

## 프로젝트 정보

- **GitHub**: https://github.com/dodezi/seoulfirst-website
- **라이브 사이트**: https://dreamy-granita-8790e2.netlify.app
- **로컬 파일 경로**: `C:\Users\dodez\Downloads\seoulfirst_multipage\`

## 기술 스택

- 순수 HTML/CSS/JavaScript (프레임워크 없음)
- `multipage.css` — 전체 공통 스타일
- `multipage.js` — 공통 스크립트 (햄버거 메뉴, 스크롤 등)
- `health-posts.json` — 건강소식 글 데이터

## 건강소식 자동 발행

병원 PC의 Claude가 `/publish-health-post` 스킬로 `health-posts.json`을 GitHub API로 직접 업데이트합니다. 노트북에서 별도 작업 불필요.
