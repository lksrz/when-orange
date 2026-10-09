import { describe, expect, test, vi } from 'vitest'
import {
	costBreakerResponse,
	costKillSwitchResponse,
	isCostKillSwitchOn,
	RunawayBreaker,
} from './costGuard.server'

describe('cost kill switch', () => {
	test('only "1" enables it', () => {
		expect(isCostKillSwitchOn({ COST_KILL_SWITCH: '1' })).toBe(true)
		expect(isCostKillSwitchOn({ COST_KILL_SWITCH: '0' })).toBe(false)
		expect(isCostKillSwitchOn({})).toBe(false)
	})

	test('responds 503 with Retry-After', async () => {
		const res = costKillSwitchResponse()
		expect(res.status).toBe(503)
		expect(res.headers.get('Retry-After')).toBe('3600')
		expect(await res.json()).toEqual({
			error: 'temporarily disabled by cost guard',
		})
	})
})

describe('cost breaker response', () => {
	test('responds 429 with Retry-After', async () => {
		const res = costBreakerResponse()
		expect(res.status).toBe(429)
		expect(res.headers.get('Retry-After')).toBe('60')
		expect(res.headers.get('Content-Type')).toBe('application/json')
		expect(await res.json()).toEqual({ error: 'rate limited by cost guard' })
	})
})

describe('RunawayBreaker', () => {
	test('trips above limit, warns once, resets next window', () => {
		let now = 1_000
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
		const breaker = new RunawayBreaker('test', { op: 2 }, () => now)
		expect(breaker.allow('op')).toBe(true)
		expect(breaker.allow('op')).toBe(true)
		expect(breaker.allow('op')).toBe(false)
		expect(breaker.allow('op')).toBe(false)
		expect(warn).toHaveBeenCalledTimes(1)
		expect(breaker.allow('other')).toBe(true)
		now += 60_000
		expect(breaker.allow('op')).toBe(true)
		warn.mockRestore()
	})
})
