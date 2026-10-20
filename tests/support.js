export const TENANT = '11111111-1111-7111-8111-111111111111';
export const PARTY_ID = 'bbbbbbbb-bbbb-7bbb-8bbb-bbbbbbbbbbbb';

export const PARTY = {
  id: PARTY_ID,
  type: 'PARTY',
  label: 'PTY-000000001',
  secondary: 'Acme Manufacturing · ORGANIZATION',
  status: 'ACTIVE',
  href: `/party?record=${PARTY_ID}`
};

export const PARTY_RECORD = {
  id: PARTY_ID,
  tenantId: TENANT,
  partyNumber: 'PTY-000000001',
  partyType: 'ORGANIZATION',
  displayName: 'Acme Manufacturing',
  legalName: 'Acme Manufacturing, Inc.',
  status: 'ACTIVE'
};

export async function fulfillJson(route, status, body, headers = {}) {
  await route.fulfill({
    status,
    contentType: 'application/json',
    headers,
    body: JSON.stringify(body)
  });
}

/** Keeps policy selection independent from the claims/cessions domains in every spec. */
export async function mockRelated(page, { claims = [], cessions = [] } = {}) {
  await page.route('**/api/v1/claims/search**', async (route) => {
    await fulfillJson(route, 200, { query: '', limit: 5, items: claims });
  });
  await page.route('**/api/v1/cessions/search**', async (route) => {
    await fulfillJson(route, 200, { query: '', limit: 5, items: cessions });
  });
}

/** Serves the common party search envelope used by EntityPicker. */
export async function mockPartySearch(page, items = [PARTY]) {
  await page.route('**/api/v1/parties/search**', async (route) => {
    const url = new URL(route.request().url());
    await fulfillJson(route, 200, {
      query: url.searchParams.get('q') || '',
      limit: 8,
      items
    });
  });
}

/** Drives the EntityPicker typeahead and selects the matching party. */
export async function selectParty(page, label = PARTY.label) {
  await page.getByPlaceholder('Search by number or name…').fill('Acme');
  await page.getByRole('button', { name: new RegExp(label) }).click();
}

/**
 * Serves GET /api/v1/parties/{id} for record cross-link resolution.
 * Pass `status: 404` to exercise the short-UUID fallback.
 */
export async function mockPartyDetail(page, { status = 200, party = PARTY_RECORD, onRequest } = {}) {
  await page.route(/\/api\/v1\/parties\/[0-9a-f-]+$/i, async (route) => {
    const url = new URL(route.request().url());
    if (onRequest) onRequest({ url, headers: route.request().headers() });
    if (status !== 200) {
      await fulfillJson(route, status, {
        status,
        code: 'PARTY_NOT_FOUND',
        message: `Party ${url.pathname.split('/').pop()} was not found`
      });
      return;
    }
    await fulfillJson(route, 200, {
      ...party,
      id: url.pathname.split('/').pop()
    });
  });
}
