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
- Insured-party cross-link resolution through `GET /api/v1/parties/{id}`: the
  record header and Overview show `name · party number` link text with a
  short-UUID fallback, and a 404 never blocks the policy record.
- Billing tab with a no-plan premium-collection empty state and a plan form
  (installment count 1–24, frequency, first due date) that creates the plan
  through `POST /api/v1/policies/{policyId}/billing`.
- Billing plan summary (total premium, paid, outstanding, overdue) and an
  installment table with number, due date, amount, status, paid date/payment
  id, and actions; `DUE`/`OVERDUE` rows are collectible and `OVERDUE` rows are
  marked.
- Mark paid and waive actions through
  `PATCH /api/v1/policies/{policyId}/billing/installments/{installmentId}`
  with `{status, paymentId?}`.
- Payment hand-off for `DUE`/`OVERDUE` installments:
  `/payment?new=1&sourceType=POLICY&sourceId=…&sourceReference=<policyNumber> installment <n>&amount=…&currency=…&payeePartyId=…`.
  Policy never creates a payment.
- Billing context panel stating that billing is premium collection, Payment owns
  disbursement and approval, and a plan does not change policy coverage.
- Playwright coverage for plan creation payload, summary, mark paid/waive
  payloads, overdue state, Payment URL, read failure, and 409 conflicts.
- Renewal action in the policy record header for `ISSUED`, `IN_FORCE`,
  `ENDORSED`, and `REINSTATED` policies; other statuses render it disabled with
  the reason as context.
- Renewal modal with the day-after-expiration effective date, a one-year term,
  current premium/limit/currencies as editable defaults, and a carry-forward
  note for coverages and limits.
- `POST /api/v1/policies/{policyId}/renew` submission with `If-Match` and
  `Idempotency-Key`; success refreshes the queue, selects the new policy, and
  announces `Renewed as POL-…`.
- `renewedFromPolicyId` record fact on the successor: `Renewed from POL-…` links
  to `/policy?record=<predecessorId>`. No successor link is rendered on the
  predecessor because the response does not identify it.
- Renewal context panel stating that a renewal creates a new policy record and
  the prior policy remains intact.
- Playwright coverage for renewal eligibility, modal defaults, POST payload and
  headers, success selection/notice, predecessor link, and 409 conflict.

### Changed

- The workbench reads `items` from the page envelope (and still tolerates a bare
  array during rollout).
- Playwright coverage now includes envelope rendering, pagination links,
  problem bodies, If-Match concurrency, coverage erosion, and endorsements.
