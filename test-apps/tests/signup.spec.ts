import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

/**
 * Ground-truth behavioural checks for the two fixtures. A keyboard / screen-reader
 * agent pointed at /bad should report roughly what the "bad:" tests assert, and
 * find nothing blocking on /good.
 */

interface FocusInfo {
  tag: string;
  role: string | null;
  name: string;
  inDialog: boolean;
}

/** Describe document.activeElement roughly the way a screen reader would name it. */
async function focused(page: Page): Promise<FocusInfo> {
  return page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null;
    if (!el || el === document.body) return { tag: 'body', role: null, name: '', inDialog: false };

    const labelledBy = el.getAttribute('aria-labelledby');
    const labels = 'labels' in el ? (el as HTMLInputElement).labels : null;
    const name =
      (labelledBy
        ? labelledBy
            .split(/\s+/)
            .map((id) => document.getElementById(id)?.textContent?.trim() ?? '')
            .join(' ')
        : null) ||
      el.getAttribute('aria-label') ||
      (labels && labels.length > 0
        ? Array.from(labels)
            .map((label) => label.textContent?.trim() ?? '')
            .join(' ')
            .trim()
        : '') ||
      (el as HTMLInputElement).placeholder ||
      el.textContent?.trim() ||
      '';

    const type = el instanceof HTMLInputElement && el.type !== 'text' ? `[type=${el.type}]` : '';

    return {
      tag: `${el.tagName.toLowerCase()}${type}`,
      role: el.getAttribute('role'),
      name: name.replace(/\s+/g, ' ').slice(0, 60),
      inDialog: el.closest('dialog') !== null,
    };
  });
}

async function tabSequence(page: Page, count: number): Promise<string[]> {
  const sequence: string[] = [];

  for (let index = 0; index < count; index += 1) {
    await page.keyboard.press('Tab');
    const info = await focused(page);
    sequence.push(`${info.tag}${info.role ? `[${info.role}]` : ''}:${info.name}`);
  }

  return sequence;
}

/* ------------------------------------------------------------------------ */
/* 1. Tab order / reachability                                               */
/* ------------------------------------------------------------------------ */

test('bad: Tab skips every custom control', async ({ page }) => {
  await page.goto('/bad');

  // Only the three inputs and two real links are reachable. The password toggle,
  // the country dropdown, the checkbox and "Create account" never receive focus.
  expect(await tabSequence(page, 5)).toEqual([
    'input:Full name',
    'input:you@example.com',
    'input[type=password]:••••••••',
    'a:Terms and Conditions',
    'a:Sign in',
  ]);
});

test('good: Tab reaches every control in visual order', async ({ page }) => {
  await page.goto('/good');

  expect(await tabSequence(page, 9)).toEqual([
    'input:Full name',
    'input[type=email]:Email address',
    'input[type=password]:Password',
    'button:Show password',
    'div[combobox]:Country',
    'input[type=checkbox]:I agree to the Terms and Conditions',
    'button:Terms and Conditions',
    'button:Create account',
    'a:Sign in',
  ]);
});

/* ------------------------------------------------------------------------ */
/* 2. Accessible names                                                       */
/* ------------------------------------------------------------------------ */

test('bad: field names fall back to placeholders', async ({ page }) => {
  await page.goto('/bad');

  expect(await page.locator('label').count()).toBe(0);
  await expect(page.getByRole('textbox', { name: 'you@example.com' })).toBeVisible();
  await expect(page.getByPlaceholder('••••••••')).toHaveAccessibleName('••••••••');
});

test('good: fields are named by labels', async ({ page }) => {
  await page.goto('/good');

  await expect(page.getByLabel('Full name')).toHaveAccessibleName('Full name');
  await expect(page.getByLabel('Email address')).toHaveAccessibleName('Email address');
  await expect(page.getByLabel('Password', { exact: true })).toHaveAccessibleName('Password');
  await expect(page.getByRole('combobox', { name: 'Country' })).toBeVisible();
  await expect(
    page.getByRole('checkbox', { name: 'I agree to the Terms and Conditions' }),
  ).toBeAttached();
});

/* ------------------------------------------------------------------------ */
/* 3. Custom dropdown                                                        */
/* ------------------------------------------------------------------------ */

test('bad: country dropdown cannot be opened from the keyboard', async ({ page }) => {
  await page.goto('/bad');

  const sequence = await tabSequence(page, 5);
  expect(sequence.some((entry) => entry.includes('Select your country'))).toBe(false);

  // Even from the field right before it, no key opens the list.
  await page.getByPlaceholder('••••••••').focus();
  for (const key of ['ArrowDown', 'Enter', 'Space', 'Alt+ArrowDown']) {
    await page.keyboard.press(key);
  }
  await expect(page.getByText('Poland')).toHaveCount(0);
  expect(await page.getByRole('combobox').count()).toBe(0);
});

test('good: country combobox is fully keyboard operable', async ({ page }) => {
  await page.goto('/good');

  const combobox = page.getByRole('combobox', { name: 'Country' });
  await combobox.focus();

  await page.keyboard.press('ArrowDown');
  await expect(combobox).toHaveAttribute('aria-expanded', 'true');
  await expect(page.getByRole('listbox', { name: 'Country' })).toBeVisible();

  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await expect(combobox).toHaveAttribute('aria-activedescendant', /option-3$/);

  await page.keyboard.press('Enter');
  await expect(combobox).toHaveAttribute('aria-expanded', 'false');
  await expect(combobox).toHaveText('Poland');
  await expect(combobox).toBeFocused();

  // First-letter type-ahead opens the list on the first match after the selection.
  await page.keyboard.press('j');
  const japan = page.getByRole('option', { name: 'Japan' });
  await expect(japan).toHaveAttribute('aria-selected', 'false');
  await expect(combobox).toHaveAttribute(
    'aria-activedescendant',
    (await japan.getAttribute('id')) ?? 'missing',
  );

  // Escape closes without changing the value.
  await page.keyboard.press('Escape');
  await expect(combobox).toHaveAttribute('aria-expanded', 'false');
  await expect(combobox).toHaveText('Poland');
});

/* ------------------------------------------------------------------------ */
/* 4. Terms modal                                                            */
/* ------------------------------------------------------------------------ */

test('bad: focus escapes the Terms modal', async ({ page }) => {
  await page.goto('/bad');

  await page.getByRole('link', { name: 'Terms and Conditions' }).focus();
  await page.keyboard.press('Enter');
  const modalText = page.getByText('Last updated: March 2026');
  await expect(modalText).toBeVisible();

  // No dialog semantics at all.
  expect(await page.getByRole('dialog').count()).toBe(0);

  // Focus was never moved into the modal…
  expect(await focused(page)).toMatchObject({ tag: 'a', name: 'Terms and Conditions' });

  // …the first Tab lands on a link hidden behind the overlay…
  await page.keyboard.press('Tab');
  expect(await focused(page)).toMatchObject({ tag: 'a', name: 'Sign in' });

  // …and Escape does nothing, so the modal cannot be dismissed without a mouse.
  await page.keyboard.press('Escape');
  await expect(modalText).toBeVisible();
});

test('good: dialog traps focus, Escape closes and restores focus', async ({ page }) => {
  await page.goto('/good');

  const trigger = page.getByRole('button', { name: 'Terms and Conditions' });
  await trigger.focus();
  await page.keyboard.press('Enter');

  const dialog = page.getByRole('dialog', { name: 'Terms and Conditions' });
  await expect(dialog).toBeVisible();
  await expect(dialog).toHaveAttribute('aria-modal', 'true');
  expect(await focused(page)).toMatchObject({ tag: 'h2', inDialog: true });

  // More presses than there are tabbable elements: focus must wrap, never leave.
  for (let index = 0; index < 8; index += 1) {
    await page.keyboard.press('Tab');
    expect(await focused(page)).toMatchObject({ inDialog: true });
  }
  for (let index = 0; index < 8; index += 1) {
    await page.keyboard.press('Shift+Tab');
    expect(await focused(page)).toMatchObject({ inDialog: true });
  }

  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();
});

test('good: "I agree" in the dialog ticks the checkbox', async ({ page }) => {
  await page.goto('/good');

  await page.getByRole('button', { name: 'Terms and Conditions' }).focus();
  await page.keyboard.press('Enter');
  await page.getByRole('button', { name: 'I agree' }).focus();
  await page.keyboard.press('Enter');

  await expect(page.getByRole('dialog')).toBeHidden();
  await expect(page.getByRole('checkbox')).toBeChecked();
});

/* ------------------------------------------------------------------------ */
/* 5. End-to-end completion                                                  */
/* ------------------------------------------------------------------------ */

test('bad: the form cannot be completed without a mouse', async ({ page }) => {
  await page.goto('/bad');

  await page.keyboard.press('Tab');
  await page.keyboard.type('Jane Doe');
  await page.keyboard.press('Tab');
  await page.keyboard.type('jane@example.com');
  await page.keyboard.press('Tab');
  await page.keyboard.type('correct horse battery');

  // No <form>, so Enter does nothing; country and terms are unreachable anyway.
  await page.keyboard.press('Enter');
  await expect(page.getByText(/Welcome aboard/)).toHaveCount(0);
  await expect(page.getByText('Create your account')).toBeVisible();

  const sequence = await tabSequence(page, 6);
  expect(sequence.some((entry) => entry.includes('Create account'))).toBe(false);
});

test('good: the whole flow can be completed keyboard-only', async ({ page }) => {
  await page.goto('/good');

  await page.keyboard.press('Tab');
  await page.keyboard.type('Jane Doe');
  await page.keyboard.press('Tab');
  await page.keyboard.type('jane@example.com');
  await page.keyboard.press('Tab');
  await page.keyboard.type('correct horse battery');
  await page.keyboard.press('Tab'); // Show password
  await page.keyboard.press('Tab'); // Country combobox
  await page.keyboard.press('ArrowDown'); // open, highlight "United States"
  await page.keyboard.press('ArrowDown'); // "United Kingdom"
  await page.keyboard.press('Enter');
  await expect(page.getByRole('combobox', { name: 'Country' })).toHaveText('United Kingdom');
  await page.keyboard.press('Tab'); // checkbox
  await page.keyboard.press('Space');
  await page.keyboard.press('Tab'); // Terms and Conditions
  await page.keyboard.press('Tab'); // Create account
  await page.keyboard.press('Enter');

  const heading = page.getByRole('heading', { level: 1, name: 'Welcome aboard, Jane Doe!' });
  await expect(heading).toBeVisible();
  await expect(heading).toBeFocused();
});

test('good: Enter submits, focus jumps to the first invalid field, error is linked', async ({
  page,
}) => {
  await page.goto('/good');

  await page.getByLabel('Email address').fill('not-an-email');
  await page.keyboard.press('Enter');

  const fullName = page.getByLabel('Full name');
  await expect(fullName).toBeFocused();
  await expect(fullName).toHaveAttribute('aria-invalid', 'true');
  await expect(fullName).toHaveAccessibleDescription('Please enter your full name.');
  await expect(page.getByLabel('Email address')).toHaveAccessibleDescription(
    'Please enter a valid email address.',
  );
});

/* ------------------------------------------------------------------------ */
/* 6. Static analysis baseline (axe)                                         */
/* ------------------------------------------------------------------------ */

const AXE_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'];

test('axe: /bad — informational baseline, shows how little static analysis catches', async ({
  page,
}, testInfo) => {
  await page.goto('/bad');

  const results = await new AxeBuilder({ page }).withTags(AXE_TAGS).analyze();
  const summary = results.violations.map((v) => `${v.id} (${v.nodes.length})`);

  await testInfo.attach('axe-bad', {
    body: JSON.stringify(results.violations, null, 2),
    contentType: 'application/json',
  });
  console.log(`axe /bad violations: ${summary.length ? summary.join(', ') : 'none'}`);
});

test('axe: /good has no violations', async ({ page }) => {
  await page.goto('/good');

  const results = await new AxeBuilder({ page }).withTags(AXE_TAGS).analyze();
  expect(results.violations.map((v) => `${v.id}: ${v.help}`)).toEqual([]);
});
