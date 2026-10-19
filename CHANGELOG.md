# Changelog

All notable changes to this repository are documented here.

The format is based on Keep a Changelog and the project uses Semantic Versioning.

## [Unreleased]

### Added

- Repository baseline.
- Policy web remote: React 19 workbench, Webpack 5 Module Federation (`eia_policy` / `./App`), dev proxy to the domain, and a Playwright test with a mocked API.
- Paginated envelope handling with previous/next controls and a total counter.
- `Idempotency-Key` on create with replay notice.
- Canonical `application/problem+json` rendering, including field errors.
- ETag display and `If-Match` lifecycle action with stale-version feedback.

### Changed

- The workbench reads `items` from the page envelope (and still tolerates a bare
  array during rollout).
- Playwright coverage now includes envelope rendering, pagination links,
  problem bodies, and If-Match concurrency.
