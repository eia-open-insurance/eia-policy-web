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
