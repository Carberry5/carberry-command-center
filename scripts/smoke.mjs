import { chromium } from 'playwright'

const BASE = process.env.BASE ?? 'http://127.0.0.1:5173'
// PW_CHROMIUM lets a sandbox point at a pre-installed browser; normally
// Playwright resolves its own after `npx playwright install chromium`.
const browser = await chromium.launch(
  process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {}
)
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })

const errors = []
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text())
})
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))
page.on('requestfailed', (r) => errors.push(`requestfailed: ${r.url()}`))
page.on('response', (r) => { if (r.status() >= 400) errors.push(`http ${r.status()} ${r.url()}`) })

await page.goto(BASE, { waitUntil: 'networkidle' })
await page.waitForTimeout(1200)

const results = []
const check = async (label, fn) => {
  try {
    results.push(`${(await fn()) ? 'ok  ' : 'FAIL'}  ${label}`)
  } catch (err) {
    results.push(`FAIL  ${label} — ${err.message}`)
  }
}

await check('Today renders the hero greeting', async () =>
  /Good (morning|afternoon|evening)!/.test(await page.textContent('body'))
)
await check('agenda shows a seeded event', async () =>
  (await page.textContent('body')).includes('Library storytime')
)
await check('pre-flight card present', async () =>
  (await page.textContent('body')).includes('Morning pre-flight')
)
await check('departure chip present', async () =>
  /Leave by 7:30 AM|Leave in \d+ min|Departed/.test(await page.textContent('body'))
)
await check('quote of the week present', async () =>
  (await page.textContent('body')).includes('QUOTE OF THE WEEK')
)

// Walk every nav destination.
for (const [label, expect] of [
  ['Calendar', 'Everyone'],
  ['Chores', 'Reward shop'],
  ['Meals', 'Family favorites'],
  ['Grocery', 'Things we regularly buy'],
  ['Lists', 'Groceries'],
  ['Countdowns', 'DAYS TO GO'],
  ['Sidekick', 'Paste a school email'],
]) {
  await check(`nav → ${label}`, async () => {
    await page.getByRole('button', { name: label, exact: true }).first().click()
    await page.waitForTimeout(350)
    return (await page.textContent('body')).includes(expect)
  })
}

// Settings is PIN-gated; the pad should appear, then accept 1234.
await check('Settings prompts for the parent PIN', async () => {
  await page.getByRole('button', { name: 'Settings', exact: true }).first().click()
  await page.waitForTimeout(350)
  return (await page.textContent('body')).includes('Settings are parent-only')
})
await check('PIN 1234 unlocks Settings', async () => {
  for (const digit of ['1', '2', '3', '4']) {
    await page.getByRole('button', { name: digit, exact: true }).first().click()
    await page.waitForTimeout(120)
  }
  await page.waitForTimeout(500)
  const body = await page.textContent('body')
  return body.includes('School pre-flight') && body.includes('Family vault')
})

// Kid pages via the family dots in the rail.
await check("Hadley's page is space-themed", async () => {
  await page.getByTitle('Hadley').first().click()
  await page.waitForTimeout(400)
  return /future astronaut/i.test(await page.textContent('body'))
})
await check('Greenlight card on a kid page', async () =>
  (await page.textContent('body')).includes('Greenlight')
)
await check("Cannon's page reads Go Irish · Go Bills", async () => {
  await page.getByTitle('Cannon').first().click()
  await page.waitForTimeout(400)
  return /go irish · go bills/i.test(await page.textContent('body'))
})
await check("Patrick's page shows the WHOOP card", async () => {
  await page.getByTitle('Patrick').first().click()
  await page.waitForTimeout(400)
  return (await page.textContent('body')).includes('WHOOP')
})

// Ticking a chore should award stars via the toast.
await check('ticking a chore toasts the star award', async () => {
  await page.getByRole('button', { name: 'Chores', exact: true }).first().click()
  await page.waitForTimeout(400)
  await page.getByText('Drink your water').first().click()
  await page.waitForTimeout(400)
  return /★ for \w+ — nice!/.test(await page.textContent('body'))
})

// Add-event dialog opens from Today.
await check('event dialog opens', async () => {
  await page.getByRole('button', { name: 'Today', exact: true }).first().click()
  await page.waitForTimeout(300)
  await page.getByRole('button', { name: '+ Add event' }).first().click()
  await page.waitForTimeout(300)
  const body = await page.textContent('body')
  return body.includes('New event') && body.includes('Drop-off') && body.includes('Repeats weekly')
})

await browser.close()

console.log(results.join('\n'))
console.log(
  errors.length ? `\nconsole errors:\n${[...new Set(errors)].join('\n')}` : '\nno console errors'
)
console.log(results.some((r) => r.startsWith('FAIL')) ? '\nSMOKE FAILED' : '\nSMOKE PASSED')
if (results.some((r) => r.startsWith('FAIL'))) process.exitCode = 1
