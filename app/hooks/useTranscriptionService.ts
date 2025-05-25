import { useCallback, useEffect, useRef, useState } from 'react'

// Configuration for reconnection
const MAX_RECONNECT_ATTEMPTS = 5
const BASE_RECONNECT_DELAY_MS = 1000
const MAX_RECONNECT_DELAY_MS = 30000

interface TranscriptionOptions {
	onTranscription?: (text: string, isFinal: boolean) => void
	onError?: (error: Error) => void
	onStatusChange?: (
		status: 'connecting' | 'connected' | 'disconnected' | 'reconnecting'
	) => void
	maxReconnectAttempts?: number
}

/**
 * A hook for connecting to the server-side transcription service
 *
 * This hook creates a WebSocket connection to our transcription service,
 * which acts as a secure bridge to Deepgram. It handles sending audio data
 * and receiving transcription results.
 */
export default function useTranscriptionService(
	options: TranscriptionOptions = {}
) {
	// WebSocket connection
	const wsRef = useRef<WebSocket | null>(null)
	// Audio processing
	const audioContextRef = useRef<AudioContext | null>(null)
	const processorRef = useRef<ScriptProcessorNode | null>(null)
	const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null)
	// Track the current audio track being transcribed
	const audioTrackRef = useRef<MediaStreamTrack | null>(null)

	// Connection status
	const [status, setStatus] = useState<
		'disconnected' | 'connecting' | 'connected' | 'reconnecting'
	>('disconnected')

	// Track reconnection attempts
	const reconnectAttemptRef = useRef<number>(0)
	const reconnectTimeoutRef = useRef<number | null>(null)

	// Reconnection synchronization flag to prevent race conditions
	const isReconnectingRef = useRef<boolean>(false)

	// Ping interval to keep connection alive
	const pingIntervalRef = useRef<number | null>(null)

	// Notify about status changes
	useEffect(() => {
		options.onStatusChange?.(status)
	}, [status, options])

	// Clean up audio processing
	const stopAudioProcessing = useCallback(() => {
		// Disconnect processor
		if (processorRef.current) {
			processorRef.current.disconnect()
			processorRef.current = null
		}

		// Disconnect source
		if (sourceRef.current) {
			sourceRef.current.disconnect()
			sourceRef.current = null
		}

		// Close audio context
		if (audioContextRef.current) {
			audioContextRef.current.close().catch(console.error)
			audioContextRef.current = null
		}

		// Clear track reference
		audioTrackRef.current = null
	}, [])

	/**
	 * Set up audio processing for a given track
	 *
	 * DEPRECATION NOTE: This implementation uses ScriptProcessorNode which is deprecated.
	 * Future versions will migrate to AudioWorklet. The migration plan:
	 *
	 * 1. Create AudioWorkletProcessor implementation for audio processing
	 * 2. Add feature detection to use AudioWorklet when available and fall back to ScriptProcessor
	 * 3. Eventually remove ScriptProcessor support in a future release
	 *
	 * See: https://developer.mozilla.org/en-US/docs/Web/API/AudioWorkletProcessor
	 */
	const setupAudioProcessing = useCallback(
		(track: MediaStreamTrack) => {
			console.log('Transcription service: setupAudioProcessing called', { track, wsReady: wsRef.current?.readyState })
			if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
				console.warn('Transcription service: setupAudioProcessing early exit - WebSocket not open', { ws: wsRef.current })
				return
			}

			// Already processing this track
			if (audioTrackRef.current === track) {
				console.log('Transcription service: setupAudioProcessing - already processing this track')
				return
			}

			// Clean up any existing audio processing
			stopAudioProcessing()

			// Validate track state
			if (track.readyState !== 'live') {
				console.error('Transcription service: Track is not active', { track })
				options.onError?.(new Error('Audio track is not active'))
				return
			}

			// Validate track settings
			const settings = track.getSettings()
			if (settings.sampleRate && settings.sampleRate < 16000) {
				console.warn(
					'Transcription service: Sample rate is low, may affect quality',
					settings.sampleRate
				)
			}

			console.log('Transcription service: setupAudioProcessing - track is valid, proceeding')
			// Store the track reference
			audioTrackRef.current = track

			try {
				// Create audio context and connect to the track
				const audioContext = new AudioContext()
				const source = audioContext.createMediaStreamSource(
					new MediaStream([track])
				)

				if ('audioWorklet' in audioContext) {
					console.log('Transcription service: AudioWorklet supported, attempting to load module /utils/audioWorklets/AudioTranscriptionProcessor.js')
					async function setupWorklet() {
						try {
							console.log('Transcription service: Before addModule')
							await audioContext.audioWorklet.addModule('/utils/audioWorklets/AudioTranscriptionProcessor.js')
							console.log('Transcription service: After addModule, before node creation')
							const workletNode = new AudioWorkletNode(audioContext, 'audio-transcription-processor')
							console.log('Transcription service: AudioWorkletNode created and module loaded.')

							// Listen for messages from the worklet
							workletNode.port.onmessage = (event) => {
								const { data } = event
								console.log('Transcription service: Received audio buffer from AudioWorkletNode', data)
								if (wsRef.current?.readyState === WebSocket.OPEN) {
									try {
										console.log('Transcription service: Debug outgoing buffer', { length: data.byteLength, sample: Array.from(new Uint8Array(data)).slice(0, 10) });
wsRef.current.send(data)
console.log('Transcription service: Sent audio buffer to backend.')
									} catch (err) {
										console.error('Transcription service: Error sending audio buffer to backend', err)
									}
								}
							}

							// Connect the audio nodes
							source.connect(workletNode)
							// Optionally connect to destination for monitoring
							// workletNode.connect(audioContext.destination);

							// Store references
							audioContextRef.current = audioContext
							sourceRef.current = source
							processorRef.current = null // Not using ScriptProcessorNode
							console.log('Transcription service: AudioWorkletNode wired up and ready.')
						} catch (err) {
							console.error('Transcription service: Failed to initialize AudioWorkletNode. Falling back to ScriptProcessorNode.', err)
							fallbackToScriptProcessor()
						}
					}
					setupWorklet();
				} else {
					console.warn('Transcription service: AudioWorklet NOT supported, will use ScriptProcessorNode.')
					fallbackToScriptProcessor()
				}

				function fallbackToScriptProcessor() {
					console.warn(
						'Transcription service: Using deprecated ScriptProcessorNode for audio processing.'
					)
					// Create a ScriptProcessorNode to process audio data
					const processor = audioContext.createScriptProcessor(2048, 1, 1) // Lower latency
					processor.onaudioprocess = (event) => {
						if (wsRef.current?.readyState === WebSocket.OPEN) {
							const pcmData = event.inputBuffer.getChannelData(0)
							const samples = new Int16Array(pcmData.length)
							for (let i = 0; i < pcmData.length; i++) {
								const s = Math.max(-1, Math.min(1, pcmData[i]))
								samples[i] = s < 0 ? Math.floor(s * 0x8000) : Math.floor(s * 0x7fff)
							}
							try {
								wsRef.current.send(samples.buffer)
								console.log('Transcription service: Sent audio buffer to backend (ScriptProcessorNode).')
							} catch (err) {
								console.error('Transcription service: Error sending audio buffer to backend (ScriptProcessorNode)', err)
							}
						}
					}
					source.connect(processor)
					processor.connect(audioContext.destination)
					audioContextRef.current = audioContext
					sourceRef.current = source
					processorRef.current = processor
					console.log('Transcription service: ScriptProcessorNode wired up and ready.')
				}
			} catch (error) {
				console.error(
					'Transcription service: Failed to set up audio processing',
					error
				)
				options.onError?.(new Error('Failed to set up audio processing'))
			}
		},
		[options, stopAudioProcessing]
	)

	// Set up regular pings to keep connection alive
	const setupPingInterval = useCallback((ws: WebSocket) => {
		// Clear any existing ping interval
		if (pingIntervalRef.current !== null) {
			window.clearInterval(pingIntervalRef.current)
			pingIntervalRef.current = null
		}

		// Set up new ping interval (every 30 seconds)
		pingIntervalRef.current = window.setInterval(() => {
			if (ws.readyState === WebSocket.OPEN) {
				try {
					ws.send(JSON.stringify({ type: 'ping', timestamp: Date.now() }))
				} catch (error) {
					console.error('Transcription service: Error sending ping:', error)
					clearInterval(pingIntervalRef.current as number)
					pingIntervalRef.current = null
				}
			} else {
				// If WebSocket is not open, clear the interval
				if (pingIntervalRef.current !== null) {
					window.clearInterval(pingIntervalRef.current)
					pingIntervalRef.current = null
				}
			}
		}, 30000) as unknown as number
	}, [])

	// Handle reconnection with exponential backoff
	const attemptReconnect = useCallback(() => {
		// Import the helper from our useIsOnline hook
		const { isOnline } = require('~/hooks/useIsOnline')

		// Check if we're online using our improved detection
		if (!isOnline()) {
			console.log(
				'Transcription service: Browser reports offline, waiting for online status before reconnecting'
			)
			// Set up a one-time listener for when we go back online
			const onlineListener = () => {
				window.removeEventListener('online', onlineListener)
				// When we go back online, try reconnecting
				setTimeout(() => attemptReconnect(), 1000)
			}
			window.addEventListener('online', onlineListener)
			return
		}

		// Prevent multiple reconnection attempts from happening simultaneously
		if (isReconnectingRef.current) {
			console.log(
				'Transcription service: Reconnection already in progress, skipping new attempt'
			)
			return
		}

		// Set the reconnection flag
		isReconnectingRef.current = true

		// Clear any existing reconnection timeout
		if (reconnectTimeoutRef.current !== null) {
			window.clearTimeout(reconnectTimeoutRef.current)
			reconnectTimeoutRef.current = null
		}

		const maxAttempts = options.maxReconnectAttempts || MAX_RECONNECT_ATTEMPTS

		// Check if we've exceeded max reconnection attempts
		if (reconnectAttemptRef.current >= maxAttempts) {
			console.log(
				`Transcription service: Max reconnection attempts (${maxAttempts}) reached, giving up`
			)
			setStatus('disconnected')
			reconnectAttemptRef.current = 0
			isReconnectingRef.current = false
			return
		}

		// Calculate backoff delay with exponential backoff and jitter
		const attemptNumber = reconnectAttemptRef.current + 1
		const exponentialDelay = Math.min(
			BASE_RECONNECT_DELAY_MS * Math.pow(2, attemptNumber),
			MAX_RECONNECT_DELAY_MS
		)
		// Add some randomness to prevent thundering herd problem
		const jitter = Math.random() * 0.3 * exponentialDelay
		const delay = exponentialDelay + jitter

		console.log(
			`Transcription service: Reconnection attempt ${attemptNumber} scheduled in ${Math.round(delay)}ms`
		)
		setStatus('reconnecting')

		// Schedule reconnection
		reconnectTimeoutRef.current = window.setTimeout(() => {
			reconnectAttemptRef.current += 1
			setupWebSocket()
			// We'll reset the isReconnecting flag when the WebSocket opens or fails
		}, delay) as unknown as number
	}, [options])

	// Helper function to create WebSocket connection after API check
	const createWebSocketConnection = useCallback(
		(apiBaseUrl: string, authToken: string) => {
			try {
				// Convert HTTP URL to WebSocket URL
				const wsBaseUrl = apiBaseUrl.replace(/^http/, 'ws')
				const wsUrl = `${wsBaseUrl}?token=${authToken}&_=${Math.random().toString(36).substring(2, 15)}`

				// More verbose logging before creating WebSocket
				console.log(
					`%c Transcription service: Creating WebSocket with URL: ${wsUrl}`,
					'background: blue; color: white; font-weight: bold; padding: 4px;'
				)

				const ws = new WebSocket(wsUrl)

				// Debug the WebSocket state after creation
				console.log(
					`%c Transcription service: WebSocket initial state: ${ws.readyState}`,
					'background: orange; color: black; font-weight: bold; padding: 4px;'
				)

				// Set a connection timeout with better logging
				const connectionTimeoutId = window.setTimeout(() => {
					if (ws.readyState !== WebSocket.OPEN) {
						console.error(
							`%c Transcription service: Connection timeout - readyState: ${ws.readyState}`,
							'background: red; color: white; font-weight: bold; padding: 4px;'
						)
						ws.close()
						attemptReconnect()
					}
				}, 10000)

				ws.addEventListener('open', () => {
					console.log('Transcription service: WebSocket connected')
					clearTimeout(connectionTimeoutId)

					// Reset reconnection attempts and flags on successful connection
					reconnectAttemptRef.current = 0
					isReconnectingRef.current = false
					setStatus('connected')

					// Set up ping interval
					setupPingInterval(ws)

					// Start transcription
					ws.send(JSON.stringify({ type: 'start-transcription' }))

					// If we have an audio track, start processing it
					if (audioTrackRef.current) {
						setupAudioProcessing(audioTrackRef.current)
					}
				})

				ws.addEventListener('message', (event) => {
					try {
						const data = JSON.parse(event.data)

						// Validate message format
						if (
							typeof data !== 'object' ||
							!data.type ||
							typeof data.type !== 'string'
						) {
							console.error(
								'Transcription service: Invalid message format from server',
								data
							)
							options.onError?.(new Error('Invalid message format from server'))
							return
						}

						// Process messages by type
						if (data.type === 'transcription') {
							// Validate transcription structure
							if (typeof data.text !== 'string') {
								console.error(
									'Transcription service: Invalid transcription data, missing text',
									data
								)
								return
							}

							// Handle transcription result with validated parameters
							options.onTranscription?.(
								data.text,
								typeof data.isFinal === 'boolean' ? data.isFinal : true
							)
						} else if (data.type === 'status') {
							// Validate status
							if (
								typeof data.status !== 'string' ||
								!['connected', 'disconnected'].includes(data.status)
							) {
								console.error(
									'Transcription service: Invalid status value',
									data
								)
								return
							}

							// Handle status update
							setStatus(data.status as 'connected' | 'disconnected')
						} else if (data.type === 'error') {
							// Validate error message
							if (typeof data.message !== 'string') {
								console.error(
									'Transcription service: Invalid error format',
									data
								)
								options.onError?.(
									new Error('Server error (no details provided)')
								)
								return
							}

							// Handle error with validated message
							options.onError?.(new Error(data.message))
						} else if (data.type === 'pong') {
							// Ping response received, connection is active
							console.log(
								'Transcription service: Pong received',
								data.timestamp
							)
						} else {
							// Unknown message type
							console.warn(
								'Transcription service: Unknown message type from server',
								data.type
							)
						}
					} catch (error) {
						console.error(
							'Transcription service: Failed to parse message',
							error
						)
					}
				})

				ws.addEventListener('error', (event) => {
					console.error(
						'%c Transcription service: WebSocket error',
						'background: red; color: white; font-weight: bold; padding: 4px;',
						event
					)
					clearTimeout(connectionTimeoutId)

					// Clear ping interval if it exists
					if (pingIntervalRef.current !== null) {
						window.clearInterval(pingIntervalRef.current)
						pingIntervalRef.current = null
					}

					// Provide a more helpful debug information and error message
					const isCloudflareHosted =
						window.location.hostname.includes('cloudflare') ||
						window.location.hostname === 'call.whenmeet.me'

					// Add detailed connection information to help with debugging
					// Import the helper from our useIsOnline hook
					const { isOnline } = require('~/hooks/useIsOnline')

					console.log(
						'%c Transcription WebSocket debug info:',
						'background: brown; color: white; font-weight: bold; padding: 4px;',
						{
							url: wsUrl,
							readyState: ws.readyState,
							readyStateText:
								['CONNECTING', 'OPEN', 'CLOSING', 'CLOSED'][ws.readyState] ||
								'UNKNOWN',
							isCloudflare: isCloudflareHosted,
							browserReportsOnline: navigator.onLine,
							actualOnlineStatus: isOnline(),
							hostname: window.location.hostname,
							protocol: window.location.protocol,
							eventType: event.type,
						}
					)

					// Test if we can make a regular HTTP request to diagnose network issues
					fetch('/api/transcription')
						.then((response) => {
							console.log(
								'%c Transcription service: HTTP fetch test:',
								'background: green; color: white; font-weight: bold; padding: 4px;',
								{
									status: response.status,
									statusText: response.statusText,
									ok: response.ok,
									headers: Object.fromEntries([...response.headers.entries()]),
								}
							)
						})
						.catch((error) => {
							console.error(
								'%c Transcription service: HTTP fetch test failed:',
								'background: red; color: white; font-weight: bold; padding: 4px;',
								error
							)
						})

					const errorMessage = isCloudflareHosted
						? 'WebSocket connection error - please check if transcription service is configured properly'
						: 'WebSocket connection error'

					options.onError?.(new Error(errorMessage))

					// Reset reconnection flag in case of error
					isReconnectingRef.current = false
				})

				ws.addEventListener('close', (event) => {
					console.log(
						`Transcription service: WebSocket disconnected (code: ${event.code}, reason: ${event.reason || 'none'})`
					)
					clearTimeout(connectionTimeoutId)

					// Clear ping interval if it exists
					if (pingIntervalRef.current !== null) {
						window.clearInterval(pingIntervalRef.current)
						pingIntervalRef.current = null
					}

					// Clean up
					wsRef.current = null

					// Stop audio processing
					stopAudioProcessing()

					// Determine if this is a normal closure
					// Normal closure codes are 1000-1999 (1000-1015 are currently defined)
					// Abnormal closures are code 1006 or codes >= 2000
					const isNormalClosure =
						event.code >= 1000 && event.code <= 1999 && event.code !== 1006 // 1006 is abnormal closure

					// Attempt to reconnect if not closed normally
					if (!isNormalClosure) {
						attemptReconnect()
					} else {
						// Normal closure, no reconnection needed
						isReconnectingRef.current = false
						setStatus('disconnected')
					}
				})

				// Store the WebSocket
				wsRef.current = ws
			} catch (error) {
				console.error(
					'Transcription service: Failed to create WebSocket',
					error
				)
				options.onError?.(new Error('Failed to create WebSocket connection'))

				// Reset reconnection flag before attempting reconnect to avoid race conditions
				isReconnectingRef.current = false
				attemptReconnect()
			}
		},
		[
			options,
			attemptReconnect,
			setupPingInterval,
			setupAudioProcessing,
			stopAudioProcessing,
		]
	)

	// Set up the WebSocket connection to our transcription service
	const setupWebSocket = useCallback(() => {
		// Close any existing WebSocket
		if (wsRef.current && wsRef.current.readyState !== WebSocket.CLOSED) {
			wsRef.current.close()
			wsRef.current = null
		}

		setStatus(reconnectAttemptRef.current > 0 ? 'reconnecting' : 'connecting')

		// Connect to our WebSocket endpoint
		// Determine URL based on environment
		let apiBaseUrl = ''

		// Add an auth token query param - we'll use the current timestamp for now
		// In production, this should be replaced with a proper auth token
		const authToken = Date.now().toString()

		// When running on Cloudflare or our production domain, use an absolute URL
		// This works around navigator.onLine detection issues on Cloudflare
		if (
			window.location.hostname.includes('cloudflare') ||
			window.location.hostname === 'call.whenmeet.me'
		) {
			// We need to try the new path
			apiBaseUrl = 'https://call.whenmeet.me/api/transcription'

			// Debug flag to force using the old path if needed
			if (localStorage.getItem('use_old_transcription_path') === 'true') {
				apiBaseUrl = 'https://call.whenmeet.me/partytracks/transcription'
				console.log(
					'%c Using OLD transcription path for debugging',
					'background: red; color: white; font-weight: bold;'
				)
			}
		} else {
			// Local development - use relative path to new API endpoint
			apiBaseUrl = `${window.location.protocol}//${window.location.host}/api/transcription`
		}

		// Verbose logging to help debug issues
		console.log(
			`%c Transcription service: Checking API availability at ${apiBaseUrl}`,
			'background: purple; color: white; font-weight: bold; padding: 4px;'
		)

		// First check if the API endpoint is available with a regular HTTP request
		fetch(apiBaseUrl)
			.then((response) => {
				if (!response.ok) {
					throw new Error(
						`API returned ${response.status}: ${response.statusText}`
					)
				}
				return response.json()
			})
			.then((data) => {
				console.log(
					'%c Transcription service: API check successful',
					'background: green; color: white; font-weight: bold; padding: 4px;',
					data
				)

				// Now we can proceed with creating the WebSocket
				createWebSocketConnection(apiBaseUrl, authToken)
			})
			.catch((error) => {
				console.error(
					'%c Transcription service: API check failed',
					'background: red; color: white; font-weight: bold; padding: 4px;',
					error
				)

				options.onError?.(
					new Error(
						`Failed to connect to transcription service: ${error.message}`
					)
				)

				// Try to reconnect
				attemptReconnect()
			})
	}, [options, attemptReconnect, createWebSocketConnection])

	// Track to detect device changes
	const trackSettingsRef = useRef<MediaTrackSettings | null>(null)

	// Function to detect if there was a significant device change
	const isDeviceChanged = useCallback((track: MediaStreamTrack) => {
		const newSettings = track.getSettings()
		const oldSettings = trackSettingsRef.current

		// If no previous settings, this is the first time
		if (!oldSettings) {
			trackSettingsRef.current = newSettings
			return false
		}

		// Check for device ID change (most reliable way to detect device change)
		if (newSettings.deviceId !== oldSettings.deviceId) {
			console.log('Transcription service: Audio device changed', {
				from: oldSettings.deviceId,
				to: newSettings.deviceId,
			})
			trackSettingsRef.current = newSettings
			return true
		}

		// Check other significant audio parameters
		if (
			newSettings.sampleRate !== oldSettings.sampleRate ||
			newSettings.channelCount !== oldSettings.channelCount
		) {
			console.log('Transcription service: Audio parameters changed', {
				oldSampleRate: oldSettings.sampleRate,
				newSampleRate: newSettings.sampleRate,
				oldChannels: oldSettings.channelCount,
				newChannels: newSettings.channelCount,
			})
			trackSettingsRef.current = newSettings
			return true
		}

		return false
	}, [])

	// Start transcription for a given audio track
	const startTranscription = useCallback(
		(track: MediaStreamTrack) => {
			console.log('Transcription service: startTranscription called', { track });
			if (!track) {
				console.warn('Transcription service: startTranscription called with no track');
			}
			if (track && track.readyState !== 'live') {
				console.warn('Transcription service: startTranscription called with inactive track', { track });
			}
			// Set up WebSocket if not already done
			if (!wsRef.current) {
				setupWebSocket()
			}

			// Check if audio device has changed significantly
			const deviceChanged = isDeviceChanged(track)

			// If we already have a track and it's the same device, check if we need to restart
			if (audioTrackRef.current === track && !deviceChanged) {
				return
			}

			// If device changed, we need to restart audio processing
			if (deviceChanged && audioTrackRef.current) {
				console.log(
					'Transcription service: Restarting audio processing due to device change'
				)
				stopAudioProcessing()
			}

			// Set up audio processing for the track
			setupAudioProcessing(track)

			// Set up a listener for track-ended events
			track.addEventListener('ended', () => {
				console.log('Transcription service: Audio track ended')
				stopAudioProcessing()
			})
		},
		[setupWebSocket, setupAudioProcessing, stopAudioProcessing, isDeviceChanged]
	)

	// Stop transcription
	const stopTranscription = useCallback(() => {
		// Stop audio processing
		stopAudioProcessing()

		// Tell the server to stop transcription
		if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
			wsRef.current.send(JSON.stringify({ type: 'stop-transcription' }))
		}
	}, [stopAudioProcessing])

	// Clean up on unmount
	useEffect(() => {
		return () => {
			stopTranscription()

			// Close WebSocket
			if (wsRef.current && wsRef.current.readyState !== WebSocket.CLOSED) {
				wsRef.current.close()
				wsRef.current = null
			}

			// Clear reconnection timeout
			if (reconnectTimeoutRef.current !== null) {
				window.clearTimeout(reconnectTimeoutRef.current)
				reconnectTimeoutRef.current = null
			}

			// Clear ping interval
			if (pingIntervalRef.current !== null) {
				window.clearInterval(pingIntervalRef.current)
				pingIntervalRef.current = null
			}

			// Reset reconnection state
			isReconnectingRef.current = false
			reconnectAttemptRef.current = 0
		}
	}, [stopTranscription])

	return {
		status,
		startTranscription,
		stopTranscription,
	}
}
