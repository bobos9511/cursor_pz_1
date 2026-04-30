# Render 상시 배포 가이드

이 프로젝트는 `render.yaml` 기준으로 배포하면:

- 고정 외부 URL 제공
- 서버 재시작/컴퓨터 종료와 무관하게 항상 접속 가능
- `git push` 시 자동 배포
- 기본 도메인(`*.onrender.com`)으로 바로 접속 가능

## 1) 로컬 준비 (1회)

1. Git 설치: https://git-scm.com/download/win
2. GitHub Desktop 설치(권장): https://desktop.github.com/
3. GitHub 계정 로그인

## 2) GitHub 새 저장소 생성 및 업로드

프로젝트 루트(`cursor_pz_1`)에서:

```bash
git init
git add .
git commit -m "Initial deploy setup for Render"
git branch -M main
git remote add origin https://github.com/<YOUR_ID>/<REPO_NAME>.git
git push -u origin main
```

## 3) Render 연결

1. Render 로그인: https://dashboard.render.com/
2. **New +** -> **Blueprint** 선택
3. 방금 만든 GitHub 저장소 선택
4. `render.yaml` 자동 인식 확인 후 생성
5. 환경변수 설정:
   - `GEMINI_API_KEY`: 본인 키
   - (선택) `GEMINI_MODEL`

## 4) 자동배포 사용법

- 이후 로컬에서 수정 후:

```bash
git add .
git commit -m "Update"
git push
```

- Render가 자동으로 재배포합니다.

## 5) 주의사항

- `data/`는 로컬 테스트용이며 Git에는 제외됩니다.
- 현재 설정은 `free` 플랜 기준이라 데이터 저장 경로가 임시(`/tmp/app-data`)입니다.
- 무료 플랜에서는 인스턴스 재시작 시 DB 파일이 초기화될 수 있습니다.
