# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

## [1.1.0] - 2026-09-21

### Changed
- `src/net.js`: `fetchHtml` now retries once on transient failures (500ms backoff)
- `src/net.js`: `storeCookies` now falls back to `headers.get("set-cookie")` string for older Node versions where `getSetCookie` is unavailable
- `src/rank.js`: `normKey` renamed to `normUrlKey` and exported from `net.js` to eliminate the forward-reference pattern; both `rank.js` and `net.js` now share the same implementation
- `test/rank.test.js`: fixed broken assertion in cross-engine consensus test (`junkIdx > ranked[0] === false` → `junkIdx > 0`)

### Added
- `.env.example` — documents all supported environment variables (`AI_ENDPOINT`, `AI_KEY`, `AI_MODEL`, `PORT`, `HOST`)
- `CHANGELOG.md` — tracks all notable changes

### Security
- `src/server.js`: now sets `X-Content-Type-Options: nosniff` and `X-Frame-Options: DENY` on all JSON responses
- `src/server.js`: basic rate limiting (20 req/min per IP) to protect against abuse

## [1.0.0] - 2026-08-20

- Initial release
- Dual-engine search (Bing + Baidu) with cross-engine consensus ranking
- Query refinement (question → substantive variants)
- Optional LLM judge via `AI_ENDPOINT` / `AI_KEY`
- Web UI at `/` and compact API at `/search?q=...&compact=1`
