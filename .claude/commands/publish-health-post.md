# 건강소식 자동 발행

서울퍼스트내과의원 홈페이지에 새 건강소식 글을 작성하고 GitHub에 자동 업로드합니다.

## 실행 순서

### 1단계: 새 글 내용 생성

아래 주제 중 아직 다루지 않은 것으로 소화기내과/내과 관련 건강 정보 글을 하나 작성하세요.

**주제 예시:**
- 위내시경, 대장내시경 관련 정보
- 5대암 검진 (위암, 대장암, 간암, 폐암, 유방암)
- 만성질환 (당뇨, 고혈압, 고지혈증, 갑상선)
- 소화기 건강 (역류성식도염, 과민성대장증후군, 변비)
- 건강검진 관련 정보
- 영양제, 건강기능식품

**글 형식:**
- 제목: 검색에 잘 걸리는 실용적인 제목 (30자 내외)
- 카테고리: 대장내시경 / 건강검진 / 만성질환 / 소화기 건강 / 5대암 검진 / 건강정보 중 하나
- 요약: 2-3줄 핵심 요약
- 본문: HTML 형식, h3 소제목 3-4개, 각 단락 p 태그, 목록은 ul/li 사용, 총 800-1200자

### 2단계: GitHub API로 health-posts.json 업데이트

아래 Python 스크립트를 작성하고 실행하세요. `new_post` 부분을 1단계에서 생성한 내용으로 채우세요.
GitHub 토큰은 `C:\github-token.txt` 파일에서 읽습니다.

```python
import urllib.request
import json
import base64
import ssl
from datetime import datetime

# 토큰을 별도 파일에서 읽기
with open("C:/Users/dodez/github-token.txt", "r") as f:
    GITHUB_TOKEN = f.read().strip()

REPO = "dodezi/seoulfirst-website"
FILE_PATH = "health-posts.json"

ctx = ssl.create_default_context()

def github_api(method, endpoint, data=None):
    url = f"https://api.github.com/repos/{REPO}/contents/{endpoint}"
    req = urllib.request.Request(
        url,
        data=json.dumps(data).encode() if data else None,
        headers={
            "Authorization": f"token {GITHUB_TOKEN}",
            "Accept": "application/vnd.github.v3+json",
            "User-Agent": "Python"
        },
        method=method
    )
    res = urllib.request.urlopen(req, context=ctx)
    return json.loads(res.read())

# 현재 파일 가져오기
file_info = github_api("GET", FILE_PATH)
sha = file_info["sha"]
current_posts = json.loads(base64.b64decode(file_info["content"]).decode())

# 새 글 ID 계산
new_id = max(p["id"] for p in current_posts) + 1
today = datetime.now().strftime("%Y.%m.%d")

# ===== 아래 내용을 생성한 글로 교체 =====
new_post = {
    "id": new_id,
    "date": today,
    "category": "카테고리",
    "title": "제목",
    "summary": "요약",
    "url": "",
    "image": "",
    "content": "<p>본문 HTML</p>"
}
# ========================================

# 맨 앞에 추가
current_posts.insert(0, new_post)

# GitHub에 업로드
new_content = base64.b64encode(
    json.dumps(current_posts, ensure_ascii=False, indent=2).encode()
).decode()

github_api("PUT", FILE_PATH, {
    "message": f"건강소식 추가: {new_post['title']}",
    "content": new_content,
    "sha": sha
})

print(f"✅ 발행 완료! ID: {new_id}, 제목: {new_post['title']}")
```

### 3단계: 확인

업로드 완료 후 https://dreamy-granita-8790e2.netlify.app/health.html 에서 새 글이 보이는지 확인하세요. (Netlify 자동 배포 2~3분 소요)
