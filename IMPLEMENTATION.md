# Implementation notes

## Status

The Policy remote renders the policy workbench: a paginated policy list, DRAFT
creation with idempotency, lifecycle advance with ETag/If-Match, and a record
detail with tabs for programs, legal entities, versions, coverages and limits,
mass tort, endorsements, insureds and locations, billing,
cancellation/reinstatement, and an event-derived activity timeline.

## Products

The product catalog is read from `GET /api/v1/products?q=&status=…`, where the
optional `status` is `ACTIVE` or `RETIRED` and an omitted status returns the
whole catalog. `src/products.js` holds the endpoints, the product-line and
status vocabularies, tolerant normalization (a bare array or an
`items`/`products` envelope, `code`/`productCode`, and
`name`/`productName`/`displayName`), create-form defaults, validation, the
create payload, status tone, and display labels.
`src/ProductPicker.jsx` is the debounced, abortable typeahead shared by New
policy and New submission: it searches by code or name, always sends
`status=ACTIVE`, shows the selected product code and catalog label, and reports
`(code, product)` to the form. Both forms store `productCode` for the command
and keep the label only as display state, so no `productLabel` member is sent.
When the unfiltered catalog read returns no products, or the read fails, the
picker switches to a manual code input and states the reason. A filtered read
with no matches keeps the search input so the operator can keep typing, and
offers a manual-entry action.

The third workspace tab, **Product catalog**, is the catalog-management surface.
It reads the catalog with a server-side search and an All/ACTIVE/RETIRED status
filter, and renders the list plus the selected product's code, name, line,
jurisdiction, status, version, type, description, and id. `New product` posts
`{productCode, productName, productLine, jurisdiction}` to
`POST /api/v1/products`: the code is normalized to upper case and capped at 32
characters, the name at 200, the line is one of `CGL`, `PRODUCTS_LIABILITY`,
`UMBRELLA`, `EXCESS`, `OTHER`, and the jurisdiction is a two-letter
ISO 3166-1 alpha-2 code. Client validation mirrors those rules; a 409 duplicate
code stays inside the open modal, and a successful create clears the search and
status filter, refreshes the catalog, and selects the new ACTIVE product.

`Retire` and `Reactivate` open a confirmation dialog and `PATCH`
`/api/v1/products/{productId}/status` with `{status}`. Retiring stops new
selection: the policy and submission pickers only read `status=ACTIVE`, so a
retired product is never offered as a catalog option on a new record. Existing policies and
submissions are not rewritten; the product code they already store remains
valid, along with their coverage, limits, premium, billing, and lifecycle. The
catalog's default All view (and the RETIRED filter) keeps retired products
reviewable, and Reactivate makes the product selectable again. A status 409 is
contained in the dialog and re-reads the catalog. New policy starts with no
product and validation requires a selection before submit; the submission
create command already required its product code.

## Submissions

The page has a second workspace tab, **Submissions**, for new-business
submissions that exist before a policy record. The list reads
`GET /api/v1/policies/submissions?page=&size=` and renders the submission
number, product code, requested effective date, status, requested limit, and the
applicant party as a `/party?record=<id>` cross-link. The queue and detail use
the Policy expert projection: `{submissionId, submissionNumber, tenantId,
applicantPartyId, productCode, requestedEffectiveDate, requestedLimitAmount,
requestedLimitCurrency, tortCodes[], notes, status, version, createdAt,
updatedAt}`. The search box and status filter are evaluated over the loaded page
and match number, applicant, status, product, requested effective date, limit,
tort codes, and notes; the match count and empty state distinguish a filtered
queue from an empty one. Pagination follows the `_links` envelope. A Party read
failure leaves the short id (or stored label) and never blocks the queue.

`New submission` opens a modal over the same Party typeahead used by policy
creation. The form records the applicant party, product through the shared
predictive product picker (search by code or name), requested effective date,
requested limit and currency, comma-separated tort codes, and notes.
`POST /api/v1/policies/submissions` sends
`{applicantPartyId, productCode, requestedEffectiveDate, requestedLimitAmount,
requestedLimitCurrency, tortCodes[], notes?}` with an `Idempotency-Key`; the
notes member is omitted when blank. Response shapes with a flat record or a
`submission` wrapper are normalized. Validation requires the applicant, product
code, requested effective date, a positive limit, and a three-letter currency.
On success the modal closes, the queue reloads, the created submission is
selected, and the notice states that no policy was created. A 400/422 problem
stays in the modal with its canonical detail and field errors.

Selecting a submission reads
`GET /api/v1/policies/submissions/{submissionId}`. The detail panel shows the
submission number and id, status, applicant party link, product code, requested
effective date, requested limit and currency, tort codes, notes, received date,
and last-updated timestamp. Only the actions allowed from the current status are
rendered: `RECEIVED` can refer, quote, decline, or withdraw; `REFERRED` can
quote, decline, or withdraw; `QUOTED` can bind, decline, or withdraw. `BOUND`,
`DECLINED`, and `WITHDRAWN` are terminal. This mirrors the Policy expert's
one-way transition graph; the workbench does not invent intermediate
statuses. Each action opens a dialog with an optional reason and sends
`PATCH /api/v1/policies/submissions/{submissionId}/status` with `{status,
reason?}`; the reason is omitted when blank. Success updates the detail and
queue and announces the move. A 400/409 stays in the dialog; a 409 re-reads the
current submission. Detail **Refresh** re-reads both the submission and the
queue, and a list read failure is contained with Retry.

The conversion panel is separate from the status actions. It offers
`Convert to policy` for `QUOTED` and `BOUND` submissions; earlier statuses
explain that a quote or bind is required, and `DECLINED`/`WITHDRAWN` are closed.
The modal summarizes the applicant, product, requested limit, requested
effective date, and current status, and collects the premium amount, premium
currency, and an optional expiration defaulted to one year after the requested
effective date. Submitting posts
`{premiumAmount, premiumCurrency, expirationDate?}` to
`POST /api/v1/policies/submissions/{submissionId}/convert` with an
`Idempotency-Key`; a blank expiration is omitted. The command creates a DRAFT
policy and binds the submission. Success refreshes the submission detail and
queue, then hands the created record to the shell, which switches to the
Policies tab, selects the policy, pushes `/policy?record=<policyId>`, and
announces the policy number. The response is normalized from a direct policy, a
`policy`/`createdPolicy`/`result` wrapper, or the `Location` header. A 400 stays
in the dialog; a 409 also re-reads the submission.

The context panels state that submissions precede policies, that a submission is
the new-business opportunity and not a policy, and that quoting or binding a
submission does not create a policy yet. Only the explicit conversion creates
the DRAFT policy record and binds the submission; status actions update only the
submission.

The Overview also carries a read-only related-notifications card. It reads
`GET /api/v1/notifications?sourceType=POLICY&sourceId=<policyId>` and shows the
total related count plus the three newest notifications by `createdAt`
(number, subject, status, created). Each number links to
`/notifications?record=<id>`. The card owns its loading, empty, and unavailable
states; a failed or missing Notifications service never blocks the policy record
or another tab, and Policy never sends or changes a notification.

The Program tab sits after Overview. The current assignment is read from the
policy record's `programId`, then `GET /api/v1/programs/{programId}` fills the
card with the program number, name, type, effective dates, status, lead policy,
and capacity. Capacity is a program-level limit with its own currency. The used
amount sums the `limitAmount` values of the assigned-policy summaries the
program read returns (`policies`/`assignedPolicies`, or a pre-aggregated
`usedAmount` plus `policyCount` when the catalog omits them), and utilization is
`used / capacity`. The card shows capacity, used, utilization, and policy count,
with a progress bar capped at 100%; utilization above 100% is labelled and the
bar turns red. A policy with no assignment is the tab's empty state, not an
error. The typeahead reads `GET /api/v1/programs?q=…`, and `Attach program` sends
`PATCH /api/v1/policies/{policyId}/program` with `{programId}`; `Detach program`
sends the same command with `programId: null`. `Create program` posts
`{name, programType, effectiveFrom, effectiveTo, capacityAmount?,
capacityCurrency?, leadPolicyId?}` to `POST /api/v1/programs` with an
`Idempotency-Key` and then attaches the returned program id to the current
policy. Capacity is optional; an empty amount omits both capacity members. The
lead policy is optional and defaults to the current policy. If creation succeeds
but the attach is rejected, the modal closes, the created program stays selected
in the attach card, and both outcomes are reported so the operator can retry.
Program reads are contained in the tab with a Retry action. The context panel
states that a program groups related policies for capacity and aggregate
administration, that capacity is a program-level limit whose used amount sums
assigned policy limits, and that assigning one does not change coverage, policy
limits, premium, or the policy version.

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

The Rating tab sits after Coverage & Limits. The latest worksheet is read with
`GET /api/v1/policies/{policyId}/rating` lazily on tab selection; a 404 is
the no-worksheet empty state, not an error. The latest-worksheet card shows the
method, base rate, exposure, factor, computed premium, canonical `calcHash`, and
created timestamp, and a read failure stays inside the card with Retry. The
calculator supports `RATE_TIMES_EXPOSURE` (`baseRate × exposureAmount × factor`)
and `FLAT` (`baseRate × factor`, no exposure stored); the preview normalizes the
operands to the expert's scales and rounds the premium once to four decimals, so
it matches the posted calculation. Rating posts to
`POST /api/v1/policies/{policyId}/rating` with `{ratingMethod, baseRate,
exposureAmount, factor, apply}` and a fresh `Idempotency-Key`; a calculation
only post omits `If-Match` and leaves the policy untouched, while `Apply to
quote` sends the selected ETag as `If-Match`. Applying refreshes the policy
premium and ETag, the current version, and the Versions tab, and the notice
reports the old and new premium, the advanced version/ETag, and the worksheet
hash prefix. A 400 validation problem or a 409 not-rateable/stale-version
conflict stays in the tab with the canonical problem and field errors. Only
`DRAFT` and `QUOTED` policies are rateable; every other status disables the
controls and shows the reason. The context panel states that a worksheet is
reproducible from its normalized inputs and SHA-256 hash, that rating does not
change coverage or limits, and that issued premium changes use Premium audit on
the Endorsements tab.

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

Premium audit is an Endorsements-tab action available while the policy is
`ISSUED`, `IN_FORCE`, `ENDORSED`, or `REINSTATED`; every other status renders it
disabled with the reason in its tooltip and in the action card. The modal shows
the current written premium, an audited premium defaulted to the current amount,
a live increase/decrease/no-change delta preview, an effective date defaulted to
today, a required reason, and optional approver and approval-reference fields.
`POST /api/v1/policies/{policyId}/premium-audit` sends
`{auditedPremium, effectiveDate, reason, approvedBy?, approvalRef?}` with the
selected ETag as `If-Match` and a fresh `Idempotency-Key`. The command response
may be the updated policy (with the advanced ETag) or an audit result carrying
`auditedPremium` and `policyVersionNumber`; the client normalizes both and
re-reads the policy detail and current version so the header premium, ETag,
Overview current-version card, and Versions tab reflect the new `PREMIUM_AUDIT`
version. The notice reads `Premium audit recorded: $old → $new` followed by the
issued `PREMIUM_AUDIT` version. A 400 validation problem or a 409 conflict stays
in the modal with its canonical problem and field errors, and the selected
policy keeps its premium and ETag. The audit changes written premium only:
coverage grants, limits, insureds, and locations stay as issued.

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

When the selected policy's written premium and the billing plan's net premium
are both present, the Billing tab compares them at cent precision. Net premium
is the plan's scheduled total less credits applied, floored at zero so a fully
or over-credited plan never compares against a negative amount. A difference
shows `Policy premium $X differs from the billing plan net premium $Y by $Z.`
with a note that a premium audit or endorsement changes written premium but does
not automatically re-plan existing installments. When the plan carries
credits, the warning appends `Plan total $T less credits $C.`; the plan's
credited total is also carried through normalization from the summary or
installment rows when the plan does not publish it. A policy premium above the
net plan offers `Add adjustment installment`: the modal shows the delta
read-only, a due date defaulted to today, and a required reason;
`POST /billing/adjustment` sends `{dueDate, reason}` with a fresh
`Idempotency-Key`, then re-reads the plan and the policy and announces the added
installment. A policy premium below the net plan offers `Create credit note`,
which opens the credit-note dialog prefilled with the excess and
`Premium audit adjustment for <policyNumber>`; saving creates the normal draft
and the operator issues and applies it in the ledger. A rejection stays in the
modal with its canonical problem; a 409 also reloads the plan and policy (or
reloads the ledger for the credit note) and tells the operator to review the
refreshed variance. An equal or unknown variance offers no action. A missing
plan, or a missing amount on either side, is not a variance and renders no
warning.

When an installment carries a `paymentId`, the Billing tab reads
`GET /api/v1/payments/{id}` for each distinct linked payment and keeps that
Payment's own status. A status of `REVERSED`, `RETURNED`, `VOID`, `CANCELLED`, or
`FAILED` shows a `Payment <status> — installment may need review` warning badge
with a link to `/payment?record=<paymentId>`, and the billing summary states how
many installments link to a payment that is no longer PAID. The warning is
advisory: the installment status is never changed automatically, and a failed
payment read is contained as an unavailable status instead of a tab error or a
warning.

Credit notes sit at the bottom of the Billing tab, after the installments. The
section reads `GET /api/v1/policies/{policyId}/credit-notes` alongside the
billing plan and renders an issued total (ISSUED + APPLIED notes) and an applied
total (APPLIED notes), plus a table of note number, amount/currency, reason,
source cancellation number, status, issued date, applied date, reversal
date/reason, and the applied installment number/ID when the read carries one.
The source cancellation number comes from the note read when it carries one;
otherwise the Billing tab quietly reads the cancellation list to resolve the
stored cancellation id. An empty ledger is the section's empty state, not an
unavailable tab. `New credit note` opens a modal whose amount defaults to the
unpaid premium and whose currency is fixed to the policy premium currency;
`Save draft` posts `{amount, currency, reason}` to
`POST /api/v1/policies/{policyId}/credit-notes` with an `Idempotency-Key`.
`Issue` (DRAFT) and `Cancel` (DRAFT/ISSUED, after an inline confirmation) PATCH
`{status}` to
`/api/v1/policies/{policyId}/credit-notes/{creditNoteId}/status`. `Apply`
(ISSUED) opens a picker of DUE/OVERDUE installments whose outstanding is at
least the note amount; `Apply credit note` sends `{status: "APPLIED",
installmentId}` to the same status endpoint. `Reverse` (APPLIED) opens a modal
that requires an audit reason and warns that the credited amount is restored to
the installment; `Reverse credit note` sends `{status: "REVERSED", reason}` to
the same status endpoint. The row then shows REVERSED with the reversal date and
reason, and the ledger and billing plan are re-read so the credited and
outstanding balances reflect the restored credit. A 400 or 409 is contained in
the modal with the canonical problem and re-reads the ledger and billing plan so
a stale target is not offered again. Credit notes reduce premium owed; they do not
change the policy premium, coverage, limits, or version, and applying or
reversing a note is an accounting status, not a Payment.

The Cancellation tab lists the policy's cancellations and reads the credit-note
ledger with them. A `POSTED` cancellation whose `returnPremiumAmount` is greater
than zero offers `Create credit note`; once a ledger note carries a matching
`cancellationId`, the row instead shows `Credit note created` linking to the
Billing ledger. The action opens the same credit-note dialog prefilled from the
cancellation: the amount is the return premium and read-only, the currency is
the cancellation/policy premium currency and read-only, the reason is the
read-only sentence `Cancellation <number> return premium`, and the source
cancellation number and id are shown as locked context. `Save draft` posts the
same payload with `cancellationId`. A 409 duplicate stays in the dialog with the
canonical problem and re-reads the ledger; a successful POST refreshes the
ledger, closes the dialog, and the cancellation row switches to the created-note
link.

A cancellation's return-premium credit note also guards reinstatement. While a
`DRAFT`, `ISSUED`, or `APPLIED` note is open, `POST /reinstate` returns 409
`CANCELLATION_CREDIT_NOTE_OPEN`. The error is contained in the Reinstatement
section, not the page-level alert: it shows the canonical code and detail, keeps
every form value, and, when `meta.noteNumbers` (or the detail sentence) names the
open notes, lists them with the cancel/reverse guidance and an **Open credit note
ledger** link. The link switches to the Billing tab, where the ledger offers the
cancel and reverse actions. The guard clears when the operator retries the
command, changes the selected record, or closes the record; any other
reinstatement failure keeps the existing page-level problem handling.

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
form validation, the premium-variance adjustment endpoint/defaults/payload,
the variance direction-to-action rule, tolerant normalization of the billing
read (plan, installments, summary), status/action rules, the Payment hand-off
URL, the policy-payment source query, tolerant payment normalization, the
linked-payment detail endpoint and status/review rules, the Payment record
link, payment status tone, amount comparison for reconciliation, the link
payload, and the credited/outstanding normalization that decides when the
credit columns apply.
`src/creditNotes.js` holds
the credit-note reason catalog, form defaults and validation (including the
billing-variance prefill and its required free-text reason), the create and
status (including apply installment and required reversal reason) payloads,
status/action rules, the eligible installment picker, the applied installment
label, and tolerant normalization of the ledger read (including applied
installment id/number and reversed date/reason) and its summary.
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
`src/products.js` holds the product catalog endpoints, line and status
vocabularies, create-form defaults/validation/payload, tolerant list and record
normalization, status tone, and display labels; `src/ProductPicker.jsx` is the
debounced, abortable product typeahead shared by the two create forms, with the
empty/unavailable-catalog manual fallback. `src/ProductCatalog.jsx` is the
Product catalog management tab (create, status filter, retire/reactivate).
`src/legalEntities.js` holds the legal-entity type catalog, endpoints, create and
attach payloads, form validation, status/type/label helpers, and tolerant
normalization of the entity read and list (catalog names such as `entityCode`,
`legalName`, `entityType`, and the domicile pair are accepted alongside `code`,
`name`, `type`, and `jurisdiction`). `src/LegalEntityPicker.jsx` is the
debounced, abortable legal-entity typeahead; it only selects an existing entity
and never mutates the policy.
`src/reinstatement.js` holds the reinstatement credit-note guard: it recognizes
the `CANCELLATION_CREDIT_NOTE_OPEN` conflict, reads note numbers from
`meta.noteNumbers` or the canonical detail, and builds the local guard view
(code, detail, notes, guidance) while leaving all other problems to the existing
handling.

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
ETag/If-Match; `tests/product-catalog.spec.js` covers the shared product
picker's search by code and name (including the `q`/`status=ACTIVE` query and
tenant header), the selected-product card, the policy `productCode` payload
without the display label, the empty- and unavailable-catalog manual fallbacks,
and the Product catalog panel's create validation and payload, duplicate 409
containment, retire/reactivate confirmation and PATCH payloads, All/ACTIVE/
RETIRED filtering, refresh/selection, and the retired-product picker exclusion;
`tests/coverage.spec.js` covers adding a coverage with limits and
applying aggregate erosion; `tests/endorsement.spec.js` covers issuing an
endorsement, the new version row, and the `428 APPROVAL_REQUIRED` problem;
`tests/activity.spec.js` covers the event timeline request path and tenant
header, newest-first rendering, empty and 503-contained states, selection
refetch, card refresh, and payload summaries; `tests/billing.spec.js` covers the
plan payload, policy premium context, summary, mark paid/waive PATCH payloads,
overdue rows, the Payment hand-off URL, read failures, 409 conflicts, the
payment-picker query and tenant header, selection and apply payload, linked
payment id/number, amount warning, empty state, picker read failure/retry, a
409 link conflict, linked-payment status display and review warnings for a
non-PAID payment (including the summary count, Payment record link, and
contained detail-read failure), the no-warning PAID case, the premium-vs-plan
variance warning (policy higher and plan higher at cent precision), the
equal and missing-amount no-warning cases, the positive-variance adjustment
modal's read-only delta/today default/required reason and `{dueDate, reason}`
POST with plan and policy reload, the contained 422 and 409 guidance/reload,
the negative-variance credit-note prefill of the excess and
`Premium audit adjustment for <policy>` reason, and the zero-variance
no-action state;
`tests/credit-notes.spec.js` covers the credited/net billing
summary and conditional credited/outstanding installment columns, the empty
ledger, the create modal's unpaid default and fixed policy currency, the draft
POST payload and idempotency header, the derived issued/applied totals, issue
and apply transitions, the apply picker's DUE/OVERDUE and outstanding filter
(partial and exact-full applications, empty picker), the `{status, installmentId}`
apply payload, the applied installment column, apply 400/409 containment with a
ledger/billing re-read, reversal's required-reason modal and restore warning,
the `{status: "REVERSED", reason}` payload, the restored credited/outstanding
balances and REVERSED date/reason row, reverse 400/409 containment with a
ledger/billing re-read, cancel confirmation for DRAFT and ISSUED notes, the
section's contained read failure with retry, a create 409 that keeps the dialog
open, and a status 409 that keeps the row unchanged and reloads the ledger;
`tests/cancellation-credit-note.spec.js` covers the cancellation action's POSTED
and positive-return-premium eligibility, the locked return-premium/currency/
reason prefill and source cancellation context, the `cancellationId` POST
payload and idempotency header, the created-note link and ledger source
cancellation number, the existing-ledger link, and 409/500 containment;
`tests/reinstatement-credit-note.spec.js` covers the contained 409 code/detail,
the note-number fallback from detail, the Billing ledger link, the preserved
form values, the guard clearing on retry and record selection, and the unchanged
page-level handling of a non-credit-note rejection;
`tests/renewal.spec.js` covers action eligibility by status,
modal term and premium/limit defaults, the renewal payload and headers, success
selection and notice, the predecessor link and its navigation, and the 409
conflict; `tests/rating.spec.js` covers the latest worksheet fields and full
hash, the live premium preview, a calculation-only POST without `If-Match` that
leaves the premium/ETag/version reads untouched, an applied POST with `If-Match`
that refreshes the premium, ETag, current version, and version list, the FLAT
method with a null exposure, DRAFT/QUOTED eligibility with the disabled reason,
and contained 400/409 problems; `tests/mass-tort.spec.js` covers the not-set empty state and setup
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
  per-section deep links. The workspace and submission selection are component
  state, so a reload returns to the Policies tab.
- The Submissions queue reads
  `GET /api/v1/policies/submissions?page=&size=` and filters the loaded page in
  the browser; it does not send `q` or `status` to the API, so a filtered result
  describes the current page rather than the whole server-side queue. Submission
  referral and quote records, producers, and documents are not rendered in this
  slice.
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
- The product pickers consume `GET /api/v1/products?q=&status=ACTIVE` and the
  Product catalog tab additionally consumes `POST /api/v1/products` and
  `PATCH /api/v1/products/{productId}/status`. The Policy domain forwards these
  to the Policy expert; the remote still normalizes responses defensively
  (`items`/`products`, `code`/`productCode`, `name`/`productName`/
  `displayName`, `productId`/`id`). Product editing (name, line, jurisdiction)
  and version history are not rendered: the only catalog mutations are create
  and the ACTIVE/RETIRED status toggle. The create forms fall back to manual
  code entry when the catalog is empty or unavailable.
- No optimistic UI or offline queue; every mutation waits for the domain.
- The remote does not read the field-usage manifest or the theme/UI-kit packages
  from `eia-frontend`.
