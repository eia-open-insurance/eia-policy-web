# Changelog

All notable changes to this repository are documented here.

The format is based on Keep a Changelog and the project uses Semantic Versioning.

## [Unreleased]

### Added

- Repository baseline.
- Predictive product picker shared by New policy and New submission: it reads
  `GET /api/v1/products?q=&status=ACTIVE`, searches by product code or name,
  shows the selected product code and catalog label, and sends only the
  `productCode` on create. An empty or unavailable catalog falls back to manual
  code entry so both create flows stay usable.
- Read-only Product catalog workspace tab over the active catalog, with a
  server-side search by code or name and a detail panel for the selected
  product.
- Playwright coverage for product picker search/selection/payload, the manual
  fallbacks for an empty and an unavailable catalog, and the catalog panel's
  list, search, and detail.
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
- `Link payment` action on `DUE`/`OVERDUE` installments: the modal reads
  `GET /api/v1/payments?sourceType=POLICY&sourceId=<policyId>` and lists payment
  number, status, amount/currency, created date, and payee when present, with
  loading, empty, read-failure, and retry states. Policy never creates a payment.
- Selecting a payment with an amount different from the installment shows a
  reconciliation warning while keeping `Apply payment` available; the Payment
  keeps its own amount and is not altered.
- `Apply payment` sends
  `PATCH /api/v1/policies/{policyId}/billing/installments/{installmentId}`
  with `{status: "PAID", paymentId}`; the row then shows the linked payment
  id/number and the modal stays open with the canonical problem on failure,
  including 409.
- Playwright coverage for the payment picker fetch/query/tenant header,
  selection and apply payload, linked id/number, amount warning, empty state,
  read failure and retry, and a 409 PATCH conflict, alongside the existing plan
  creation payload, summary, mark paid/waive payloads, overdue state, Payment
  URL, read failure, and 409 conflicts.
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
- Mass tort tab after Coverage & Limits with a not-set empty state that explains
  mass-tort administration and a `Set up profile` action.
- Mass tort profile form for tort type, trigger, allocation method with a short
  explanation, allocation notes, and coverage block start/end. Saving a draft
  requires the tort, trigger, and allocation method; completing additionally
  requires the notes and coverage block.
- `GET`/`PUT /api/v1/policies/{policyId}/mass-tort-profile` integration with
  `Save draft` and `Mark complete` status transitions, a current status/value
  summary, and a complete-profile summary card.
- Contained mass tort loading, 400, 404, and unavailable states, with a profile
  reload after a 409 conflict.
- Mass tort context panel stating that the profile guides allocation and
  coverage administration, never changes coverage or limits, and that Policy
  owns the profile while Direct Claims owns allocations.
- Playwright coverage for the mass tort empty state, draft payload, complete
  validation, existing-value load/edit, context boundary, read failure, 400
  problem, and 409 reload.
- Rating tab after Coverage & Limits with the latest immutable worksheet card
  (method, base rate, exposure, factor, computed premium, canonical SHA-256
  hash, and created timestamp) and a calculator for `RATE_TIMES_EXPOSURE` or
  `FLAT` with a live computed-premium preview and `Apply to quote` opt-in.
- `GET`/`POST /api/v1/policies/{policyId}/rating` integration: a
  calculation-only post records a worksheet without touching the policy, and
  an applied post sends `If-Match` plus `Idempotency-Key`, then refreshes the
  policy premium, ETag, current version, and version history.
- Rating eligibility limited to `DRAFT` and `QUOTED` policies, with the
  disabled reason shown for every other status and contained 400/409 problems.
- Rating context panel stating that a worksheet is reproducible from its
  normalized inputs and hash, that rating does not change coverage or limits,
  and that issued premium changes use Premium audit.
- Playwright coverage for the latest worksheet/hash card, live preview,
  calculation-only and applied POST payloads, ETag/premium/version refresh,
  DRAFT/QUOTED eligibility, FLAT exposure omission, and 400/409 containment.
- Program tab after Overview with a no-program empty state, the current
  program's number, name, type, effective dates, status, and lead-policy link,
  and a `Detach program` action.
- Program capacity card: the program-level capacity amount/currency, the used
  amount summed from the limits of assigned policies, the utilization
  percentage (which may exceed 100), and the assigned-policy count. A progress
  bar fills to 100% and turns red when used limits exceed program capacity.
- Attach existing program typeahead over `GET /api/v1/programs` with an
  `Attach program` action that sends
  `PATCH /api/v1/policies/{policyId}/program` with `{programId}`; detaching
  sends the same command with `programId: null`.
- Create program modal (name, type, effective dates, optional capacity
  amount/currency, optional lead policy that defaults to the current policy)
  that posts `POST /api/v1/programs` and then attaches the new program to the
  current policy. A create/attach split failure keeps the created program
  selectable in the attach card.
- Program context panel stating that a program groups related policies for
  capacity and aggregate administration, that capacity is a program-level limit
  whose used amount sums assigned policy limits, and that assigning one does
  not change coverage or policy limits.
- Playwright coverage for the tab position and empty state, catalog attach with
  the lead-policy link, detach payload, create defaults/lead policy, capacity
  amount/currency payload, capacity values and 95% utilization, over-capacity
  red state at 125% with the bar capped at 100%, create validation, attach
  rejection and retry, and a contained program read failure with retry.
- Legal entity tab after Program with a no-entity empty state, the assigned
  entity's code, name, type, jurisdiction, regulator, license, and status, and a
  `Detach` action.
- Attach existing legal-entity typeahead over `GET /api/v1/legal-entities` with
  an `Attach legal entity` action that sends
  `PATCH /api/v1/policies/{policyId}/legal-entity` with `{legalEntityId}`;
  detaching sends the same command with `legalEntityId: null`.
- Create legal entity modal (code, name, type, jurisdiction, regulator, license)
  that posts `POST /api/v1/legal-entities` with an `Idempotency-Key` and then
  attaches the new entity to the current policy. A create/attach split failure
  keeps the created entity selectable in the attach card.
- Contained legal-entity loading, 404, and unavailable states with retry, and a
  409 conflict that re-reads the current assignment before the operator retries.
- Legal entity context panel stating that the legal entity is the issuing,
  licensed carrier and that assigning one does not change coverage or limits.
- Playwright coverage for the tab position and empty state, attach, detach,
  create, create validation/rejection, a missing assigned entity, a contained
  read failure with retry, and a 409 attach conflict with reload and retry.
- Cancellation tab **Create credit note** action on every `POSTED` cancellation
  with a positive return premium, opening the credit-note modal prefilled from
  the cancellation: locked amount (return premium), locked policy currency, and
  the `Cancellation <number> return premium` reason. When the ledger already
  contains a note with the same `cancellationId`, the row shows **Credit note
  created** with a link to the Billing ledger instead.
- Cancellation credit-note POST includes the source `cancellationId`; success
  refreshes the ledger and announces the saved draft, while a 409 duplicate stays
  in the dialog with the canonical problem and re-reads the ledger.
- Credit-note ledger shows the source cancellation number (from the note read or
  the cancellation list) and Playwright coverage for the prefill, POST payload,
  duplicate 409, generic error, existing-ledger link, and source cancellation
  number.
- Reinstatement credit-note guard: a 409 `CANCELLATION_CREDIT_NOTE_OPEN` stays in
  the Reinstatement section with the canonical code/detail and the open note
  numbers from `meta.noteNumbers` (or the detail), keeps the form values, and
  links to the Billing ledger with cancel/reverse guidance. The guard clears on
  retry or record selection; other reinstatement failures keep the page-level
  problem path. Playwright coverage for the guard, ledger link, retry, selection,
  and unchanged generic errors.
- Endorsements-tab **Record premium audit** action with a modal for the current
  premium, audited premium, live increase/decrease/no-change delta preview,
  effective date, reason, and optional approver/approval reference. It is
  available for `ISSUED`, `IN_FORCE`, `ENDORSED`, and `REINSTATED` policies and
  disabled with the reason otherwise.
  `POST /api/v1/policies/{policyId}/premium-audit` sends the selected ETag as
  `If-Match` and a fresh `Idempotency-Key`; success re-reads the policy and
  current version, updates the header premium/ETag, issues a `PREMIUM_AUDIT`
  version, and announces the changed premium. The audit changes written premium
  only, leaves coverage and limits untouched, and contains 400/409 problems in
  the dialog. Playwright coverage for status eligibility, increase/decrease/
  no-change previews and payloads, the refreshed policy/version, and 400/409
  containment.
- Billing premium-variance corrective actions. A policy premium above the plan's
  net premium offers **Add adjustment installment**: the modal shows the delta
  read-only, defaults the due date to today, requires a reason, and posts
  `{dueDate, reason}` to
  `POST /api/v1/policies/{policyId}/billing/adjustment` with an
  `Idempotency-Key`, then reloads the plan and policy and announces the added
  installment. A policy premium below the net plan offers **Create credit
  note**, which opens the existing credit-note modal prefilled with the excess
  and `Premium audit adjustment for <policyNumber>` for the operator to save,
  issue, and apply. An equal or unknown variance offers no action. Rejections
  stay in the modal with their canonical problem; a 409 reloads the plan and
  policy (or the credit-note ledger) and states that the current variance was
  reloaded. Playwright coverage for the adjustment payload and plan/policy
  reload, contained 422 and 409 handling, the credit-note prefill and POST, and
  the zero-variance no-action state.
- Overview related-notifications card: reads
  `GET /api/v1/notifications?sourceType=POLICY&sourceId=<policyId>` and shows the
  total related count with the three newest notifications (number, subject,
  status, created). Each notification number links to
  `/notifications?record=<id>`; a policy with no notifications shows an empty
  state, and an unavailable Notifications service stays inside the card without
  blocking the policy record.
- Playwright coverage for the related-notification count and newest-first
  preview, the `sourceType`/`sourceId` query and tenant header, per-record
  reload, the notification record link, the empty state, and a contained read
  failure.
- Top-level **Submissions** workspace tab for new-business submissions that
  precede a policy: a prominent text search over number, applicant, product,
  tort, status, and notes, a status filter, a clear action, and a queue showing
  the submission number, product/requested date, status, requested limit, and
  the applicant as a `/party?record=<id>` cross-link.
- `New submission` modal with the Party predictive picker, product code,
  requested effective date, requested limit and currency, comma-separated tort
  codes, and notes. `POST /api/v1/policies/submissions` sends
  `{applicantPartyId, productCode, requestedEffectiveDate,
  requestedLimitAmount, requestedLimitCurrency, tortCodes[], notes?}` with an
  `Idempotency-Key`; success refreshes and selects the created submission and
  states that no policy was created. The projection is the Policy expert shape
  (`submissionId`, `requestedLimitAmount`, `requestedLimitCurrency`); no
  `productId`, `programId`, `requestedLimits`, exposures, or owner members are
  read or sent.
- Submission detail from
  `GET /api/v1/policies/submissions/{submissionId}` with every request field,
  status, torts, notes, received/updated timestamps, applicant link, and a
  detail **Refresh** that re-reads the submission and queue.
- Allowed status actions only for the current status, matching the Policy expert
  graph (`RECEIVED -> REFERRED/QUOTED/DECLINED/WITHDRAWN`, `REFERRED ->
  QUOTED/DECLINED/WITHDRAWN`, `QUOTED -> BOUND/DECLINED/WITHDRAWN`; `BOUND`,
  `DECLINED`, and `WITHDRAWN` terminal) with an optional reason. The action
  `PATCH`es `/api/v1/policies/submissions/{submissionId}/status` with
  `{status, reason?}`;
  a blank reason is omitted. A 400/409 stays in the dialog, a 409 re-reads the
  submission, and success refreshes both the detail and the queue.
- Context copy and success notices state that submissions precede policies and
  that quoting or binding a submission does not create a policy; only the
  explicit conversion command creates the policy record.
- `Convert to policy` action for `QUOTED` and `BOUND` submissions. The modal
  summarizes the applicant, product, requested limit, requested effective date,
  and current status, and collects the premium amount, premium currency, and an
  optional expiration defaulted to one year after the requested effective date.
  Submitting posts `{premiumAmount, premiumCurrency, expirationDate?}` to
  `POST /api/v1/policies/submissions/{submissionId}/convert` with an
  `Idempotency-Key`; a blank expiration is omitted. The command creates a DRAFT
  policy and binds the submission: success refreshes the submission detail and
  queue, switches to the Policies tab, selects the created policy, pushes
  `/policy?record=<policyId>`, and announces the policy number. A 400 stays in
  the dialog; a 409 also re-reads the submission. The conversion response is
  normalized from a direct policy, a `policy`/`createdPolicy`/`result` wrapper,
  or a `Location` header.
- Playwright coverage for the conversion summary and defaults, the exact
  payload and idempotency header, `QUOTED` and `BOUND` eligibility, the optional
  expiration, submission refresh, created-policy selection and URL, premium and
  expiration validation, and contained 400/409 problems.

### Changed

- The workbench reads `items` from the page envelope (and still tolerates a bare
  array during rollout).
- Playwright coverage now includes envelope rendering, pagination links,
  problem bodies, If-Match concurrency, coverage erosion, and endorsements.
