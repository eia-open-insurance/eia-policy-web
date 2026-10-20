import { test, expect } from '@playwright/test';
import { mockPartyDetail, mockRelated, PARTY_ID, TENANT } from './support.js';

const POLICY_ID = 'aaaaaaaa-aaaa-7aaa-8aaa-aaaaaaaaaaaa';
const SECOND_POLICY_ID = 'dddddddd-dddd-7ddd-8ddd-dddddddddddd';
const EVENTS = '**/api/v1/events/aggregate/**';

const CREATED_EVENT_ID = 'eeeeeeee-eeee-7eee-8eee-eeeeeeeeeee1';
const UPDATED_EVENT_ID = 'eeeeeeee-eeee-7eee-8eee-eeeeeeeeeee2';
const CANCELLED_EVENT_ID = 'eeeeeeee-eeee-7eee-8eee-eeeeeeeeeee3';
const ENDORSED_EVENT_ID = 'eeeeeeee-eeee-7eee-8eee-eeeeeeeeeee4';

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

/**
 * The aggregate endpoint embeds the canonical event envelope in `payload`; the
 * policy facts are in `payload.data`. One helper builds that real shape.
 */
function aggregateEvent({
  eventId,
  eventType,
  occurredAt,
  aggregateVersion,
  status = 'PROCESSED',
  data = {},
  payload
}) {
  return {
    eventId,
    eventType,
    eventVersion: 1,
    tenantId: TENANT,
    book: 'DIRECT',
    aggregateType: 'Policy',
    aggregateId: POLICY_ID,
    aggregateVersion,
    occurredAt,
    receivedAt: occurredAt,
    status,
    payload: payload ?? {
      eventId,
      eventType,
      eventVersion: 1,
      tenantId: TENANT,
      book: 'DIRECT',
      aggregateType: 'Policy',
      aggregateId: POLICY_ID,
      aggregateVersion,
      occurredAt,
      data
    }
  };
}

function createdEvent() {
  return aggregateEvent({
    eventId: CREATED_EVENT_ID,
    eventType: 'policy.policy.created',
    occurredAt: '2026-10-18T12:00:00Z',
    aggregateVersion: 1,
    data: {
      policyId: POLICY_ID,
      policyNumber: 'POL-2026-0000001',
      status: 'DRAFT',
      version: 0,
      premiumAmount: '125000.0000',
      premiumCurrency: 'USD',
      limitAmount: '2000000.0000',
      limitCurrency: 'USD'
    }
  });
}

function updatedEvent() {
  return aggregateEvent({
    eventId: UPDATED_EVENT_ID,
    eventType: 'policy.policy.updated',
    occurredAt: '2026-10-19T09:30:00Z',
    aggregateVersion: 2,
    data: {
      policyId: POLICY_ID,
      policyNumber: 'POL-2026-0000001',
      status: 'QUOTED',
      version: 1,
      from: 'DRAFT',
      to: 'QUOTED',
      reason: 'Quote accepted by the broker',
      premiumAmount: '125000.0000',
      premiumCurrency: 'USD',
      limitAmount: '2000000.0000',
      limitCurrency: 'USD'
    }
  });
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

async function mockEvents(page, respond) {
  await page.route(EVENTS, async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    await respond({ route, url, request });
  });
}

test('loads the selected policy activity with tenant header, newest-first order, and refresh', async ({ page }) => {
  const first = policy();
  const second = policy({
    id: SECOND_POLICY_ID,
    policyNumber: 'POL-2026-0000002',
    version: 1,
    status: 'QUOTED'
  });
  const requests = [];
  let releaseFirst;
  const firstGate = new Promise((resolve) => {
    releaseFirst = resolve;
  });

  await mockRelated(page);
  await mockPartyDetail(page);
  await mockPolicies(page, [first, second]);
  await mockEvents(page, async ({ route, url, request }) => {
    requests.push({
      method: request.method(),
      url,
      headers: request.headers()
    });
    if (requests.length === 1) await firstGate;

    const policyId = url.pathname.split('/').pop();
    if (policyId === POLICY_ID) {
      // Deliberately oldest-first: the card must present newest-first.
      await json(route, 200, {
        aggregateId: POLICY_ID,
        limit: 50,
        items: [createdEvent(), updatedEvent()]
      });
      return;
    }
    await json(route, 200, {
      aggregateId: SECOND_POLICY_ID,
      limit: 50,
      items: [aggregateEvent({
        eventId: UPDATED_EVENT_ID,
        eventType: 'policy.policy.updated',
        occurredAt: '2026-10-20T08:00:00Z',
        aggregateVersion: 2,
        data: { from: 'DRAFT', to: 'QUOTED', version: 1 }
      })]
    });
  });

  try {
    await page.goto(`/?record=${POLICY_ID}`);
    await expect(page.getByRole('heading', { name: 'POL-2026-0000001' })).toBeVisible();

    // Selection alone fetches the timeline, before the Activity tab is opened.
    await expect.poll(() => requests.length).toBe(1);
    expect(requests[0].method).toBe('GET');
    expect(requests[0].url.pathname).toBe(`/api/v1/events/aggregate/${POLICY_ID}`);
    expect(requests[0].url.searchParams.get('limit')).toBe('50');
    expect(requests[0].headers['x-eia-tenant']).toBe(TENANT);

    await page.getByRole('tab', { name: 'Activity' }).click();
    const card = page.getByTestId('policy-activity');
    await expect(card).toBeVisible();
    await expect(card.getByTestId('activity-loading')).toBeVisible();
    await expect(card.getByTestId('activity-count')).toHaveText('…');
    releaseFirst();

    await expect(card.getByTestId('activity-count')).toHaveText('2 events');
    const items = card.getByTestId('activity-item');
    await expect(items).toHaveCount(2);

    const newest = items.nth(0);
    await expect(newest.getByTestId('activity-type')).toHaveText('Policy updated');
    await expect(newest.getByTestId('activity-status')).toHaveText('PROCESSED');
    await expect(newest.getByTestId('activity-time')).toHaveAttribute(
      'dateTime',
      '2026-10-19T09:30:00Z'
    );
    await expect(newest.getByTestId('activity-time')).toContainText('Oct 19, 2026');
    await expect(newest).toContainText('DRAFT → QUOTED');
    await expect(newest).toContainText('Version 1');
    await expect(newest).toContainText('Quote accepted by the broker');

    const oldest = items.nth(1);
    await expect(oldest.getByTestId('activity-type')).toHaveText('Policy created');
    await expect(oldest).toContainText('Status DRAFT');
    await expect(oldest).toContainText('Version 0');
    await expect(oldest).toContainText('Premium $125,000.00');
    await expect(oldest).toContainText('Limit $2,000,000.00');

    // Selecting another record refetches for that record's aggregate id.
    await page.getByRole('button', { name: 'Open record POL-2026-0000002' }).click();
    await expect(page.getByRole('heading', { name: 'POL-2026-0000002' })).toBeVisible();
    await expect.poll(() => requests.length).toBe(2);
    expect(requests[1].url.pathname).toBe(`/api/v1/events/aggregate/${SECOND_POLICY_ID}`);
    expect(requests[1].headers['x-eia-tenant']).toBe(TENANT);

    await page.getByRole('tab', { name: 'Activity' }).click();
    await expect(card.getByTestId('activity-count')).toHaveText('1 event');
    await expect(card.getByTestId('activity-item')).toHaveCount(1);

    // The card's own Refresh re-reads the same aggregate without changing selection.
    await card.getByRole('button', { name: 'Refresh activity timeline' }).click();
    await expect.poll(() => requests.length).toBe(3);
    expect(requests[2].url.pathname).toBe(`/api/v1/events/aggregate/${SECOND_POLICY_ID}`);
    expect(requests[2].url.searchParams.get('limit')).toBe('50');
    await expect(card.getByTestId('activity-count')).toHaveText('1 event');
  } finally {
    releaseFirst();
  }
});

test('shows the card-local empty state and the event-source context note', async ({ page }) => {
  const existing = policy();

  await mockRelated(page);
  await mockPartyDetail(page);
  await mockPolicies(page, [existing]);
  await mockEvents(page, async ({ route }) => {
    await json(route, 200, { aggregateId: POLICY_ID, limit: 50, items: [] });
  });

  await page.goto(`/?record=${POLICY_ID}`);
  await expect(page.getByRole('heading', { name: 'POL-2026-0000001' })).toBeVisible();
  await page.getByRole('tab', { name: 'Activity' }).click();

  const card = page.getByTestId('policy-activity');
  await expect(card.getByTestId('activity-count')).toHaveText('0 events');
  await expect(card.getByTestId('activity-empty')).toContainText(
    'No activity has been recorded for this policy yet.'
  );
  await expect(card.getByTestId('activity-timeline')).toHaveCount(0);
  await expect(card.getByTestId('activity-context-note')).toContainText('Event-derived timeline');
  await expect(card.getByTestId('activity-context-note')).toContainText('append-only');
  await expect(card.getByTestId('activity-context-note')).toContainText('source of truth');
  await expect(page.getByTestId('policy-status')).toHaveText('DRAFT');
  await expect(page.getByRole('alert')).toHaveCount(0);
});

test('contains a 503 from the event service inside the activity card', async ({ page }) => {
  const existing = policy({ status: 'IN_FORCE' });

  await mockRelated(page);
  await mockPartyDetail(page);
  await mockPolicies(page, [existing]);
  await mockEvents(page, async ({ route }) => {
    await route.fulfill({
      status: 503,
      contentType: 'application/problem+json',
      body: JSON.stringify({
        type: 'https://errors.eia-open-insurance.example/platform/event-store-unavailable',
        title: 'Event store unavailable',
        status: 503,
        code: 'EVENT_STORE_UNAVAILABLE',
        detail: 'The event service is unavailable; retry later.'
      })
    });
  });

  await page.goto(`/?record=${POLICY_ID}`);
  await expect(page.getByRole('heading', { name: 'POL-2026-0000001' })).toBeVisible();
  await page.getByRole('tab', { name: 'Activity' }).click();

  const card = page.getByTestId('policy-activity');
  await expect(card.getByTestId('activity-error')).toContainText(
    'Activity timeline is temporarily unavailable.'
  );
  await expect(card.getByTestId('activity-count')).toHaveText('0 events');
  await expect(card.getByTestId('activity-timeline')).toHaveCount(0);
  await expect(page.getByTestId('policy-status')).toHaveText('IN_FORCE');
  await expect(page.getByTestId('policy-etag')).toHaveText('"0"');
  await expect(page.getByRole('alert')).toHaveCount(0);

  // The rest of the record still works: Overview remains readable.
  await page.getByRole('tab', { name: 'Overview' }).click();
  await expect(page.getByRole('region', { name: 'Policy details' })).toBeVisible();
});

test('summarizes status, version, reason, premium/limit, and return premium from payloads', async ({ page }) => {
  const existing = policy({ status: 'IN_FORCE', version: 4 });

  await mockRelated(page);
  await mockPartyDetail(page);
  await mockPolicies(page, [existing]);
  await mockEvents(page, async ({ route }) => {
    await json(route, 200, {
      aggregateId: POLICY_ID,
      limit: 50,
      items: [
        aggregateEvent({
          eventId: CANCELLED_EVENT_ID,
          eventType: 'policy.policy.cancelled',
          occurredAt: '2026-10-20T10:00:00Z',
          aggregateVersion: 5,
          data: {
            cancellationType: 'PRO_RATA',
            reason: 'Insured sold the business',
            from: 'IN_FORCE',
            to: 'CANCELLED',
            version: 4,
            premiumAmount: '125000.0000',
            premiumCurrency: 'USD',
            returnPremiumAmount: '60164.4000',
            limitAmount: '2000000.0000',
            limitCurrency: 'USD'
          }
        }),
        // Some projections return the data object directly; the summary accepts both.
        aggregateEvent({
          eventId: ENDORSED_EVENT_ID,
          eventType: 'policy.policy.endorsed',
          occurredAt: '2026-10-19T10:00:00Z',
          aggregateVersion: 4,
          payload: {
            reason: 'Broadened products coverage',
            from: 'IN_FORCE',
            to: 'ENDORSED',
            version: 3,
            premiumDeltaAmount: '5000.00',
            premiumDeltaCurrency: 'USD'
          }
        })
      ]
    });
  });

  await page.goto(`/?record=${POLICY_ID}`);
  await expect(page.getByRole('heading', { name: 'POL-2026-0000001' })).toBeVisible();
  await page.getByRole('tab', { name: 'Activity' }).click();

  const items = page.getByTestId('activity-item');
  await expect(items).toHaveCount(2);

  const cancellation = items.nth(0);
  await expect(cancellation.getByTestId('activity-type')).toHaveText('Policy cancelled');
  await expect(cancellation.getByTestId('activity-status')).toHaveText('PROCESSED');
  await expect(cancellation.getByTestId('activity-status')).toHaveClass(/green/);
  await expect(cancellation.getByTestId('activity-fact-status')).toContainText('IN_FORCE → CANCELLED');
  await expect(cancellation.getByTestId('activity-fact-version')).toContainText('Version 4');
  await expect(cancellation.getByTestId('activity-fact-reason')).toContainText(
    'Cancellation reason Insured sold the business'
  );
  await expect(cancellation.getByTestId('activity-fact-premium')).toContainText(
    'Premium $125,000.00'
  );
  await expect(cancellation.getByTestId('activity-fact-return-premium')).toContainText(
    'Return premium $60,164.40'
  );
  await expect(cancellation.getByTestId('activity-fact-limit')).toContainText(
    'Limit $2,000,000.00'
  );

  const endorsement = items.nth(1);
  await expect(endorsement.getByTestId('activity-type')).toHaveText('Policy endorsed');
  await expect(endorsement.getByTestId('activity-fact-status')).toContainText(
    'IN_FORCE → ENDORSED'
  );
  await expect(endorsement.getByTestId('activity-fact-reason')).toContainText(
    'Endorsement reason Broadened products coverage'
  );
  await expect(endorsement.getByTestId('activity-fact-premium-delta')).toContainText(
    'Premium delta $5,000.00'
  );
});
