# Docker 배포 가이드 (서버 업로드용)

이 문서는 이 프로젝트를 컨테이너로 서버에 배포하는 최소 절차입니다.

## 1) 로컬에서 준비

프로젝트 루트에서 아래 파일이 있는지 확인:

- `Dockerfile`
- `docker-compose.yml`
- `.env` (없으면 `.env.example` 복사)

`.env` 예시:

```bash
GEMINI_API_KEY=your_real_key
GEMINI_MODEL=gemini-1.5-flash
PORT=5500
```

## 2) 서버(리눅스) 초기 준비

서버에 Docker + Docker Compose Plugin 설치 후 로그인:

```bash
ssh <USER>@<SERVER_IP>
docker --version
docker compose version
```

## 3) 코드 올리기

방법 A(권장): GitHub에서 직접 받기

```bash
git clone https://github.com/<YOUR_ID>/<REPO_NAME>.git
cd <REPO_NAME>
cp .env.example .env
vi .env
```

방법 B: 로컬에서 서버로 업로드(scp/rsync)

## 4) 컨테이너 실행

```bash
docker compose up -d --build
docker compose ps
docker compose logs -f --tail=100
```

서비스 확인:

```bash
curl http://localhost:5500
```

브라우저 접속:

`http://<SERVER_IP>:5500`

## 5) 운영 명령어

재배포:

```bash
git pull
docker compose up -d --build
```

중지:

```bash
docker compose down
```

데이터 볼륨 유지한 채 재시작:

```bash
docker compose restart
```

## 6) 방화벽/보안 권장

- 서버 인바운드에서 `5500/tcp` 허용 (또는 Nginx 80/443 리버스 프록시 사용)
- 운영 환경에서는 `GEMINI_API_KEY`를 안전하게 관리
- HTTPS가 필요하면 Nginx + Certbot 구성 권장
