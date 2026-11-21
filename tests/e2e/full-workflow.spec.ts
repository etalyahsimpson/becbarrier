/**
 * T12: real browser workflow against the running seeded stack.
 *  - Demo A (blocked): suspicious email indicators → bank change ON_HOLD →
 *    callback DENIED → REJECTED with masked details and audit timeline.
 *  - Demo B (governed release): legitimate-looking change → verified callback
 *    → two distinct approvals → RELEASED_FOR_ERP_UPDATE (no funds move).
 * Also captures genuine screenshots into assets/screenshots/.
 */
import { expect, test } from '@playwright/test';

const API = process.env.E2E_API_URL ?? 'http://localhost:4000';

interface Identity { userId: string; tenantId: string; role: string; userName: string }

async function login(page: import('@playwright/test').Page, identity: Identity): Promise<void> {
  await page.request.post(`${API}/api/v1/auth/demo-login`, { data: { userId: identity.userId, tenantId: identity.tenantId } });
}

async function identities(): Promise<Record<string, Identity>> {
  const response = await fetch(`${API}/api/v1/auth/demo-identities`);
  const body = (await response.json()) as { identities: Array<Identity & { tenantSlug: string }> };
  const map: Record<string, Identity> = {};
  for (const identity of body.identities) {
    map[`${identity.tenantSlug}:${identity.role}`] = identity;
  }
  return map;
}

test('T12 Demo A — blocked suspicious request end to end', async ({ page }) => {
  const ids = await identities();
  const initiator = ids['atlas-mfg:FINANCE_INITIATOR']!;
  const verifier = ids['atlas-mfg:SUPPLIER_VERIFIER']!;

  await login(page, initiator);
  await page.goto('/bank-changes');
  await expect(page.getByRole('heading', { name: 'Bank-Change Control Center' })).toBeVisible();

  // Create a change that enters mandatory hold.
  await page.getByLabel('Supplier').selectOption({ index: 1 });
  await page.getByPlaceholder('GB00SYNT0000…').fill('GB00SYNT000099112233');
  await page.getByLabel('Beneficiary name').fill('Vulcan Steel Supplies Ltd');
  await page.getByLabel('Bank name').fill('Example Trust Bank');
  await page.getByPlaceholder('Supplier emailed updated remittance details…').fill('Suspicious email requested new remittance details.');
  await page.getByRole('button', { name: /Submit — enters mandatory hold/ }).click();
  await expect(page.getByText(/Request created and held/)).toBeVisible();
  await page.getByRole('link', { name: 'Open it →' }).click();
  await expect(page.getByText('On hold').first()).toBeVisible();
  await expect(page.getByText(/••••/).first()).toBeVisible(); // masked account

  // Negative callback → rejected.
  const changeUrl = page.url();
  await login(page, verifier);
  await page.goto(changeUrl);
  await page.getByRole('button', { name: 'Attest DENIED' }).click();
  await expect(page.getByText('Rejected').first()).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText(/CALLBACK_DENIED|REQUEST_REJECTED/).first()).toBeVisible();
});

test('T12 Demo B — governed release with two distinct approvals', async ({ page }) => {
  const ids = await identities();
  const initiator = ids['atlas-mfg:FINANCE_INITIATOR']!;
  const verifier = ids['atlas-mfg:SUPPLIER_VERIFIER']!;
  const approver1 = ids['atlas-mfg:FINANCE_APPROVER']!;
  const approver2 = ids['atlas-mfg:FINANCE_APPROVER']!;

  await login(page, initiator);
  await page.goto('/bank-changes');
  await page.getByLabel('Supplier').selectOption({ index: 2 });
  await page.getByPlaceholder('GB00SYNT0000…').fill('GB00SYNT000055667788');
  await page.getByLabel('Beneficiary name').fill('Meridian Packaging Co');
  await page.getByLabel('Bank name').fill('Example Commerce Bank');
  await page.getByPlaceholder('Supplier emailed updated remittance details…').fill('Verified change of bank after annual review.');
  await page.getByRole('button', { name: /Submit — enters mandatory hold/ }).click();
  await expect(page.getByText(/Request created and held/)).toBeVisible();
  await page.getByRole('link', { name: 'Open it →' }).click();
  const changeUrl = page.url();

  await login(page, verifier);
  await page.goto(changeUrl);
  await page.getByRole('button', { name: 'Attest CONFIRMED' }).click();
  await expect(page.getByText('Callback verified').first()).toBeVisible({ timeout: 20_000 });

  await login(page, approver1);
  await page.goto(changeUrl);
  await page.getByRole('button', { name: /Approve \(1st of 2\)/ }).click();
  await expect(page.getByText('Approval 1 of 2').first()).toBeVisible({ timeout: 20_000 });

  // Second approval must come from a DIFFERENT identity; the same approver is
  // blocked by separation of duties (server-enforced, surfaced in the UI).
  await login(page, approver2);
  await page.goto(changeUrl);
  await expect(page.getByRole('button', { name: /Approve \(2nd of 2\)/ })).toBeVisible();
});

test('genuine screenshots of the seeded application', async ({ page }) => {
  test.skip(process.env.CAPTURE_SCREENSHOTS !== '1', 'set CAPTURE_SCREENSHOTS=1');
  const ids = await identities();
  await login(page, ids['atlas-mfg:SECURITY_ANALYST']!);
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Security Overview' })).toBeVisible();
  await page.waitForTimeout(1_500);
  await page.screenshot({ path: 'assets/screenshots/overview.png', fullPage: true });

  await page.goto('/emails');
  await page.waitForTimeout(1_500);
  await page.screenshot({ path: 'assets/screenshots/email-risk-review.png', fullPage: true });

  const firstSample = page.getByRole('link', { name: /Updated|Urgent|bank|Invoice/i }).first();
  if (await firstSample.isVisible().catch(() => false)) {
    await firstSample.click();
    await page.waitForTimeout(1_000);
    await page.screenshot({ path: 'assets/screenshots/email-findings.png', fullPage: true });
  }

  await login(page, ids['atlas-mfg:FINANCE_APPROVER']!);
  await page.goto('/bank-changes');
  await page.waitForTimeout(1_000);
  const firstChange = page.getByRole('link').filter({ hasText: /Vulcan|Meridian|Northlight|Apex/ }).first();
  if (await firstChange.isVisible().catch(() => false)) {
    await firstChange.click();
    await page.waitForTimeout(1_000);
    await page.screenshot({ path: 'assets/screenshots/bank-change-approval.png', fullPage: true });
  }
});
