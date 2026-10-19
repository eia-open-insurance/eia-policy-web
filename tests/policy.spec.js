import { test, expect } from '@playwright/test';

const TENANT = '11111111-1111-7111-8111-111111111111';

test('renders the policy workbench and creates a policy', async ({ page }) => {
  const existing = {
    id: 'aaaaaaaa-aaaa-7aaa-8aaa-aaaaaaaaaaaa',
    tenantId: TENANT,
    policyNumber: 'POL-2026-0000001',
    productCode: 'CGL',
    insuredPartyId: 'bbbbbbbb-bbbb-7bbb-8bbb-bbbbbbbbbbbb',
    status: 'DRAFT',
    effectiveDate: '2026-01-01',
    expirationDate: '2027-01-01',
    premiumAmount: '125000.0000',
    premiumCurrency: 'USD',
    limitAmount: '2000000.0000',
    limitCurrency: 'USD',
    version: 0,
    createdAt: '2026-10-19T12:00:00Z',
    updatedAt: '2026-10-19T12:00:00Z'
  };
  let policies = [existing];

  await page.route('**/api/v1/policies', async (route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(policies)
      });
      return;
    }
    const body = route.request().postDataJSON();
    const created = {
      ...existing,
      ...body,
      id: 'cccccccc-cccc-7ccc-8ccc-cccccccccccc',
      policyNumber: body.policyNumber || 'POL-2026-0000002',
      status: 'DRAFT',
      version: 0
    };
    policies = [created, ...policies];
    await route.fulfill({
      status: 201,
      contentType: 'application/json',
      body: JSON.stringify(created)
    });
  });

  await page.goto('/');

  await expect(page.getByRole('heading', { name: 'Policy', exact: true })).toBeVisible();
  await expect(page.getByText('POL-2026-0000001')).toBeVisible();
  await expect(page.getByText('No policies yet.')).toHaveCount(0);

  await page.getByPlaceholder('Insured party ID (UUID)').fill('bbbbbbbb-bbbb-7bbb-8bbb-bbbbbbbbbbbb');
  await page.getByRole('button', { name: 'Create policy' }).click();

  await expect(page.getByText('POL-2026-0000002')).toBeVisible();
  await expect(page.getByRole('alert')).toHaveCount(0);
});
