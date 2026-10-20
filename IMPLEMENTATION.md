# Implementation notes

## Status

The Policy remote renders the policy workbench: a paginated policy list, DRAFT
creation with idempotency, lifecycle advance with ETag/If-Match, and a record
detail with tabs for versions, coverages and limits, mass tort, endorsements,
insureds and locations, billing, cancellation/reinstatement, and an
event-derived activity timeline.

The Mass tort tab sits after Coverage & Limits and administers the policy-owned
mass tort profile. `GET /mass-tort-profile` is read lazily on tab selection; a
404 is the not-set empty state, not an error. `Set up profile` reveals the form
for tort type, trigger, allocation method (with a short explanation of the
selected method), allocation notes, and the coverage block start/end. `Save
draft` and `Mark complete` both `PUT /mass-tort-profile` with
`{tortType, triggerType, allocationMethod, allocationNotes, coverageBlockStart,
coverageBlockEnd, status}` (`DRAFT` or `COMPLETE`). The three classification
fields are required for a draft; completing additionally requires the allocation
notes and a valid coverage-block window. The response is
rendered as the profile summary, with a distinct complete-profile card. The tab
owns its loading, empty, 400, 404, and unavailable states. A 409 re-reads the
current profile before the operator retries. The context panel states that the
profile guides allocation and coverage administration, never changes coverage or
limits, and that Policy owns the profile while Direct Claims owns allocations.

Renewal is a record-header action available while the policy is `ISSUED`,
`IN_FORCE`, `ENDORSED`, or `REINSTATED`; every other status renders it disabled
with the reason in its tooltip and context. The modal defaults the effective date
to the day after the expiring policy, the expiration to a one-year term from that
effective date, and premium, limit, and currencies to the current policy. All
fields stay editable, and the modal states that coverages and limits are carried
forward. `POST /api/v1/policies/{policyId}/renew` sends
`{effectiveDate, expirationDate, premiumAmount, premiumCurrency, limitAmount,
limitCurrency}` with the selected policy ETag as `If-Match` and a fresh
`Idempotency-Key`. On success the queue is refreshed, the new policy is selected,
and the notice reads `Renewed as POL-…`. The successor shows
`Renewed from POL-…` linking to `/policy?record=<predecessorId>`; the
predecessor payload does not identify its successor, so no forward link is
rendered.

Billing owns the premium collection plan only. `GET /billing` is treated as an
empty state on 404; a plan is rendered as a summary (total premium, paid,
outstanding, overdue) and an installment table. `POST /billing` sends
`{installmentCount, frequency, firstDueDate}` with an `Idempotency-Key`;
`PATCH /billing/installments/{id}` sends `{status}` (plus an existing
`paymentId` when present). `DUE`/`OVERDUE` rows also offer `Link payment`, which
reads `GET /api/v1/payments?sourceType=POLICY&sourceId=<policyId>` and lists the
candidate payment number, status, amount/currency, created date, and payee. The
modal owns its loading, empty, read-failure/retry, and apply-failure states. It
warns when the selected payment amount differs from the installment, then
`Apply payment` sends `{status: "PAID", paymentId}`. The PATCH
marks the installment collected and stores the payment id; it never creates,
executes, approves, or alters the Payment, whose amount is kept for
reconciliation. The row shows the linked payment id and (from the selection) its
payment number. The `Create payment` action remains a link that hands the
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
   stream rather than from the policy aggregate. Billing and the mass tort
   profile have their own request lifecycles so a missing or slow read never
   blocks the policy record.
3. Forms map one-to-one to the domain commands and refresh both the affected
   tab and the policy header/ETag after a successful mutation.

`src/billing.js` holds the pure billing helpers: plan form defaults and payload,
form validation, tolerant normalization of the billing read (plan, installments,
summary), status/action rules, the Payment hand-off URL, the policy-payment
source query, tolerant payment normalization, payment status tone, amount
comparison for reconciliation, and the link payload. `src/renewal.js`
holds the pure renewal helpers: status eligibility and context, UTC-safe date
arithmetic, the term/premium form defaults, payload construction, and
validation. `src/massTort.js` holds the profile's tort, trigger, and allocation
catalogs (with allocation explanations), form defaults and validation, the PUT
payload, status helpers, and tolerant normalization of the profile read.

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
overdue rows, the Payment hand-off URL, read failures, 409 conflicts, the
payment-picker query and tenant header, selection and apply payload, linked
payment id/number, amount warning, empty state, picker read failure/retry, and a
409 link conflict; `tests/renewal.spec.js` covers action eligibility by status,
modal term and premium/limit defaults, the renewal payload and headers, success
selection and notice, the predecessor link and its navigation, and the 409
conflict; `tests/mass-tort.spec.js` covers the not-set empty state and setup
form, the draft payload and header, complete validation (including a reversed
coverage block), existing-value load and edit, the allocation/ownership context,
a contained read failure with retry, a 400 problem inside the form, and the 409
reload.

## Known SPEC gaps in this slice

- Routing covers only the `?record=` and `?new=1` cross-links; there are no
  per-section deep links.
- The predecessor policy cannot render a forward link to its successor because
  `PolicyDto` exposes only `renewedFromPolicyId`; the link is kept on the
  successor record.
- No document, occurrence, claims, or reinsurance views. The Mass tort tab
  administers one profile and one coverage-block window; the SPEC
  `policy_coverage_block` table (layers, aggregate treatment, sequence) and the
  specialist profile fields (defense strategy, settlement authority, MDL and
  trust references, review cadence) are not rendered yet.
- The Billing tab covers the premium installment plan only; billing accounts,
  receivables, dunning, credit notes, commission statements, and disputes are
  not rendered.
- No optimistic UI or offline queue; every mutation waits for the domain.
- The remote does not read the field-usage manifest or the theme/UI-kit packages
  from `eia-frontend`.
