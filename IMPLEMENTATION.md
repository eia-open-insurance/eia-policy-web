# Implementation notes

## Status

The Policy remote renders the policy workbench: a paginated policy list, DRAFT
creation with idempotency, lifecycle advance with ETag/If-Match, and a record
detail with tabs for versions, coverages and limits, endorsements, insureds and
locations, billing, cancellation/reinstatement, and an event-derived activity
timeline.

Billing owns the premium collection plan only. `GET /billing` is treated as an
empty state on 404; a plan is rendered as a summary (total premium, paid,
outstanding, overdue) and an installment table. `POST /billing` sends
`{installmentCount, frequency, firstDueDate}` with an `Idempotency-Key`;
`PATCH /billing/installments/{id}` sends `{status}` (plus an existing
`paymentId` when present). The `Create payment` action is a link that hands the
installment to the Payment workbench through
`?new=1&sourceType=POLICY&sourceId=…&sourceReference=<policyNumber> installment <n>&amount=…&currency=…&payeePartyId=…`.
Policy never posts a payment, and the plan never changes coverage or the policy
version.

## Structure

`src/App.jsx` is the whole remote. It has three layers:

1. `api()` wraps `fetch` with `X-EIA-Tenant`, optional `If-Match` and
   `Idempotency-Key`, and exposes the `ETag` / `Idempotent-Replayed` headers.
2. Collection and detail loaders keep one page envelope or detail object per
   section; tab data is loaded lazily when a tab is selected. The activity
   timeline is the exception: it is fetched when the policy is selected (and
   refreshed from its own card), because it is derived from the platform event
   stream rather than from the policy aggregate. Billing has its own request
   lifecycle so a missing or slow plan never blocks the policy record.
3. Forms map one-to-one to the domain commands and refresh both the affected
   tab and the policy header/ETag after a successful mutation.

`src/billing.js` holds the pure billing helpers: plan form defaults and payload,
form validation, tolerant normalization of the billing read (plan, installments,
summary), status/action rules, and the Payment hand-off URL.

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
endorsement, the new version row, and the `428 APPROVAL_REQUIRED` problem;
`tests/activity.spec.js` covers the event timeline request path and tenant
header, newest-first rendering, empty and 503-contained states, selection
refetch, card refresh, and payload summaries; `tests/billing.spec.js` covers the
plan payload, policy premium context, summary, mark paid/waive PATCH payloads,
overdue rows, the Payment hand-off URL, read failures, and 409 conflicts.

## Known SPEC gaps in this slice

- No routing or deep links; the detail is an in-page panel.
- No document, occurrence, mass tort, claims, or reinsurance views.
- The Billing tab covers the premium installment plan only; billing accounts,
  receivables, dunning, credit notes, commission statements, and disputes are
  not rendered.
- No optimistic UI or offline queue; every mutation waits for the domain.
- The remote does not read the field-usage manifest or the theme/UI-kit packages
  from `eia-frontend`.
