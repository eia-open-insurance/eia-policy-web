import { test, expect } from '@playwright/test';
import { mockPartyDetail, mockRelated } from './support.js';

const TENANT = '11111111-1111-7111-8111-111111111111';
const POLICY_ID = 'aaaaaaaa-aaaa-7aaa-8aaa-aaaaaaaaaaaa';
const INSURED_PARTY_ID = 'bbbbbbbb-bbbb-7bbb-8bbb-bbbbbbbbbbbb';
const ENTITY_ID = 'dddddddd-dddd-7ddd-8ddd-dddddddddddd';
const CREATED_ENTITY_ID = 'eeeeeeee-eeee-7eee-8eee-eeeeeeeeeeee';
const POLICY_NUMBER = 'POL-2026-0000001';

const LEGAL_ENTITY = {
  id: ENTITY_ID,
  tenantId: TENANT,
  entityCode: 'EIA-INS-US',
  legalName: 'EIA Insurance Company',
  entityType: 'INSURER',
  jurisdiction: 'US-DE',
  regulator: 'Delaware Department of Insurance',
  license: 'DOI-100245',
  status: 'ACTIVE'
};

function policy(overrides = {}) {
  return {
    id: POLICY_ID,
    tenantId: TENANT,
    policyNumber: POLICY_NUMBER,
    productCode: 'CGL',
    insuredPartyId: INSURED_PARTY_ID,
    status: 'IN_FORCE',
    effectiveDate: '2026-01-01',
    expirationDate: '2027-01-01',
    premiumAmount: '120000.0000',
    premiumCurrency: 'USD',
    limitAmount: '5000000.0000',
    limitCurrency: 'USD',
    version: 3,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...overrides
  };
}

function envelope(items) {
  return {
    items,
    page: 0,
    size: 20,
    total: items.length,
    _links: { self: { href: '/api/v1/policies?page=0&size=20' } }
  };
}

async function json(route, status, body, headers = {}) {
  await route.fulfill({
    status,
    contentType: 'application/json',
    headers,
    body: JSON.stringify(body)
  });
}

function problem(status, detail, code, errors) {
  return {
    type: `https://errors.eia-open-insurance.example/policy/${String(code || 'error').toLowerCase()}`,
    title: status === 409 ? 'Conflict' : status === 404 ? 'Not Found' : 'Bad Request',
    status,
    detail,
    code,
    category: status === 409 ? 'CONFLICT' : 'VALIDATION',
    retryable: false,
    ...(errors ? { errors } : {})
  };
}

/**
 * Mocks the policy record, the legal-entity catalog, and the policy-to-entity
 * command. GET /api/v1/legal-entities?q= serves the typeahead,
 * GET /legal-entities/{id} serves the current-entity card, POST creates, and
 * PATCH /policies/{id}/legal-entity records the association so the tab reloads.
 */
async function installMocks(page, options = {}) {
  const state = {
    policy: policy(options.withLegalEntity ? { legalEntityId: ENTITY_ID } : {}),
    legalEntities: options.legalEntities
      ? [...options.legalEntities]
      : [{ ...LEGAL_ENTITY }],
    entityGetStatus: options.entityGetStatus || 200,
    patchStatus: options.patchStatus || 200,
    patchError: options.patchError || null,
    createStatus: options.createStatus || 201,
    createError: options.createError || null,
    searches: [],
    entityGets: 0,
    posts: [],
    patches: []
  };

  await page.route('**/api/v1/policies**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const method = request.method();

    if (method === 'GET' && url.pathname === '/api/v1/policies') {
      await json(route, 200, envelope([state.policy]));
      return;
    }
    if (method === 'GET' && url.pathname === `/api/v1/policies/${POLICY_ID}`) {
      await json(route, 200, state.policy, { ETag: `"${state.policy.version}"` });
      return;
    }
    if (method === 'GET' && url.pathname === `/api/v1/policies/${POLICY_ID}/versions/current`) {
      await json(route, 200, { version: null, current: false, hashVerified: false });
      return;
    }
    if (method === 'PATCH' && url.pathname === `/api/v1/policies/${POLICY_ID}/legal-entity`) {
      const body = request.postDataJSON();
      state.patches.push({ headers: request.headers(), body });
      if (state.patchStatus >= 400) {
        await json(route, state.patchStatus, state.patchError || problem(
          state.patchStatus,
          'The legal-entity assignment could not be changed.',
          'LEGAL_ENTITY_ASSIGNMENT_FAILED'
        ));
        return;
      }
      state.policy = {
        ...state.policy,
        legalEntityId: body.legalEntityId || null,
        version: state.policy.version + 1
      };
      await json(route, 200, state.policy);
      return;
    }
    await route.fulfill({ status: 404, body: `unexpected route ${method} ${url.pathname}` });
  });

  await page.route('**/api/v1/legal-entities**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const method = request.method();

    if (method === 'GET' && url.pathname === '/api/v1/legal-entities') {
      state.searches.push({
        q: url.searchParams.get('q') || '',
        tenant: request.headers()['x-eia-tenant']
      });
      await json(route, 200, {
        items: state.legalEntities,
        page: 0,
        size: state.legalEntities.length,
        total: state.legalEntities.length
      });
      return;
    }
    if (method === 'POST' && url.pathname === '/api/v1/legal-entities') {
      const body = request.postDataJSON();
      state.posts.push({ headers: request.headers(), body });
      if (state.createStatus >= 400) {
        await json(route, state.createStatus, state.createError || problem(
          state.createStatus,
          'The legal entity could not be created.',
          'LEGAL_ENTITY_INVALID'
        ));
        return;
      }
      const created = {
        id: CREATED_ENTITY_ID,
        tenantId: TENANT,
        entityCode: body.code,
        legalName: body.name,
        entityType: body.type,
        jurisdiction: body.jurisdiction,
        regulator: body.regulator || null,
        license: body.license || null,
        status: 'ACTIVE'
      };
      state.legalEntities = [...state.legalEntities, created];
      await json(route, 201, created, { ETag: '"0"' });
      return;
    }
    if (method === 'GET' && url.pathname.startsWith('/api/v1/legal-entities/')) {
      state.entityGets += 1;
      if (state.entityGetStatus >= 400) {
        await json(route, state.entityGetStatus, problem(
          state.entityGetStatus,
          'The legal entity could not be read.',
          'LEGAL_ENTITY_UNAVAILABLE'
        ));
        return;
      }
      const legalEntityId = url.pathname.split('/').pop();
      const found = state.legalEntities.find((entry) => entry.id === legalEntityId);
      if (!found) {
        await json(route, 404, problem(
          404,
          'The legal entity was not found.',
          'LEGAL_ENTITY_NOT_FOUND'
        ));
        return;
      }
      await json(route, 200, found);
      return;
    }
    await route.fulfill({ status: 404, body: `unexpected route ${method} ${url.pathname}` });
  });

  await mockRelated(page);
  await mockPartyDetail(page);
  await page.route('**/api/v1/documents**', async (route) => {
    await json(route, 200, { items: [] });
  });
  await page.route('**/api/v1/events/**', async (route) => {
    await json(route, 200, { items: [] });
  });

  return state;
}

async function openLegalEntityTab(page) {
  await page.goto('/');
  await page.getByRole('button', { name: `Open record ${POLICY_NUMBER}` }).click();
  await expect(page.getByRole('heading', { name: POLICY_NUMBER })).toBeVisible();
  await page.getByRole('tab', { name: 'Legal entity', exact: true }).click();
}

async function chooseLegalEntity(page, name = LEGAL_ENTITY.legalName) {
  await page.getByLabel('Search legal entities by code or name…').click();
  await page.getByRole('option', { name: new RegExp(name) }).click();
}

test('places the Legal entity tab after Program and shows the no-entity state', async ({ page }) => {
  await installMocks(page);
  await openLegalEntityTab(page);

  const tabs = page.getByRole('tab');
  await expect(tabs.nth(1)).toHaveText('Program');
  await expect(tabs.nth(2)).toHaveText('Legal entity');

  const empty = page.getByTestId('legal-entity-empty');
  await expect(empty).toBeVisible();
  await expect(empty).toContainText('No legal entity assigned');
  await expect(empty).toContainText('licensed carrier');
  await expect(empty).toContainText('coverage,');
  await expect(page.getByTestId('legal-entity-current')).toHaveCount(0);
  await expect(page.getByTestId('legal-entity-attach')).toBeVisible();
  await expect(page.getByTestId('create-legal-entity')).toBeEnabled();

  const context = page.getByTestId('legal-entity-context');
  await expect(context).toContainText('issuing, licensed carrier');
  await expect(context).toContainText('does not change coverage or limits');
  await expect(context).toContainText('Billing, tax, and regulatory reporting');
});

test('attaches an existing legal entity and shows its issuing details', async ({ page }) => {
  const state = await installMocks(page);
  await openLegalEntityTab(page);

  await chooseLegalEntity(page);
  await expect(page.getByTestId('legal-entity-attach-selection')).toContainText(
    'EIA Insurance Company'
  );
  await expect(page.getByTestId('attach-legal-entity')).toBeEnabled();
  await page.getByTestId('attach-legal-entity').click();

  await expect(page.getByRole('status')).toContainText(
    `Attached legal entity EIA Insurance Company to ${POLICY_NUMBER}.`
  );

  const current = page.getByTestId('legal-entity-current');
  await expect(current).toBeVisible();
  await expect(page.getByTestId('legal-entity-value-code')).toHaveText('EIA-INS-US');
  await expect(page.getByTestId('legal-entity-value-name')).toHaveText('EIA Insurance Company');
  await expect(page.getByTestId('legal-entity-value-type')).toHaveText('Insurer');
  await expect(page.getByTestId('legal-entity-value-jurisdiction')).toHaveText('US-DE');
  await expect(page.getByTestId('legal-entity-value-regulator')).toHaveText(
    'Delaware Department of Insurance'
  );
  await expect(page.getByTestId('legal-entity-value-license')).toHaveText('DOI-100245');
  await expect(page.getByTestId('legal-entity-value-status')).toHaveText('ACTIVE');
  await expect(page.getByTestId('legal-entity-status')).toHaveText('ACTIVE');
  await expect(page.getByTestId('legal-entity-empty')).toHaveCount(0);

  expect(state.patches).toHaveLength(1);
  expect(state.patches[0].body).toEqual({ legalEntityId: ENTITY_ID });
  expect(state.patches[0].headers['x-eia-tenant']).toBe(TENANT);
  expect(state.patches[0].headers['content-type']).toBe('application/json');

  expect(state.searches[0].tenant).toBe(TENANT);
  expect(state.searches[0].q).toBe('');
  expect(state.entityGets).toBe(1);
});

test('detaches the current legal entity without touching the rest of the policy', async ({ page }) => {
  const state = await installMocks(page, { withLegalEntity: true });
  await openLegalEntityTab(page);

  await expect(page.getByTestId('legal-entity-current')).toBeVisible();
  await expect(page.getByTestId('legal-entity-value-name')).toHaveText('EIA Insurance Company');

  await page.getByTestId('detach-legal-entity').click();

  await expect(page.getByRole('status')).toContainText(
    'Detached legal entity EIA Insurance Company.'
  );
  await expect(page.getByTestId('legal-entity-empty')).toBeVisible();
  await expect(page.getByTestId('legal-entity-current')).toHaveCount(0);
  expect(state.policy.legalEntityId).toBeNull();
  expect(state.policy.premiumAmount).toBe('120000.0000');
  expect(state.policy.limitAmount).toBe('5000000.0000');
  expect(state.patches).toHaveLength(1);
  expect(state.patches[0].body).toEqual({ legalEntityId: null });
});

test('creates a legal entity from the catalog fields and attaches it', async ({ page }) => {
  const state = await installMocks(page);
  await openLegalEntityTab(page);

  await page.getByTestId('create-legal-entity').click();
  const dialog = page.getByTestId('legal-entity-dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('Create legal entity');
  await expect(page.getByLabel('Entity type')).toHaveValue('');

  await page.getByLabel('Entity code').fill('EIA-INS-CA');
  await page.getByLabel('Legal name').fill('EIA Insurance Company of California');
  await page.getByLabel('Entity type').selectOption('INSURER');
  await page.getByLabel('Jurisdiction').fill('US-CA');
  await page.getByLabel('Regulator').fill('California Department of Insurance');
  await page.getByLabel('License').fill('CA-778899');
  await page.getByTestId('submit-legal-entity').click();

  await expect(page.getByTestId('legal-entity-dialog')).toHaveCount(0);
  await expect(page.getByRole('status')).toContainText(
    'Created legal entity EIA Insurance Company of California and attached it to '
    + `${POLICY_NUMBER}.`
  );

  await expect(page.getByTestId('legal-entity-current')).toBeVisible();
  await expect(page.getByTestId('legal-entity-value-code')).toHaveText('EIA-INS-CA');
  await expect(page.getByTestId('legal-entity-value-name')).toHaveText(
    'EIA Insurance Company of California'
  );
  await expect(page.getByTestId('legal-entity-value-type')).toHaveText('Insurer');
  await expect(page.getByTestId('legal-entity-value-jurisdiction')).toHaveText('US-CA');
  await expect(page.getByTestId('legal-entity-value-regulator')).toHaveText(
    'California Department of Insurance'
  );
  await expect(page.getByTestId('legal-entity-value-license')).toHaveText('CA-778899');
  await expect(page.getByTestId('legal-entity-value-status')).toHaveText('ACTIVE');

  expect(state.posts).toHaveLength(1);
  expect(state.posts[0].body).toEqual({
    code: 'EIA-INS-CA',
    name: 'EIA Insurance Company of California',
    type: 'INSURER',
    jurisdiction: 'US-CA',
    regulator: 'California Department of Insurance',
    license: 'CA-778899'
  });
  expect(state.posts[0].headers['idempotency-key']).toBeTruthy();
  expect(state.posts[0].headers['x-eia-tenant']).toBe(TENANT);
  expect(state.patches).toHaveLength(1);
  expect(state.patches[0].body).toEqual({ legalEntityId: CREATED_ENTITY_ID });
});

test('validates the create form and keeps the dialog open when the catalog rejects the entity', async ({ page }) => {
  const state = await installMocks(page, {
    createStatus: 400,
    createError: problem(
      400,
      'The legal entity could not be created.',
      'LEGAL_ENTITY_INVALID',
      [{ field: 'code', message: 'is already used by another legal entity' }]
    )
  });
  await openLegalEntityTab(page);

  await page.getByTestId('create-legal-entity').click();
  await page.getByTestId('submit-legal-entity').click();
  await expect(page.getByTestId('legal-entity-form-error')).toHaveText(
    'Enter the legal entity code before creating the legal entity.'
  );
  expect(state.posts).toHaveLength(0);

  await page.getByLabel('Entity code').fill('EIA-INS-US');
  await page.getByLabel('Legal name').fill('Duplicate Carrier');
  await page.getByLabel('Entity type').selectOption('INSURER');
  await page.getByLabel('Jurisdiction').fill('US-DE');
  await page.getByTestId('submit-legal-entity').click();

  const formError = page.getByTestId('legal-entity-form-error');
  await expect(formError).toContainText('The legal entity could not be created.');
  await expect(formError).toContainText('code: is already used by another legal entity');
  await expect(page.getByTestId('legal-entity-dialog')).toBeVisible();
  await expect(page.getByLabel('Entity code')).toHaveValue('EIA-INS-US');
  expect(state.posts).toHaveLength(1);
  expect(state.patches).toHaveLength(0);

  state.createStatus = 201;
  await page.getByTestId('submit-legal-entity').click();
  await expect(page.getByTestId('legal-entity-dialog')).toHaveCount(0);
  await expect(page.getByTestId('legal-entity-current')).toBeVisible();
  await expect(page.getByTestId('legal-entity-value-name')).toHaveText('Duplicate Carrier');
  expect(state.posts).toHaveLength(2);
  expect(state.patches).toHaveLength(1);
});

test('contains a missing assigned legal entity inside the tab', async ({ page }) => {
  await installMocks(page, { withLegalEntity: true, entityGetStatus: 404 });
  await openLegalEntityTab(page);

  const tab = page.getByRole('tabpanel', { name: 'Legal entity' });
  await expect(tab.getByRole('alert')).toContainText(
    'The assigned legal entity could not be found.'
  );
  await expect(page.getByTestId('legal-entity-empty')).toHaveCount(0);
  await expect(page.getByTestId('legal-entity-current')).toHaveCount(0);
});

test('contains a legal-entity read failure in the tab and retries', async ({ page }) => {
  const state = await installMocks(page, { withLegalEntity: true, entityGetStatus: 503 });
  await openLegalEntityTab(page);

  const tab = page.getByRole('tabpanel', { name: 'Legal entity' });
  await expect(tab.getByRole('alert')).toContainText('Legal entity is temporarily unavailable.');
  await expect(page.getByTestId('legal-entity-empty')).toHaveCount(0);
  await expect(page.getByTestId('legal-entity-current')).toHaveCount(0);
  expect(state.entityGets).toBe(1);

  state.entityGetStatus = 200;
  await page.getByRole('button', { name: 'Retry' }).click();

  await expect(page.getByTestId('legal-entity-current')).toBeVisible();
  await expect(page.getByTestId('legal-entity-value-code')).toHaveText('EIA-INS-US');
  expect(state.entityGets).toBe(2);
});

test('shows a 409 attach conflict inside the tab, reloads, and allows a retry', async ({ page }) => {
  const state = await installMocks(page, {
    patchStatus: 409,
    patchError: problem(
      409,
      'The policy was changed by another user.',
      'POLICY_VERSION_CONFLICT',
      [{ field: 'legalEntityId', message: 'assignment changed since it was read' }]
    )
  });
  await openLegalEntityTab(page);

  await chooseLegalEntity(page);
  await page.getByTestId('attach-legal-entity').click();

  const conflict = page.getByTestId('legal-entity-conflict');
  await expect(conflict).toContainText('The policy was changed by another user.');
  await expect(conflict).toContainText('legalEntityId: assignment changed since it was read');
  await expect(page.getByTestId('legal-entity-empty')).toBeVisible();
  await expect(page.getByTestId('legal-entity-current')).toHaveCount(0);
  await expect(page.getByTestId('attach-legal-entity')).toBeEnabled();
  expect(state.patches).toHaveLength(1);

  state.patchStatus = 200;
  await page.getByTestId('attach-legal-entity').click();

  await expect(page.getByTestId('legal-entity-current')).toBeVisible();
  await expect(page.getByTestId('legal-entity-value-name')).toHaveText('EIA Insurance Company');
  await expect(page.getByTestId('legal-entity-conflict')).toHaveCount(0);
  expect(state.patches).toHaveLength(2);
  expect(state.patches[1].body).toEqual({ legalEntityId: ENTITY_ID });
});
