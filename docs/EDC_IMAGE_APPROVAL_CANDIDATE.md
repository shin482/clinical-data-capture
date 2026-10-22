# EDC 2.0.1 배포 이미지 승인 후보 기록

기록일: 2026-10-22 (Asia/Seoul)

이 문서는 배포 승인이 아니라 승인권자의 검토 자료다. `approved-image.json`의 상태는 계속 `IMAGE_DIGEST_UNVERIFIED`이며 digest는 `null`이다.

## 확인 결과

| 항목 | 값 | 상태 |
|---|---|---|
| Repository | `ghcr.io/shin482/clinical-data-capture-web-app` | VERIFIED |
| Tag | `2.0.1` | VERIFIED |
| OCI Image Index digest | `sha256:80ac4f2c45f6a369f160b7425c2bc2e007921954948b5095d0b56eb9f4f6ab53` | VERIFIED (Registry 응답) |
| Linux amd64 manifest digest | `sha256:739e945df3718cc86946755561a0278f88a1740d17beac3ff2ab8da2a282f9f7` | VERIFIED (Index descriptor) |
| Source revision | `178d7c2251f726555506b0b5c3059b5d462e5425` | VERIFIED (첨부 provenance subject/material 및 공개 commit 존재) |
| Source와 image 연결 | amd64 digest를 subject로 하는 in-toto/SLSA 계열 attestation이 위 revision을 material로 기록 | VERIFIED (내용 연결), UNVERIFIED (신뢰 체인) |
| 공식 release/tag | 공개 release/tag `2.0.1`의 독립 확인 자료 없음 | UNVERIFIED |
| Provenance 서명/신뢰 체인 | 신뢰된 builder identity, 서명 검증 및 조직 승인 근거 미확보 | APPROVAL_REQUIRED |
| 보안 스캔 | 해당 digest에 귀속된 승인 가능한 취약점/SBOM 검토 결과 미확보 | APPROVAL_REQUIRED |

## 승인 전 필수 확인

1. 배포 승인권자가 repository, OCI index digest, amd64 manifest digest, source revision을 함께 승인해야 한다.
2. 신뢰된 CI workflow/builder identity와 attestation 서명을 독립적으로 검증해야 한다.
3. amd64 manifest에 대한 SBOM 및 취약점 스캔 결과를 보관하고 허용 기준을 승인해야 한다.
4. 현재 소스의 파일 기반 secret 지원은 기존 이미지 `2.0.1`에 포함됐다고 볼 수 없다. 새 이미지를 빌드하면 새 index/manifest digest와 provenance를 다시 검증해야 한다.
5. 승인 전에는 Installer의 `IMAGE_DIGEST_UNVERIFIED` 차단을 해제하지 않는다.

## 승인 후 적용 형식

승인권자의 서면 승인과 위 검증 증거가 확보된 경우에만 `edc-integrated-installer/approved-image.json`에 승인된 **OCI index digest**를 기록하고 상태를 `APPROVED`로 변경한다. 특정 플랫폼 digest를 직접 고정하는 정책을 채택한다면 Installer의 플랫폼 선택 및 digest 비교 계약도 함께 변경·검증해야 한다. 어느 방식을 택하든 tag만 승인 근거로 사용하지 않는다.
