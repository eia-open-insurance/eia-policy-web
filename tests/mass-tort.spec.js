import { test, expect } from '@playwright/test';
import { mockPartyDetail, mockRelated } from './support.js';

const TENANT = '11111111-1111-7111-8111-111111111111';
const POLICY_ID = 'aaaaaaaa-aaaa-7aaa-8aaa-aaaaaaaaaaaa';
const INSURED_PARTY_ID = 'bbbbbbbb-bbbb-7bbb-8bbb-bbbbbbbbbbbb';
const PROFILE_ID = 'cccccccc-cccc-7ccc-8ccc-cccccccccccc';

const POLICY = {
  id: POLICY_ID,
  tenantId: TENANT,
  policyNumber: 'POL-2026-0000001',
  productCode: 'CGL',
  insuredPartyId: INSURED_PARTY_ID,
  status: 'IN_FORCE',
  effectiveDate: '2026-01-01',
  expirationDate: '2027-01-01',
  premiumAmount: '120000.0000',
  premiumCurrency: 'USD',
  limitAmount: '5000000.0000',
  limitCurrency: 'USD',
  version: 4,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z'
};

const DRAFT_PROFILE = {
  profileId: PROFILE_ID,
  tenantId: TENANT,
  policyId: POLICY_ID,
  tortType: 'ASBESTOS',
  triggerType: 'EXPOSURE',
  allocationMethod: 'ALL_SUMS',
  allocationNotes: 'Allocate to the policy year with the highest remaining limit.',
  coverageBlockStart: '1975-01-01',
  coverageBlockEnd: '1985-12-31',
  status: 'DRAFT',
  updatedAt: '2026-10-20T09:00:00Z'
};

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
 * Mocks the policy record and the mass tort profile API. GET returns 404 while
 * `state.profile` is null (the tab's empty state); PUT records the request and
 * persists the body so a successful save is visible without another read.
 */
async function installMocks(page, options = {}) {
  const state = {
    profile: options.profile ? { ...options.profile } : null,
    requests: [],
    puts: [],
    gets: 0,
    getStatus: options.getStatus || 200,
    putStatus: options.putStatus || 200,
    putError: options.putError || null,
    onPut: options.onPut || null
  };

  await page.route('**/api/v1/policies**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const method = request.method();

    if (method === 'GET' && url.pathname === '/api/v1/policies') {
      await json(route, 200, envelope([POLICY]));
      return;
    }
    if (method === 'GET' && url.pathname === `/api/v1/policies/${POLICY_ID}`) {
      await json(route, 200, POLICY, { ETag: '"4"' });
      return;
    }
    if (method === 'GET' && url.pathname === `/api/v1/policies/${POLICY_ID}/versions/current`) {
      await json(route, 200, { version: null, current: false, hashVerified: false });
      return;
    }
    if (url.pathname === `/api/v1/policies/${POLICY_ID}/mass-tort-profile`) {
      state.requests.push({
        method,
        path: url.pathname,
        tenant: request.headers()['x-eia-tenant'],
        contentType: request.headers()['content-type']
      });
      if (method === 'GET') {
        state.gets += 1;
        if (state.getStatus >= 400) {
          await json(route, state.getStatus, problem(
            state.getStatus,
            'The mass tort profile could not be read.',
            'MASS_TORT_PROFILE_UNAVAILABLE'
          ));
          return;
        }
        if (!state.profile) {
          await json(route, 404, problem(
            404,
            'No mass tort profile has been set up for this policy.',
            'MASS_TORT_PROFILE_NOT_FOUND'
          ));
          return;
        }
        await json(route, 200, state.profile);
        return;
      }
      if (method === 'PUT') {
        const body = request.postDataJSON();
        state.puts.push({ headers: request.headers(), body });
        if (state.onPut) state.onPut(state);
        if (state.putStatus >= 400) {
          await json(route, state.putStatus, state.putError || problem(
            state.putStatus,
            'The mass tort profile could not be saved.',
            'MASS_TORT_PROFILE_INVALID'
          ));
          return;
        }
        state.profile = {
          ...DRAFT_PROFILE,
          ...body,
          profileId: PROFILE_ID,
          tenantId: TENANT,
          policyId: POLICY_ID,
          updatedAt: '2026-10-20T12:00:00Z'
        };
        await json(route, 200, state.profile);
        return;
      }
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

async function openMassTortTab(page) {
  await page.goto('/');
  await page.getByRole('button', { name: `Open record ${POLICY.policyNumber}` }).click();
  await expect(page.getByRole('heading', { name: POLICY.policyNumber })).toBeVisible();
  await page.getByRole('tab', { name: 'Mass tort', exact: true }).click();
}

async function fillProfile(page) {
  await page.getByLabel('Tort type').selectOption('TALC');
  await page.getByLabel('Trigger').selectOption('MANIFESTATION');
  await page.getByLabel('Allocation method').selectOption('PRO_RATA_TIME_ON_RISK');
  await page.getByLabel('Allocation notes').fill(
    'Allocate by years of cosmetic talc use; review the matrix annually.'
  );
  await page.getByLabel('Coverage block start').fill('1978-01-01');
  await page.getByLabel('Coverage block end').fill('1985-12-31');
}

test('shows the not-set state, explains mass tort administration, and opens setup', async ({ page }) => {
  const state = await installMocks(page);
  await openMassTortTab(page);

  const empty = page.getByTestId('mass-tort-empty');
  await expect(empty).toBeVisible();
  await expect(empty).toContainText('Mass tort profile not set');
  await expect(empty).toContainText('guide long-tail claim administration');
  await expect(empty).toContainText('Direct Claims');
  await expect(empty).toContainText('does not change coverage, limits, premium');
  await expect(page.getByTestId('mass-tort-form')).toHaveCount(0);

  await page.getByRole('button', { name: 'Set up profile' }).click();

  const form = page.getByTestId('mass-tort-form');
  await expect(form).toBeVisible();
  await expect(page.getByTestId('mass-tort-empty')).toHaveCount(0);
  await expect(page.getByLabel('Tort type')).toHaveValue('');
  await expect(page.getByLabel('Trigger')).toHaveValue('');
  await expect(page.getByLabel('Allocation method')).toHaveValue('');
  await expect(page.getByLabel('Coverage block start')).toHaveValue('2026-01-01');
  await expect(page.getByLabel('Coverage block end')).toHaveValue('2027-01-01');

  await page.getByRole('button', { name: 'Save draft', exact: true }).click();
  await expect(page.getByTestId('mass-tort-form-error')).toHaveText(
    'Select a tort type before saving the profile.'
  );
  expect(state.puts).toHaveLength(0);

  expect(state.gets).toBe(1);
  expect(state.requests[0]).toMatchObject({
    method: 'GET',
    path: `/api/v1/policies/${POLICY_ID}/mass-tort-profile`,
    tenant: TENANT
  });
});

test('saves a draft profile with the selected values', async ({ page }) => {
  const state = await installMocks(page);
  await openMassTortTab(page);
  await page.getByRole('button', { name: 'Set up profile' }).click();

  await fillProfile(page);
  await expect(page.getByTestId('mass-tort-allocation-help')).toContainText(
    'time the insured was exposed'
  );
  await page.getByRole('button', { name: 'Save draft', exact: true }).click();

  await expect(page.getByTestId('mass-tort-notice')).toHaveText(
    'Mass tort profile saved as draft.'
  );
  await expect(page.getByTestId('mass-tort-status')).toHaveText('DRAFT');
  await expect(page.getByTestId('mass-tort-value-tort')).toHaveText('Talc');
  await expect(page.getByTestId('mass-tort-value-trigger')).toHaveText('Manifestation');
  await expect(page.getByTestId('mass-tort-value-allocation')).toHaveText(
    'Pro rata — time on risk'
  );
  await expect(page.getByTestId('mass-tort-value-block')).toHaveText(
    '1978-01-01 – 1985-12-31'
  );
  await expect(page.getByTestId('mass-tort-value-notes')).toContainText(
    'Allocate by years of cosmetic talc use'
  );

  expect(state.puts).toHaveLength(1);
  expect(state.puts[0].body).toEqual({
    tortType: 'TALC',
    triggerType: 'MANIFESTATION',
    allocationMethod: 'PRO_RATA_TIME_ON_RISK',
    allocationNotes: 'Allocate by years of cosmetic talc use; review the matrix annually.',
    coverageBlockStart: '1978-01-01',
    coverageBlockEnd: '1985-12-31',
    status: 'DRAFT'
  });
  expect(state.puts[0].headers['x-eia-tenant']).toBe(TENANT);
  expect(state.puts[0].headers['content-type']).toBe('application/json');
  expect(state.gets).toBe(1);
});

test('validates a complete profile, rejects a reversed block, then marks it complete', async ({ page }) => {
  const state = await installMocks(page);
  await openMassTortTab(page);
  await page.getByRole('button', { name: 'Set up profile' }).click();

  await page.getByRole('button', { name: 'Mark complete', exact: true }).click();
  await expect(page.getByTestId('mass-tort-form-error')).toHaveText(
    'Select a tort type before marking the profile complete.'
  );
  expect(state.puts).toHaveLength(0);

  await page.getByLabel('Tort type').selectOption('PFAS');
  await page.getByLabel('Trigger').selectOption('REVISIONIST');
  await page.getByLabel('Allocation method').selectOption('STACKED_LIMITS');
  await page.getByLabel('Coverage block start').fill('1990-01-01');
  await page.getByLabel('Coverage block end').fill('2001-12-31');
  await page.getByRole('button', { name: 'Mark complete', exact: true }).click();
  await expect(page.getByTestId('mass-tort-form-error')).toHaveText(
    'Enter allocation notes before marking the profile complete.'
  );
  expect(state.puts).toHaveLength(0);

  await page.getByLabel('Allocation notes').fill(
    'Stack the triggered years in sequence and record any agreed exceptions.'
  );
  await page.getByLabel('Coverage block end').fill('1980-01-01');
  await page.getByRole('button', { name: 'Mark complete', exact: true }).click();
  await expect(page.getByTestId('mass-tort-form-error')).toHaveText(
    'Coverage block end must be on or after the coverage block start.'
  );
  expect(state.puts).toHaveLength(0);

  await page.getByLabel('Coverage block end').fill('2001-12-31');
  await page.getByRole('button', { name: 'Mark complete', exact: true }).click();

  await expect(page.getByTestId('mass-tort-notice')).toHaveText(
    'Mass tort profile marked complete.'
  );
  await expect(page.getByTestId('mass-tort-status')).toHaveText('COMPLETE');
  await expect(page.getByTestId('mass-tort-summary')).toHaveAttribute(
    'aria-label',
    'Complete mass tort profile'
  );
  await expect(page.getByTestId('mass-tort-complete-note')).toContainText(
    'did not change coverage, limits, or the policy version'
  );
  await expect(page.getByTestId('mass-tort-value-tort')).toHaveText('PFAS / AFFF');
  await expect(page.getByTestId('mass-tort-value-trigger')).toHaveText('Revisionist');
  await expect(page.getByTestId('mass-tort-value-allocation')).toHaveText('Stacked limits');
  await expect(page.getByTestId('mass-tort-value-block')).toHaveText(
    '1990-01-01 – 2001-12-31'
  );

  expect(state.puts).toHaveLength(1);
  expect(state.puts[0].body).toMatchObject({
    tortType: 'PFAS',
    triggerType: 'REVISIONIST',
    allocationMethod: 'STACKED_LIMITS',
    allocationNotes: 'Stack the triggered years in sequence and record any agreed exceptions.',
    coverageBlockStart: '1990-01-01',
    coverageBlockEnd: '2001-12-31',
    status: 'COMPLETE'
  });
});

test('loads an existing profile, shows its values, and saves edits', async ({ page }) => {
  const state = await installMocks(page, {
    profile: {
      ...DRAFT_PROFILE,
      status: 'COMPLETE',
      tortType: 'TALC',
      triggerType: 'MANIFESTATION',
      allocationMethod: 'PRO_RATA_TIME_ON_RISK',
      allocationNotes: 'Allocate by years of cosmetic talc use.'
    }
  });
  await openMassTortTab(page);

  await expect(page.getByTestId('mass-tort-status')).toHaveText('COMPLETE');
  await expect(page.getByTestId('mass-tort-value-tort')).toHaveText('Talc');
  await expect(page.getByTestId('mass-tort-value-trigger')).toHaveText('Manifestation');
  await expect(page.getByTestId('mass-tort-value-allocation')).toHaveText(
    'Pro rata — time on risk'
  );
  await expect(page.getByTestId('mass-tort-value-block')).toHaveText(
    '1975-01-01 – 1985-12-31'
  );
  await expect(page.getByLabel('Tort type')).toHaveValue('TALC');
  await expect(page.getByLabel('Trigger')).toHaveValue('MANIFESTATION');
  await expect(page.getByLabel('Allocation method')).toHaveValue('PRO_RATA_TIME_ON_RISK');
  await expect(page.getByLabel('Coverage block start')).toHaveValue('1975-01-01');
  await expect(page.getByLabel('Coverage block end')).toHaveValue('1985-12-31');

  await page.getByLabel('Allocation method').selectOption('EQUAL_SHARES');
  await page.getByLabel('Allocation notes').fill('Split evenly across the triggered years.');
  await page.getByRole('button', { name: 'Save draft', exact: true }).click();

  await expect(page.getByTestId('mass-tort-notice')).toHaveText(
    'Mass tort profile saved as draft.'
  );
  await expect(page.getByTestId('mass-tort-status')).toHaveText('DRAFT');
  await expect(page.getByTestId('mass-tort-value-allocation')).toHaveText('Equal shares');
  await expect(page.getByTestId('mass-tort-value-notes')).toHaveText(
    'Split evenly across the triggered years.'
  );

  expect(state.puts).toHaveLength(1);
  expect(state.puts[0].body).toEqual({
    tortType: 'TALC',
    triggerType: 'MANIFESTATION',
    allocationMethod: 'EQUAL_SHARES',
    allocationNotes: 'Split evenly across the triggered years.',
    coverageBlockStart: '1975-01-01',
    coverageBlockEnd: '1985-12-31',
    status: 'DRAFT'
  });
});

test('states the allocation and ownership context of the profile', async ({ page }) => {
  await installMocks(page);
  await openMassTortTab(page);

  const context = page.getByTestId('mass-tort-context');
  await expect(context).toBeVisible();
  await expect(context).toContainText('guides allocation and coverage administration');
  await expect(context).toContainText('does not change coverage or limits');
  await expect(context).toContainText('Policy owns the profile; Direct Claims owns allocations');
  await expect(context.getByRole('link', { name: 'Open Direct Claims workbench' }))
    .toHaveAttribute('href', '/direct-claims');
});

test('contains a profile read failure in the tab and retries', async ({ page }) => {
  const state = await installMocks(page, { getStatus: 503 });
  await openMassTortTab(page);

  const tab = page.getByRole('tabpanel', { name: 'Mass tort' });
  await expect(tab.getByRole('alert')).toContainText(
    'Mass tort profile is temporarily unavailable.'
  );
  await expect(page.getByTestId('mass-tort-empty')).toHaveCount(0);

  state.getStatus = 200;
  state.profile = { ...DRAFT_PROFILE, status: 'COMPLETE' };
  await page.getByRole('button', { name: 'Retry' }).click();

  await expect(page.getByTestId('mass-tort-summary')).toBeVisible();
  await expect(page.getByTestId('mass-tort-status')).toHaveText('COMPLETE');
  expect(state.gets).toBe(2);
});

test('shows a 400 problem inside the form without losing the current profile', async ({ page }) => {
  const state = await installMocks(page, {
    profile: DRAFT_PROFILE,
    putStatus: 400,
    putError: problem(
      400,
      'The mass tort profile is invalid.',
      'MASS_TORT_PROFILE_INVALID',
      [{ field: 'tortType', message: 'must be a known tort code' }]
    )
  });
  await openMassTortTab(page);

  await page.getByLabel('Allocation notes').fill('Edited notes that the domain rejects.');
  await page.getByRole('button', { name: 'Save draft', exact: true }).click();

  await expect(page.getByTestId('mass-tort-form-error')).toContainText(
    'The mass tort profile is invalid.'
  );
  await expect(page.getByTestId('mass-tort-form-error')).toContainText(
    'tortType: must be a known tort code'
  );
  await expect(page.getByTestId('mass-tort-status')).toHaveText('DRAFT');
  await expect(page.getByTestId('mass-tort-value-notes')).toHaveText(
    DRAFT_PROFILE.allocationNotes
  );
  await expect(page.getByLabel('Allocation notes')).toHaveValue(
    'Edited notes that the domain rejects.'
  );
  expect(state.puts).toHaveLength(1);
  expect(state.gets).toBe(1);
});

test('reloads the current profile when a save conflicts', async ({ page }) => {
  const state = await installMocks(page, {
    profile: DRAFT_PROFILE,
    putStatus: 409,
    putError: problem(
      409,
      'The mass tort profile was changed by another user.',
      'MASS_TORT_PROFILE_CONFLICT'
    ),
    onPut: (current) => {
      current.profile = {
        ...DRAFT_PROFILE,
        allocationNotes: 'Changed elsewhere while this form was open.',
        allocationMethod: 'CUSTOM_MATRIX',
        status: 'DRAFT'
      };
    }
  });
  await openMassTortTab(page);

  await page.getByLabel('Allocation notes').fill('This edit is stale.');
  await page.getByRole('button', { name: 'Save draft', exact: true }).click();

  await expect(page.getByTestId('mass-tort-form-error')).toContainText(
    'The mass tort profile was changed by another user.'
  );
  await expect(page.getByTestId('mass-tort-form-error')).toContainText('reloaded');
  await expect(page.getByLabel('Allocation notes')).toHaveValue(
    'Changed elsewhere while this form was open.'
  );
  await expect(page.getByLabel('Allocation method')).toHaveValue('CUSTOM_MATRIX');
  expect(state.puts).toHaveLength(1);
  expect(state.gets).toBe(2);
});

