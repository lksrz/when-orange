import { expect, test } from '@playwright/test'
import { randomUUID } from 'crypto'

test('Two users joining the same room', async ({ browser }) => {
	// can't use nanoid here :(
	const location = `http://localhost:8787/${randomUUID()}`

	const context = await browser.newContext()
	const page = await context.newPage()

	await page.goto(location)
	await page.getByLabel('Enter your display name').fill('kevin')
	await page.getByLabel('Enter your display name').press('Enter')

	// Wait for Join button to be visible and enabled (session ready)
	await expect(page.getByRole('button', { name: 'Join' })).toBeVisible({
		timeout: 20000,
	})
	await expect(page.getByRole('button', { name: 'Join' })).toBeEnabled({
		timeout: 20000,
	})

	await page.getByRole('button', { name: 'Join' }).click()
	await expect(page.getByRole('button', { name: 'Leave' })).toBeVisible({
		timeout: 10000,
	})

	const pageTwo = await context.newPage()
	await pageTwo.goto(location)

	// Wait for session on second page too
	await expect(pageTwo.getByRole('button', { name: 'Join' })).toBeVisible({
		timeout: 20000,
	})
	await expect(pageTwo.getByRole('button', { name: 'Join' })).toBeEnabled({
		timeout: 20000,
	})

	await pageTwo.getByRole('button', { name: 'Join' }).click()
	await expect(pageTwo.getByRole('button', { name: 'Leave' })).toBeVisible({
		timeout: 10000,
	})

	await expect
		.poll(async () => page.locator('video').count(), { timeout: 15_000 })
		.toBe(2)

	await expect
		.poll(async () => pageTwo.locator('video').count(), { timeout: 15_000 })
		.toBe(2)
})

test('Username parameter automatically sets username', async ({ browser }) => {
	// can't use nanoid here :(
	const roomId = randomUUID()
	const location = `http://localhost:8787/${roomId}?username=lukasz`

	const context = await browser.newContext()
	const page = await context.newPage()

	await page.goto(location)

	// Should not see the username form, should go directly to the room lobby
	await expect(page.getByLabel('Enter your display name')).not.toBeVisible()

	// Wait for the session to be established and Join button to be enabled
	await expect(page.getByRole('button', { name: 'Join' })).toBeVisible({
		timeout: 20000,
	})
	await expect(page.getByRole('button', { name: 'Join' })).toBeEnabled({
		timeout: 20000,
	})
})
