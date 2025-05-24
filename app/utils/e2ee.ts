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
	private configuredSenders: Set<string> = new Set()
	private configuredReceivers: Set<string> = new Set()
	private groupCreationAttempted: boolean = false
	public isWorkerCrashed: boolean = false
	private restartAttempts: number = 0
	private maxRestartAttempts: number = 3

	constructor(config: { id: string }) {
		this.id = config.id
		this.initializeWorker()
	}

	private initializeWorker() {
		try {
			this._worker = new Worker('/e2ee/worker.js')
			this.isWorkerCrashed = false

			// Add error handling for worker crashes
			this._worker.onerror = (error) => {
				console.error('🔐 E2EE Worker error:', error)
				this.handleWorkerCrash()
			}

			// Listen for unhandled errors in worker
			this._worker.addEventListener('messageerror', (error) => {
				console.error('🔐 E2EE Worker message error:', error)
				this.handleWorkerCrash()
			})
		} catch (error) {
			console.error('🔐 Failed to create E2EE worker:', error)
			this.isWorkerCrashed = true
		}
	}

	private handleWorkerCrash() {
		console.error('🔐 E2EE Worker crashed, attempting recovery...')
		this.isWorkerCrashed = true

		if (this.restartAttempts < this.maxRestartAttempts) {
			this.restartAttempts++
			console.log(
				`🔐 Restarting E2EE worker (attempt ${this.restartAttempts}/${this.maxRestartAttempts})`
			)

			// Clean up current worker
			if (this._worker) {
				this._worker.terminate()
				this._worker = null
			}

			// Reset state
			this.configuredSenders.clear()
			this.configuredReceivers.clear()
			this.groupCreationAttempted = false

			// Restart after delay
			setTimeout(() => {
				this.initializeWorker()
				// Re-initialize the group if it was previously created
				if (this.restartAttempts === 1) {
					this.initializeAndCreateGroup()
				}
			}, 1000 * this.restartAttempts) // Exponential backoff
		} else {
			console.error('🔐 Max E2EE worker restart attempts reached, giving up')
		}
	}

	dispose() {
		this.cleanup()
	}

	initialize() {
		if (this.isWorkerCrashed) {
			console.log('🔐 Skipping initialize operation - worker crashed')
			return
		}

		try {
			this.worker.postMessage({ type: 'initialize', id: this.id })
		} catch (error) {
			console.error('🔐 Error in initialize operation:', error)
			this.handleWorkerCrash()
		}
	}

	initializeAndCreateGroup() {
		if (this.isWorkerCrashed) {
			console.log(
				'🔐 Skipping initializeAndCreateGroup operation - worker crashed'
			)
			return
		}

		this.groupCreationAttempted = true
		try {
			this.worker.postMessage({ type: 'initializeAndCreateGroup', id: this.id })
		} catch (error) {
			console.error('🔐 Error in initializeAndCreateGroup operation:', error)
			this.handleWorkerCrash()
		}
	}

	// Add method to create group if none exists
	createGroupIfNeeded() {
		if (this.isWorkerCrashed) {
			console.log('🔐 Skipping createGroupIfNeeded operation - worker crashed')
			return
		}

		if (!this.groupCreationAttempted) {
			console.log('🔐 No existing group found, creating new group')
			this.groupCreationAttempted = true
			try {
				this.worker.postMessage({
					type: 'initializeAndCreateGroup',
					id: this.id,
				})
			} catch (error) {
				console.error('🔐 Error in createGroupIfNeeded operation:', error)
				this.handleWorkerCrash()
			}
		}
	}

	userJoined(keyPkg: Uint8Array) {
		if (this.isWorkerCrashed) {
			console.log('🔐 Skipping userJoined operation - worker crashed')
			return
		}

		try {
			this.worker.postMessage({ type: 'userJoined', keyPkg })
		} catch (error) {
			console.error('🔐 Error in userJoined operation:', error)
			this.handleWorkerCrash()
		}
	}

	userLeft(id: string) {
		if (this.isWorkerCrashed) {
			console.log('🔐 Skipping userLeft operation - worker crashed')
			return
		}

		try {
			console.log('🔐 Processing userLeft safely:', id)
			this.worker.postMessage({ type: 'userLeft', id })
		} catch (error) {
			console.error('🔐 Error in userLeft operation:', error)
			this.handleWorkerCrash()
		}
	}

	receiveMlsWelcome(senderId: string, welcome: Uint8Array, rtree: Uint8Array) {
		if (this.isWorkerCrashed) {
			console.log('🔐 Skipping receiveMlsWelcome operation - worker crashed')
			return
		}

		try {
			this.worker.postMessage({
				type: 'recvMlsWelcome',
				welcome,
				rtree,
				senderId,
			})
		} catch (error) {
			console.error('🔐 Error in receiveMlsWelcome operation:', error)
			this.handleWorkerCrash()
		}
	}

	receiveMlsMessage(msg: Uint8Array, senderId: string) {
		if (this.isWorkerCrashed) {
			console.log('🔐 Skipping receiveMlsMessage operation - worker crashed')
			return
		}

		const message = {
			msg,
			senderId,
			type: 'recvMlsMessage',
		}
		console.log('passing receiveMlsMessage into worker', message)
		try {
			this.worker.postMessage(message)
		} catch (error) {
			console.error('🔐 Error in receiveMlsMessage operation:', error)
			this.handleWorkerCrash()
		}
	}

	async setupSenderTransform(sender: RTCRtpSender) {
		const trackId = sender.track?.id
		if (!trackId || this.configuredSenders.has(trackId)) {
			console.log(
				'🔐 Sender transform already configured or no track ID for:',
				trackId
			)
			return
		}

		console.log('🔐 Setting up sender transform for track:', trackId)

		try {
			// If this is Firefox, we will have to use RTCRtpScriptTransform
			if (window.RTCRtpScriptTransform) {
				sender.transform = new RTCRtpScriptTransform(this.worker, {
					type: 'encryptStream',
				})

				console.log(
					'🔐 Successfully set up sender transform for track:',
					trackId
				)
				this.configuredSenders.add(trackId)
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

				console.log(
					'🔐 Successfully set up sender transform for track:',
					trackId
				)
				this.configuredSenders.add(trackId)
				return
			}

			throw new Error(
				'Neither RTCRtpScriptTransform nor RTCRtpSender.createEncodedStreams methods supported'
			)
		} catch (error) {
			console.error('🔐 Failed to set up sender transform:', error)
			// Don't throw - allow the application to continue without E2EE for this track
		}
	}

	async setupReceiverTransform(receiver: RTCRtpReceiver) {
		const trackId = receiver.track?.id
		if (!trackId || this.configuredReceivers.has(trackId)) {
			console.log(
				'🔐 Receiver transform already configured or no track ID for:',
				trackId
			)
			return
		}

		if (this.isWorkerCrashed) {
			console.log('🔐 Skipping receiver transform setup - worker crashed')
			return
		}

		console.log(
			'🔐 Setting up receiver transform for track:',
			trackId,
			'mediaType:',
			receiver.track?.kind
		)

		try {
			// If this is Firefox, we will have to use RTCRtpScriptTransform
			if (window.RTCRtpScriptTransform) {
				receiver.transform = new RTCRtpScriptTransform(this.worker, {
					type: 'decryptStream',
				})

				console.log(
					'🔐 Successfully set up receiver transform for track:',
					trackId
				)
				this.configuredReceivers.add(trackId)
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
					'🔐 Successfully set up receiver transform for track:',
					trackId
				)
				this.configuredReceivers.add(trackId)
				return
			}

			throw new Error(
				'Neither RTCRtpScriptTransform nor RTCRtpSender.createEncodedStreams methods supported'
			)
		} catch (error) {
			console.error('🔐 Failed to set up receiver transform:', error)
			console.log(
				'🔐 Continuing without E2EE for this track to allow video reception'
			)
			// Don't throw - allow the application to continue without E2EE for this track
			// This ensures video can still be received even if E2EE setup fails
		}
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

	cleanup() {
		if (this._worker) {
			this._worker.terminate()
			this._worker = null
		}
		this.configuredSenders.clear()
		this.configuredReceivers.clear()
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
	const peerConnection = useObservableAsValue(partyTracks.peerConnection$)
	const [isReconnecting, setIsReconnecting] = useState(false)

	const encryptionWorker = useMemo(() => {
		if (!enabled) {
			console.log('🔐 E2EE disabled, not creating worker')
			return null
		}

		console.log('🔐 Creating encryption worker for user:', room.websocket.id)
		const worker = new EncryptionWorker({
			id: room.websocket.id,
		})

		return worker
	}, [enabled, room.websocket.id])

	const [joined, setJoined] = useState(false)
	const [firstUser, setFirstUser] = useState(false)

	// Track ICE connection state for reconnection handling
	useEffect(() => {
		if (!peerConnection) return

		const handleIceStateChange = () => {
			const state = peerConnection.iceConnectionState
			if (state === 'disconnected' || state === 'failed') {
				console.log(
					'🔐 E2EE detecting network disconnection, setting reconnecting state'
				)
				setIsReconnecting(true)
			} else if (state === 'connected' || state === 'completed') {
				if (isReconnecting) {
					console.log('🔐 E2EE connection restored after reconnection')
					setIsReconnecting(false)
				}
			}
		}

		peerConnection.addEventListener(
			'iceconnectionstatechange',
			handleIceStateChange
		)
		return () => {
			peerConnection.removeEventListener(
				'iceconnectionstatechange',
				handleIceStateChange
			)
		}
	}, [peerConnection, isReconnecting])

	useEffect(() => {
		return () => {
			encryptionWorker?.dispose()
		}
	}, [encryptionWorker])

	useEffect(() => {
		if (!enabled || !encryptionWorker) return

		const subscription = partyTracks.transceiver$.subscribe((transceiver) => {
			if (transceiver.direction === 'sendonly') {
				try {
					// Only set VP9 codec preferences if explicitly supported and safe to do so
					if (transceiver.sender.track?.kind === 'video') {
						const capability = RTCRtpSender.getCapabilities('video')
						if (capability) {
							const vp9codec = capability.codecs.filter(
								(a) => a.mimeType === 'video/VP9' || a.mimeType === 'video/rtx'
							)
							// Only set codec preferences if VP9 is available and transceiver is in proper state
							if (
								vp9codec.length > 0 &&
								transceiver.currentDirection === null &&
								peerConnection?.iceConnectionState !== 'disconnected'
							) {
								try {
									transceiver.setCodecPreferences(vp9codec)
								} catch (codecError) {
									console.warn(
										'🔐 Failed to set codec preferences, continuing without:',
										codecError
									)
								}
							}
						}
					}
					encryptionWorker.setupSenderTransform(transceiver.sender)
				} catch (error) {
					console.error('🔐 Failed to configure sender transceiver:', error)
					// Continue with encryption setup even if codec preferences fail
				}
			}
		})

		// Listen for ICE connection restoration to re-verify transforms
		const handleIceConnectionRestored = () => {
			console.log('🔐 ICE connection restored, verifying E2EE transforms')
			// Small delay to ensure transceivers are stable after ICE restart
			setTimeout(() => {
				// Re-verify all sender transforms are still active
				if (
					peerConnection &&
					peerConnection.iceConnectionState !== 'disconnected'
				) {
					peerConnection
						.getTransceivers()
						.forEach((transceiver: RTCRtpTransceiver) => {
							if (
								transceiver.direction === 'sendonly' &&
								transceiver.sender.track &&
								transceiver.currentDirection !== null
							) {
								try {
									encryptionWorker.setupSenderTransform(transceiver.sender)
								} catch (error) {
									console.warn(
										'🔐 Failed to re-setup sender transform after ICE restart:',
										error
									)
								}
							}
						})
				}
			}, 1500) // Increased delay to ensure stability
		}

		window.addEventListener(
			'iceConnectionRestored',
			handleIceConnectionRestored
		)

		return () => {
			subscription.unsubscribe()
			window.removeEventListener(
				'iceConnectionRestored',
				handleIceConnectionRestored
			)
		}
	}, [enabled, encryptionWorker, partyTracks.transceiver$, peerConnection])

	useEffect(() => {
		if (!enabled || !encryptionWorker) return

		const subscription = partyTracks.transceiver$.subscribe((transceiver) => {
			if (transceiver.direction === 'recvonly') {
				try {
					encryptionWorker.setupReceiverTransform(transceiver.receiver)
				} catch (error) {
					console.error('🔐 Failed to configure receiver transceiver:', error)
				}
			}
		})

		// Listen for ICE connection restoration to re-verify receiver transforms
		const handleIceConnectionRestored = () => {
			console.log(
				'🔐 ICE connection restored, verifying E2EE receiver transforms'
			)
			// Small delay to ensure transceivers are stable after ICE restart
			setTimeout(() => {
				// Re-verify all receiver transforms are still active
				if (
					peerConnection &&
					peerConnection.iceConnectionState !== 'disconnected'
				) {
					peerConnection
						.getTransceivers()
						.forEach((transceiver: RTCRtpTransceiver) => {
							if (
								transceiver.direction === 'recvonly' &&
								transceiver.receiver.track &&
								transceiver.currentDirection !== null
							) {
								try {
									encryptionWorker.setupReceiverTransform(transceiver.receiver)
								} catch (error) {
									console.warn(
										'🔐 Failed to re-setup receiver transform after ICE restart:',
										error
									)
								}
							}
						})
				}
			}, 1500) // Increased delay to ensure stability
		}

		window.addEventListener(
			'iceConnectionRestored',
			handleIceConnectionRestored
		)

		return () => {
			subscription.unsubscribe()
			window.removeEventListener(
				'iceConnectionRestored',
				handleIceConnectionRestored
			)
		}
	}, [enabled, encryptionWorker, partyTracks.transceiver$, peerConnection])

	const onJoin = useCallback(
		(firstUser: boolean) => {
			if (!enabled) return
			setJoined(true)
			setFirstUser(firstUser)
		},
		[enabled]
	)

	useEffect(() => {
		if (!joined || !encryptionWorker) {
			console.log('🔐 E2EE effect skipped:', {
				joined,
				encryptionWorker: !!encryptionWorker,
			})
			return
		}

		console.log('🔐 Setting up E2EE handlers, firstUser:', firstUser)

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

		let hasReceivedMlsMessage = false

		const handler = (event: MessageEvent) => {
			const message = JSON.parse(event.data) as ServerMessage
			if (message.type === 'e2eeMlsMessage') {
				console.log('📨 incoming e2eeMlsMessage from peer', message)
				hasReceivedMlsMessage = true

				// Handle potential epoch mismatches during reconnection
				try {
					encryptionWorker!.handleIncomingEvent(message.payload)
				} catch (error) {
					if (
						isReconnecting &&
						error instanceof Error &&
						error.message.includes('Wrong Epoch')
					) {
						console.log(
							'🔐 Ignoring epoch mismatch during reconnection, will resync'
						)
						// Don't process the message during reconnection to avoid epoch issues
						return
					}
					console.error('🔐 Error handling MLS message:', error)
				}
			}
			if (message.type === 'userLeftNotification') {
				console.log('👋 Processing user left notification:', message.id)

				// Add safety check to prevent processing stale user left events
				if (encryptionWorker && !encryptionWorker.isWorkerCrashed) {
					try {
						encryptionWorker.userLeft(message.id)
					} catch (error) {
						console.error('🔐 Error processing userLeft notification:', error)
						// Don't let userLeft errors crash the entire E2EE system
						// The worker crash handler will take care of recovery
					}
				} else {
					console.log('🔐 Skipping userLeft notification - worker unavailable')
				}
			}
		}

		room.websocket.addEventListener('message', handler)

		if (firstUser) {
			console.log('🔐 Initializing as first user (creating group)')
			encryptionWorker.initializeAndCreateGroup()
		} else {
			console.log('🔐 Initializing as joining user')
			encryptionWorker.initialize()

			// If we don't receive any MLS messages within 3 seconds,
			// it likely means there's no existing group, so we should create one
			setTimeout(() => {
				if (!hasReceivedMlsMessage) {
					console.log(
						'🔐 No MLS messages received, likely no existing group - creating one'
					)
					encryptionWorker.createGroupIfNeeded()
				}
			}, 3000)
		}

		return () => {
			room.websocket.removeEventListener('message', handler)
		}
	}, [encryptionWorker, firstUser, joined, room.websocket])

	return {
		e2eeSafetyNumber: enabled ? safetyNumber : undefined,
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
