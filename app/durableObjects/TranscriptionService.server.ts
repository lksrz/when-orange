import type { Env } from '~/types/Env'

/**
 * TranscriptionService Durable Object
 *
 * This service acts as a secure bridge between the client and the Deepgram API:
 * 1. Receives messages from the API route WebSocket
 * 2. Connects to Deepgram using the server-side API key
 * 3. Forwards audio data to Deepgram
 * 4. Returns transcription results to the client via the API route
 */

// Configuration constants
const MAX_BUFFER_SIZE = 1024 * 1024 // 1MB max buffer size
const DEFAULT_CONNECTION_TIMEOUT = 30000 // 30 seconds default timeout
const MAX_MESSAGE_RATE = 60 // Maximum number of messages per second
const RATE_LIMIT_WINDOW_MS = 1000 // 1 second window for rate limiting
const MAX_CONSECUTIVE_EMPTY_BUFFERS = 10 // Maximum consecutive empty buffers
const DEEPGRAM_API_URL = 'wss://api.deepgram.com/v1/listen'

// Messages to/from the client and deepgram service
interface ClientMessage {
	type: string
	[key: string]: any
}

interface PendingResponse {
	resolver: (response: any) => void
	timestamp: number
}

export class TranscriptionService {
	state: DurableObjectState
	env: Env
	deepgramSocket: WebSocket | null = null
	messageQueue: ArrayBuffer[] = []
	messageRate: {
		count: number
		lastReset: number
		consecutiveEmptyBuffers: number
	} = { count: 0, lastReset: 0, consecutiveEmptyBuffers: 0 }

	// Keep track of pending responses to API requests
	pendingResponses: Map<string, PendingResponse> = new Map()

	// Timeouts and intervals
	deepgramKeepaliveInterval: number | null = null
	deepgramInactivityTimeout: number | null = null
	deepgramConnectTimeout: number | null = null

	// Connection state
	token: string = ''
	deepgramConnected: boolean = false
	lastActivityTimestamp: number = 0
	userAgent: string = ''

	constructor(state: DurableObjectState, env: Env) {
		this.state = state
		this.env = env

		// Start state persistence
		this.state.blockConcurrencyWhile(async () => {
			// Load persistent state if it exists
			const stored = (await this.state.storage.get('sessionInfo')) as Record<
				string,
				string
			> | null
			if (stored) {
				this.token = stored.token || ''
				this.userAgent = stored.userAgent || ''
			}
		})
	}

	// Main fetch handler for the DO
	async fetch(request: Request): Promise<Response> {
		const url = new URL(request.url)

		// Create a unique request ID for tracing
		const requestId = crypto.randomUUID()

		try {
			// Log all incoming requests with extensive details for debugging
			console.log(`TranscriptionService: Received request [${requestId}]`, {
				method: request.method,
				url: request.url,
				headers: Object.fromEntries([...request.headers.entries()]),
				hasUpgradeHeader: Boolean(request.headers.get('Upgrade')),
				upgradeHeaderValue: request.headers.get('Upgrade'),
				env: {
					hasDeepgramSecret: Boolean(this.env.DEEPGRAM_SECRET),
					hasTranscriptionService: Boolean(this.env.transcriptionService),
				},
			})

			// Handle WebSocket connections directly to the DO (should not happen)
			if (request.headers.get('Upgrade')?.toLowerCase() === 'websocket') {
				console.error(
					`TranscriptionService: Direct WebSocket connections not supported [${requestId}]`
				)
				return new Response('Direct WebSocket connections not supported', {
					status: 400,
					headers: {
						'Content-Type': 'application/json',
						'X-Request-ID': requestId,
					},
				})
			}

			// Check if Deepgram API key is configured
			if (!this.env.DEEPGRAM_SECRET) {
				console.error(
					`TranscriptionService: DEEPGRAM_SECRET not configured [${requestId}]`
				)
				return new Response(
					JSON.stringify({
						error: 'Transcription service misconfigured: Missing API key',
						requestId,
					}),
					{
						status: 500,
						headers: {
							'Content-Type': 'application/json',
							'X-Request-ID': requestId,
						},
					}
				)
			}

			// Get authentication token from headers
			const token = request.headers.get('X-Token') || ''

			// Handle different HTTP methods
			if (request.method === 'PUT') {
				return await this.handleSetup(request, token)
			} else if (request.method === 'POST') {
				return await this.handleMessage(request, token)
			} else if (request.method === 'DELETE') {
				return await this.handleCleanup(request)
			} else {
				console.warn(
					`TranscriptionService: Method ${request.method} not allowed [${requestId}]`
				)
				return new Response(
					JSON.stringify({
						error: 'Method not allowed',
						allowedMethods: ['PUT', 'POST', 'DELETE'],
						requestId,
					}),
					{
						status: 405,
						headers: {
							Allow: 'PUT, POST, DELETE',
							'Content-Type': 'application/json',
							'X-Request-ID': requestId,
						},
					}
				)
			}
		} catch (error) {
			console.error(
				`TranscriptionService: Unhandled error [${requestId}]`,
				error
			)
			return new Response(
				JSON.stringify({
					error: `Internal server error: ${error instanceof Error ? error.message : 'Unknown error'}`,
					requestId,
					timestamp: Date.now(),
				}),
				{
					status: 500,
					headers: {
						'Content-Type': 'application/json',
						'X-Request-ID': requestId,
					},
				}
			)
		}
	}

	// Handle setup request
	async handleSetup(request: Request, token: string): Promise<Response> {
		let requestData: any = {}

		try {
			requestData = await request.json()
		} catch (error) {
			// Default values if JSON is invalid
			requestData = { type: 'setup' }
		}

		// Store connection information
		this.token = token
		this.userAgent =
			requestData.userAgent || request.headers.get('User-Agent') || 'unknown'
		this.lastActivityTimestamp = Date.now()

		// Persist this information
		await this.state.storage.put('sessionInfo', {
			token: this.token,
			userAgent: this.userAgent,
			created: this.lastActivityTimestamp,
		})

		console.log('TranscriptionService: Session initialized', {
			token: token ? token.substring(0, 5) + '...' : 'none',
			userAgent: this.userAgent.substring(0, 20) + '...',
		})

		// Connect to Deepgram if not already connected
		if (
			!this.deepgramSocket ||
			this.deepgramSocket.readyState !== WebSocket.OPEN
		) {
			try {
				await this.connectToDeepgram()
			} catch (error) {
				console.error(
					'TranscriptionService: Failed to connect to Deepgram during setup',
					error
				)
				return new Response(
					JSON.stringify({
						error: 'Failed to connect to speech transcription service',
						details: error instanceof Error ? error.message : 'Unknown error',
					}),
					{
						status: 502,
						headers: { 'Content-Type': 'application/json' },
					}
				)
			}
		}

		// Return success
		return new Response(
			JSON.stringify({
				status: 'ready',
				message: 'Transcription service initialized',
				timestamp: Date.now(),
			}),
			{
				headers: { 'Content-Type': 'application/json' },
			}
		)
	}

	// Handle WebSocket message from client
	async handleMessage(request: Request, token: string): Promise<Response> {
		// Validate token
		if (token !== this.token) {
			console.warn('TranscriptionService: Token mismatch', {
				expected: this.token.substring(0, 5) + '...',
				received: token ? token.substring(0, 5) + '...' : 'none',
			})
		}

		// Update activity timestamp
		this.lastActivityTimestamp = Date.now()

		// Handle different content types
		const contentType = request.headers.get('Content-Type') || ''

		// Process the message based on content type
		if (contentType.includes('application/json')) {
			try {
				// Parse JSON message
				const jsonData = (await request.json()) as ClientMessage
				return await this.handleControlMessage(jsonData)
			} catch (error) {
				return new Response(
					JSON.stringify({
						error: 'Invalid JSON message',
						details: error instanceof Error ? error.message : 'Unknown error',
					}),
					{
						status: 400,
						headers: { 'Content-Type': 'application/json' },
					}
				)
			}
		} else if (contentType.includes('application/octet-stream')) {
			// Handle binary audio data
			try {
				const audioData = await request.arrayBuffer()
				return await this.handleAudioData(audioData)
			} catch (error) {
				return new Response(
					JSON.stringify({
						error: 'Failed to process audio data',
						details: error instanceof Error ? error.message : 'Unknown error',
					}),
					{
						status: 500,
						headers: { 'Content-Type': 'application/json' },
					}
				)
			}
		} else {
			return new Response(
				JSON.stringify({
					error: `Unsupported content type: ${contentType}`,
				}),
				{
					status: 415,
					headers: { 'Content-Type': 'application/json' },
				}
			)
		}
	}

	// Handle connection cleanup
	async handleCleanup(request: Request): Promise<Response> {
		// Clean up the Deepgram connection
		this.cleanupDeepgramConnection()

		// Return success
		return new Response(
			JSON.stringify({
				status: 'success',
				message: 'Connection closed',
				timestamp: Date.now(),
			}),
			{
				headers: { 'Content-Type': 'application/json' },
			}
		)
	}

	// Handle control messages from client
	async handleControlMessage(message: ClientMessage): Promise<Response> {
		// Validate message
		if (!message.type || typeof message.type !== 'string') {
			return new Response(
				JSON.stringify({
					error: 'Invalid message format, missing type field',
				}),
				{
					status: 400,
					headers: { 'Content-Type': 'application/json' },
				}
			)
		}

		// Process by message type
		switch (message.type) {
			case 'ping':
				return new Response(
					JSON.stringify({
						type: 'pong',
						timestamp: Date.now(),
					}),
					{
						headers: { 'Content-Type': 'application/json' },
					}
				)

			case 'start-transcription':
				// Connect to Deepgram if not already connected
				if (
					!this.deepgramSocket ||
					this.deepgramSocket.readyState !== WebSocket.OPEN
				) {
					try {
						await this.connectToDeepgram()
					} catch (error) {
						return new Response(
							JSON.stringify({
								error: 'Failed to connect to speech transcription service',
								details:
									error instanceof Error ? error.message : 'Unknown error',
							}),
							{
								status: 502,
								headers: { 'Content-Type': 'application/json' },
							}
						)
					}
				}

				return new Response(
					JSON.stringify({
						type: 'status',
						status: 'connected',
						message: 'Transcription started',
						timestamp: Date.now(),
					}),
					{
						headers: { 'Content-Type': 'application/json' },
					}
				)

			case 'stop-transcription':
				// Clean up the Deepgram connection
				this.cleanupDeepgramConnection()

				return new Response(
					JSON.stringify({
						type: 'status',
						status: 'disconnected',
						message: 'Transcription stopped',
						timestamp: Date.now(),
					}),
					{
						headers: { 'Content-Type': 'application/json' },
					}
				)

			default:
				return new Response(
					JSON.stringify({
						error: `Unknown message type: ${message.type}`,
					}),
					{
						status: 400,
						headers: { 'Content-Type': 'application/json' },
					}
				)
		}
	}

	// Handle audio data from client
	async handleAudioData(audioData: ArrayBuffer): Promise<Response> {
		// Rate limiting
		const now = Date.now()

		// Reset rate counter if window has elapsed
		if (now - this.messageRate.lastReset > RATE_LIMIT_WINDOW_MS) {
			this.messageRate.count = 0
			this.messageRate.lastReset = now
		}

		// Increment message count
		this.messageRate.count++

		// Check rate limit
		if (this.messageRate.count > MAX_MESSAGE_RATE) {
			return new Response(
				JSON.stringify({
					error: 'Rate limit exceeded',
					message: 'Too many audio messages per second',
				}),
				{
					status: 429,
					headers: { 'Content-Type': 'application/json' },
				}
			)
		}

		// Validate empty buffer
		if (audioData.byteLength === 0) {
			this.messageRate.consecutiveEmptyBuffers++

			if (
				this.messageRate.consecutiveEmptyBuffers > MAX_CONSECUTIVE_EMPTY_BUFFERS
			) {
				return new Response(
					JSON.stringify({
						error: 'Too many empty audio buffers',
						message: 'Check your audio input',
					}),
					{
						status: 400,
						headers: { 'Content-Type': 'application/json' },
					}
				)
			}

			// Empty buffers are ok in small numbers
			return new Response(null, { status: 204 })
		}

		// Reset consecutive empty buffers counter
		this.messageRate.consecutiveEmptyBuffers = 0

		// Check buffer size limit
		if (audioData.byteLength > MAX_BUFFER_SIZE) {
			return new Response(
				JSON.stringify({
					error: 'Audio data too large',
					limit: MAX_BUFFER_SIZE,
					received: audioData.byteLength,
				}),
				{
					status: 413,
					headers: { 'Content-Type': 'application/json' },
				}
			)
		}

		// Connect to Deepgram if needed
		if (
			!this.deepgramSocket ||
			this.deepgramSocket.readyState !== WebSocket.OPEN
		) {
			try {
				// Queue the message to be sent once connected
				this.messageQueue.push(audioData)
				await this.connectToDeepgram()
				return new Response(null, { status: 202 }) // Accepted, will process once connected
			} catch (error) {
				return new Response(
					JSON.stringify({
						error: 'Failed to connect to speech service',
						details: error instanceof Error ? error.message : 'Unknown error',
					}),
					{
						status: 503,
						headers: { 'Content-Type': 'application/json' },
					}
				)
			}
		}

		// Send the audio data to Deepgram
		try {
			this.deepgramSocket.send(audioData)
			return new Response(null, { status: 200 })
		} catch (error) {
			console.error(
				'TranscriptionService: Error sending audio to Deepgram',
				error
			)

			// Try to reconnect
			this.cleanupDeepgramConnection()
			this.messageQueue.push(audioData)

			try {
				await this.connectToDeepgram()
				return new Response(null, { status: 202 }) // Accepted, will retry
			} catch (reconnectError) {
				return new Response(
					JSON.stringify({
						error: 'Failed to send audio data and reconnect',
						details: error instanceof Error ? error.message : 'Unknown error',
					}),
					{
						status: 503,
						headers: { 'Content-Type': 'application/json' },
					}
				)
			}
		}
	}

	// Connect to Deepgram speech API
	async connectToDeepgram(): Promise<void> {
		// Clean up any existing connection
		this.cleanupDeepgramConnection()

		// Get Deepgram API key
		const apiKey = this.env.DEEPGRAM_SECRET
		if (!apiKey) {
			throw new Error('Deepgram API key not configured')
		}

		// Create a new WebSocket connection to Deepgram
		console.log('TranscriptionService: Connecting to Deepgram')

		return new Promise<void>((resolve, reject) => {
			try {
				// Create WebSocket with authentication
				const socket = new WebSocket(DEEPGRAM_API_URL, ['token', apiKey])

				// Set a connection timeout
				const CONNECTION_TIMEOUT =
					Number(this.env.DEEPGRAM_CONNECTION_TIMEOUT) ||
					DEFAULT_CONNECTION_TIMEOUT

				this.deepgramConnectTimeout = setTimeout(() => {
					console.error('TranscriptionService: Deepgram connection timeout')
					socket.close(1000, 'Connection timeout')
					reject(new Error('Deepgram connection timeout'))
				}, CONNECTION_TIMEOUT) as unknown as number

				// When the connection opens
				socket.addEventListener('open', () => {
					console.log('TranscriptionService: Connected to Deepgram')
					this.deepgramConnected = true

					// Clear the connection timeout
					if (this.deepgramConnectTimeout !== null) {
						clearTimeout(this.deepgramConnectTimeout)
						this.deepgramConnectTimeout = null
					}

					// Configure Deepgram transcription settings
					socket.send(
						JSON.stringify({
							format: {
								type: 'linear16',
								sample_rate: 48000,
							},
							channels: 1,
							model: 'nova-3',
							language: 'en',
							interim_results: true,
							smart_format: true,
							punctuate: true,
						})
					)

					// Set up keepalive interval
					this.deepgramKeepaliveInterval = setInterval(() => {
						if (socket.readyState === WebSocket.OPEN) {
							socket.send(new Uint8Array(0))
						}
					}, 15000) as unknown as number

					// Set up inactivity timeout - close connection after 2 minutes of inactivity
					this.resetInactivityTimeout()

					// Send any queued messages
					while (this.messageQueue.length > 0) {
						const data = this.messageQueue.shift()
						if (data) {
							socket.send(data)
						}
					}

					// Resolution
					this.deepgramSocket = socket
					resolve()
				})

				// Handle messages from Deepgram
				socket.addEventListener('message', (event) => {
					this.handleDeepgramMessage(event.data)
					this.resetInactivityTimeout()
				})

				// Handle errors
				socket.addEventListener('error', (event) => {
					console.error('TranscriptionService: Deepgram WebSocket error', event)

					// Clear the connection timeout if it's still running
					if (this.deepgramConnectTimeout !== null) {
						clearTimeout(this.deepgramConnectTimeout)
						this.deepgramConnectTimeout = null
						reject(new Error('Deepgram connection error'))
					}
				})

				// Handle close
				socket.addEventListener('close', (event) => {
					console.log(
						`TranscriptionService: Deepgram connection closed (code: ${event.code})`
					)
					this.deepgramConnected = false

					// Clear the connection timeout if it's still running
					if (this.deepgramConnectTimeout !== null) {
						clearTimeout(this.deepgramConnectTimeout)
						this.deepgramConnectTimeout = null

						// If we're still in the connection phase, reject the promise
						reject(new Error(`Deepgram connection closed: ${event.code}`))
					}

					// Clean up
					this.cleanupDeepgramConnection()
				})
			} catch (error) {
				console.error(
					'TranscriptionService: Error creating Deepgram WebSocket',
					error
				)
				reject(error)
			}
		})
	}

	// Handle messages from Deepgram
	handleDeepgramMessage(data: string): void {
		try {
			const result = JSON.parse(data)

			// Validate the message
			if (typeof result !== 'object') {
				console.error('TranscriptionService: Invalid Deepgram response', result)
				return
			}

			// Handle error messages
			if (result.error) {
				console.error('TranscriptionService: Deepgram API error', result.error)

				// Store the error to be retrieved by the next client request
				this.pendingResponses.set('error', {
					resolver: function (resolve) {
						resolve(
							JSON.stringify({
								type: 'error',
								message: `Deepgram error: ${result.error.message || 'Unknown error'}`,
								timestamp: Date.now(),
							})
						)
					},
					timestamp: Date.now(),
				})

				return
			}

			// Process transcription results
			if (result.channel?.alternatives?.[0]?.transcript) {
				const transcript = result.channel.alternatives[0].transcript.trim()
				const isFinal = !result.is_final || result.speech_final

				if (transcript) {
					// Store the transcription to be retrieved by the next client request
					this.pendingResponses.set(`transcription:${Date.now()}`, {
						resolver: function (resolve) {
							resolve(
								JSON.stringify({
									type: 'transcription',
									text: transcript,
									isFinal,
									timestamp: Date.now(),
								})
							)
						},
						timestamp: Date.now(),
					})

					console.log(`TranscriptionService: Transcription: "${transcript}"`)
				}
			}
			// Handle metadata responses
			else if (result.type === 'MetadataResponse') {
				console.log('TranscriptionService: Received Deepgram metadata')
			}
			// Unknown message type
			else {
				console.warn(
					'TranscriptionService: Unrecognized Deepgram response format',
					result
				)
			}
		} catch (error) {
			console.error(
				'TranscriptionService: Error processing Deepgram response',
				error
			)
		}
	}

	// Reset the inactivity timeout
	resetInactivityTimeout(): void {
		// Clear any existing timeout
		if (this.deepgramInactivityTimeout !== null) {
			clearTimeout(this.deepgramInactivityTimeout)
			this.deepgramInactivityTimeout = null
		}

		// Set a new timeout
		this.deepgramInactivityTimeout = setTimeout(() => {
			console.log('TranscriptionService: Closing inactive Deepgram connection')
			this.cleanupDeepgramConnection()
		}, 120000) as unknown as number
	}

	// Clean up Deepgram connection
	cleanupDeepgramConnection(): void {
		console.log('TranscriptionService: Cleaning up Deepgram connection')

		// Clear keepalive interval
		if (this.deepgramKeepaliveInterval !== null) {
			clearInterval(this.deepgramKeepaliveInterval)
			this.deepgramKeepaliveInterval = null
		}

		// Clear inactivity timeout
		if (this.deepgramInactivityTimeout !== null) {
			clearTimeout(this.deepgramInactivityTimeout)
			this.deepgramInactivityTimeout = null
		}

		// Clear connection timeout
		if (this.deepgramConnectTimeout !== null) {
			clearTimeout(this.deepgramConnectTimeout)
			this.deepgramConnectTimeout = null
		}

		// Close Deepgram connection
		if (this.deepgramSocket) {
			if (
				this.deepgramSocket.readyState === WebSocket.OPEN ||
				this.deepgramSocket.readyState === WebSocket.CONNECTING
			) {
				this.deepgramSocket.close(1000, 'Normal closure')
			}
			this.deepgramSocket = null
		}

		// Reset connection state
		this.deepgramConnected = false
	}

	// Alarm handler for cleanup
	async alarm(): Promise<void> {
		// Clean up old pending responses
		const now = Date.now()
		const MAX_PENDING_AGE_MS = 60000 // 1 minute

		for (const [id, pending] of this.pendingResponses.entries()) {
			if (now - pending.timestamp > MAX_PENDING_AGE_MS) {
				this.pendingResponses.delete(id)
			}
		}

		// Close connection if inactive for too long
		if (
			this.lastActivityTimestamp &&
			now - this.lastActivityTimestamp > 300000
		) {
			// 5 minutes
			this.cleanupDeepgramConnection()
		}
	}
}
