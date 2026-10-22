# EDC 웹 테스트 이미지 빌드 절차

## 현재 상태

- 로컬 Docker daemon은 기존 EDC 환경과의 격리가 입증되지 않아 사용하지 않는다.
- `.github/workflows/build-edc-web-test-image.yml`은 GitHub-hosted Ubuntu runner에서만 수동 실행한다.
- workflow는 GHCR login/push 권한이 없으며 OCI image tar를 Actions artifact로만 보관한다.
- 기존 `2.0.1` 태그와 `approved-image.json`은 변경하지 않는다.

## 재현 가능한 소스 준비

GitHub Actions는 미커밋 파일을 볼 수 없다. 따라서 실행 전 다음이 필요하다.

1. 현재 변경 중 실제 빌드에 필요한 소스만 검토한다.
2. 산출물, 로컬 DB, backup, secret 및 기존 Installer를 제외한다.
3. 전용 검토 브랜치의 단일 commit으로 소스 상태를 고정한다.
4. 해당 commit SHA를 검토 기록에 남긴다.
5. 승인 후 브랜치를 push하고 수동 workflow를 그 commit에서 실행한다.

현재 dirty worktree를 기존 HEAD만으로 빌드하면 파일 기반 secret 기능이 누락되므로 허용하지 않는다.

## 생성되는 결과

- 플랫폼: `linux/amd64`
- 태그 형식: `secret-file-test-<12자리 commit>-<run id>-<attempt>`
- 형식: OCI image layout tar
- 기록: source revision, test tag, Buildx digest, 플랫폼, registry 미게시 상태
- BuildKit SBOM 및 provenance attestation 요청
- 보관 기간: 14일

OCI artifact의 Buildx digest는 아직 GHCR에 게시된 digest가 아니다. 나중에 별도 승인을 받아 GHCR에 게시할 경우 Registry가 반환하는 digest를 다시 확인해야 한다.

## 실행 전 승인 사항

- 전용 브랜치 생성 및 source commit 범위
- 원격 push
- GitHub Actions 수동 실행
- Actions artifact 접근자와 보존 기간

GHCR push는 이 workflow의 범위가 아니다. 이미지 실행, Installer 반영 및 병원 배포도 별도 승인 대상이다.
