// Console log filter to reduce noise from external libraries
const originalConsoleLog = console.log
const originalConsoleInfo = console.info
const originalConsoleError = console.error
const originalConsoleDebug = console.debug

// Throttle map to track when messages were last logged
const throttleMap = new Map<string, number>()

// Messages to filter out completely
const FILTERED_MESSAGES = [
	'📤 pushing track',
	'📥 pulling track',
	'♻︎ replacing track',
	'🔚 Closing pushed track',
	'🔚 Closing pulled track',
	'👩🏻‍⚕️ track is healthy!',
	'Frame decryption failed: Not in a group, so decryption does not make sense',
	'🛑 Stopping track',
	'🙏🏻 Requesting',
	'👩🏻‍⚕️ Checking track health',
	'🌱 creating transceiver!',
	'Tab is foregrounded, checking health...',
	'Received event of type userLeft from main thread',
	'Received event of type encryptStream from main thread',
	'Received event of type decryptStream from main thread',
	'Received event of type userJoined from main thread',
	'Received event of type initializeAndCreateGroup from main thread',
	'Received event of type initialize from main thread',
	'panicked at',
	'RuntimeError: Unreachable code should not be executed',
	'assertion `left == right` failed: cannot recursively acquire mutex',
	'could not remove user: EmptyInput(RemoveMembers)',
]

// Messages to throttle (show only every N seconds)
const THROTTLED_MESSAGES = [
	{
		pattern: /WebSocket connection.*failed.*network connection was lost/,
		throttleMs: 5000, // 5 seconds
	},
	{
		pattern: /Frame decryption failed: Not in a group/,
		throttleMs: 10000, // 10 seconds
	},
	{
		pattern: /🔐 Worker is unhealthy/,
		throttleMs: 10000, // 10 seconds
	},
	{
		pattern: /🔐 Worker health check failed/,
		throttleMs: 15000, // 15 seconds
	},
	{
		pattern: /🔐 Failed to (process|set up)/,
		throttleMs: 5000, // 5 seconds
	},
]

function shouldFilterMessage(message: string): boolean {
	return FILTERED_MESSAGES.some((filter) => message.includes(filter))
}

function shouldThrottleMessage(message: string): boolean {
	for (const throttled of THROTTLED_MESSAGES) {
		if (throttled.pattern.test(message)) {
			const now = Date.now()
			const lastLogged = throttleMap.get(message)

			if (!lastLogged || now - lastLogged > throttled.throttleMs) {
				throttleMap.set(message, now)
				return false // Don't throttle, allow this message
			}
			return true // Throttle this message
		}
	}
	return false
}

function filterConsoleMessage(
	level: 'log' | 'info' | 'error' | 'debug',
	...args: any[]
) {
	const message = args.join(' ')

	// Filter out completely blocked messages
	if (shouldFilterMessage(message)) {
		return
	}

	// Throttle certain messages
	if (shouldThrottleMessage(message)) {
		return
	}

	// Allow the message through
	switch (level) {
		case 'log':
			originalConsoleLog(...args)
			break
		case 'info':
			originalConsoleInfo(...args)
			break
		case 'error':
			originalConsoleError(...args)
			break
		case 'debug':
			originalConsoleDebug(...args)
			break
	}
}

// Override console methods
console.log = (...args: any[]) => filterConsoleMessage('log', ...args)
console.info = (...args: any[]) => filterConsoleMessage('info', ...args)
console.error = (...args: any[]) => filterConsoleMessage('error', ...args)
console.debug = (...args: any[]) => filterConsoleMessage('debug', ...args)

// Export function to restore original console if needed
export function restoreConsole() {
	console.log = originalConsoleLog
	console.info = originalConsoleInfo
	console.error = originalConsoleError
	console.debug = originalConsoleDebug
}

export function addFilteredMessage(message: string) {
	FILTERED_MESSAGES.push(message)
}

export function addThrottledMessage(pattern: RegExp, throttleMs: number) {
	THROTTLED_MESSAGES.push({ pattern, throttleMs })
}
