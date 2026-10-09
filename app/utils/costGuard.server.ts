/**
 * Cloudflare cost guards.
 *
 * - Kill switch: a central guard sets the secret COST_KILL_SWITCH="1" when the
 *   account's spend breaches its budget. While set, the Worker and every
 *   Durable Object refuse work before touching any binding.
 * - Runaway breaker: per-object, in-memory (zero storage cost) op counter over
 *   fixed 60s windows. Stops a single hot object (bug, reconnect storm, abuse)
 *   from burning requests/duration indefinitely.
 */

export const COST_GUARD_MESSAGE = 'temporarily disabled by cost guard'

export function isCostKillSwitchOn(env: { COST_KILL_SWITCH?: string }) {
	return env.COST_KILL_SWITCH === '1'
}

export function costKillSwitchResponse() {
	return new Response(JSON.stringify({ error: COST_GUARD_MESSAGE }), {
		status: 503,
		headers: {
			'Content-Type': 'application/json',
			'Retry-After': '3600',
		},
	})
}

export function costBreakerResponse() {
	return new Response(JSON.stringify({ error: 'rate limited by cost guard' }), {
		status: 429,
		headers: { 'Content-Type': 'application/json', 'Retry-After': '60' },
	})
}

export const BREAKER_WINDOW_MS = 60_000

export class RunawayBreaker {
	private windowStart = 0
	private counts = new Map<string, number>()
	private warned = false

	private name: string
	private limits: Record<string, number>
	private now: () => number

	constructor(
		name: string,
		limits: Record<string, number>,
		now: () => number = Date.now
	) {
		this.name = name
		this.limits = limits
		this.now = now
	}

	/** Counts one op of `kind`; returns false when the window limit is exceeded. */
	allow(kind: string): boolean {
		const now = this.now()
		if (now - this.windowStart >= BREAKER_WINDOW_MS) {
			this.windowStart = now
			this.counts.clear()
			this.warned = false
		}
		const count = (this.counts.get(kind) ?? 0) + 1
		this.counts.set(kind, count)
		const limit = this.limits[kind]
		if (limit === undefined || count <= limit) return true
		if (!this.warned) {
			this.warned = true
			console.warn(
				`[cost-guard] ${this.name}: runaway breaker tripped (${kind} > ${limit}/min)`
			)
		}
		return false
	}
}
