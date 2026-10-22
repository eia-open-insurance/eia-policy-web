import { test, expect } from '@playwright/test';
import { mockPartyDetail, mockRelated, PARTY_ID, TENANT } from './support.js';

const POLICY_ID = 'aaaaaaaa-aaaa-7aaa-8aaa-aaaaaaaaaaaa';
const SECOND_POLICY_ID = 'dddddddd-dddd-7ddd-8ddd-dddddddddddd';
const NOTIFICATION_ID = '99999999-9999-7999-8999-999999999991';
const NOTIFICATIONS = '**/api/v1/notifications**';

function policy(overrides = {}) {
  return {
    id: POLICY_ID,
    tenantId: TENANT,
    policyNumber: 'POL-2026-0000001',
    productCode: 'CGL',
    insuredPartyId: PARTY_ID,
    status: 'DRAFT',
    effectiveDate: '2026-01-01',
    expirationDate: '2027-01-01',
    premiumAmount: '125000.0000',
    premiumCurrency: 'USD',
    limitAmount: '2000000.0000',
    limitCurrency: 'USD',
    version: 0,
    createdAt: '2026-10-19T12:00:00Z',
    updatedAt: '2026-10-19T12:00:00Z',
    ...overrides
  };
}

function notification(overrides = {}) {
  return {
    id: NOTIFICATION_ID,
    tenantId: TENANT,
    notificationNumber: 'NTF-2026-000000001',
    notificationType: 'NEW_CLAIM_NOTICE',
    channel: 'EMAIL',
    status: 'SENT',
    recipientPartyId: PARTY_ID,
    subject: 'Policy issued',
    body: 'The policy was issued.',
    templateCode: 'CLAIM_NOTICE_STANDARD',
    templateVersion: 1,
    scheduledAt: null,
    sentAt: '2026-10-18T12:00:00Z',
    version: 1,
    createdAt: '2026-10-18T12:00:00Z',
    updatedAt: '2026-10-18T12:00:00Z',
    sourceType: 'POLICY',
    sourceId: POLICY_ID,
    sourceReference: 'POL-2026-0000001',
    ...overrides
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

async function mockPolicies(page, policies) {
  const byId = new Map(policies.map((row) => [row.id, row]));

  await page.route('**/api/v1/policies**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const method = request.method();

    if (method === 'GET' && url.pathname === '/api/v1/policies') {
      await json(route, 200, {
        items: policies,
        page: 0,
        size: 20,
        total: policies.length,
        _links: { self: { href: '/api/v1/policies?page=0&size=20' } }
      });
      return;
    }
    if (method === 'GET' && url.pathname.endsWith('/versions/current')) {
      await json(route, 200, { version: null, current: false, hashVerified: false });
      return;
    }
    const match = url.pathname.match(/^\/api\/v1\/policies\/([^/]+)$/);
    if (method === 'GET' && match && byId.has(match[1])) {
      const record = byId.get(match[1]);
      await json(route, 200, record, { ETag: `"${record.version}"` });
      return;
    }
    await route.fulfill({ status: 404, body: `unexpected ${method} ${url.pathname}` });
  });
}

test('shows the related-notification count and the three newest notifications', async ({ page }) => {
  const first = policy();
  const second = policy({
    id: SECOND_POLICY_ID,
    policyNumber: 'POL-2026-0000002',
    version: 1
  });
  const requests = [];
  const firstRows = [
    notification({
      id: '99999999-9999-7999-8999-999999999911',
      notificationNumber: 'NTF-2026-000000011',
      subject: 'Policy issued',
      status: 'SENT',
      createdAt: '2026-10-15T09:00:00Z'
    }),
    notification({
      id: '99999999-9999-7999-8999-999999999922',
      notificationNumber: 'NTF-2026-000000022',
      subject: 'Renewal reminder',
      status: 'QUEUED',
      createdAt: '2026-10-18T14:30:00Z'
    }),
    notification({
      id: '99999999-9999-7999-8999-999999999933',
      notificationNumber: 'NTF-2026-000000033',
      subject: 'Payment due',
      status: 'FAILED',
      createdAt: '2026-10-17T08:00:00Z'
    }),
    notification({
      id: '99999999-9999-7999-8999-999999999944',
      notificationNumber: 'NTF-2026-000000044',
      subject: 'Endorsement confirmed',
      status: 'DELIVERED',
      createdAt: '2026-10-16T10:00:00Z'
    }),
    notification({
      id: '99999999-9999-7999-8999-999999999955',
      notificationNumber: 'NTF-2026-000000055',
      subject: 'Welcome',
      status: 'SENT',
      createdAt: '2026-10-14T07:00:00Z'
    })
  ];
  const secondRows = [
    notification({
      id: '99999999-9999-7999-8999-999999999966',
      notificationNumber: 'NTF-2026-000000066',
      sourceId: SECOND_POLICY_ID,
      sourceReference: 'POL-2026-0000002',
      subject: 'Second policy notice',
      status: 'SENT',
      createdAt: '2026-10-19T11:00:00Z'
    })
  ];

  await mockRelated(page);
  await mockPartyDetail(page);
  await mockPolicies(page, [first, second]);
  await page.route(NOTIFICATIONS, async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    requests.push({
      method: request.method(),
      url,
      headers: request.headers()
    });
    const rows = url.searchParams.get('sourceId') === SECOND_POLICY_ID
      ? secondRows
      : firstRows;
    await json(route, 200, {
      items: rows,
      page: 0,
      size: 20,
      total: rows.length
    });
  });

  await page.goto(`/?record=${POLICY_ID}`);
  await expect(page.getByRole('heading', { name: 'POL-2026-0000001' })).toBeVisible();

  const card = page.getByTestId('related-notifications');
  await expect(card).toBeVisible();
  await expect(card.getByRole('heading', { name: 'Notifications' })).toBeVisible();
  await expect(page.getByTestId('related-notifications-count')).toHaveText('5 notifications');
  await expect(page.getByTestId('related-notifications-more'))
    .toHaveText('Showing the newest 3 of 5.');

  const rows = card.getByTestId('related-notification-row');
  await expect(rows).toHaveCount(3);
  await expect(rows.nth(0)).toContainText('NTF-2026-000000022');
  await expect(rows.nth(0)).toContainText('Renewal reminder');
  await expect(rows.nth(0)).toContainText('QUEUED');
  await expect(rows.nth(0)).toContainText(/Oct 18, 2026/);
  await expect(rows.nth(1)).toContainText('NTF-2026-000000033');
  await expect(rows.nth(1)).toContainText('FAILED');
  await expect(rows.nth(2)).toContainText('NTF-2026-000000044');
  await expect(rows.nth(2)).toContainText('DELIVERED');
  await expect(rows.nth(2)).toContainText(/Oct 16, 2026/);
  await expect(card.getByText('NTF-2026-000000011')).toHaveCount(0);
  await expect(card.getByText('NTF-2026-000000055')).toHaveCount(0);

  await expect(rows.nth(0).getByRole('link', { name: 'NTF-2026-000000022' })).toHaveAttribute(
    'href',
    '/notifications?record=99999999-9999-7999-8999-999999999922'
  );

  await expect.poll(() => requests.length).toBe(1);
  expect(requests[0].method).toBe('GET');
  expect(requests[0].url.pathname).toBe('/api/v1/notifications');
  expect(requests[0].url.searchParams.get('sourceType')).toBe('POLICY');
  expect(requests[0].url.searchParams.get('sourceId')).toBe(POLICY_ID);
  expect(requests[0].headers['x-eia-tenant']).toBe(TENANT);

  await page.getByRole('button', { name: 'Open record POL-2026-0000002' }).click();
  await expect(page.getByRole('heading', { name: 'POL-2026-0000002' })).toBeVisible();
  await expect(page.getByTestId('related-notifications-count')).toHaveText('1 notification');
  await expect(card.getByTestId('related-notification-row')).toHaveCount(1);
  await expect(card).toContainText('Second policy notice');

  await expect.poll(() => requests.length).toBe(2);
  expect(requests[1].url.searchParams.get('sourceType')).toBe('POLICY');
  expect(requests[1].url.searchParams.get('sourceId')).toBe(SECOND_POLICY_ID);
  expect(requests[1].headers['x-eia-tenant']).toBe(TENANT);
});

test('opens a related notification in the notifications workbench', async ({ page }) => {
  await mockRelated(page);
  await mockPartyDetail(page);
  await mockPolicies(page, [policy()]);
  await page.route(NOTIFICATIONS, async (route) => {
    await json(route, 200, { items: [notification()], page: 0, size: 20, total: 1 });
  });

  await page.goto(`/?record=${POLICY_ID}`);
  await expect(page.getByRole('heading', { name: 'POL-2026-0000001' })).toBeVisible();

  const card = page.getByTestId('related-notifications');
  const link = card.getByRole('link', { name: 'NTF-2026-000000001' });
  await expect(link).toHaveAttribute('href', `/notifications?record=${NOTIFICATION_ID}`);
  await link.click();
  await expect(page).toHaveURL(new RegExp(`/notifications\\?record=${NOTIFICATION_ID}$`));
});

test('shows the related-notifications empty state without disturbing the policy record', async ({ page }) => {
  await mockRelated(page);
  await mockPartyDetail(page);
  await mockPolicies(page, [policy()]);
  await page.route(NOTIFICATIONS, async (route) => {
    await json(route, 200, { items: [], page: 0, size: 20, total: 0 });
  });

  await page.goto(`/?record=${POLICY_ID}`);

  await expect(page.getByRole('heading', { name: 'POL-2026-0000001' })).toBeVisible();
  await expect(page.getByTestId('policy-status')).toHaveText('DRAFT');
  await expect(page.getByTestId('policy-etag')).toHaveText('"0"');
  const card = page.getByTestId('related-notifications');
  await expect(page.getByTestId('related-notifications-count')).toHaveText('0 notifications');
  await expect(page.getByTestId('related-notifications-empty'))
    .toHaveText('No notifications reference this policy yet.');
  await expect(card.getByRole('table')).toHaveCount(0);
  await expect(page.getByTestId('related-notifications-more')).toHaveCount(0);
  await expect(page.getByRole('alert')).toHaveCount(0);
});

test('keeps the policy record usable when the related-notification lookup fails', async ({ page }) => {
  await mockRelated(page);
  await mockPartyDetail(page);
  await mockPolicies(page, [policy()]);
  await page.route(NOTIFICATIONS, async (route) => {
    await route.fulfill({
      status: 503,
      contentType: 'application/problem+json',
      body: JSON.stringify({
        title: 'Notifications expert unavailable',
        status: 503,
        code: 'EXPERT_UNAVAILABLE',
        detail: 'The Notifications expert is unavailable; retry later.'
      })
    });
  });

  await page.goto(`/?record=${POLICY_ID}`);

  await expect(page.getByRole('heading', { name: 'POL-2026-0000001' })).toBeVisible();
  await expect(page.getByTestId('policy-status')).toHaveText('DRAFT');
  await expect(page.getByTestId('policy-etag')).toHaveText('"0"');
  const card = page.getByTestId('related-notifications');
  await expect(page.getByTestId('related-notifications-error'))
    .toHaveText('Related notifications are temporarily unavailable.');
  await expect(page.getByTestId('related-notifications-count')).toHaveText('0 notifications');
  await expect(card.getByRole('table')).toHaveCount(0);
  await expect(page.getByRole('alert')).toHaveCount(0);
});
