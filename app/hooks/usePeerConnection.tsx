import {
	PartyTracks,
	setLogLevel,
	type PartyTracksConfig,
} from 'partytracks/client'
import { useObservableAsValue } from 'partytracks/react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useStablePojo } from './useStablePojo'

setLogLevel('debug')

export const usePeerConnection = (config: PartyTracksConfig) => {
	const stableConfig = useStablePojo(config)
	const [forceReconnect, setForceReconnect] = useState(0)

	// Use forceReconnect as part of the dependencies to force a new PartyTracks instance
	const partyTracks = useMemo(
		() => new PartyTracks(stableConfig),
		[stableConfig, forceReconnect]
	)

	const peerConnection = useObservableAsValue(partyTracks.peerConnection$)
	const [iceConnectionState, setIceConnectionState] =
		useState<RTCIceConnectionState>('new')
	const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null)

	// Add reconnection logic
	const reconnect = useCallback(() => {
		console.log('Triggering WebRTC reconnection...')

		// Clear any existing reconnection timeout
		if (reconnectTimeoutRef.current) {
			clearTimeout(reconnectTimeoutRef.current)
			reconnectTimeoutRef.current = null
		}

		// Force recreation of the PartyTracks instance
		setForceReconnect((prev) => prev + 1)
	}, [])

	useEffect(() => {
		if (!peerConnection) return
		setIceConnectionState(peerConnection.iceConnectionState)

		const iceConnectionStateChangeHandler = () => {
			const newState = peerConnection.iceConnectionState
			setIceConnectionState(newState)

			// Automatically reconnect when the connection is disconnected or failed
			if (newState === 'disconnected' || newState === 'failed') {
				console.log(
					`ICE connection state changed to ${newState}, will attempt to reconnect...`
				)

				// Add a delay before reconnecting to avoid rapid reconnection attempts
				if (reconnectTimeoutRef.current) {
					clearTimeout(reconnectTimeoutRef.current)
				}

				reconnectTimeoutRef.current = setTimeout(() => {
					reconnect()
					reconnectTimeoutRef.current = null
				}, 2000)
			}
		}

		peerConnection.addEventListener(
			'iceconnectionstatechange',
			iceConnectionStateChangeHandler
		)

		return () => {
			if (reconnectTimeoutRef.current) {
				clearTimeout(reconnectTimeoutRef.current)
				reconnectTimeoutRef.current = null
			}

			peerConnection.removeEventListener(
				'iceconnectionstatechange',
				iceConnectionStateChangeHandler
			)
		}
	}, [peerConnection, reconnect])

	return {
		partyTracks,
		iceConnectionState,
		reconnect, // Expose reconnect function
	}
}
