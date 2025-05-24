import { useEffect, useMemo, useRef, useState } from 'react'
import type { ClientMessage, RoomState, ServerMessage } from '~/types/Messages'

import usePartySocket from 'partysocket/react'
import type { UserMedia } from './useUserMedia'

export default function useRoom({
	roomName,
	userMedia,
}: {
	roomName: string
	userMedia: UserMedia
}) {
	const [roomState, setRoomState] = useState<RoomState>({
		users: [],
		ai: { enabled: false },
	})
	const [websocketConnected, setWebsocketConnected] = useState(false)

	const userLeftFunctionRef = useRef(() => {})

	useEffect(() => {
		return () => userLeftFunctionRef.current()
	}, [])

	const websocket = usePartySocket({
		party: 'rooms',
		room: roomName,
		onOpen: () => {
			console.log('🌐 WebSocket connected')
			setWebsocketConnected(true)
		},
		onClose: (e) => {
			console.log('🌐 WebSocket disconnected:', e.code, e.reason)
			setWebsocketConnected(false)
		},
		onError: (e) => {
			console.error('🌐 WebSocket error:', e)
			setWebsocketConnected(false)
		},
		onMessage: (e) => {
			const message = JSON.parse(e.data) as ServerMessage
			switch (message.type) {
				case 'roomState':
					// prevent updating state if nothing has changed
					if (JSON.stringify(message.state) === JSON.stringify(roomState)) break
					setRoomState(message.state)
					break
				case 'error':
					console.error('Received error message from WebSocket')
					console.error(message.error)
					break
				case 'directMessage':
					break
				case 'muteMic':
					userMedia.turnMicOff()
					break
				case 'partyserver-pong':
				case 'e2eeMlsMessage':
				case 'userLeftNotification':
				case 'aiSdp':
					// do nothing
					break
				default:
					message satisfies never
					break
			}
		},
	})

	userLeftFunctionRef.current = () =>
		websocket.send(JSON.stringify({ type: 'userLeft' } satisfies ClientMessage))

	useEffect(() => {
		function onBeforeUnload() {
			userLeftFunctionRef.current()
		}
		window.addEventListener('beforeunload', onBeforeUnload)
		return () => {
			window.removeEventListener('beforeunload', onBeforeUnload)
		}
	}, [websocket])

	// setup a heartbeat
	useEffect(() => {
		const interval = setInterval(() => {
			websocket.send(
				JSON.stringify({ type: 'heartbeat' } satisfies ClientMessage)
			)
		}, 5_000)

		return () => clearInterval(interval)
	}, [websocket])

	const identity = useMemo(
		() => roomState.users.find((u) => u.id === websocket.id),
		[roomState.users, websocket.id]
	)

	const otherUsers = useMemo(
		() => roomState.users.filter((u) => u.id !== websocket.id && u.joined),
		[roomState.users, websocket.id]
	)

	return { identity, otherUsers, websocket, roomState, websocketConnected }
}
