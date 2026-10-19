# Implementation notes

## Status

The Policy remote renders the policy workbench: a paginated policy list, DRAFT
creation with idempotency, lifecycle advance with ETag/If-Match, and a record
detail with tabs for versions, coverages and limits, endorsements, insureds and
locations, and cancellation/reinstatement.

## Structure

`src/App.jsx` is the whole remote. It has three layers:

1. `api()` wraps `fetch` with `X-EIA-Tenant`, optional `If-Match` and
   `Idempotency-Key`, and exposes the `ETag` / `Idempotent-Replayed` headers.
2. Collection and detail loaders keep one page envelope or detail object per
   section; tab data is loaded lazily when a tab is selected.
3. Forms map one-to-one to the domain commands and refresh both the affected
   tab and the policy header/ETag after a successful mutation.

No business rule is duplicated in the remote; canonical problems from the domain
are rendered with their field errors.

## Verification

```powershell
npm install
npm run build
npm test
```

`npm test` starts the Webpack dev server and runs Playwright with a mocked API.
`tests/policy.spec.js` covers the page envelope, pagination, problem bodies, and
ETag/If-Match; `tests/coverage.spec.js` covers adding a coverage with limits and
applying aggregate erosion; `tests/endorsement.spec.js` covers issuing an
endorsement, the new version row, and the `428 APPROVAL_REQUIRED` problem.

## Known SPEC gaps in this slice

- No routing or deep links; the detail is an in-page panel.
- No document, billing, occurrence, mass tort, claims, or reinsurance views.
- No optimistic UI or offline queue; every mutation waits for the domain.
- The remote does not read the field-usage manifest or the theme/UI-kit packages
  from `eia-frontend`.
