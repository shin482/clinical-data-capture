# Clinical Data Capture · Local EDC

당뇨발 연구의 Part B 임상 데이터를 입력·검토·내보내기 위한 개발 중인 웹 애플리케이션입니다. EDC(Electronic Data Capture, 전자 데이터 수집) 화면에서 대상자별 e-CRF(전자 증례기록서)를 작성하고, 입력 오류 Query와 변경 이력을 확인합니다.

Next.js 서버가 실행되는 장치의 SQLite 파일에 데이터를 저장합니다. 별도 DB 서버는 필요하지 않으며, 브라우저 저장소에는 최근 검색어와 일부 화면 접근 상태를 보관합니다.

## 1. 주요 화면과 구현 상태

| 화면 | 경로 | 기능 |
| --- | --- | --- |
| Dashboard | `/dashboard` | 대상자·Query 현황, 방문별 필수 항목 입력 진행률, 대상자 검색 |
| Subjects | `/subjects` | 대상자 등록·검색·목록 조회, 숫자를 고려한 ID 정렬 |
| 대상자 e-CRF | `/subjects/[subjectId]` | T1·T2·T3 입력, 자동 저장, 조건부 항목, SINBAD 점수 계산, Query 항목 표시 |
| Queries | `/queries` | 오류 조회·필터링, 해당 대상자·방문·변수로 이동 |
| Rule Master | `/rule-master` | 변수별 범주·범위·입력 가이드 등 규칙 관리, 비밀번호 확인 |
| Export | `/export` | 전체/대상자/방문별 XLSX 다운로드, Query 시트 포함 선택, 내보내기 이력 |
| Audit Trail | `/audit-trail` | 값 변경·내보내기 등의 기록 조회와 필터링, 비밀번호 확인 |
| User Management | `/user-management` | 안내 화면만 구현, 사용자·권한 관리는 준비 중 |
| Settings / Backup | `/settings` | 안내 화면만 구현, 설정·백업 UI는 준비 중 |

`/`로 접속하면 `/dashboard`로 이동합니다. 화면의 기관명과 표시 버전은 `lib/app-config.ts`에서 관리합니다. 패키지 버전은 `0.1.0`, 화면 표시 버전은 `v1.0`으로 서로 다릅니다.

## 2. 기술 구성

`package.json` 및 `pnpm-lock.yaml` 기준입니다.

| 구분 | 구성 |
| --- | --- |
| 웹 프레임워크 | Next.js 16.3.3, App Router 및 Route Handler |
| UI | React 19, TypeScript 5.7.3, Tailwind CSS 4, Lucide 아이콘, Base UI |
| 데이터 저장 | SQLite, better-sqlite3 13.0.3, WAL 모드 |
| Excel 처리 | xlsx 0.18.5 |
| 테스트 | Node.js assert 기반 `.cjs` 스크립트, TypeScript 모듈을 변환하여 실행 |

## 3. 설치와 실행

### 준비 사항

- Node.js **22 이상**: 잠금 파일의 `better-sqlite3` 엔진 조건입니다.
- pnpm: 저장소에 pnpm 버전은 고정되어 있지 않습니다.
- DB를 생성할 로컬 디렉터리의 쓰기 권한

현재 `pnpm-lock.yaml`은 SQLite·Excel 의존성을 포함하지만, `package-lock.json`에는 해당 의존성 등이 빠져 있습니다. 아래는 pnpm 기준이며, npm을 사용하려면 먼저 잠금 파일을 동기화해야 합니다. 현재 상태에서 `npm ci`를 그대로 사용하는 것은 피합니다.

### 개발 서버

프로젝트 루트에서 실행합니다.

```powershell
pnpm install --frozen-lockfile
pnpm dev --hostname 127.0.0.1
```

[http://localhost:3000](http://localhost:3000)에 접속합니다. 다른 포트를 쓰려면 다음과 같이 실행합니다.

```powershell
pnpm dev --hostname 127.0.0.1 --port 3001
```

`better-sqlite3`는 네이티브 모듈입니다. `pnpm-workspace.yaml`에는 해당 패키지의 빌드 허용 설정이 있습니다. 설치 중 네이티브 빌드 오류가 발생하면 Node.js 버전과 설치 로그, 사용하는 pnpm의 빌드 허용 설정 적용 여부를 확인합니다.

### 환경 변수

필수 환경 변수는 없습니다. 필요하면 루트에 `.env.local`을 생성합니다.

```dotenv
EDC_DATA_DIR=./data
ADMIN_PASSWORD=replace-with-your-local-password
```

| 변수 | 기본값 | 역할 |
| --- | --- | --- |
| `EDC_DATA_DIR` | 실행 디렉터리의 `data` | `edc.sqlite` 저장 디렉터리 |
| `ADMIN_PASSWORD` | `123456` | Rule Master·Audit Trail 화면 진입 시 확인하는 비밀번호 |

`.env.local`은 Git에서 제외됩니다. 직접 `node scripts/...`로 실행하는 스크립트는 Next.js의 환경 파일 로더를 사용하지 않으므로, 데이터 경로를 바꾸려면 셸 환경 변수로 전달해야 합니다.

```powershell
$env:EDC_DATA_DIR = Join-Path $PWD 'data-dev'
pnpm dev --hostname 127.0.0.1
```

### 빌드 결과 실행

```powershell
pnpm exec tsc --noEmit
pnpm build
pnpm start --hostname 127.0.0.1
```

`next.config.mjs`에 `typescript.ignoreBuildErrors: true`가 설정되어 있으므로 빌드 성공만으로 타입 검사를 통과했다고 판단할 수 없습니다. 타입 검사를 별도로 실행합니다. DB 모듈은 로드 시 초기화되므로 빌드·테스트 작업에서도 `EDC_DATA_DIR`가 어느 위치를 가리키는지 확인합니다.

## 4. 연구 변수와 입력 동작

### 변수 정의의 기준

- 기준 파일: `DFU-DC_e-CRF_PartB_IJH.xlsx`
- 기준 시트: `part B 변수목록 수정_최종본`
- 앱의 변수 정의: `lib/study-variables.json`
- 스키마 버전 및 이전 변수명 매핑: `lib/study-schema.ts`
- 전체 변수 **71개**, 기본 수집 대상은 **T1 71개 / T2 55개 / T3 55개**입니다.

변수명·한글 항목명·순서·수집 시점은 기준 시트를 따릅니다. 자료형·허용 범위·필수 여부 등은 기존 EDC 규칙을 유지한 것으로, 모두 Excel 시트에서 정의된 것은 아닙니다. 실행 시 Excel을 자동으로 읽어 JSON을 다시 만드는 구조도 아닙니다.

Rule Master/API에서는 기준 변수명·항목명·수집 시점을 바꾸거나 새 변수를 추가할 수 없습니다. 이러한 변경 요청은 `409`로 거절됩니다. 연구 스키마 변경은 원본·JSON·마이그레이션·검증 코드를 함께 검토해야 합니다.

### 저장과 검증

1. 대상자를 등록하면 T1(Baseline), T2(Follow-up 1), T3(Follow-up 2) 방문이 생성됩니다.
2. 입력 변경 후 약 400ms 뒤 필드 단위로 자동 저장합니다. 화면에서 저장 완료 또는 실패 상태를 확인합니다.
3. 필수 누락, 허용 범주, 정수 형식, 설정된 수치 범위 등의 오류는 값을 저장한 뒤 Query로 기록합니다. 입력을 수정하면 해당 필드의 기존 Query를 해결하고 필요한 Query를 다시 생성합니다.
4. 잘못된 방문, 해당 방문에서 수집하지 않는 변수, 계산 필드 직접 입력 등은 API에서 거절합니다.
5. 상위 항목 값에 따라 하위 항목을 활성화합니다. 비활성화된 항목의 기존 값은 보존합니다.
6. `snb_score`는 SINBAD 6개 항목이 모두 `0` 또는 `1`일 때 합산합니다. 누락이나 `99`가 있으면 계산 결과는 빈 값이며 직접 수정할 수 없습니다.

방문 진행률은 해당 방문에서 활성화된 필수 항목 중 **실제 값이 입력된 비율**입니다. 선택 항목·비활성 항목은 제외하고, `0`은 입력값으로 인정합니다. 결측 사유만 저장된 필수 항목은 완료로 세지 않습니다. 따라서 **입력 완료 상태와 Query 해결 상태는 별개**입니다.

API는 `NOT_ASSESSED`, `NOT_APPLICABLE`, `UNKNOWN`, `NOT_DONE` 결측 사유를 지원하며, 값과 결측 사유를 동시에 전달하면 거절합니다. 범주형 `99=Unknown`은 해당 규칙에서 허용할 때만 유효합니다.

## 5. 데이터 저장과 마이그레이션

DB 모듈을 처음 로드하면 저장 디렉터리와 `edc.sqlite`를 생성하고 테이블 및 버전별 마이그레이션을 적용합니다. 별도의 초기 seed 명령은 필요하지 않으며, 샘플 대상자 데이터는 자동으로 넣지 않습니다.

| 테이블 | 용도 |
| --- | --- |
| `subjects`, `visits` | 대상자와 방문 |
| `variable_definitions` | 변수 정의와 검증 규칙 |
| `clinical_values` | 방문별 입력값, 결측 사유, 수정 시각·작성자 |
| `queries` | 검증 오류와 처리 상태 |
| `audit_logs` | 값 변경·내보내기·마이그레이션 등 기록 |
| `export_history` | 내보내기 이력 |
| `schema_migrations`, `schema_migration_archive` | 적용 버전과 변경 전 데이터 보관 |
| `users`, `hospital_settings` | 테이블만 마련된 사용자·기관 설정 영역 |

기존 `pvd`는 `pad`, `ampdt_lt`는 `amp_dt`로 매핑합니다. 사용하지 않는 변수는 비활성화하고 관련 Query를 보관 상태로 전환하며, 이전 감사 기록은 유지합니다. 구·신 변수 데이터가 충돌하면 덮어쓰지 않고 마이그레이션을 중단합니다.

기존 DB를 명시적으로 백업한 후 스키마를 적용·검증하려면 다음을 실행합니다.

```powershell
node scripts/migrate-variables.cjs
```

이 명령은 **현재 지정된 DB를 변경합니다**. 기존 DB가 있으면 먼저 데이터 디렉터리의 `schema-backups/before-final-71-<timestamp>.sqlite`에 SQLite 백업을 생성합니다. 일반 앱 초기화에는 이 파일 백업 단계가 없으며, 이 스크립트는 Excel→JSON 생성기가 아닙니다.

전체 DB 백업이 필요하면 앱을 종료하고 데이터 디렉터리를 복사하거나 SQLite 백업 API를 사용합니다. WAL 모드에서 실행 중인 `edc.sqlite` 파일 하나만 복사하면 최신 변경 내용이 빠질 수 있습니다. XLSX 내보내기는 모든 DB 테이블을 포함하는 복구용 백업이 아닙니다.

## 6. API 개요

| 메서드 | 경로 | 기능 |
| --- | --- | --- |
| GET | `/api/health` | DB 연결 확인 (`connected`) |
| GET / POST | `/api/subjects` | 대상자 목록·진행률 조회 / 대상자 등록 |
| GET / POST | `/api/subjects/[subjectId]` | 방문·입력값 조회 / 필드 저장 |
| GET | `/api/variables` | 연구 변수 목록 |
| POST | `/api/variables` | 신규 변수 추가 차단 (`409`) |
| PATCH | `/api/variables/[variableKey]` | 허용된 변수 규칙 수정 |
| GET | `/api/queries` | Query 목록 |
| GET | `/api/audit` | 감사 기록 필터 조회 |
| GET | `/api/export` | XLSX 생성 또는 내보내기 이력 조회 |
| POST | `/api/admin/auth` | 화면 진입용 비밀번호 확인 |
| GET | `/api/admin/status` | 현재 항상 `{ "isAdmin": false }` 반환 |

필드 저장 요청 예시:

```json
{
  "timepoint": "T1",
  "variableKey": "occl",
  "value": "1",
  "modifiedBy": "local-user"
}
```

내보내기 옵션:

- `/api/export`: 전체 대상자·방문
- `/api/export?subject=TEST001&visit=T1`: 특정 대상자·방문
- `/api/export?includeQueries=1`: Query 시트 추가
- `/api/export?history=1`: 내보내기 이력 JSON

기본 XLSX 시트 순서는 `data`, `Variable Dictionary`이며, 선택 시 `Queries`가 추가됩니다. 데이터는 대상자당 한 행, `occl_t1`처럼 변수명과 방문을 조합한 열로 구성됩니다. 저장된 결측 사유가 있으면 해당 `_missing_reason` 열을 추가합니다. XLSX 생성은 내보내기 이력과 감사 기록도 남깁니다.

감사 기록 필터는 `subjectId`, `visit`, `variable`, `action`, `from`, `to`, `fromInstant`, `toInstant`를 지원합니다. `fromInstant`/`toInstant`가 있으면 날짜 필터보다 우선하고 종료 시각은 포함하지 않습니다.

## 7. 개발용 검증과 테스트

의존성을 설치한 후 프로젝트 루트에서 실행합니다. `package.json`에는 `test`·`lint` 명령이 등록되어 있지 않습니다.

```powershell
node scripts/validate-variables.cjs
node scripts/test-schema.cjs
node scripts/test-entry-rules.cjs
node scripts/test-crf.cjs
node scripts/test-search-ui.cjs
pnpm exec tsc --noEmit
```

| 스크립트 | 검사 내용 |
| --- | --- |
| `validate-variables.cjs` | Excel과 JSON의 변수 수·이름·항목명·방문 일치 |
| `test-schema.cjs` | 이전 DB 마이그레이션, 데이터 보존, 방문 제한, 변수 수정 제한, Excel 사전 |
| `test-entry-rules.cjs` | 조건부 항목, 흡연 관련 규칙, SINBAD 계산·저장, 내보내기 열 순서 |
| `test-crf.cjs` | 필드 저장·오류·결측·Query 해결, 진행률, 화면 접근 만료, 감사 기록, 내보내기 |
| `test-search-ui.cjs` | 최근 검색어·삭제·중복 제거, 변수 표시명, 그룹 정렬, 상태 표시 |

DB 통합 테스트 3개는 시스템 임시 디렉터리에 독립 DB를 생성하고 `EDC_DATA_DIR`를 해당 위치로 바꿉니다. 프로젝트 임상 DB는 사용하지 않으며 임시 DB는 자동 삭제하지 않습니다. `test-crf.cjs`의 비밀번호 검사는 기본값 `123456`을 전제로 하므로 별도 관리자 비밀번호가 설정되지 않은 테스트 셸을 사용합니다.

테스트는 서버를 띄우지 않고 API 함수를 직접 호출합니다. `test-search-ui.cjs`도 브라우저 자동화 테스트가 아닌 보조 함수 검사입니다. 실제 화면 레이아웃·클릭·자동 저장 전환은 별도로 확인해야 합니다.

수동 확인 흐름:

1. 별도의 개발용 데이터 경로로 앱을 실행하고 테스트 대상자를 등록합니다.
2. T1~T3 입력과 자동 저장 후 새로고침 시 값 유지 여부를 확인합니다.
3. 범위/범주 오류를 입력하여 Query 생성 및 수정 후 해결을 확인합니다.
4. 조건부 항목·SINBAD 계산과 방문별 진행률을 확인합니다.
5. 전체/대상자/방문별 XLSX와 Query 포함 옵션, 내보내기 이력을 확인합니다.
6. Rule Master·Audit Trail의 개별 비밀번호 확인과 감사 기록 필터를 확인합니다.

## 8. 코드 구조

```text
app/
  layout.tsx                    # 공통 레이아웃과 EdcWorkspace 마운트
  page.tsx                      # Dashboard 리다이렉트
  [...workspace]/page.tsx        # 허용된 메뉴 경로 검사
  subjects/[subjectId]/page.tsx  # 대상자 상세 경로
  api/                          # SQLite 기반 서버 API
  globals.css                   # 전역 스타일과 EDC 화면 스타일
components/
  clinical/
    edc-workspace.tsx            # 화면 상태·메뉴·입력·조회·자동 저장 중심 구현
    crf-field.tsx               # 자료형별 입력 필드
    data-entry-progress.tsx     # 대시보드 진행률
    recent-search-input.tsx     # 검색어 이력 UI
    help-modal.tsx              # 도움말
  ui/                          # 공통 UI 구성 요소
lib/
  db/                          # DB 초기화와 버전별 마이그레이션
  study-variables.json          # 연구 변수 71개 정의
  study-schema.ts              # 스키마 버전과 이전 변수명 매핑
  entry-rules.ts               # 조건부 활성화·계산 필드
  visit-rules.ts               # 방문별 수집 여부
  data-entry.ts                # 진행률·완료 판정
  crf-metadata.ts              # 방문·범주·결측 사유 메타데이터
  page-access.ts              # 화면별 접근 상태와 만료
  date-time.ts                # 시각 저장·표시와 날짜 경계
scripts/                      # 검증·통합 테스트·명시적 마이그레이션
public/                       # 정적 이미지·아이콘
DFU-DC_e-CRF_PartB_IJH.xlsx     # 연구 변수 기준 파일
```

필드 동작을 수정할 때는 `entry-rules.ts`, `data-entry.ts`, 필드 저장 API와 화면을 함께 확인합니다. 변수명·수집 시점 변경 시에는 DB 마이그레이션과 내보내기까지 영향을 확인합니다.

## 9. 현재 개발상 한계

- **인증은 화면 접근 확인 수준입니다.** Rule Master와 Audit Trail은 각각 `sessionStorage`에 저장한 인증 시각을 기준으로 30분간 접근을 허용합니다. 서버 세션·API 권한 검사는 구현되어 있지 않으므로 `ADMIN_PASSWORD` 설정만으로 API가 보호되지는 않습니다.
- 내보내기 작성자는 `Minji Jung`으로 고정되어 있고, 필드 수정자는 요청의 `modifiedBy` 또는 `local-user`입니다. 실제 사용자 인증과 연결된 감사 체계가 아닙니다.
- 사용자 관리, 설정·백업 UI, EMR 연동은 구현되어 있지 않습니다. 코드의 일부 EMR 참조 및 방문 표시값은 예시입니다.
- 화면의 `Local only` 문구는 네트워크 접근을 제한하는 기능이 아닙니다. 위 실행 예시는 개발 서버를 `127.0.0.1`에 바인딩합니다. 데이터는 브라우저 장치가 아닌 **앱 서버 장치**에 저장됩니다.
- 날짜 등 모든 입력 의미를 서버가 완전히 검증하는 것은 아니며, Query는 주로 저장한 필드에 대해 생성됩니다. Query가 없다는 사실만으로 전체 입력의 완전성을 보장하지 않습니다.
- 저장소에는 Dockerfile·Compose 구성과 CI 워크플로가 없습니다. `Docker Desktop.lnk`는 앱 실행 구성 파일이 아닙니다.

### 문서 작성 시 확인 범위

2026-09-15 기준 소스·패키지 설정·잠금 파일·테스트 코드를 검토하여 작성했습니다. 당시 작업 디렉터리에 `node_modules`가 없어 앱 실행, 빌드 및 테스트의 성공 여부는 검증하지 않았습니다.
