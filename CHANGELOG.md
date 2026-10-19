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
- Record detail with tabs for versions, coverages and limits, endorsements,
  insureds and locations, and cancellation/reinstatement.
- Coverage/limit form and an idempotent aggregate erosion action.
- Endorsement form with backdate reason and approval fields.
- Insured and location forms.
- Cancellation form with the computed return premium and a reinstatement form
  that requires approval and premium evidence.
- Playwright coverage for the coverage/limit and endorsement flows, including a
  `422 BUSINESS_RULE` and a `428 APPROVAL_REQUIRED` problem.

### Changed

- The workbench reads `items` from the page envelope (and still tolerates a bare
  array during rollout).
- Playwright coverage now includes envelope rendering, pagination links,
  problem bodies, If-Match concurrency, coverage erosion, and endorsements.
