import type { PartyTracks } from 'partytracks/client'
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
		console.log('Received message from worker:', event.data)
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

		console.log('🔐 Setting up sender transform for', sender.track?.kind)

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

		console.log('🔐 Setting up receiver transform for', receiver.track?.kind)

		// If this is Firefox, we will have to use RTCRtpScriptTransform
		if (window.RTCRtpScriptTransform) {
			receiver.transform = new RTCRtpScriptTransform(this.worker, {
				operation: 'decryptStream',
			})

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
				console.log('Message from worker in handleOutgoingEvents', event.data)
				onMessage(JSON.stringify(event.data, replacer))
			}
		})
	}

	handleIncomingEvent(data: string) {
		const message = JSON.parse(data, reviver) as MessagesFromWorker
		// the message type here came from another user's worker
		console.log('Incoming event: ', message.type, { message })
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
				console.log(
					'🔐 Setting up sender transform for',
					transceiver.sender.track?.kind
				)
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
				console.log(
					'🔐 Setting up receiver transform for',
					transceiver.receiver.track?.kind
				)
				encryptionWorker.setupReceiverTransform(transceiver.receiver)
			}
		})

		return () => {
			subscription.unsubscribe()
		}
	}, [enabled, joined, workerReady, encryptionWorker, partyTracks.transceiver$])

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
