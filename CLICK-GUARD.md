# Boncho Click Guard

Cloudflare Pages Functions 기반 부정 클릭 대응 기능입니다.

## 작동 방식

1. 기본 방식은 기존 광고 URL `https://bonchojw.com` 그대로 사용합니다.
2. 사이트 첫 접속 시 네이버/구글 유입으로 확인되는 방문만 IP, 시간, 기기, 유입경로, 반복 횟수를 기록합니다.
3. 같은 IP에서 짧은 시간 반복 접속이 감지되면 `CLICK_GUARD_KV`에 자동 차단합니다.
4. 차단된 IP는 사이트 전체에서 403 페이지가 표시됩니다.
5. `/admin/blocked`에서 네이버/구글 광고에 넣을 차단 IP 목록을 내려받을 수 있습니다.

무료 KV 사용량을 줄이기 위해 이미지, 영상, CSS 같은 정적 파일은 검사하지 않고, 광고 유입으로 판단되는 HTML 방문만 기록합니다.

## Cloudflare Pages 설정

Cloudflare Pages 프로젝트에서 아래를 설정하세요.

- KV namespace: `CLICK_GUARD_KV`
- Environment variable: `ADMIN_TOKEN`

`ADMIN_TOKEN`은 긴 임의 문자열로 넣으세요. 예: `boncho-2026-긴랜덤문자`

## 광고 주소 예시

광고 URL을 바꿀 수 없으면 기존 URL을 그대로 두세요.

```text
https://bonchojw.com
```

광고 URL을 바꿀 수 있는 경우에는 아래 `/go` 주소를 쓰면 네이버/구글 구분이 더 정확합니다.

네이버 검색광고:

```text
https://bonchojw.com/go?to=home&utm_source=naver&utm_medium=search&utm_campaign=brand
```

구글 검색광고:

```text
https://bonchojw.com/go?to=home&utm_source=google&utm_medium=search&utm_campaign=brand
```

본문 제품 링크:

```text
https://bonchojw.com/go?to=product&utm_source=article&utm_medium=homepage
```

## 차단 IP 확인

JSON:

```text
https://bonchojw.com/admin/blocked?token=ADMIN_TOKEN
```

CSV:

```text
https://bonchojw.com/admin/blocked?token=ADMIN_TOKEN&format=csv
```

## 의심 광고 유입 IP 확인

차단까지는 안 됐지만 네이버/구글 광고 유입으로 기록된 IP입니다.

```text
https://bonchojw.com/admin/suspects?token=ADMIN_TOKEN
```

CSV:

```text
https://bonchojw.com/admin/suspects?token=ADMIN_TOKEN&format=csv
```

## 차단 해제

```text
https://bonchojw.com/admin/unblock?token=ADMIN_TOKEN&ip=1.2.3.4
```

## 네이버/구글 광고 차단

Cloudflare 차단은 사이트 접속을 막는 기능입니다. 광고 클릭 비용 자체를 줄이려면 CSV에서 뽑은 IP를 네이버/구글 광고 관리자에도 등록해야 합니다.

네이버는 "광고 노출 제한 IP"로 등록하고, 구글은 캠페인 또는 계정의 "IP 제외"에 등록합니다.
