import {
	PartyTracks,
	setLogLevel,
	type PartyTracksConfig,
} from 'partytracks/client'
import { useObservableAsValue } from 'partytracks/react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useStablePojo } from './useStablePojo'

setLogLevel('debug')

// Helper function to detect mobile network
const isMobileNetwork = () => {
	if ('connection' in navigator) {
		const connection = (navigator as any).connection
		console.log('🔍 Network Connection API:', {
			type: connection?.type,
			effectiveType: connection?.effectiveType,
			downlink: connection?.downlink,
			rtt: connection?.rtt,
		})

		// Only consider it mobile if explicitly cellular
		if (connection?.type === 'cellular') {
			console.log('📱 Detected cellular network')
			return true
		}

		// If type is not available but effectiveType suggests mobile AND downlink is low
		if (
			!connection?.type &&
			connection?.effectiveType &&
			(connection.effectiveType === '2g' ||
				connection.effectiveType === '3g') &&
			connection.downlink &&
			connection.downlink < 1
		) {
			console.log('📱 Detected slow mobile network via effectiveType')
			return true
		}

		console.log('💻 Detected non-mobile network')
		return false
	}

	console.log('❓ Network Connection API not available')
	// Fallback: don't assume mobile if we can't detect
	return false
}

export const usePeerConnection = (config: PartyTracksConfig) => {
	const stableConfig = useStablePojo(config)

	// Check if we should force TURN relay for mobile networks
	const shouldForceRelay = isMobileNetwork()
	// Allow disabling force relay via URL parameter for testing
	const urlParams = new URLSearchParams(window.location.search)
	const forceRelayEnabled = urlParams.get('forceRelay') === 'true' // Changed to opt-in instead of opt-out
	// Add debug mode to force relay when no TURN candidates are detected
	const debugForceRelay = urlParams.get('debugRelay') === 'true'

	// Modify config to force relay if needed
	const modifiedConfig = useMemo(() => {
		if ((shouldForceRelay && forceRelayEnabled) || debugForceRelay) {
			console.log('📱 Mobile network detected, will prefer TURN relay')
			return {
				...stableConfig,
				// Add ice transport policy to force relay
				iceTransportPolicy: 'relay' as RTCIceTransportPolicy,
			}
		}
		if (shouldForceRelay) {
			console.log(
				'📱 Mobile network detected, but force relay disabled by default'
			)
		}
		if (debugForceRelay) {
			console.log('🔧 Debug relay mode enabled via URL parameter')
		}
		return stableConfig
	}, [stableConfig, shouldForceRelay, forceRelayEnabled, debugForceRelay])

	const partyTracks = useMemo(
		() => new PartyTracks(modifiedConfig),
		[modifiedConfig]
	)
	const peerConnection = useObservableAsValue(partyTracks.peerConnection$)

	const [iceConnectionState, setIceConnectionState] =
		useState<RTCIceConnectionState>('new')
	const [iceRestartInProgress, setIceRestartInProgress] = useState(false)
	const [consecutiveFailures, setConsecutiveFailures] = useState(0)
	const [lastRestartTime, setLastRestartTime] = useState<number>(0)
	const [connectionStable, setConnectionStable] = useState(false)
	const [iceCandidateStats, setIceCandidateStats] = useState({
		local: { host: 0, srflx: 0, relay: 0 },
		remote: { host: 0, srflx: 0, relay: 0 },
	})

	// Add global error handler for setParameters errors and session readiness issues
	useEffect(() => {
		const handleUnhandledRejection = (event: PromiseRejectionEvent) => {
			if (
				event.reason instanceof Error &&
				event.reason.name === 'InvalidModificationError' &&
				event.reason.message.includes('parameters are not valid')
			) {
				console.warn(
					'🔧 Caught setParameters error during network transition, ignoring:',
					event.reason.message
				)
				// Prevent the error from being logged as unhandled
				event.preventDefault()
			}

			// Handle session readiness errors
			if (
				event.reason instanceof Error &&
				event.reason.message.includes('Session is not ready yet')
			) {
				console.warn(
					'🔄 Caught session readiness error during transition, ignoring:',
					event.reason.message
				)
				// Prevent the error from being logged as unhandled
				event.preventDefault()
			}

			// Handle other common WebRTC errors during transitions
			if (
				event.reason instanceof Error &&
				(event.reason.message.includes('Cannot set remote answer') ||
					event.reason.message.includes('Failed to execute') ||
					event.reason.message.includes('InvalidStateError'))
			) {
				console.warn(
					'🔄 Caught WebRTC state error during transition, ignoring:',
					event.reason.message
				)
				event.preventDefault()
			}
		}

		window.addEventListener('unhandledrejection', handleUnhandledRejection)
		return () => {
			window.removeEventListener('unhandledrejection', handleUnhandledRejection)
		}
	}, [])

	useEffect(() => {
		if (!peerConnection) return
		setIceConnectionState(peerConnection.iceConnectionState)

		// Add ICE candidate logging
		const handleIceCandidate = (event: RTCPeerConnectionIceEvent) => {
			if (event.candidate) {
				console.log('🧊 ICE Candidate:', {
					type: event.candidate.type,
					protocol: event.candidate.protocol,
					address: event.candidate.address,
					port: event.candidate.port,
					priority: event.candidate.priority,
					foundation: event.candidate.foundation,
					relatedAddress: event.candidate.relatedAddress,
					relatedPort: event.candidate.relatedPort,
				})

				// Update candidate statistics
				setIceCandidateStats((prev) => ({
					...prev,
					local: {
						...prev.local,
						[event.candidate!.type || 'host']:
							(prev.local[event.candidate!.type as keyof typeof prev.local] ||
								0) + 1,
					},
				}))
			}
		}

		// Add ICE candidate error logging
		const handleIceCandidateError = (event: RTCPeerConnectionIceErrorEvent) => {
			console.error('❌ ICE Candidate Error:', {
				errorCode: event.errorCode,
				errorText: event.errorText,
				url: event.url,
				address: event.address,
				port: event.port,
			})
		}

		// Add ICE gathering state change logging
		const handleIceGatheringStateChange = () => {
			console.log('🧊 ICE Gathering State:', peerConnection.iceGatheringState)
			if (peerConnection.iceGatheringState === 'complete') {
				console.log('📊 ICE Candidate Statistics:', iceCandidateStats)

				// Warn if no TURN candidates were gathered
				if (iceCandidateStats.local.relay === 0) {
					console.warn(
						'⚠️ No TURN relay candidates found - mobile connections may fail'
					)
					console.warn(
						'💡 Check TURN_SERVICE_ID and TURN_SERVICE_TOKEN environment variables'
					)
					console.warn('💡 Try ?debugRelay=true to test with force relay mode')
				} else {
					console.log(
						'✅ TURN relay candidates available:',
						iceCandidateStats.local.relay
					)
				}
			}
		}

		const iceConnectionStateChangeHandler = () => {
			const newState = peerConnection.iceConnectionState
			console.log(
				`🧊 ICE connection state changed: ${iceConnectionState} → ${newState}`
			)
			setIceConnectionState(newState)

			// Track connection failures for backoff strategy
			if (newState === 'failed') {
				setConsecutiveFailures((prev) => prev + 1)
				setConnectionStable(false)
				console.log(
					`🔄 ICE connection failed (${consecutiveFailures + 1} consecutive failures)`
				)
			} else if (newState === 'connected' || newState === 'completed') {
				// Reset failure counter on successful connection
				setConsecutiveFailures(0)
				// Mark connection as stable after a short delay
				setTimeout(() => setConnectionStable(true), 1000)
			} else if (newState === 'disconnected' || newState === 'checking') {
				setConnectionStable(false)
			}

			// If we were restarting ICE and now we're connected, the restart succeeded
			if (
				iceRestartInProgress &&
				(newState === 'connected' || newState === 'completed')
			) {
				console.log('✅ ICE restart completed successfully')
				setIceRestartInProgress(false)
				setConsecutiveFailures(0) // Reset failure counter
				setLastRestartTime(Date.now())

				// Trigger a custom event to notify other components that connection is restored
				window.dispatchEvent(new CustomEvent('iceConnectionRestored'))
			}

			// Handle failed restarts
			if (iceRestartInProgress && newState === 'failed') {
				console.log('❌ ICE restart failed, will retry with backoff')
				setIceRestartInProgress(false)
			}
		}
		peerConnection.addEventListener(
			'iceconnectionstatechange',
			iceConnectionStateChangeHandler
		)
		// Add new event listeners for ICE diagnostics
		peerConnection.addEventListener('icecandidate', handleIceCandidate)
		peerConnection.addEventListener(
			'icecandidateerror',
			handleIceCandidateError
		)
		peerConnection.addEventListener(
			'icegatheringstatechange',
			handleIceGatheringStateChange
		)

		return () => {
			peerConnection.removeEventListener(
				'iceconnectionstatechange',
				iceConnectionStateChangeHandler
			)
			peerConnection.removeEventListener('icecandidate', handleIceCandidate)
			peerConnection.removeEventListener(
				'icecandidateerror',
				handleIceCandidateError
			)
			peerConnection.removeEventListener(
				'icegatheringstatechange',
				handleIceGatheringStateChange
			)
		}
	}, [
		peerConnection,
		iceRestartInProgress,
		iceConnectionState,
		consecutiveFailures,
		iceCandidateStats,
	])

	// Handle ICE restart for network transitions with exponential backoff
	useEffect(() => {
		if (
			!peerConnection ||
			iceRestartInProgress ||
			(iceConnectionState !== 'disconnected' &&
				iceConnectionState !== 'failed' &&
				iceConnectionState !== 'closed')
		)
			return

		// Special handling for 'closed' state - this indicates complete failure
		if (iceConnectionState === 'closed') {
			console.log('❌ ICE connection closed - connection completely failed')
			// Don't attempt restart on closed connections, let the application handle reconnection
			setConsecutiveFailures((prev) => prev + 1)
			return
		}

		// Implement exponential backoff to prevent rapid restart loops
		const timeSinceLastRestart = Date.now() - lastRestartTime
		const baseDelay = 5000 // 5 seconds base delay
		const maxDelay = 60000 // Max 60 seconds delay
		const backoffDelay = Math.min(
			baseDelay * Math.pow(2, consecutiveFailures),
			maxDelay
		)

		// Don't restart too frequently
		if (timeSinceLastRestart < backoffDelay) {
			console.log(
				`🔄 ICE restart delayed due to backoff: ${Math.ceil((backoffDelay - timeSinceLastRestart) / 1000)}s remaining`
			)
			return
		}

		// Don't restart after too many consecutive failures
		if (consecutiveFailures >= 5) {
			console.log('❌ Too many consecutive ICE restart failures, giving up')
			return
		}

		console.log(
			`🔄 Scheduling ICE restart (attempt ${consecutiveFailures + 1}) with ${backoffDelay}ms delay`
		)

		const restartTimeout = setTimeout(async () => {
			// Double-check connection state before restarting
			if (
				peerConnection.iceConnectionState === 'disconnected' ||
				peerConnection.iceConnectionState === 'failed'
			) {
				if (!iceRestartInProgress) {
					console.log(
						`🔄 Attempting ICE restart (attempt ${consecutiveFailures + 1})`
					)
					setIceRestartInProgress(true)
					try {
						// Validate peer connection is in a state where restart is possible
						if (peerConnection.signalingState === 'closed') {
							console.log('❌ Cannot restart ICE: peer connection is closed')
							setIceRestartInProgress(false)
							return
						}

						// Create a new offer with iceRestart: true
						const offer = await peerConnection.createOffer({ iceRestart: true })
						await peerConnection.setLocalDescription(offer)
						console.log('✅ ICE restart initiated')
						setLastRestartTime(Date.now())
					} catch (error) {
						console.error('❌ Failed to restart ICE:', error)
						setIceRestartInProgress(false)
						setConsecutiveFailures((prev) => prev + 1)
					}
				}
			} else {
				console.log('🔄 ICE restart skipped - connection state improved')
			}
		}, backoffDelay)

		return () => clearTimeout(restartTimeout)
	}, [
		peerConnection,
		iceConnectionState,
		iceRestartInProgress,
		consecutiveFailures,
		lastRestartTime,
	])

	// Additional ICE restart triggers for network transitions
	useEffect(() => {
		if (!peerConnection || iceRestartInProgress) return

		// Handle network change events that might not trigger 'disconnected' state
		const handleNetworkChange = async () => {
			console.log(
				'🌐 Network change detected, checking if ICE restart is needed'
			)

			// Wait a moment to see if ICE state changes naturally
			setTimeout(async () => {
				const currentState = peerConnection.iceConnectionState
				console.log('🧊 ICE state after network change:', currentState)

				// If we're still in a problematic state after network change, restart ICE
				if (
					(currentState === 'checking' ||
						currentState === 'failed' ||
						currentState === 'disconnected') &&
					!iceRestartInProgress
				) {
					console.log('🔄 Triggering ICE restart due to network change')
					setIceRestartInProgress(true)
					try {
						const offer = await peerConnection.createOffer({ iceRestart: true })
						await peerConnection.setLocalDescription(offer)
						console.log('✅ ICE restart initiated after network change')
					} catch (error) {
						console.error(
							'❌ Failed to restart ICE after network change:',
							error
						)
						setIceRestartInProgress(false)
					}
				}
			}, 2000) // Wait 2 seconds to see if state changes naturally
		}

		// Listen for network change events
		window.addEventListener('online', handleNetworkChange)
		window.addEventListener('offline', handleNetworkChange)

		// Listen for connection type changes (mobile networks)
		if ('connection' in navigator) {
			const connection = (navigator as any).connection
			connection?.addEventListener('change', handleNetworkChange)
		}

		return () => {
			window.removeEventListener('online', handleNetworkChange)
			window.removeEventListener('offline', handleNetworkChange)
			if ('connection' in navigator) {
				const connection = (navigator as any).connection
				connection?.removeEventListener('change', handleNetworkChange)
			}
		}
	}, [peerConnection, iceRestartInProgress])

	// Periodic check for media flow to detect stale connections
	// TEMPORARILY DISABLED: This might be interfering with video reception
	/*
	useEffect(() => {
		if (!peerConnection || iceRestartInProgress) return

		let lastBytesReceived = 0
		let lastBytesSent = 0
		let noDataCount = 0

		const checkMediaFlow = async () => {
			try {
				const stats = await peerConnection.getStats()
				let currentBytesReceived = 0
				let currentBytesSent = 0
				let hasActiveInboundVideo = false
				let hasActiveOutboundVideo = false

				stats.forEach((report) => {
					if (report.type === 'inbound-rtp') {
						currentBytesReceived += report.bytesReceived || 0
						// Check if we have active video streams
						if (report.mediaType === 'video' && report.bytesReceived > 0) {
							hasActiveInboundVideo = true
						}
					}
					if (report.type === 'outbound-rtp') {
						currentBytesSent += report.bytesSent || 0
						// Check if we're sending video
						if (report.mediaType === 'video' && report.bytesSent > 0) {
							hasActiveOutboundVideo = true
						}
					}
				})

				// Check if data is flowing
				const receivedData = currentBytesReceived > lastBytesReceived
				const sentData = currentBytesSent > lastBytesSent

				// Only count as "no data" if we have neither received nor sent ANY data
				// AND we're not in a legitimate scenario where no video is expected
				const hasVideoActivity = hasActiveInboundVideo || hasActiveOutboundVideo
				
				if (!receivedData && !sentData && !hasVideoActivity) {
					noDataCount++
					console.log(`📊 No media data flow detected (${noDataCount}/6)`)

					// Increased threshold: If no data for 6 consecutive checks (30 seconds), restart ICE
					// This is much more conservative to avoid interfering with working video
					if (noDataCount >= 6) {
						console.log('🔄 Triggering ICE restart due to prolonged media silence')
						setIceRestartInProgress(true)
						try {
							const offer = await peerConnection.createOffer({
								iceRestart: true,
							})
							await peerConnection.setLocalDescription(offer)
							console.log('✅ ICE restart initiated due to media flow issue')
						} catch (error) {
							console.error(
								'❌ Failed to restart ICE due to media flow issue:',
								error
							)
							setIceRestartInProgress(false)
						}
						noDataCount = 0 // Reset counter
					}
				} else {
					// Reset counter if any data is flowing or we have active video
					noDataCount = 0
				}

				lastBytesReceived = currentBytesReceived
				lastBytesSent = currentBytesSent
			} catch (error) {
				console.error('❌ Error checking media flow:', error)
			}
		}

		// Check every 5 seconds, but be much more conservative about restarts
		const interval = setInterval(checkMediaFlow, 5000)

		return () => clearInterval(interval)
	}, [peerConnection, iceRestartInProgress])
	*/

	// Manual ICE restart function for external triggers
	const manualIceRestart = async () => {
		if (!peerConnection || iceRestartInProgress) {
			console.log(
				'🔄 Manual ICE restart skipped - already in progress or no connection'
			)
			return
		}

		console.log('🔄 Manual ICE restart triggered')
		setIceRestartInProgress(true)
		try {
			const offer = await peerConnection.createOffer({ iceRestart: true })
			await peerConnection.setLocalDescription(offer)
			console.log('✅ Manual ICE restart initiated')
		} catch (error) {
			console.error('❌ Failed to manually restart ICE:', error)
			setIceRestartInProgress(false)
		}
	}

	// Session readiness checker
	const isSessionReady = useCallback(() => {
		if (!peerConnection) return false
		return (
			peerConnection.signalingState !== 'closed' &&
			peerConnection.connectionState !== 'closed' &&
			peerConnection.connectionState !== 'failed'
		)
	}, [peerConnection])

	// Safe operation executor that waits for session readiness
	const executeWhenReady = useCallback(
		async (operation: () => Promise<void>, maxRetries = 3) => {
			let retries = 0
			while (retries < maxRetries) {
				if (isSessionReady()) {
					try {
						await operation()
						return true
					} catch (error) {
						if (
							error instanceof Error &&
							error.message.includes('Session is not ready yet')
						) {
							console.log(
								`🔄 Session not ready, retry ${retries + 1}/${maxRetries}`
							)
							retries++
							await new Promise((resolve) =>
								setTimeout(resolve, 1000 * retries)
							) // exponential backoff
							continue
						}
						throw error // Re-throw non-session errors
					}
				} else {
					console.log(
						`🔄 Waiting for session readiness, retry ${retries + 1}/${maxRetries}`
					)
					retries++
					await new Promise((resolve) => setTimeout(resolve, 1000 * retries))
				}
			}
			console.log('❌ Operation failed: session not ready after max retries')
			return false
		},
		[isSessionReady]
	)

	return {
		partyTracks,
		iceConnectionState,
		iceRestartInProgress,
		manualIceRestart,
		isSessionReady,
		executeWhenReady,
		iceCandidateStats,
		isMobileNetwork: isMobileNetwork(),
	}
}
