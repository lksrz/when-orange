import type { PartyTracks } from 'partytracks/client'
import { useObservableAsValue } from 'partytracks/react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import invariant from 'tiny-invariant'
import type useRoom from '~/hooks/useRoom'
import type { ServerMessage } from '~/types/Messages'

type MessagesToE2eeWorker =
	| {
			type: 'userJoined'
			id: string
	  }
	| {
			type: 'userLeft'
			id: string
	  }
	| { type: 'recvMlsMessage'; msg: Uint8Array }
	| { type: 'encryptStream'; in: ReadableStream; out: WritableStream }
	| { type: 'decryptStream'; in: ReadableStream; out: WritableStream }
	| { type: 'initializeAndCreateGroup'; id: string }

type MessagesFromE2eeWorker =
	| {
			type: 'workerReady'
	  }
	| {
			type: 'sendMlsMessage'
			msg: Uint8Array
	  }
	| {
			type: 'newSafetyNumber'
			msg: Uint8Array
	  }

export async function loadWorker(
	handleEvents: (message: MessagesFromE2eeWorker) => void
) {
	// Create a new worker
	const worker = new Worker('/e2ee/worker.js')

	const ready = new Promise<void>((res) => {
		const handler = (event: MessageEvent) => {
			if (event.data.type === 'workerReady') {
				res()
				worker.removeEventListener('message', handler)
			}
		}
		worker.addEventListener('message', handler)
	})

	// Listen for messages from the worker
	worker.onmessage = function (event: MessageEvent<MessagesFromE2eeWorker>) {
		handleEvents(event.data)
	}

	// Error handling
	worker.onerror = function (error) {
		console.error('Worker error:', error.message)
	}

	await ready

	async function safePostMessage(message: MessagesToE2eeWorker): Promise<void>
	async function safePostMessage(
		message: MessagesToE2eeWorker,
		transfer: Transferable[]
	): Promise<void>
	async function safePostMessage(
		message: MessagesToE2eeWorker,
		transfer?: Transferable[]
	): Promise<void> {
		if (transfer) {
			worker.postMessage(message, transfer)
		} else {
			worker.postMessage(message)
		}
	}

	return Object.assign(worker, {
		safePostMessage,
	})
}

type MessagesFromWorker =
	| { type: 'shareKeyPackage'; keyPkg: Uint8Array }
	| { type: 'sendMlsMessage'; msg: Uint8Array; senderId: string }
	| {
			type: 'sendMlsWelcome'
			senderId: string
			welcome: Uint8Array
			rtree: Uint8Array
	  }
	| { type: 'newSafetyNumber'; hash: Uint8Array }

export class EncryptionWorker {
	get worker(): Worker {
		invariant(
			this._worker !== null,
			'worker not yet initialized, call initialize() or initializeAndCreateGroup() first'
		)
		return this._worker
	}

	_worker: Worker | null = null
	safetyNumber: number = -1
	id: string
	ready: boolean = false
	// Track active sender transforms to avoid conflicts
	private _activeSenderTransforms = new Map<string, RTCRtpSender>()
	// Track the current video mode to ensure only one video sender is active
	private _currentVideoMode: 'camera' | 'screenshare' | null = null
	// Track our own track IDs to prevent self-decryption
	private _ownTrackIds = new Set<string>()
	// Track our own session ID for additional verification
	private _ownSessionId: string | null = null

	constructor(config: { id: string }) {
		this.id = config.id
		this._worker = new Worker('/e2ee/worker.js')

		// Listen for worker ready signal
		this._worker.addEventListener('message', (event) => {
			if (event.data.type === 'workerReady') {
				this.ready = true
			}
		})
	}

	dispose() {
		this._worker?.terminate()
		this._worker = null
		this.ready = false
		this._activeSenderTransforms.clear()
		this._currentVideoMode = null
		this._ownTrackIds.clear()
		this._ownSessionId = null
	}

	// Check if a track ID belongs to us
	isOwnTrack(trackId?: string): boolean {
		return trackId ? this._ownTrackIds.has(trackId) : false
	}

	// Add a track ID to our own tracks
	addOwnTrack(trackId: string) {
		this._ownTrackIds.add(trackId)
	}

	// Remove a track ID from our own tracks
	removeOwnTrack(trackId: string) {
		this._ownTrackIds.delete(trackId)
	}

	// Set our own session ID for additional verification
	setOwnSessionId(sessionId: string) {
		this._ownSessionId = sessionId
	}

	// Check if a session ID belongs to us
	isOwnSession(sessionId?: string): boolean {
		return sessionId ? this._ownSessionId === sessionId : false
	}

	// Clean up a specific transform
	cleanupSenderTransform(
		trackKind: 'video' | 'audio' | 'camera' | 'screenshare'
	) {
		const sender = this._activeSenderTransforms.get(trackKind)
		if (sender) {
			if (sender.transform) {
				sender.transform = null
			}
			this._activeSenderTransforms.delete(trackKind)
		}
	}

	// Clean up all video transforms (both camera and screenshare)
	cleanupAllVideoTransforms() {
		this.cleanupSenderTransform('camera')
		this.cleanupSenderTransform('screenshare')
		// Legacy cleanup for old 'video' key
		this.cleanupSenderTransform('video' as any)
		this._currentVideoMode = null
	}

	// Get the current video mode
	getCurrentVideoMode(): 'camera' | 'screenshare' | null {
		return this._currentVideoMode
	}

	// Force cleanup of current video mode
	cleanupCurrentVideoMode() {
		if (this._currentVideoMode) {
			this.cleanupSenderTransform(this._currentVideoMode)
			this._currentVideoMode = null
		}
	}

	// Get the currently active sender for a track kind
	getActiveSender(
		trackKind: 'video' | 'audio' | 'camera' | 'screenshare'
	): RTCRtpSender | undefined {
		return this._activeSenderTransforms.get(trackKind)
	}

	initialize() {
		if (!this.ready) {
			console.warn('🔐 Worker not ready yet, initialization may fail')
		}
		this.worker.postMessage({ type: 'initialize', id: this.id })
	}

	initializeAndCreateGroup() {
		if (!this.ready) {
			console.warn('🔐 Worker not ready yet, group creation may fail')
		}
		this.worker.postMessage({ type: 'initializeAndCreateGroup', id: this.id })
	}

	userJoined(keyPkg: Uint8Array) {
		this.worker.postMessage({ type: 'userJoined', keyPkg })
	}

	userLeft(id: string) {
		this.worker.postMessage({ type: 'userLeft', id })
	}

	receiveMlsWelcome(senderId: string, welcome: Uint8Array, rtree: Uint8Array) {
		this.worker.postMessage({
			type: 'recvMlsWelcome',
			welcome,
			rtree,
			senderId,
		})
	}

	receiveMlsMessage(msg: Uint8Array, senderId: string) {
		const message = {
			msg,
			senderId,
			type: 'recvMlsMessage',
		}
		console.log('passing receiveMlsMessage into worker', message)
		this.worker.postMessage(message)
	}

	async setupSenderTransform(sender: RTCRtpSender) {
		if (!this.ready) {
			console.warn('🔐 Worker not ready, delaying sender transform setup')
			// Wait for worker to be ready with timeout
			let attempts = 0
			const maxAttempts = 100 // 5 seconds maximum
			while (!this.ready && attempts < maxAttempts) {
				await new Promise((resolve) => setTimeout(resolve, 50))
				attempts++
			}

			if (!this.ready) {
				console.error(
					'🔐 Worker failed to become ready within timeout, sender transform setup failed'
				)
				return
			}
		}

		const trackKind = sender.track?.kind
		const trackId = sender.track?.id

		// Track this as our own track to prevent self-decryption
		if (trackId) {
			this.addOwnTrack(trackId)
		}

		// For video tracks, implement strict single-sender mode
		if (trackKind === 'video') {
			// Determine track type based on content hint or track characteristics
			const track = sender.track
			const isScreenShare =
				track?.contentHint === 'text' ||
				track?.contentHint === 'detail' ||
				track?.getSettings().displaySurface !== undefined

			const videoMode: 'camera' | 'screenshare' = isScreenShare
				? 'screenshare'
				: 'camera'

			// If we're switching video modes, clean up the previous mode
			if (this._currentVideoMode && this._currentVideoMode !== videoMode) {
				// Clean up the previous video mode
				const previousSender = this._activeSenderTransforms.get(
					this._currentVideoMode
				)
				if (previousSender && previousSender.transform) {
					// Remove the previous track from our own tracks when cleaning up
					if (previousSender.track?.id) {
						this.removeOwnTrack(previousSender.track.id)
					}

					previousSender.transform = null
				}
				this._activeSenderTransforms.delete(this._currentVideoMode)

				// Wait for cleanup to complete
				await new Promise((resolve) => setTimeout(resolve, 100))
			}

			// Check if we already have this exact sender set up
			const existingSender = this._activeSenderTransforms.get(videoMode)
			if (existingSender && existingSender !== sender) {
				// Remove the existing track from our own tracks
				if (existingSender.track?.id) {
					this.removeOwnTrack(existingSender.track.id)
				}

				// Clear the existing transform
				if (existingSender.transform) {
					existingSender.transform = null
				}

				// Wait a brief moment to ensure the transform is fully cleared
				await new Promise((resolve) => setTimeout(resolve, 100))
			}

			// Set up the new video mode
			this._currentVideoMode = videoMode
			this._activeSenderTransforms.set(videoMode, sender)
		} else if (trackKind === 'audio') {
			// Track audio sender (shouldn't conflict but good to track)
			this._activeSenderTransforms.set('audio', sender)
		}

		// If this is Firefox, we will have to use RTCRtpScriptTransform
		if (window.RTCRtpScriptTransform) {
			sender.transform = new RTCRtpScriptTransform(this.worker, {
				operation: 'encryptStream',
			})
			return
		}

		// Otherwise if this is Chrome we'll have to use createEncodedStreams
		if (
			'createEncodedStreams' in sender &&
			typeof sender.createEncodedStreams === 'function'
		) {
			const senderStreams = sender.createEncodedStreams()
			const { readable, writable } = senderStreams
			this.worker.postMessage(
				{
					type: 'encryptStream',
					in: readable,
					out: writable,
				},
				[readable, writable]
			)

			return
		}

		throw new Error(
			'Neither RTCRtpScriptTransform nor RTCRtpSender.createEncodedStreams methods supported'
		)
	}

	async setupReceiverTransform(receiver: RTCRtpReceiver) {
		if (!this.ready) {
			console.warn('🔐 Worker not ready, delaying receiver transform setup')
			// Wait for worker to be ready with timeout
			let attempts = 0
			const maxAttempts = 100 // 5 seconds maximum
			while (!this.ready && attempts < maxAttempts) {
				await new Promise((resolve) => setTimeout(resolve, 50))
				attempts++
			}

			if (!this.ready) {
				console.error(
					'🔐 Worker failed to become ready within timeout, receiver transform setup failed'
				)
				return
			}
		}

		const trackId = receiver.track?.id
		const trackKind = receiver.track?.kind

		// Check if this is our own track - if so, skip receiver transform setup
		if (this.isOwnTrack(trackId)) {
			console.log(
				'🔐 Skipping receiver transform setup for own track:',
				trackId,
				'kind:',
				trackKind
			)
			return
		}

		console.log(
			'🔐 Setting up receiver transform for remote track:',
			trackId,
			'kind:',
			trackKind
		)

		// If this is Firefox, we will have to use RTCRtpScriptTransform
		if (window.RTCRtpScriptTransform) {
			receiver.transform = new RTCRtpScriptTransform(this.worker, {
				operation: 'decryptStream',
			})

			console.log(
				'🔐 Successfully set up receiver transform (Firefox) for track:',
				trackId
			)
			return
		}

		// Otherwise if this is Chrome we'll have to use createEncodedStreams
		if (
			'createEncodedStreams' in receiver &&
			typeof receiver.createEncodedStreams === 'function'
		) {
			const senderStreams = receiver.createEncodedStreams()
			const { readable, writable } = senderStreams
			this.worker.postMessage(
				{
					type: 'decryptStream',
					in: readable,
					out: writable,
				},
				[readable, writable]
			)

			console.log(
				'🔐 Successfully set up receiver transform (Chrome) for track:',
				trackId
			)
			return
		}

		throw new Error(
			'Neither RTCRtpScriptTransform nor RTCRtpSender.createEncodedStreams methods supported'
		)
	}

	decryptStream(inStream: ReadableStream, outStream: WritableStream) {
		this.worker.postMessage({
			type: 'decryptStream',
			in: inStream,
			out: outStream,
		})
	}

	handleOutgoingEvents(onMessage: (data: string) => void) {
		this.worker.addEventListener('message', (event) => {
			const excludedEvents = ['workerReady', 'newSafetyNumber']
			if (!excludedEvents.includes(event.data.type)) {
				onMessage(JSON.stringify(event.data, replacer))
			}
		})
	}

	handleIncomingEvent(data: string) {
		const message = JSON.parse(data, reviver) as MessagesFromWorker
		switch (message.type) {
			case 'shareKeyPackage': {
				this.userJoined(message.keyPkg)
				break
			}
			case 'sendMlsWelcome': {
				this.receiveMlsWelcome(message.senderId, message.welcome, message.rtree)
				break
			}
			case 'sendMlsMessage': {
				this.receiveMlsMessage(message.msg, message.senderId)
				break
			}
		}
	}

	onNewSafetyNumber(handler: (safetyNumber: Uint8Array) => void) {
		this.worker.addEventListener('message', (event) => {
			if (event.data.type === 'newSafetyNumber') {
				handler(event.data.hash)
			}
		})
	}
}

const FLAG_TYPED_ARRAY = 'FLAG_TYPED_ARRAY'
const FLAG_ARRAY_BUFFER = 'FLAG_ARRAY_BUFFER'

function replacer(_key: string, value: any) {
	if (value instanceof Uint8Array) {
		return { [FLAG_TYPED_ARRAY]: true, data: Array.from(value) }
	}
	if (value instanceof ArrayBuffer) {
		return {
			[FLAG_ARRAY_BUFFER]: true,
			data: Array.from(new Uint8Array(value)),
		}
	}
	return value
}

function reviver(_key: string, value: any) {
	if (value && value[FLAG_TYPED_ARRAY]) {
		return Uint8Array.from(value.data)
	}
	if (value && value[FLAG_ARRAY_BUFFER]) {
		return new Uint8Array(value.data).buffer
	}
	return value
}

export function useE2EE({
	enabled = false,
	room,
	partyTracks,
}: {
	enabled?: boolean
	partyTracks: PartyTracks
	room: ReturnType<typeof useRoom>
}) {
	const [safetyNumber, setSafetyNumber] = useState<string>()
	const [workerReady, setWorkerReady] = useState(false)

	const encryptionWorker = useMemo(
		() =>
			new EncryptionWorker({
				id: room.websocket.id,
			}),
		[room.websocket.id]
	)

	const [joined, setJoined] = useState(false)
	const [firstUser, setFirstUser] = useState(false)

	// Get our own session ID to avoid setting up receiver transforms for our own tracks
	const ownSession = useObservableAsValue(partyTracks.session$)
	const ownSessionId = ownSession?.sessionId

	// Set the session ID in the encryption worker when it becomes available
	useEffect(() => {
		if (ownSessionId) {
			encryptionWorker.setOwnSessionId(ownSessionId)
			console.log('🔐 Set own session ID in encryption worker:', ownSessionId)
		}
	}, [ownSessionId, encryptionWorker])

	useEffect(() => {
		return () => {
			encryptionWorker.dispose()
		}
	}, [encryptionWorker])

	// Track worker readiness
	useEffect(() => {
		if (!enabled) return

		const handleWorkerMessage = (event: MessageEvent) => {
			if (event.data.type === 'workerReady') {
				setWorkerReady(true)
			}
		}

		encryptionWorker.worker.addEventListener('message', handleWorkerMessage)

		return () => {
			encryptionWorker.worker.removeEventListener(
				'message',
				handleWorkerMessage
			)
		}
	}, [enabled, encryptionWorker])

	useEffect(() => {
		if (!enabled || !joined || !workerReady) return

		let setupPromise = Promise.resolve()

		const subscription = partyTracks.transceiver$.subscribe((transceiver) => {
			if (transceiver.direction === 'sendonly') {
				// Chain setup operations to avoid race conditions
				setupPromise = setupPromise.then(async () => {
					try {
						if (transceiver.sender.track?.kind === 'video') {
							const capability = RTCRtpSender.getCapabilities('video')
							const codecs = capability ? capability.codecs : []
							const vp9codec = codecs.filter(
								(a) => a.mimeType === 'video/VP9' || a.mimeType === 'video/rtx'
							)
							transceiver.setCodecPreferences(vp9codec)
						}

						console.log(
							'🔐 Setting up sender transform for',
							transceiver.sender.track?.kind,
							'trackId:',
							transceiver.sender.track?.id
						)

						await encryptionWorker.setupSenderTransform(transceiver.sender)

						console.log(
							'🔐 Successfully set up sender transform for',
							transceiver.sender.track?.kind,
							'trackId:',
							transceiver.sender.track?.id
						)
					} catch (error) {
						console.error('🔐 Failed to set up sender transform:', error)
					}
				})
			}
		})

		return () => {
			subscription.unsubscribe()
		}
	}, [enabled, joined, workerReady, encryptionWorker, partyTracks.transceiver$])

	useEffect(() => {
		if (!enabled || !joined || !workerReady) return

		const subscription = partyTracks.transceiver$.subscribe((transceiver) => {
			if (transceiver.direction === 'recvonly') {
				// Get the session ID from the transceiver's mid
				const mid = transceiver.mid
				const trackId = transceiver.receiver.track?.id

				// Skip if this is our own track by checking track ID
				if (encryptionWorker.isOwnTrack(trackId)) {
					console.log('🔐 Skipping receiver transform for own track:', trackId)
					return
				}

				// Additional check: if we have our own session ID, compare it
				if (ownSessionId && mid) {
					// Check if this transceiver belongs to our own session
					// This is a more robust check than just track ID
					const transceiverSessionId = mid.split('-')[0] // Extract session prefix if present
					if (transceiverSessionId === ownSessionId) {
						console.log(
							'🔐 Skipping receiver transform for own session:',
							ownSessionId,
							'mid:',
							mid
						)
						return
					}
				}

				console.log(
					'🔐 Setting up receiver transform for remote track:',
					trackId,
					'mid:',
					mid
				)
				encryptionWorker.setupReceiverTransform(transceiver.receiver)
			}
		})

		return () => {
			subscription.unsubscribe()
		}
	}, [
		enabled,
		joined,
		workerReady,
		encryptionWorker,
		partyTracks.transceiver$,
		ownSessionId,
	])

	const onJoin = useCallback(
		(firstUser: boolean) => {
			if (!enabled) return
			setJoined(true)
			setFirstUser(firstUser)
		},
		[enabled]
	)

	useEffect(() => {
		if (!joined || !workerReady) return

		console.log(
			'🔐 Setting up E2EE event handlers, worker ready:',
			workerReady,
			'joined:',
			joined
		)

		encryptionWorker.onNewSafetyNumber((buffer) => {
			const safetyNum = arrayBufferToDecimal(buffer)
			console.log('🔐 Safety number generated:', safetyNum)
			setSafetyNumber(safetyNum)
		})
		encryptionWorker.handleOutgoingEvents((data) => {
			console.log('📬 sending e2eeMlsMessage to peers', data)
			room.websocket.send(
				JSON.stringify({
					type: 'e2eeMlsMessage',
					payload: data,
				})
			)
		})
		const handler = (event: MessageEvent) => {
			const message = JSON.parse(event.data) as ServerMessage
			if (message.type === 'e2eeMlsMessage') {
				console.log('📨 incoming e2eeMlsMessage from peer', message)
				encryptionWorker.handleIncomingEvent(message.payload)
			}
			if (message.type === 'userLeftNotification') {
				encryptionWorker.userLeft(message.id)
			}
		}

		room.websocket.addEventListener('message', handler)

		// Add delay to ensure worker is fully initialized before creating/joining group
		setTimeout(() => {
			if (firstUser) {
				console.log('🔐 Initializing and creating group as first user')
				encryptionWorker.initializeAndCreateGroup()
			} else {
				console.log('🔐 Initializing worker as joining user')
				encryptionWorker.initialize()
			}
		}, 100)

		return () => {
			room.websocket.removeEventListener('message', handler)
		}
	}, [encryptionWorker, firstUser, joined, workerReady, room.websocket])

	// Log ready state changes for debugging
	useEffect(() => {
		const isReady = enabled && workerReady && joined
		console.log('🔐 E2EE ready state changed:', {
			enabled,
			workerReady,
			joined,
			isReady,
			safetyNumber: !!safetyNumber,
		})
	}, [enabled, workerReady, joined, safetyNumber])

	return {
		e2eeSafetyNumber: enabled ? safetyNumber : undefined,
		e2eeReady: enabled && workerReady && joined,
		onJoin,
	}
}

function arrayBufferToDecimal(buffer: ArrayBuffer) {
	const byteArray = new Uint8Array(buffer) // Create a typed array from the ArrayBuffer
	const hexArray = Array.from(byteArray, (byte) => {
		return byte.toString(10).padStart(2, '0') // Convert each byte to a 2-digit hex string
	})
	return hexArray.join('') // Join all hex strings into a single string
}
