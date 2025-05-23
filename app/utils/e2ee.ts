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
	// Track which video sender is currently active to prevent conflicts
	private _activeVideoSender: RTCRtpSender | null = null

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
		this._activeVideoSender = null
	}

	initialize() {
		this.worker.postMessage({ type: 'initialize', id: this.id })
	}

	initializeAndCreateGroup() {
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
		const trackKind = sender.track?.kind
		const trackId = sender.track?.id

		// For video tracks, clean up previous sender if it exists
		if (
			trackKind === 'video' &&
			this._activeVideoSender &&
			this._activeVideoSender !== sender
		) {
			console.log('🔐 Cleaning up previous video sender transform')
			if (this._activeVideoSender.transform) {
				this._activeVideoSender.transform = null
			}
			// Wait a moment for cleanup
			await new Promise((resolve) => setTimeout(resolve, 100))
		}

		console.log(
			'🔐 Setting up sender transform for',
			trackKind,
			'trackId:',
			trackId
		)

		// If this is Firefox, we will have to use RTCRtpScriptTransform
		if (window.RTCRtpScriptTransform) {
			sender.transform = new RTCRtpScriptTransform(this.worker, {
				operation: 'encryptStream',
			})

			// Track video sender
			if (trackKind === 'video') {
				this._activeVideoSender = sender
			}

			console.log(
				'🔐 Successfully set up sender transform for',
				trackKind,
				'trackId:',
				trackId
			)
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

			// Track video sender
			if (trackKind === 'video') {
				this._activeVideoSender = sender
			}

			console.log(
				'🔐 Successfully set up sender transform for',
				trackKind,
				'trackId:',
				trackId
			)
			return
		}

		throw new Error(
			'Neither RTCRtpScriptTransform nor RTCRtpSender.createEncodedStreams methods supported'
		)
	}

	async setupReceiverTransform(receiver: RTCRtpReceiver) {
		const trackId = receiver.track?.id
		const trackKind = receiver.track?.kind

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

	// Get our own session ID to check for self-decryption scenarios
	const ownSession = useObservableAsValue(partyTracks.session$)
	const ownSessionId = ownSession?.sessionId

	useEffect(() => {
		return () => {
			encryptionWorker.dispose()
		}
	}, [encryptionWorker])

	// Track worker readiness
	useEffect(() => {
		if (!enabled) return

		const checkReady = () => {
			if (encryptionWorker.ready && !workerReady) {
				setWorkerReady(true)
			}
		}

		// Check immediately
		checkReady()

		// Check periodically until ready
		const interval = setInterval(() => {
			checkReady()
		}, 100)

		return () => {
			clearInterval(interval)
		}
	}, [enabled, encryptionWorker, workerReady])

	useEffect(() => {
		if (!enabled || !joined || !workerReady) return

		const subscription = partyTracks.transceiver$.subscribe((transceiver) => {
			if (transceiver.direction === 'sendonly') {
				if (transceiver.sender.track?.kind === 'video') {
					const capability = RTCRtpSender.getCapabilities('video')
					const codecs = capability ? capability.codecs : []
					const vp9codec = codecs.filter(
						(a) => a.mimeType === 'video/VP9' || a.mimeType === 'video/rtx'
					)
					transceiver.setCodecPreferences(vp9codec)
				}
				encryptionWorker.setupSenderTransform(transceiver.sender)
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
				// Skip receiver transform if we're the only user in the room
				const allUsers = room.otherUsers
				if (allUsers.length === 0) {
					console.log(
						'🔐 Skipping receiver transform - we are the only user in the room'
					)
					return
				}

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
		room.otherUsers,
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
