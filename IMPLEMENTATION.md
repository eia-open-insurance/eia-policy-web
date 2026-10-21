# Implementation notes

## Status

The Policy remote renders the policy workbench: a paginated policy list, DRAFT
creation with idempotency, lifecycle advance with ETag/If-Match, and a record
detail with tabs for programs, legal entities, versions, coverages and limits,
mass tort, endorsements, insureds and locations, billing,
cancellation/reinstatement, and an event-derived activity timeline.

The Program tab sits after Overview. The current assignment is read from the
policy record's `programId`, then `GET /api/v1/programs/{programId}` fills the
card with the program number, name, type, effective dates, status, and lead
policy. A policy with no assignment is the tab's empty state, not an error. The
typeahead reads `GET /api/v1/programs?q=…`, and `Attach program` sends
`PATCH /api/v1/policies/{policyId}/program` with `{programId}`; `Detach program`
sends the same command with `programId: null`. `Create program` posts
`{name, programType, effectiveFrom, effectiveTo, leadPolicyId?}` to
`POST /api/v1/programs` with an `Idempotency-Key` and then attaches the returned
program id to the current policy. The lead policy is optional and defaults to
the current policy. If creation succeeds but the attach is rejected, the modal
closes, the created program stays selected in the attach card, and both outcomes
are reported so the operator can retry. Program reads are contained in the tab
with a Retry action. The context panel states that a program groups related
policies for capacity and aggregate administration and that assigning one does
not change coverage, limits, premium, or the policy version.

The Legal entity tab sits after Program and shows the issuing, licensed carrier.
The current assignment is read from the policy record's `legalEntityId` (the
SPEC name `issuingLegalEntityId` and a nested legal-entity object are tolerated),
then `GET /api/v1/legal-entities/{legalEntityId}` fills the card with the entity
code, legal name, type, jurisdiction, regulator, license, and status. A policy
with no assignment is the tab's empty state, not an error; a missing assigned
record (404) is reported inside the tab instead of being shown as unassigned.
The typeahead reads `GET /api/v1/legal-entities?q=…`, and `Attach legal entity`
sends `PATCH /api/v1/policies/{policyId}/legal-entity` with `{legalEntityId}`;
`Detach` sends the same command with `legalEntityId: null`.
`Create legal entity` posts `{code, name, type, jurisdiction, regulator?,
license?}` to `POST /api/v1/legal-entities` with an `Idempotency-Key` and then
attaches the returned entity id to the current policy. If creation succeeds but
the attach is rejected, the modal closes, the created entity stays selected in
the attach card, and both outcomes are reported so the operator can retry. A 409
on attach, detach, or the create/attach split re-reads the current assignment
and keeps the canonical problem in the tab. The context panel states that the
legal entity is the issuing, licensed carrier and that assigning one does not
change coverage or limits.

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
credited, outstanding net of credits, overdue) and an installment table.
`creditedAmount` and `outstandingAmount` are read from the Billing payload when
present (`outstandingAmount` falls back to `amount - creditedAmount`) and the
installment table adds Credited and Outstanding columns only when at least one
row carries those fields. `POST /billing` sends
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

Credit notes sit at the bottom of the Billing tab, after the installments. The
section reads `GET /api/v1/policies/{policyId}/credit-notes` alongside the
billing plan and renders an issued total (ISSUED + APPLIED notes) and an applied
total (APPLIED notes), plus a table of note number, amount/currency, reason,
status, issued date, applied date, and the applied installment number/ID when
the read carries one. An empty ledger is the section's
empty state, not an unavailable tab. `New credit note` opens a modal whose amount
defaults to the unpaid premium and whose currency is fixed to the policy premium
currency; `Save draft` posts `{amount, currency, reason}` to
`POST /api/v1/policies/{policyId}/credit-notes` with an `Idempotency-Key`.
`Issue` (DRAFT) and `Cancel` (DRAFT/ISSUED, after an inline confirmation) PATCH
`{status}` to
`/api/v1/policies/{policyId}/credit-notes/{creditNoteId}/status`. `Apply`
(ISSUED) opens a picker of DUE/OVERDUE installments whose outstanding is at
least the note amount; `Apply credit note` sends `{status: "APPLIED",
installmentId}` to the same status endpoint. A 400 or 409 is contained in the
modal with the canonical problem and re-reads the ledger and billing plan so a
stale target is not offered again. Credit notes reduce premium owed; they do not
change the policy premium, coverage, limits, or version, and applying a note is
an accounting status, not a Payment.

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
comparison for reconciliation, the link payload, and the credited/outstanding
normalization that decides when the credit columns apply.
`src/creditNotes.js` holds
the credit-note reason catalog, form defaults and validation, the create and
status (including apply installment) payloads, status/action rules, the eligible
installment picker, the applied installment label, and tolerant normalization of
the ledger read (including applied installment id/number) and its summary.
`src/renewal.js`
holds the pure renewal helpers: status eligibility and context, UTC-safe date
arithmetic, the term/premium form defaults, payload construction, and
validation. `src/massTort.js` holds the profile's tort, trigger, and allocation
catalogs (with allocation explanations), form defaults and validation, the PUT
payload, status helpers, and tolerant normalization of the profile read.
`src/programs.js` holds the program catalog types, endpoints, create and attach
payloads, form defaults and validation, status/type/label helpers, and tolerant
normalization of the program read and list. `src/ProgramPicker.jsx` is the
debounced, abortable program typeahead; it only selects an existing program and
never mutates the policy.
`src/legalEntities.js` holds the legal-entity type catalog, endpoints, create and
attach payloads, form validation, status/type/label helpers, and tolerant
normalization of the entity read and list (catalog names such as `entityCode`,
`legalName`, `entityType`, and the domicile pair are accepted alongside `code`,
`name`, `type`, and `jurisdiction`). `src/LegalEntityPicker.jsx` is the
debounced, abortable legal-entity typeahead; it only selects an existing entity
and never mutates the policy.

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
409 link conflict; `tests/credit-notes.spec.js` covers the credited/net billing
summary and conditional credited/outstanding installment columns, the empty
ledger, the create modal's unpaid default and fixed policy currency, the draft
POST payload and idempotency header, the derived issued/applied totals, issue
and apply transitions, the apply picker's DUE/OVERDUE and outstanding filter
(partial and exact-full applications, empty picker), the `{status, installmentId}`
apply payload, the applied installment column, apply 400/409 containment with a
ledger/billing re-read, cancel confirmation for DRAFT and ISSUED notes, the
section's contained read failure with retry, a create 409 that keeps the dialog
open, and a status 409 that keeps the row unchanged and reloads the ledger;
`tests/renewal.spec.js` covers action eligibility by status,
modal term and premium/limit defaults, the renewal payload and headers, success
selection and notice, the predecessor link and its navigation, and the 409
conflict; `tests/mass-tort.spec.js` covers the not-set empty state and setup
form, the draft payload and header, complete validation (including a reversed
coverage block), existing-value load and edit, the allocation/ownership context,
a contained read failure with retry, a 400 problem inside the form, and the 409
reload; `tests/program.spec.js` covers the tab position and no-program empty
state, attaching a catalog program with the lead-policy link and PATCH payload,
detaching with `programId: null`, create defaults with the current policy as
lead, creating without a lead policy, create validation and a catalog rejection
inside the open dialog, attach rejection/retry, and a contained program read
failure with retry; `tests/legal-entity.spec.js` covers the tab position and
no-entity empty state, attaching a catalog entity and rendering its issuing
details, detaching with `legalEntityId: null`, creating an entity with all
catalog fields and attaching it, create validation and a catalog rejection
inside the open dialog, a 404 for the assigned entity, a contained entity read
failure with retry, and a 409 attach conflict that reloads and retries.

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
- The Billing tab covers the premium installment plan and credit notes; billing
  accounts, receivables, dunning, commission statements, and disputes are not
  rendered.
- The Program tab consumes `GET`/`POST /api/v1/programs`,
  `GET /api/v1/programs/{programId}`, and
  `PATCH /api/v1/policies/{policyId}/program`; the current assignment is read
  from the policy record's `programId` (a nested program object is tolerated).
  The Policy contract does not publish these operations yet, so the read/write
  shapes are normalized defensively (`programNumber`/`code`, `programType`/
  `type`, `leadPolicyId`/`leadPolicyNumber`). Program versions, capacity
  shares, coinsurance, fronting, captives, and pools are not rendered.
- The Legal entity tab consumes `GET`/`POST /api/v1/legal-entities`,
  `GET /api/v1/legal-entities/{legalEntityId}`, and
  `PATCH /api/v1/policies/{policyId}/legal-entity`; the current assignment is
  read from the policy record's `legalEntityId` (the SPEC
  `issuingLegalEntityId` and a nested legal-entity object are tolerated). The
  response shapes are normalized defensively because the endpoints are not yet
  published by a backend in this tree. Legal-entity relationships, organization
  units, and the capacity/coinsurance/fronting structures that reference the
  entity are not rendered.
- No optimistic UI or offline queue; every mutation waits for the domain.
- The remote does not read the field-usage manifest or the theme/UI-kit packages
  from `eia-frontend`.
