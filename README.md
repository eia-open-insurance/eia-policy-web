# eia-policy-web

- GitHub organization: `eia-open-insurance`
- Repository URL: https://github.com/eia-open-insurance/eia-policy-web
- Type: Federated front-end
- Deployable: Yes
- Owner: Policy
- Runtime: React 19 and Webpack 5
- Data store: None
- Depends on: eia-frontend/packages, eia-contracts, eia-platform/gateway

## Purpose

Policy federated remote: screens, widgets, record tabs, and transaction composition. Direct policy lifecycle, coverage, limits, mass tort profiles, programs, legal entities, billing, underwriting, rating, and capacity.

## Implemented slice

A React 19 workbench that lists policies and creates DRAFT policies through the domain API. It is a Webpack 5 Module Federation container named `eia_policy` that exposes `./App` and uses an asynchronous bootstrap so React is shared with the shell.

The workbench understands the paginated envelope
`{items, page, size, total, _links:{self,next,prev}}`, follows `next`/`prev`
links, sends an `Idempotency-Key` on every create, and displays canonical
`application/problem+json` failures. Lifecycle actions fetch the detail ETag and
send it as `If-Match` together with the compatibility `expectedVersion`; a stale
version is shown as a problem alert and the list is reloaded.

Opening a policy shows a record detail with tabs:

- **Overview** — policy terms, ETag, and the derived current version with its
  hash-verified flag.
- **Program** — the policy's administrative program assignment. The current
  assignment is read from the policy record and the program card shows its
  number, name, type, effective dates, status, and a link to the lead policy.
  The card also shows program-level capacity and currency, the used amount
  summed from assigned policy limits, utilization (which can exceed 100%), and
  the assigned-policy count, with a progress bar that turns red when the
  program is over capacity. With no program, the tab explains the grouping,
  offers a typeahead over `GET /api/v1/programs`, and attaches an existing
  program through `PATCH /api/v1/policies/{policyId}/program`. `Create program`
  posts a new catalog record (name, type, effective dates, optional capacity
  amount/currency, optional lead policy defaulting to the current policy) to
  `POST /api/v1/programs` and attaches it to the policy; `Detach program` clears
  the association. Assigning a program is administrative and does not change
  coverage or limits; used capacity is derived from the assigned policies'
  limits, not written onto the policy.
- **Legal entity** — the policy's issuing, licensed carrier. The current
  assignment is read from the policy record and the card shows the entity code,
  legal name, type, jurisdiction, regulator, license, and status, with a
  `Detach` action. With no entity, the tab explains that the legal entity issues
  and is licensed for the policy, offers a typeahead over
  `GET /api/v1/legal-entities`, and attaches an existing entity through
  `PATCH /api/v1/policies/{policyId}/legal-entity`. `Create legal entity` posts
  a new catalog record (code, name, type, jurisdiction, regulator, license) to
  `POST /api/v1/legal-entities` and attaches it to the policy. Reads, 404s, and
  409 conflicts stay contained in the tab; assigning a legal entity does not
  change coverage or limits.
- **Versions** — immutable version history, change type, effective window, and
  premium delta.
- **Coverages & Limits** — coverage grants with per-occurrence, aggregate,
  sublimit, deductible, coinsurance, and remaining aggregate; add a coverage and
  post an idempotent aggregate erosion fact.
- **Mass tort** — the policy-owned mass tort profile after Coverage & Limits.
  With no profile, the tab explains mass-tort administration and offers
  `Set up profile`; the form records the tort type, trigger, allocation method
  with short explanations, allocation notes, and the coverage block start/end.
  `GET`/`PUT /api/v1/policies/{policyId}/mass-tort-profile` load and replace the
  profile, and `Save draft` / `Mark complete` move it between `DRAFT` and
  `COMPLETE`. The classification fields are required to save; completion also
  requires the allocation notes and the coverage block. A saved profile renders
  its status and values, and a complete profile renders as a summary card. The
  tab contains its own loading, empty, problem, and 404 states; a 409 reloads
  the current profile before retrying.
  The context panel states that the profile guides allocation and coverage
  administration, does not change coverage or limits, and that Policy owns the
  profile while Direct Claims owns allocations.
- **Endorsements** — endorsement list and an endorse form (type, effective date,
  premium delta, coverage impact, backdate reason, approver/approval reference).
- **Insureds & Locations** — insured roles and scheduled locations with add
  forms.
- **Billing** — the policy's premium collection plan. With no plan, the tab
  explains premium collection and offers a plan form (installment count 1–24,
  frequency, first due date) that posts `POST /api/v1/policies/{policyId}/billing`.
  With a plan, it shows the total premium, paid, outstanding, and overdue
  summary plus an installment table (number, due date, amount, status, paid
  date/payment id, action). `DUE` and `OVERDUE` installments can be marked paid
  or waived through `PATCH .../billing/installments/{installmentId}`. They also
  offer **Link payment**: the modal reads
  `GET /api/v1/payments?sourceType=POLICY&sourceId=<policyId>` and lists the
  payment number, status, amount/currency, created date, and payee when
  present. Selecting a payment whose amount differs from the installment shows
  a reconciliation warning; `Apply payment` sends
  `{status: "PAID", paymentId}` and the row then shows the linked payment
  id/number. Policy never creates, executes, approves, or changes the Payment.
  The Payment hand-off for those installments builds
  `/payment?new=1&sourceType=POLICY&sourceId=…&sourceReference=<policyNumber> installment <n>&amount=…&currency=…&payeePartyId=…`
  and never creates a payment from Policy.
- **Cancellation** — cancellation history with the computed return premium, a
  cancel form, and a reinstatement form that requires approval and premium
  evidence. A `POSTED` cancellation with a positive return premium offers
  **Create credit note**, which opens the credit-note modal prefilled and locked
  to the return premium, policy currency, and `Cancellation <number> return
  premium` reason, and posts the source `cancellationId`. Once the ledger has a
  matching note the row shows **Credit note created** and links to it.
- **Renewal** — a record-header **Renew** action for `ISSUED`, `IN_FORCE`,
  `ENDORSED`, and `REINSTATED` policies (disabled with the reason otherwise).
  The modal defaults the effective date to the day after the current expiration,
  the expiration to a one-year term, and premium/limit/currencies to the current
  policy; all fields stay editable and the modal notes that coverages and limits
  are carried forward. Submitting posts
  `POST /api/v1/policies/{policyId}/renew` with `If-Match` and
  `Idempotency-Key`, refreshes the queue, selects the new record, and announces
  `Renewed as POL-…`. The successor shows `Renewed from POL-…` as a link to
  `/policy?record=<predecessorId>`; the predecessor response does not know its
  successor, so no forward link is rendered.
- **Activity** — the record's event-derived, append-only timeline, newest first,
  with event status and concise payload facts. It reads
  `GET /api/v1/events/aggregate/{policyId}?limit=50` with `X-EIA-Tenant`, loads
  when a policy is selected, and stays contained in its card when the event
  service is unavailable.

Every second-slice mutation sends the current policy ETag as `If-Match` and a
fresh `Idempotency-Key`; the returned ETag updates the header immediately.

## Local development

```powershell
npm install
npm start
```

The dev server listens on port 3002 and proxies `/api` to `http://localhost:8084`. The Policy domain and expert must be running for live data.

```powershell
npm run build
npm test
```

`npm test` runs the Playwright tests against the dev server with a mocked API, covering the page envelope, pagination links, problem bodies, and ETag/If-Match. `tests/legal-entity.spec.js` covers the Legal entity tab position and empty state, attaching a catalog entity and rendering its issuing details, the detach payload, creating an entity with all catalog fields and attaching it, create validation/rejection inside the open dialog, a missing assigned entity, a contained entity read failure with retry, and a 409 attach conflict with reload and retry. `tests/program.spec.js` covers the Program tab position and empty state, attaching a catalog program with the lead-policy link, the detach payload, capacity/used/utilization/policy-count values, the over-capacity red state, the capacity amount/currency create payload, create defaults with the current policy as lead, creating without a lead policy, create validation/rejection, attach rejection and retry, and a contained program read failure with retry. `tests/coverage.spec.js` covers the coverage/limit add and erosion flow, `tests/mass-tort.spec.js` covers the profile empty state, draft save, complete validation, existing-value load and edit, context boundary, read failure, 400 problem, and 409 reload, `tests/endorsement.spec.js` covers the endorsement flow and the 428 approval problem, `tests/activity.spec.js` covers the event-timeline path/header, ordering, empty and unavailable states, and payload facts, `tests/billing.spec.js` covers plan creation, the billing summary, mark paid/waive PATCH payloads, overdue rows, linking an existing policy payment (fetch, selection/apply payload, amount warning, empty, read failure, and 409), the Payment hand-off URL, and 409 conflicts, and `tests/renewal.spec.js` covers the action's status eligibility, modal term/premium defaults, renewal payload and headers, success selection/notice, the predecessor link, and the 409 conflict. `tests/cancellation-credit-note.spec.js` covers the cancellation
return-premium prefill, locked amount/currency/reason, `cancellationId` payload,
the created-note link and ledger source cancellation number, and 409/500
containment. `@swc/core` is pinned to `1.10.7`.

## Responsibilities

- Keep this repository focused on one deployable component or one platform concern.
- Follow the repository standard in `../CONVENTIONS.md` and the specification in `../../SPEC.md`.
- Publish and consume contracts through `eia-contracts`.
- Maintain README, CODEOWNERS, SECURITY, CHANGELOG, tests, and local verification.
- Contain no business logic in shared libraries or front-end remotes.

## Verification

- Lint and format
- Unit tests with 100% business-logic coverage where applicable
- Contract tests
- Integration or Playwright tests where applicable
- Security scan and SBOM
- Build and publish

## Notes

No business logic; all actions go through the domain service.

## License

Apache License 2.0. See [LICENSE](LICENSE) and [NOTICE](NOTICE).
