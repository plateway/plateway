import { expect, test, type Page } from '@playwright/test';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

/** A weekday at least two days ahead, so timetables are published and nothing is "in the past". */
function nextWeekday(): string {
  const d = new Date();
  d.setDate(d.getDate() + 2);
  while (d.getDay() !== 1) d.setDate(d.getDate() + 1);
  return d.toISOString().slice(0, 10);
}

const problems = new WeakMap<Page, string[]>();

test.beforeEach(async ({ page }) => {
  const list: string[] = [];
  problems.set(page, list);
  page.on('pageerror', (err) => list.push(`uncaught: ${err.message}`));
  page.on('console', (msg) => {
    if (msg.type() === 'error' && !/Failed to load resource|Estimating resolution/.test(msg.text())) list.push(`console error: ${msg.text().slice(0, 200)}`);
  });
  page.on('response', (res) => {
    if (res.status() >= 500) list.push(`${res.status()} from ${new URL(res.url()).host}`);
  });
});

test.afterEach(async ({ page }, info) => {
  if (info.title.includes('[fault]')) return;
  expect(problems.get(page), 'no uncaught errors or 5xx replies').toEqual([]);
});

/** Opens the app and answers "Who's planning today?". */
async function open(page: Page, role: 'Plate driver' | 'Lift driver' = 'Plate driver') {
  await page.goto('/');
  await page.getByRole('button', { name: new RegExp(`^${role}`) }).click();
}

/**
 * The page must never be wider than the screen, and nothing a person can see
 * may poke out past its edges. A stretched tick box once pushed a label off
 * the side of a real phone while every other check passed.
 */
async function fitsScreen(page: Page, where: string) {
  const res = await page.evaluate(() => {
    const vw = document.documentElement.clientWidth;
    const scope = document.querySelector('dialog[open]') ?? document.body;
    const out: string[] = [];
    for (const el of scope.querySelectorAll<HTMLElement>('*')) {
      if (el.closest('.mapwrap, #splash')) continue;
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height || getComputedStyle(el).visibility === 'hidden') continue;
      if (r.right > vw + 1.5 || r.left < -1.5) out.push(`${el.tagName.toLowerCase()}.${String(el.className).split(' ')[0]} ${Math.round(r.left)}..${Math.round(r.right)}`);
    }
    return { vw, pageWidth: document.documentElement.scrollWidth, out: [...new Set(out)].slice(0, 6) };
  });
  expect(res.pageWidth, `${where}: page is ${res.pageWidth}px wide on a ${res.vw}px screen`).toBeLessThanOrEqual(res.vw + 1);
  expect(res.out, `${where}: these stick out past the screen edge`).toEqual([]);
}

const shot = (page: Page, name: string) => page.screenshot({ path: `test-results/shots/${test.info().project.name}-${name}.png` });

async function setDay(page: Page, leave = '07:30') {
  await page.getByLabel('Day', { exact: true }).fill(nextWeekday());
  await page.getByLabel('Leave at').fill(leave);
}

async function addJob(_page: Page, scope: ReturnType<Page['locator']> | Page, collect: string, deliver: string | null, ref = '', opener = 'Add a job by postcode') {
  await scope.getByRole('button', { name: opener }).click();
  await scope.getByLabel('Collect from').fill(collect);
  if (deliver) await scope.getByLabel('Deliver to').fill(deliver);
  else await scope.getByLabel('Carryover: the car goes home tonight').check();
  if (ref) await scope.getByLabel('Job number (optional)').fill(ref);
  await fitsScreen(_page, `job form (${collect})`);
  // The form must really close. A tap can miss if the page moves under it as results arrive.
  const add = scope.getByRole('button', { name: 'Add job', exact: true });
  await expect(async () => {
    if (await add.count()) await add.click();
    await expect(scope.locator('.job-form')).toHaveCount(0, { timeout: 2500 });
  }).toPass({ timeout: 30_000 });
}

test('opens with a splash, asks who is planning, and remembers the answer', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#splash')).toBeVisible();
  await page.waitForTimeout(900); // let the road draw for the picture
  await shot(page, '00-splash');
  await expect(page.getByRole('heading', { name: "Who's planning today?" })).toBeVisible();
  await expect(page.locator('#splash')).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^Plate driver/ })).toBeVisible();
  await fitsScreen(page, 'who is planning');
  await shot(page, '00-who');

  await page.getByRole('button', { name: /^Lift driver/ }).click();
  await expect(page.getByRole('heading', { name: 'Who are you carrying?' })).toBeVisible();

  // Next time the app opens it goes straight to their screen.
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Who are you carrying?' })).toBeVisible();
  await expect(page.getByRole('heading', { name: "Who's planning today?" })).toHaveCount(0);

  // Switch goes back to the choice, and the other screen loads.
  await page.getByRole('button', { name: 'Planning as Lift driver. Switch' }).click();
  await page.getByRole('button', { name: /^Plate driver/ }).click();
  await expect(page.getByText('No jobs yet.')).toBeVisible();
});

test('driver plans a day by typing postcodes, in lift and solo mode', async ({ page }) => {
  const phone = test.info().project.name === 'phone';
  await open(page);
  await expect(page.locator('.top .brand')).toHaveText('Plateway');
  await expect(page.getByRole('button', { name: 'Planning as Plate driver. Switch' })).toBeVisible();
  await expect(page.getByText('No jobs yet.')).toBeVisible();
  await fitsScreen(page, 'empty setup');
  await shot(page, '01-empty');
  await page.getByRole('button', { name: 'Add a job by postcode' }).click();
  await shot(page, '01-job-form');
  await page.getByRole('button', { name: 'Cancel' }).click();

  await setDay(page);
  await page.getByLabel('Start from').fill('ts1 1eg');
  await expect(page.getByText('Middlesbrough', { exact: true })).toBeVisible();

  await addJob(page, page, 'ts3 8at', 'wf6 1fl', '12000001');
  await addJob(page, page, 'TS17 0EY', 'NE37 3HT');
  await addJob(page, page, 'TS15 9ZS', null);
  await expect(page.getByText('TS15 9ZS → home')).toBeVisible();

  const solo = page.getByRole('button', { name: /^Solo/ });
  const lift = page.getByRole('button', { name: /^With a lift/ });
  await expect(lift).toContainText('Done by');
  await expect(lift).toContainText('miles in the lift car');
  await expect(solo).toContainText('Done by');
  await expect(solo).toContainText('bus, train and foot');
  await expect(solo).toContainText(/fares (up to|about) £\d+/);
  await expect(page.getByText('Shortest of 2 orders')).toBeVisible();
  // The carryover is always last.
  await expect(page.locator('.jobs > li').last()).toContainText('Carryover: going home with you');
  await fitsScreen(page, 'setup with jobs');
  await shot(page, '02-setup-filled');

  await lift.click();
  await page.getByRole('button', { name: 'See route' }).click();
  await expect(page.locator('.sum')).toContainText('07:30');
  await expect(page.locator('.sum')).toContainText('in the lift car');
  await expect(page.locator('.tl-job')).toHaveCount(3);
  await expect(page.locator('.tl-gap').first()).toContainText('Lift to');
  await expect(page.locator('.tl-job').last()).toContainText('Take home');
  // The map itself must be up, with the stops on it. (This once passed with a dead map.)
  await expect(page.locator('.map[data-ready=true]')).toBeVisible();
  await expect(page.locator('.pin').first()).toBeVisible();
  await page.waitForTimeout(3500); // let map tiles and the fit animation settle for the screenshot
  await fitsScreen(page, 'route');
  await shot(page, '03-route-lift');

  // Directions hand off to the maps apps on the phone.
  if (phone) await page.getByRole('button', { name: 'Show the full plan' }).click();
  await page.locator('.tl-job').first().getByRole('button', { name: 'Directions' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('heading', { name: 'Open directions' })).toBeVisible();
  const google = await dialog.getByRole('link', { name: /Google Maps/ }).getAttribute('href');
  expect(google).toMatch(/^https:\/\/www\.google\.com\/maps\/dir\/\?api=1&destination=[A-Z0-9+]+&travelmode=driving&origin=/);
  expect(await dialog.getByRole('link', { name: /Waze/ }).getAttribute('href')).toMatch(/^https:\/\/waze\.com\/ul\?ll=5\d\.\d+,-1\.\d+&navigate=yes$/);
  expect(await dialog.getByRole('link', { name: /Apple Maps/ }).getAttribute('href')).toContain('maps.apple.com');
  await fitsScreen(page, 'directions dialog');
  await shot(page, '04-directions');
  await dialog.getByRole('button', { name: 'Close' }).click();

  // Show one leg on the map.
  await page.locator('.tl-job').first().getByRole('button', { name: 'Show on map' }).click();
  await expect(page.getByRole('button', { name: 'Show whole day' })).toBeVisible();
  await page.waitForTimeout(2500);
  await shot(page, '05-one-leg');
  if (phone) await page.getByRole('button', { name: 'Show the full plan' }).click();
  await page.getByRole('button', { name: 'Show whole day' }).click();

  // Solo: the same day on public transport.
  if (phone) await page.getByRole('button', { name: 'Show the map' }).click();
  await page.getByRole('group', { name: 'How you get between jobs' }).getByRole('button', { name: 'Solo' }).click();
  await expect(page.locator('.sum')).toContainText('bus, train, foot');
  await expect(page.locator('.tl-gap .pill').first()).toBeVisible();
  // Likely cost of the buses and trains, for the day and for each trip between jobs.
  await expect(page.locator('.sum .fare-sum')).toContainText(/Fares (up to|about) £\d+/);
  await expect(page.locator('.tl-gap .fare').first()).toContainText(/Fares (up to|about) £\d+/);
  await expect(page.locator('.fine').filter({ hasText: 'not real ticket prices' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'timetable sources' })).toHaveAttribute('href', 'https://transitous.org/sources/');
  await page.waitForTimeout(3500);
  await fitsScreen(page, 'solo route');
  await shot(page, '06-route-solo');
  if (phone) {
    await page.getByRole('button', { name: 'Show the full plan' }).click();
    await page.waitForTimeout(500);
    await shot(page, '07-solo-timeline');
  }

  // A reload mid-task keeps the day.
  await page.reload();
  await expect(page.getByLabel('Start from')).toHaveValue('TS1 1EG');
  await expect(page.locator('.jobs > li')).toHaveCount(3);
});

test('plate driver sees what each job pays, keeps a history, and marks jobs done or failed', async ({ page }) => {
  await open(page);
  await setDay(page);
  await page.getByLabel('Start from').fill('TS1 1EG');

  // A 74-mile job from the sheet: £20 for the move plus 20p for each of the 14 miles over 60.
  await page.getByRole('button', { name: 'Add a job by postcode' }).click();
  await page.getByLabel('Collect from').fill('TS3 8AT');
  await page.getByLabel('Deliver to').fill('WF6 1FL');
  await page.getByLabel('Job number (optional)').fill('12000001');
  await page.getByLabel('Miles on sheet (optional)').fill('74');
  await fitsScreen(page, 'job form with pay fields');
  await page.getByRole('button', { name: 'Add job', exact: true }).click();
  await addJob(page, page, 'TS17 0EY', 'NE37 3HT');

  const cards = page.locator('.jobs > li');
  const far = cards.filter({ hasText: '#12000001' });
  const near = cards.filter({ hasText: 'TS17 0EY' });
  await expect(far.locator('.job-pay')).toContainText('£22.80');
  await expect(far.locator('.job-pay')).toContainText('Move £20.00 + 14 mi over 60 £2.80');
  // No sheet miles on the second job, so it is paid on the road distance once that is worked out.
  await expect(near.locator('.job-m')).toContainText('mi');
  await expect(near.locator('.job-pay')).toContainText('£20.00');
  await expect(page.locator('.sec-pay')).toContainText('£42.80 for the day');
  await near.getByRole('button', { name: 'Inspection?' }).click();
  await expect(near.locator('.job-pay')).toContainText('£28.00');
  await expect(page.locator('.sec-pay')).toContainText('£50.80 for the day');
  await fitsScreen(page, 'plan with pay');
  await shot(page, '50-plan-pay');

  // History: nothing earned until a job is marked.
  const sections = page.getByRole('group', { name: 'Section' });
  await sections.getByRole('button', { name: 'History and pay' }).click();
  const band = page.locator('.band');
  await expect(band).toContainText('0 done · 0 failed · 2 to do');
  await expect(band.locator('.band-main')).toContainText('£0.00');
  await expect(band.locator('.band-main')).toContainText('£50.80');
  await fitsScreen(page, 'history');

  const row1 = page.locator('.hday li').filter({ hasText: '#12000001' });
  await row1.getByRole('button').first().click();
  await row1.getByRole('group', { name: 'What happened' }).getByRole('button', { name: 'Done' }).click();
  await expect(band.locator('.band-main')).toContainText('£22.80');
  // Typed miles win over the sheet; clearing them goes back to the sheet.
  await row1.getByLabel('Miles paid').fill('100');
  await expect(row1.locator('.sum-line')).toContainText('£28.00');
  await row1.getByLabel('Miles paid').fill('');
  await expect(row1.locator('.sum-line')).toContainText('£22.80');
  await fitsScreen(page, 'history, job open');
  await shot(page, '51-history-job-open');

  // A failed job pays nothing until the driver says what was offered.
  const row2 = page.locator('.hday li').filter({ hasText: 'TS17 0EY' });
  await row2.getByRole('button').first().click();
  await row2.getByRole('group', { name: 'What happened' }).getByRole('button', { name: 'Failed' }).click();
  await expect(row2.locator('.hjob-pay')).toHaveText('Add amount');
  await row2.getByLabel('What you were offered (£)').fill('abc');
  await expect(row2.getByText('Use a number, like 25.')).toBeVisible();
  await row2.getByLabel('What you were offered (£)').fill('25');
  await expect(row2.locator('.hjob-pay')).toHaveText('£25.00');
  await expect(band.locator('.band-main')).toContainText('£47.80');
  await expect(band).toContainText('1 done · 1 failed · 0 to do · 74 miles done');
  await shot(page, '52-history-week');

  // Rates can be changed, and put back.
  await page.getByRole('button', { name: 'Change rates' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByText('Jobs already marked done or failed keep the rates they were paid at.')).toBeVisible();
  await expect(dialog.getByLabel('Each mile after (pence)')).toHaveValue('20');
  await dialog.getByLabel('Each move (£)').fill('25');
  await fitsScreen(page, 'rates');
  await shot(page, '53-rates');
  await dialog.getByRole('button', { name: 'Save rates' }).click();
  // Both jobs are settled, so a new rate does not rewrite what they paid.
  await expect(band.locator('.band-main')).toContainText('£47.80');
  await page.getByRole('button', { name: 'Change rates' }).click();
  await dialog.getByRole('button', { name: 'Back to standard' }).click();
  await dialog.getByRole('button', { name: 'Save rates' }).click();
  await expect(band.locator('.band-main')).toContainText('£47.80');

  // It is all still there after closing and reopening the app.
  await page.reload();
  await sections.getByRole('button', { name: 'History and pay' }).click();
  await expect(band.locator('.band-main')).toContainText('£47.80');
  await page.getByRole('button', { name: 'Earlier week' }).click();
  await expect(page.getByText('Nothing planned in this week.')).toBeVisible();
  await page.getByRole('button', { name: 'Later week' }).click();
  await page.locator('.hday').getByRole('button', { name: 'Plan' }).click();
  await expect(cards).toHaveCount(2);
});

test('a carryover is paid when delivered, and is offered for delivery on a later day', async ({ page }) => {
  await open(page);
  await setDay(page);
  await page.getByLabel('Start from').fill('TS1 1EG');
  await page.getByRole('button', { name: 'Add a job by postcode' }).click();
  await page.getByLabel('Collect from').fill('TS15 9ZS');
  await page.getByLabel('Deliver to').fill('NE37 3HT');
  await page.getByLabel('Job number (optional)').fill('12000009');
  await page.getByLabel('Miles on sheet (optional)').fill('36');
  await page.getByLabel('Carryover: the car goes home tonight').check();
  await page.getByRole('button', { name: 'Add job', exact: true }).click();
  const cards = page.locator('.jobs > li');
  await expect(cards.first()).toContainText('TS15 9ZS → home');
  await expect(cards.first().locator('.job-pay')).toHaveText('Paid when delivered');

  // The next day: the car at home is offered for delivery.
  const next = new Date(`${nextWeekday()}T12:00:00Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  await page.getByLabel('Day', { exact: true }).fill(next.toISOString().slice(0, 10));
  await expect(cards).toHaveCount(0);
  await expect(page.getByText(/You took #12000009 home on Mon/)).toBeVisible();
  await fitsScreen(page, 'carryover offered');
  await shot(page, '55-carryover-offer');
  await page.getByRole('button', { name: 'Deliver it this day' }).click();
  await expect(cards).toHaveCount(1);
  await expect(cards.first()).toContainText('TS1 1EG → NE37 3HT');
  await expect(cards.first().locator('.job-pay')).toContainText('£20.00');
  await expect(page.getByText(/You took #12000009 home/)).toHaveCount(0);

  // Both days are in the history, and only the delivery is paid.
  await page.getByRole('group', { name: 'Section' }).getByRole('button', { name: 'History and pay' }).click();
  await expect(page.locator('.hday')).toHaveCount(2);
  await expect(page.locator('.hday').first().locator('.hjob-pay')).toHaveText('When delivered');
  await expect(page.locator('.hday').last().locator('.hjob-pay')).toHaveText('£20.00');
  await expect(page.locator('.band-main')).toContainText('£20.00');

  // Taking the delivery off again puts the car back on offer.
  await page.getByRole('group', { name: 'Section' }).getByRole('button', { name: 'Plan' }).click();
  await page.getByRole('button', { name: 'Remove job 1' }).click();
  await expect(page.getByText(/You took #12000009 home on Mon/)).toBeVisible();
});

test('removing a job can be undone, and history can be backed up and restored', async ({ page }) => {
  await open(page);
  await setDay(page);
  await page.getByLabel('Start from').fill('TS1 1EG');
  await addJob(page, page, 'TS3 8AT', 'WF6 1FL', '12000001');
  await addJob(page, page, 'TS17 0EY', 'NE37 3HT', '12000002');
  const cards = page.locator('.jobs > li');
  await expect(cards).toHaveCount(2);

  await page.getByRole('button', { name: 'Remove job 1' }).click();
  await expect(cards).toHaveCount(1);
  await page.getByRole('status').getByRole('button', { name: 'Undo' }).click();
  await expect(cards).toHaveCount(2);
  await expect(page.getByText('#12000001')).toBeVisible();

  // Save a backup file.
  await page.getByRole('group', { name: 'Section' }).getByRole('button', { name: 'History and pay' }).click();
  await fitsScreen(page, 'history with backup box');
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Save backup' }).click()]);
  const file = test.info().outputPath('backup.json');
  await download.saveAs(file);
  expect(download.suggestedFilename()).toMatch(/^plateway-backup-\d{4}-\d{2}-\d{2}\.json$/);

  // A new phone: everything gone, then restored from the file.
  await page.evaluate(() => localStorage.clear());
  await open(page);
  await page.getByRole('group', { name: 'Section' }).getByRole('button', { name: 'History and pay' }).click();
  await expect(page.getByText('No jobs yet. Every job you plan is kept here')).toBeVisible();
  await page.getByLabel('Choose a backup file').setInputFiles(file);
  await expect(page.getByRole('status')).toContainText('Restored 2 jobs from');
  // The jobs are on next Monday, so they are in next week.
  await page.getByRole('button', { name: 'Later week' }).click();
  await expect(page.locator('.hday li')).toHaveCount(2);

  // A file that is not a backup changes nothing and says why.
  const junk = test.info().outputPath('junk.json');
  writeFileSync(junk, '{"hello":1}');
  await page.getByLabel('Choose a backup file').setInputFiles(junk);
  await expect(page.getByRole('status')).toContainText("That file isn't a Plateway backup.");
  await expect(page.locator('.hday li')).toHaveCount(2);
});

test('with no signal, the last plan is still shown', async ({ page, context }) => {
  await open(page);
  await setDay(page);
  await page.getByLabel('Start from').fill('TS1 1EG');
  await addJob(page, page, 'TS3 8AT', 'WF6 1FL');
  await page.getByRole('button', { name: /^With a lift/ }).click();
  await page.getByRole('button', { name: 'See route' }).click();
  await expect(page.locator('.tl-job')).toHaveCount(1);
  // Map credit is on screen without tapping anything.
  await expect(page.locator('.map-credit')).toBeVisible();
  await expect(page.locator('.map-credit')).toContainText('OpenStreetMap');
  await shot(page, '60-credit');

  // Signal gone, page reloaded.
  await context.route(/postcodes\.io|project-osrm|openstreetmap\.de|transitous/, (r) => r.abort());
  await page.reload();
  // Reopening lands on the day's jobs; the route opens from the saved copy.
  await page.getByRole('button', { name: 'See route' }).click();
  await expect(page.locator('.tl-job')).toHaveCount(1);
  await expect(page.getByText(/Showing the plan saved at \d\d:\d\d/)).toBeVisible();
  await expect(page.getByText('There is no connection right now')).toBeVisible();
  await fitsScreen(page, 'saved plan, offline');
  await shot(page, '61-offline-plan');
});

test('the About page says what leaves the phone and credits the data', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText('Not connected to any logistics company.')).toBeVisible();
  await page.getByRole('button', { name: 'About Plateway' }).click();
  const about = page.getByRole('dialog', { name: 'About Plateway' });
  await expect(about).toContainText('any vehicle logistics or auction company');
  await expect(about).toContainText('Screenshots of job sheets are read on the phone and are not uploaded.');
  await expect(about.getByRole('link', { name: 'these timetable sources' })).toHaveAttribute('href', 'https://transitous.org/sources/');
  await expect(about.getByRole('link', { name: 'Fix the map' })).toHaveAttribute('href', 'https://www.openstreetmap.org/fixthemap');
  await expect(about).toContainText('Open Government Licence');
  await expect(about).toContainText('It sets no cookies');
  await fitsScreen(page, 'about');
  await shot(page, '62-about');
});

test('driver adds jobs from three real screenshots', async ({ page }) => {
  const dir = process.env.SHOTS_DIR;
  test.skip(!dir || !existsSync(`${dir}/1.png`) || !existsSync(`${dir}/expected.json`), 'set SHOTS_DIR to a folder with 1.png, 2.png, 3.png and expected.json');
  await open(page);
  await setDay(page);
  await page.getByLabel('Start from').fill('TS1 1EG');
  await page.getByRole('button', { name: 'Screenshots' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('heading', { name: 'Add jobs' })).toBeVisible();
  await dialog.locator('input[type=file]').setInputFiles([`${dir}/1.png`, `${dir}/2.png`, `${dir}/3.png`]);
  await expect(dialog.getByRole('img')).toHaveCount(3);
  await fitsScreen(page, 'import, screenshots picked');
  await shot(page, '10-import-picked');
  await dialog.getByRole('button', { name: 'Read 3 screenshots' }).click();
  await expect(dialog.getByRole('heading', { name: 'Check these jobs' })).toBeVisible({ timeout: 150_000 });

  const rows = dialog.locator('fieldset');
  await expect(rows).toHaveCount(4);
  const read = await rows.evaluateAll((els) => els.map((el) => [...el.querySelectorAll('input:not([type=checkbox])')].map((i) => (i as HTMLInputElement).value)));
  // What the sheets say is kept beside the screenshots (expected.json), so no real job details live in the code.
  const expected = JSON.parse(readFileSync(`${dir}/expected.json`, 'utf8')) as { rows: string[][]; liftFrom?: string; datePassed?: boolean };
  expect(read).toEqual(expected.rows);
  if (expected.liftFrom) await expect(dialog.getByText(new RegExp(`lift from ${expected.liftFrom}`))).toBeVisible();
  if (expected.datePassed) await expect(dialog.getByText(/this date has passed/)).toBeVisible();
  await fitsScreen(page, 'import, confirm');
  await shot(page, '11-import-confirm');

  // Leave the first job out, and a bad edit blocks adding until it is fixed.
  await rows.nth(0).getByRole('checkbox').first().uncheck();
  await rows.nth(1).getByLabel('Deliver to').fill('ZZ99 9ZZ');
  await expect(dialog.getByText("We can't find ZZ99 9ZZ. Check it and try again.")).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Add 3 jobs' })).toBeDisabled();
  await rows.nth(1).getByLabel('Deliver to').fill('WF6 1FL');
  await dialog.getByRole('button', { name: 'Add 3 jobs' }).click();

  await expect(page.getByText('3 jobs added')).toBeVisible();
  await expect(page.locator('.jobs > li')).toHaveCount(3);
  await expect(page.getByText(`#${expected.rows[1][0]}`)).toBeVisible();
  await expect(page.getByRole('button', { name: /^With a lift/ })).toContainText('Done by');
  await shot(page, '12-import-added');

  // Reading the same sheet again updates the jobs rather than doubling them.
  await page.getByRole('button', { name: 'Screenshots' }).click();
  await dialog.locator('input[type=file]').setInputFiles([`${dir}/3.png`]);
  await dialog.getByRole('button', { name: 'Read 1 screenshot' }).click();
  await expect(dialog.getByRole('heading', { name: 'Check these jobs' })).toBeVisible({ timeout: 150_000 });
  await dialog.getByRole('button', { name: /^Add \d jobs?$/ }).click();
  await expect(page.locator('.jobs > li')).toHaveCount(3);
});

test('driver pastes email text', async ({ page }) => {
  await open(page);
  await page.getByRole('button', { name: 'Screenshots' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Or paste the email text').fill('nothing useful here');
  await dialog.getByRole('button', { name: 'Read jobs' }).click();
  await expect(dialog.getByText('No jobs were found in that text. Paste the whole email, or type the job in by hand.')).toBeVisible();
  await dialog.getByLabel('Or paste the email text').fill('Driver Work and StartTimes for 17/11/2026\nZZ999\nSam Sample\nJob1 12000001 "ON EVO" TS3 8AT Example Auctions\nWF6 1FL\nLift from :ALEX - 07000000000\nJob2 12000002 TS17 0EY NE37 3HT');
  await dialog.getByRole('button', { name: 'Read jobs' }).click();
  await expect(dialog.getByRole('heading', { name: 'Check these jobs' })).toBeVisible();
  await expect(dialog.locator('fieldset')).toHaveCount(2);
  await dialog.getByRole('button', { name: 'Add 2 jobs' }).click();
  await expect(page.locator('.jobs > li')).toHaveCount(2);
});

test('lift driver plans a run for three drivers', async ({ page, context }) => {
  const phone = test.info().project.name === 'phone';
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await open(page, 'Lift driver');
  await expect(page.getByRole('heading', { name: 'Who are you carrying?' })).toBeVisible();
  await shot(page, '20-team-empty');
  await setDay(page);
  await page.getByLabel('Start from').fill('TS1 1EG');

  const team: [string, [string, string | null][]][] = [
    ['AB123', [['TS17 0EY', 'NE37 3HT'], ['TS3 8AT', null]]],
    ['MK214', [['TS15 9ZS', 'NE37 3HT'], ['DL1 4AA', null]]],
    ['SR507', [['TS5 5QG', 'WF6 1FL'], ['YO24 1AB', null]]],
  ];
  for (const [i, [sign, jobs]] of team.entries()) {
    await page.getByRole('button', { name: 'Add a driver' }).click();
    const card = page.locator('.drv').nth(i);
    await card.getByLabel(`Call sign for driver ${i + 1}`).fill(sign.toLowerCase());
    for (const [c, d] of jobs) await addJob(page, card, c, d, '', '+ Add job');
    await expect(card.locator('.jr')).toHaveCount(2);
  }
  await expect(page.getByText('3 drivers · 6 jobs')).toBeVisible();
  await fitsScreen(page, 'team');
  await shot(page, '21-team-filled');

  await page.getByRole('button', { name: 'Plan the run' }).click();
  await expect(page.locator('.sum')).toContainText('9 stops');
  await expect(page.locator('.sum')).toContainText('Back');
  const stops = page.locator('.stops-list > li');
  await expect(stops).toHaveCount(10);
  await expect(stops.first()).toContainText(/Drop (AB123|MK214|SR507)/);
  await expect(stops.last()).toContainText('Back at the start');
  await expect(page.getByRole('link', { name: 'Open the whole run in Google Maps' })).toHaveAttribute('href', /waypoints=/);
  await expect(page.locator('.map[data-ready=true]')).toBeVisible();
  await expect(page.locator('.pin')).toHaveCount(await page.locator('.pin').count());
  await expect(page.locator('.pin').first()).toBeVisible();
  await page.waitForTimeout(3500);
  await fitsScreen(page, 'run, stops');
  await shot(page, '22-run-stops');

  if (phone) await page.getByRole('button', { name: 'Show the full plan' }).click();
  await page.getByRole('group', { name: 'What to show' }).getByRole('button', { name: 'Drivers' }).click();
  await expect(page.locator('.lanes > li')).toHaveCount(3);
  await expect(page.locator('.lanes > li').first()).toContainText('Carryover');
  await page.waitForTimeout(800);
  await fitsScreen(page, 'run, drivers');
  await shot(page, '23-run-drivers');

  await page.locator('.lanes > li').first().getByRole('button', { name: 'Send plan' }).click();
  const copied = await page.evaluate(() => navigator.clipboard.readText()).catch(() => '');
  if (copied) {
    expect(copied).toContain('AB123: lift plan for');
    expect(copied).toContain('Carryover: take it home.');
    await expect(page.getByText('Plan for AB123 copied. Paste it into a message.')).toBeVisible();
  }

  // Back to the team keeps everything; reload too.
  if (phone) await page.getByRole('button', { name: 'Show the map' }).click();
  await page.getByRole('button', { name: 'Team' }).click();
  await expect(page.locator('.drv')).toHaveCount(3);
  await page.reload();
  await expect(page.locator('.drv')).toHaveCount(3);
});

test('leave now sets the day and time to right now, for both drivers', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-11-21T13:56:20Z'));
  for (const role of ['Plate driver', 'Lift driver'] as const) {
    await open(page, role);
    await page.getByLabel('Leave at').fill('07:00');
    await page.getByRole('button', { name: 'Leave now' }).click();
    await expect(page.getByLabel('Leave at')).toHaveValue('13:56');
    await expect(page.getByLabel('Day', { exact: true })).toHaveValue('2026-11-21');
    await expect(page.getByRole('button', { name: 'Leaving now' })).toBeVisible();
    await fitsScreen(page, `${role} leave now`);
    await page.screenshot({ path: `test-results/leave-now-${role.split(' ')[0].toLowerCase()}-${page.viewportSize()!.width}.png` });
    await page.evaluate(() => localStorage.clear());
  }
});

test('bad input is explained in plain words', async ({ page }) => {
  await open(page);
  await page.getByLabel('Start from').fill('ZZ99 9ZZ');
  await expect(page.getByText("We can't find ZZ99 9ZZ. Check it and try again.")).toBeVisible();
  await page.getByLabel('Start from').fill('HELLO THERE');
  await expect(page.getByText("That doesn't look like a full UK postcode.")).toBeVisible();
  await page.getByRole('button', { name: 'Add a job by postcode' }).click();
  await page.getByRole('button', { name: 'Add job', exact: true }).click();
  await expect(page.getByText('Enter the full collection postcode, like TS3 8AT.')).toBeVisible();
  await page.getByLabel('Collect from').fill('TS3 8AT');
  await page.getByRole('button', { name: 'Add job', exact: true }).click();
  await expect(page.getByText('Enter the full delivery postcode, or tick carryover if the car is going home with you.')).toBeVisible();
  await page.getByLabel('Deliver to').fill('ZZ99 9ZZ');
  await page.getByRole('button', { name: 'Add job', exact: true }).click();
  await expect(page.getByText("We can't find ZZ99 9ZZ. Edit this job.")).toBeVisible();
  await expect(page.getByRole('button', { name: 'See route' })).toBeDisabled();
  await fitsScreen(page, 'bad input');
  await shot(page, '30-bad-input');
});

test('location: allowed fills the nearest postcode, refused says what to do', async ({ browser }) => {
  const allowed = await browser.newContext({ ...test.info().project.use, geolocation: { latitude: 54.57896, longitude: -1.23494 }, permissions: ['geolocation'] });
  const a = await allowed.newPage();
  await open(a);
  await a.getByRole('button', { name: 'Use my location' }).click();
  await expect(a.getByLabel('Start from')).toHaveValue(/^TS1 /);
  await allowed.close();

  const refused = await browser.newContext({ ...test.info().project.use, permissions: [] });
  const b = await refused.newPage();
  await open(b);
  await b.getByRole('button', { name: 'Use my location' }).click();
  await expect(b.getByText(/Location is switched off for this site|Could not get your location/)).toBeVisible();
  await refused.close();
});

async function fillDay(page: Page) {
  await setDay(page);
  await page.getByLabel('Start from').fill('TS1 1EG');
  await addJob(page, page, 'TS3 8AT', 'WF6 1FL');
}

test('[fault] road routing down: says so and offers a retry', async ({ page }) => {
  await page.route(/router\.project-osrm\.org|routing\.openstreetmap\.de/, (r) => r.abort());
  await open(page);
  await fillDay(page);
  const lift = page.getByRole('button', { name: /^With a lift/ });
  await expect(lift).toContainText("Couldn't work this out. Could not reach the road routing service. Check your connection and try again.");
  await page.getByRole('button', { name: 'See route' }).click();
  await expect(page.getByText('Could not reach the road routing service. Check your connection and try again.')).toBeVisible();
  await shot(page, '40-roads-down');
  await expect(page.getByText(/Failed to fetch|TypeError|undefined|NetworkError/)).toHaveCount(0);
  // The service comes back: retry works.
  await page.unroute(/router\.project-osrm\.org|routing\.openstreetmap\.de/);
  await page.getByRole('button', { name: 'Try again' }).click();
  await expect(page.locator('.tl-job')).toHaveCount(1);
});

test('[fault] timetables down: solo explains, lift still plans', async ({ page }) => {
  await page.route(/api\.transitous\.org/, (r) => r.abort());
  await open(page);
  await fillDay(page);
  await expect(page.getByRole('button', { name: /^With a lift/ })).toContainText('Done by');
  await expect(page.getByRole('button', { name: /^Solo/ })).toContainText("Couldn't work this out. Could not reach the public transport service. Check your connection and try again.");
  await shot(page, '41-transit-down');
});

test('[fault] no public transport found: shown by road with a plain note', async ({ page }) => {
  await page.route(/api\.transitous\.org/, (r) => r.fulfill({ json: { itineraries: [], direct: [] } }));
  await open(page);
  await fillDay(page);
  await page.getByRole('button', { name: /^Solo/ }).click();
  await page.getByRole('button', { name: 'See route' }).click();
  await expect(page.getByText('No public transport was found for part of the day. That part is shown by road, so allow for a taxi or a lift.')).toBeVisible();
  await expect(page.locator('.tl-gap').first()).toContainText('No public transport found to');
});

test('[fault] postcode lookup down: says so', async ({ page }) => {
  await page.route(/api\.postcodes\.io/, (r) => r.abort());
  await open(page);
  await page.getByLabel('Start from').fill('TS1 1EG');
  await expect(page.getByText('Could not reach the postcode lookup. Check your connection and try again.')).toBeVisible();
  await shot(page, '42-postcodes-down');
});

test('[fault] a 500 from the road service is not shown raw', async ({ page }) => {
  await page.route(/router\.project-osrm\.org|routing\.openstreetmap\.de/, (r) => r.fulfill({ status: 500, body: 'Internal Server Error' }));
  await open(page);
  await fillDay(page);
  await expect(page.getByRole('button', { name: /^With a lift/ })).toContainText('Could not reach the road routing service.');
  await expect(page.getByText(/HTTP 500|Internal Server Error/)).toHaveCount(0);
});

test('installable: manifest, icons and offline shell are served', async ({ request }) => {
  const manifest = await (await request.get('/manifest.webmanifest')).json();
  expect(manifest.name).toBe('Plateway');
  expect(manifest.display).toBe('standalone');
  for (const icon of manifest.icons) expect((await request.get(`/${icon.src}`)).status()).toBe(200);
  expect((await request.get('/sw.js')).status()).toBe(200);
});
