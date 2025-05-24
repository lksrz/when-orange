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

	constructor(config: { id: string }) {
		this.id = config.id
		this._worker = new Worker('/e2ee/worker.js')
	}

	dispose() {
		this.cleanup()
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
		console.log('🔐 Setting up receiver transform for track:', trackId)

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
			// Don't throw - allow the application to continue without E2EE for this track
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
								transceiver.currentDirection === null
							) {
								transceiver.setCodecPreferences(vp9codec)
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

		return () => {
			subscription.unsubscribe()
		}
	}, [enabled, encryptionWorker, partyTracks.transceiver$])

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

		return () => {
			subscription.unsubscribe()
		}
	}, [enabled, encryptionWorker, partyTracks.transceiver$])

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

		const handler = (event: MessageEvent) => {
			const message = JSON.parse(event.data) as ServerMessage
			if (message.type === 'e2eeMlsMessage') {
				console.log('📨 incoming e2eeMlsMessage from peer', message)
				encryptionWorker!.handleIncomingEvent(message.payload)
			}
			if (message.type === 'userLeftNotification') {
				console.log('👋 Processing user left:', message.id)
				encryptionWorker!.userLeft(message.id)
			}
		}

		room.websocket.addEventListener('message', handler)

		if (firstUser) {
			console.log('🔐 Initializing as first user (creating group)')
			encryptionWorker.initializeAndCreateGroup()
		} else {
			console.log('🔐 Initializing as joining user')
			encryptionWorker.initialize()
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
