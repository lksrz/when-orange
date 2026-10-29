import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import { action } from '../routes/api.transcription-token'

const requestAction = (url: string, env: Record<string, unknown>) =>
	action({
		request: new Request(url, { method: 'POST' }),
		context: { env },
		params: {},
	} as any)

describe('transcription token endpoint', () => {
	it('keeps the dormant Worker transcription default disabled', () => {
		const config = readFileSync('wrangler.toml', 'utf8')
		expect(config).toMatch(/^TRANSCRIPTION_ENABLED = "false"$/m)
	})

	it('never returns the server credential on the standard path', async () => {
		const secret = 'test-openai-secret-do-not-expose'
		const response = await requestAction(
			'https://example.test/api/transcription-token',
			{ OPENAI_API_TOKEN: secret }
		)
		expect(response.status).toBe(410)
		expect(await response.text()).not.toContain(secret)
	})

	it.each([
		'https://example.test/api/transcription-token/realtime',
		'https://example.test/api/transcription-token/realtime/session',
		'https://example.test/api/transcription-token?type=realtime',
	])(
		'keeps the realtime path delegated to the Durable Object: %s',
		async (url) => {
			const fetch = vi.fn(async (_request: Request) =>
				Response.json({ client_secret: { value: 'ephemeral-test-token' } })
			)
			const transcriptionService = {
				idFromName: () => ({ toString: () => 'test-id' }),
				get: () => ({ fetch }),
			}
			const response = await requestAction(url, {
				OPENAI_API_TOKEN: 'server-secret',
				transcriptionService,
			})
			expect(response.status).toBe(200)
			expect(await response.json()).toMatchObject({
				provider: 'openai-realtime',
				client_secret: { value: 'ephemeral-test-token' },
			})
			expect(fetch).toHaveBeenCalledTimes(1)
			expect(fetch.mock.calls[0]?.[0]).toMatchObject({ method: 'GET' })
		}
	)
})
