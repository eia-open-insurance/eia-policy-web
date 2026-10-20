import { test, expect } from '@playwright/test';
import { mockPartyDetail, mockRelated } from './support.js';

const TENANT = '11111111-1111-7111-8111-111111111111';
const POLICY_ID = 'aaaaaaaa-aaaa-7aaa-8aaa-aaaaaaaaaaaa';
const INSURED_PARTY_ID = 'bbbbbbbb-bbbb-7bbb-8bbb-bbbbbbbbbbbb';
const PROGRAM_ID = 'dddddddd-dddd-7ddd-8ddd-dddddddddddd';
const CREATED_PROGRAM_ID = 'eeeeeeee-eeee-7eee-8eee-eeeeeeeeeeee';
const LEAD_POLICY_ID = 'ffffffff-ffff-7fff-8fff-ffffffffffff';
const POLICY_NUMBER = 'POL-2026-0000001';
const LEAD_POLICY_NUMBER = 'POL-2026-0000009';

const PROGRAM = {
  id: PROGRAM_ID,
  tenantId: TENANT,
  programNumber: 'PRG-2026-0001',
  name: 'Tower Casualty Program',
  programType: 'CASUALTY',
  effectiveFrom: '2026-01-01',
  effectiveTo: '2027-12-31',
  status: 'ACTIVE',
  leadPolicyId: LEAD_POLICY_ID,
  leadPolicyNumber: LEAD_POLICY_NUMBER,
  description: 'Casualty tower for the 2026 program year.'
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
 * Mocks the policy record, the program catalog, and the policy-to-program
 * command. GET /api/v1/programs?q= serves the typeahead, GET /programs/{id}
 * serves the current-program card, POST /programs creates, and PATCH
 * /policies/{id}/program records the association so the tab can reload it.
 */
async function installMocks(page, options = {}) {
  const state = {
    policy: policy(options.withProgram ? { programId: PROGRAM_ID } : {}),
    programs: options.programs ? [...options.programs] : [{ ...PROGRAM }],
    programGetStatus: options.programGetStatus || 200,
    patchStatus: options.patchStatus || 200,
    patchError: options.patchError || null,
    createStatus: options.createStatus || 201,
    createError: options.createError || null,
    searches: [],
    programGets: 0,
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
    if (method === 'GET' && url.pathname === `/api/v1/policies/${LEAD_POLICY_ID}`) {
      await json(route, 200, policy({
        id: LEAD_POLICY_ID,
        policyNumber: LEAD_POLICY_NUMBER
      }));
      return;
    }
    if (method === 'GET' && url.pathname === `/api/v1/policies/${POLICY_ID}/versions/current`) {
      await json(route, 200, { version: null, current: false, hashVerified: false });
      return;
    }
    if (method === 'PATCH' && url.pathname === `/api/v1/policies/${POLICY_ID}/program`) {
      const body = request.postDataJSON();
      state.patches.push({ headers: request.headers(), body });
      if (state.patchStatus >= 400) {
        await json(route, state.patchStatus, state.patchError || problem(
          state.patchStatus,
          'The program assignment could not be changed.',
          'PROGRAM_ASSIGNMENT_FAILED'
        ));
        return;
      }
      state.policy = {
        ...state.policy,
        programId: body.programId || null,
        version: state.policy.version + 1
      };
      await json(route, 200, state.policy);
      return;
    }
    await route.fulfill({ status: 404, body: `unexpected route ${method} ${url.pathname}` });
  });

  await page.route('**/api/v1/programs**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const method = request.method();

    if (method === 'GET' && url.pathname === '/api/v1/programs') {
      state.searches.push({
        q: url.searchParams.get('q') || '',
        tenant: request.headers()['x-eia-tenant']
      });
      await json(route, 200, {
        items: state.programs,
        page: 0,
        size: state.programs.length,
        total: state.programs.length
      });
      return;
    }
    if (method === 'POST' && url.pathname === '/api/v1/programs') {
      const body = request.postDataJSON();
      state.posts.push({ headers: request.headers(), body });
      if (state.createStatus >= 400) {
        await json(route, state.createStatus, state.createError || problem(
          state.createStatus,
          'The program could not be created.',
          'PROGRAM_INVALID'
        ));
        return;
      }
      const created = {
        id: CREATED_PROGRAM_ID,
        tenantId: TENANT,
        programNumber: 'PRG-2026-0002',
        name: body.name,
        programType: body.programType,
        effectiveFrom: body.effectiveFrom,
        effectiveTo: body.effectiveTo,
        status: 'ACTIVE',
        leadPolicyId: body.leadPolicyId || null,
        leadPolicyNumber: body.leadPolicyId ? POLICY_NUMBER : null
      };
      state.programs = [...state.programs, created];
      await json(route, 201, created, { ETag: '"0"' });
      return;
    }
    if (method === 'GET' && url.pathname.startsWith('/api/v1/programs/')) {
      state.programGets += 1;
      if (state.programGetStatus >= 400) {
        await json(route, state.programGetStatus, problem(
          state.programGetStatus,
          'The program could not be read.',
          'PROGRAM_UNAVAILABLE'
        ));
        return;
      }
      const programId = url.pathname.split('/').pop();
      const found = state.programs.find((entry) => entry.id === programId);
      if (!found) {
        await json(route, 404, problem(404, 'The program was not found.', 'PROGRAM_NOT_FOUND'));
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

async function openProgramTab(page) {
  await page.goto('/');
  await page.getByRole('button', { name: `Open record ${POLICY_NUMBER}` }).click();
  await expect(page.getByRole('heading', { name: POLICY_NUMBER })).toBeVisible();
  await page.getByRole('tab', { name: 'Program', exact: true }).click();
}

async function chooseProgram(page, name = PROGRAM.name) {
  await page.getByLabel('Search programs by number or name…').click();
  await page.getByRole('option', { name: new RegExp(name) }).click();
}

test('places the Program tab after Overview and shows the no-program state', async ({ page }) => {
  await installMocks(page);
  await openProgramTab(page);

  const tabs = page.getByRole('tab');
  await expect(tabs.nth(0)).toHaveText('Overview');
  await expect(tabs.nth(1)).toHaveText('Program');

  const empty = page.getByTestId('program-empty');
  await expect(empty).toBeVisible();
  await expect(empty).toContainText('No program assigned');
  await expect(empty).toContainText('groups related policies');
  await expect(empty).toContainText('coverage, limits, premium');
  await expect(page.getByTestId('program-current')).toHaveCount(0);
  await expect(page.getByTestId('program-attach')).toBeVisible();
  await expect(page.getByTestId('create-program')).toBeEnabled();

  const context = page.getByTestId('program-context');
  await expect(context).toContainText(
    'groups related policies for capacity and aggregate administration'
  );
  await expect(context).toContainText('does not change coverage or limits');
  await expect(context).toContainText('Capacity, coinsurance, and fronting stay separate');
});

test('attaches an existing program from the catalog and links its lead policy', async ({ page }) => {
  const state = await installMocks(page);
  await openProgramTab(page);

  await chooseProgram(page);
  await expect(page.getByTestId('program-attach-selection')).toContainText(
    'Tower Casualty Program'
  );
  await expect(page.getByTestId('attach-program')).toBeEnabled();
  await page.getByTestId('attach-program').click();

  await expect(page.getByRole('status')).toContainText(
    `Attached program Tower Casualty Program to ${POLICY_NUMBER}.`
  );

  const current = page.getByTestId('program-current');
  await expect(current).toBeVisible();
  await expect(page.getByTestId('program-value-number')).toHaveText('PRG-2026-0001');
  await expect(page.getByTestId('program-value-name')).toHaveText('Tower Casualty Program');
  await expect(page.getByTestId('program-value-type')).toHaveText('Casualty');
  await expect(page.getByTestId('program-value-effective-from')).toHaveText('2026-01-01');
  await expect(page.getByTestId('program-value-effective-to')).toHaveText('2027-12-31');
  await expect(page.getByTestId('program-value-status')).toHaveText('ACTIVE');
  await expect(page.getByTestId('program-status')).toHaveText('ACTIVE');
  await expect(page.getByTestId('program-empty')).toHaveCount(0);

  const leadLink = page.getByTestId('program-lead-policy-link');
  await expect(leadLink).toHaveText(LEAD_POLICY_NUMBER);
  await expect(leadLink).toHaveAttribute('href', `/policy?record=${LEAD_POLICY_ID}`);

  expect(state.patches).toHaveLength(1);
  expect(state.patches[0].body).toEqual({ programId: PROGRAM_ID });
  expect(state.patches[0].headers['x-eia-tenant']).toBe(TENANT);
  expect(state.patches[0].headers['content-type']).toBe('application/json');

  expect(state.searches[0].tenant).toBe(TENANT);
  expect(state.searches[0].q).toBe('');
  expect(state.programGets).toBe(1);
});

test('detaches the current program without touching the rest of the policy', async ({ page }) => {
  const state = await installMocks(page, { withProgram: true });
  await openProgramTab(page);

  await expect(page.getByTestId('program-current')).toBeVisible();
  await expect(page.getByTestId('program-value-name')).toHaveText('Tower Casualty Program');
  await expect(page.getByTestId('program-value-lead-policy')).toContainText(LEAD_POLICY_NUMBER);

  await page.getByTestId('detach-program').click();

  await expect(page.getByRole('status')).toContainText(
    'Detached program Tower Casualty Program.'
  );
  await expect(page.getByTestId('program-empty')).toBeVisible();
  await expect(page.getByTestId('program-current')).toHaveCount(0);
  await expect(page.getByTestId('program-value-name')).toHaveCount(0);
  expect(state.policy.programId).toBeNull();
  expect(state.patches).toHaveLength(1);
  expect(state.patches[0].body).toEqual({ programId: null });
});

test('creates a program with the policy as the default lead and attaches it', async ({ page }) => {
  const state = await installMocks(page);
  await openProgramTab(page);

  await page.getByTestId('create-program').click();
  const dialog = page.getByTestId('program-dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('Create program');
  await expect(page.getByLabel('Effective from')).toHaveValue('2026-01-01');
  await expect(page.getByLabel('Effective to')).toHaveValue('2027-01-01');
  const leadToggle = page.getByLabel(
    new RegExp(`Use ${POLICY_NUMBER} as the program's lead policy`)
  );
  await expect(leadToggle).toBeChecked();

  await page.getByLabel('Program name').fill('Asbestos Tower 2026');
  await page.getByLabel('Program type').selectOption('CASUALTY');
  await page.getByLabel('Effective from').fill('2026-02-01');
  await page.getByLabel('Effective to').fill('2027-01-31');
  await page.getByTestId('submit-program').click();

  await expect(page.getByTestId('program-dialog')).toHaveCount(0);
  await expect(page.getByRole('status')).toContainText(
    `Created program Asbestos Tower 2026 and attached it to ${POLICY_NUMBER}.`
  );

  await expect(page.getByTestId('program-current')).toBeVisible();
  await expect(page.getByTestId('program-value-number')).toHaveText('PRG-2026-0002');
  await expect(page.getByTestId('program-value-name')).toHaveText('Asbestos Tower 2026');
  await expect(page.getByTestId('program-value-type')).toHaveText('Casualty');
  await expect(page.getByTestId('program-value-effective-from')).toHaveText('2026-02-01');
  await expect(page.getByTestId('program-value-effective-to')).toHaveText('2027-01-31');
  await expect(page.getByTestId('program-value-lead-policy')).toContainText(POLICY_NUMBER);

  expect(state.posts).toHaveLength(1);
  expect(state.posts[0].body).toEqual({
    name: 'Asbestos Tower 2026',
    programType: 'CASUALTY',
    effectiveFrom: '2026-02-01',
    effectiveTo: '2027-01-31',
    leadPolicyId: POLICY_ID
  });
  expect(state.posts[0].headers['idempotency-key']).toBeTruthy();
  expect(state.posts[0].headers['x-eia-tenant']).toBe(TENANT);
  expect(state.patches).toHaveLength(1);
  expect(state.patches[0].body).toEqual({ programId: CREATED_PROGRAM_ID });
});

test('creates a program without a lead policy when the default is cleared', async ({ page }) => {
  const state = await installMocks(page);
  await openProgramTab(page);

  await page.getByTestId('create-program').click();
  await page.getByLabel('Program name').fill('Standalone Property Program');
  await page.getByLabel('Program type').selectOption('PROPERTY');
  await page.getByLabel(
    new RegExp(`Use ${POLICY_NUMBER} as the program's lead policy`)
  ).uncheck();
  await page.getByTestId('submit-program').click();

  await expect(page.getByTestId('program-dialog')).toHaveCount(0);
  expect(state.posts).toHaveLength(1);
  expect(state.posts[0].body).toEqual({
    name: 'Standalone Property Program',
    programType: 'PROPERTY',
    effectiveFrom: '2026-01-01',
    effectiveTo: '2027-01-01'
  });
  expect(state.posts[0].body.leadPolicyId).toBeUndefined();
});

test('validates and keeps the create dialog open when the catalog rejects the program', async ({ page }) => {
  const state = await installMocks(page, {
    createStatus: 400,
    createError: problem(
      400,
      'The program could not be created.',
      'PROGRAM_INVALID',
      [{ field: 'name', message: 'is already used by another program' }]
    )
  });
  await openProgramTab(page);

  await page.getByTestId('create-program').click();
  await page.getByTestId('submit-program').click();
  await expect(page.getByTestId('program-form-error')).toHaveText(
    'Enter the program name before creating the program.'
  );
  expect(state.posts).toHaveLength(0);

  await page.getByLabel('Program name').fill('Duplicate Program');
  await page.getByLabel('Program type').selectOption('SPECIALTY');
  await page.getByTestId('submit-program').click();

  const formError = page.getByTestId('program-form-error');
  await expect(formError).toContainText('The program could not be created.');
  await expect(formError).toContainText('name: is already used by another program');
  await expect(page.getByTestId('program-dialog')).toBeVisible();
  await expect(page.getByLabel('Program name')).toHaveValue('Duplicate Program');
  expect(state.posts).toHaveLength(1);
  expect(state.patches).toHaveLength(0);

  state.createStatus = 201;
  await page.getByTestId('submit-program').click();
  await expect(page.getByTestId('program-dialog')).toHaveCount(0);
  await expect(page.getByTestId('program-current')).toBeVisible();
  await expect(page.getByTestId('program-value-name')).toHaveText('Duplicate Program');
  expect(state.posts).toHaveLength(2);
  expect(state.patches).toHaveLength(1);
});

test('shows an attach rejection inside the attach card and allows a retry', async ({ page }) => {
  const state = await installMocks(page, {
    patchStatus: 400,
    patchError: problem(
      400,
      'The program is inactive.',
      'PROGRAM_INACTIVE',
      [{ field: 'programId', message: 'must reference an active program' }]
    )
  });
  await openProgramTab(page);

  await chooseProgram(page);
  await page.getByTestId('attach-program').click();

  const attachError = page.getByTestId('program-attach-error');
  await expect(attachError).toContainText('The program is inactive.');
  await expect(attachError).toContainText('programId: must reference an active program');
  await expect(page.getByTestId('program-empty')).toBeVisible();
  await expect(page.getByTestId('program-current')).toHaveCount(0);
  await expect(page.getByTestId('attach-program')).toBeEnabled();
  expect(state.patches).toHaveLength(1);

  state.patchStatus = 200;
  await page.getByTestId('attach-program').click();
  await expect(page.getByTestId('program-current')).toBeVisible();
  await expect(page.getByTestId('program-attach-error')).toHaveCount(0);
  expect(state.patches).toHaveLength(2);
  expect(state.patches[1].body).toEqual({ programId: PROGRAM_ID });
});

test('contains a program read failure in the tab and retries', async ({ page }) => {
  const state = await installMocks(page, { withProgram: true, programGetStatus: 503 });
  await openProgramTab(page);

  const tab = page.getByRole('tabpanel', { name: 'Program' });
  await expect(tab.getByRole('alert')).toContainText('Program is temporarily unavailable.');
  await expect(page.getByTestId('program-empty')).toHaveCount(0);
  await expect(page.getByTestId('program-current')).toHaveCount(0);
  expect(state.programGets).toBe(1);

  state.programGetStatus = 200;
  await page.getByRole('button', { name: 'Retry' }).click();

  await expect(page.getByTestId('program-current')).toBeVisible();
  await expect(page.getByTestId('program-value-number')).toHaveText('PRG-2026-0001');
  expect(state.programGets).toBe(2);
});
