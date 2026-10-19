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

Policy federated remote: screens, widgets, record tabs, and transaction composition. Direct policy lifecycle, coverage, limits, billing, underwriting, rating, and capacity.

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
- **Versions** — immutable version history, change type, effective window, and
  premium delta.
- **Coverages & Limits** — coverage grants with per-occurrence, aggregate,
  sublimit, deductible, coinsurance, and remaining aggregate; add a coverage and
  post an idempotent aggregate erosion fact.
- **Endorsements** — endorsement list and an endorse form (type, effective date,
  premium delta, coverage impact, backdate reason, approver/approval reference).
- **Insureds & Locations** — insured roles and scheduled locations with add
  forms.
- **Cancellation** — cancellation history with the computed return premium, a
  cancel form, and a reinstatement form that requires approval and premium
  evidence.

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

`npm test` runs the Playwright tests against the dev server with a mocked API, covering the page envelope, pagination links, problem bodies, and ETag/If-Match. `tests/coverage.spec.js` covers the coverage/limit add and erosion flow, and `tests/endorsement.spec.js` covers the endorsement flow and the 428 approval problem. `@swc/core` is pinned to `1.10.7`.

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
