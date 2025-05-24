// Connection Debug Script for Orange Meets
// Run this in the browser console to diagnose connection issues

;(async function debugConnection() {
	console.log('🔍 Starting Orange Meets Connection Diagnostics...\n')

	// Check network information
	if ('connection' in navigator) {
		const connection = navigator.connection
		console.log('📱 Network Information:')
		console.log('  Type:', connection.type || 'unknown')
		console.log('  Effective Type:', connection.effectiveType || 'unknown')
		console.log('  Downlink:', connection.downlink || 'unknown', 'Mbps')
		console.log('  RTT:', connection.rtt || 'unknown', 'ms')
		console.log('  Save Data:', connection.saveData || false)
		console.log('')
	} else {
		console.log('❌ Network Information API not available\n')
	}

	// Find all peer connections
	const peerConnections = []
	// Look for peer connections in the window object
	for (const key in window) {
		if (window[key] && window[key] instanceof RTCPeerConnection) {
			peerConnections.push(window[key])
		}
	}

	// If no peer connections found in window, try to find them in React components
	if (peerConnections.length === 0) {
		console.log('⚠️  No peer connections found in window object')
		console.log('   Try running this after joining a room\n')
		return
	}

	// Analyze each peer connection
	for (let i = 0; i < peerConnections.length; i++) {
		const pc = peerConnections[i]
		console.log(`🔌 Peer Connection ${i + 1}:`)
		console.log('  Connection State:', pc.connectionState)
		console.log('  ICE Connection State:', pc.iceConnectionState)
		console.log('  ICE Gathering State:', pc.iceGatheringState)
		console.log('  Signaling State:', pc.signalingState)
		console.log('')

		// Get stats
		try {
			const stats = await pc.getStats()
			const candidates = {
				local: { host: 0, srflx: 0, relay: 0, prflx: 0 },
				remote: { host: 0, srflx: 0, relay: 0, prflx: 0 },
			}

			let selectedCandidatePair = null
			let transportStats = null

			stats.forEach((report) => {
				if (report.type === 'candidate-pair' && report.state === 'succeeded') {
					selectedCandidatePair = report
				}
				if (report.type === 'transport') {
					transportStats = report
				}
				if (report.type === 'local-candidate') {
					const type = report.candidateType || 'unknown'
					if (candidates.local[type] !== undefined) {
						candidates.local[type]++
					}
				}
				if (report.type === 'remote-candidate') {
					const type = report.candidateType || 'unknown'
					if (candidates.remote[type] !== undefined) {
						candidates.remote[type]++
					}
				}
			})

			console.log('🧊 ICE Candidates:')
			console.log('  Local:', candidates.local)
			console.log('  Remote:', candidates.remote)

			if (selectedCandidatePair) {
				console.log('\n✅ Selected Candidate Pair:')
				console.log('  Local:', selectedCandidatePair.localCandidateId)
				console.log('  Remote:', selectedCandidatePair.remoteCandidateId)
				console.log('  State:', selectedCandidatePair.state)
				console.log('  Bytes Sent:', selectedCandidatePair.bytesSent)
				console.log('  Bytes Received:', selectedCandidatePair.bytesReceived)

				// Find the actual candidates
				stats.forEach((report) => {
					if (report.id === selectedCandidatePair.localCandidateId) {
						console.log('\n  Local Candidate Details:')
						console.log('    Type:', report.candidateType)
						console.log('    Protocol:', report.protocol)
						console.log('    Address:', report.address)
						console.log('    Port:', report.port)
						if (report.candidateType === 'relay') {
							console.log('    Relay Protocol:', report.relayProtocol)
						}
					}
					if (report.id === selectedCandidatePair.remoteCandidateId) {
						console.log('\n  Remote Candidate Details:')
						console.log('    Type:', report.candidateType)
						console.log('    Protocol:', report.protocol)
						console.log('    Address:', report.address)
						console.log('    Port:', report.port)
					}
				})
			}

			if (transportStats) {
				console.log('\n📊 Transport Stats:')
				console.log('  DTLS State:', transportStats.dtlsState)
				console.log('  ICE State:', transportStats.iceState)
				console.log(
					'  Selected Candidate Pair ID:',
					transportStats.selectedCandidatePairId
				)
			}

			// Check for media flow
			console.log('\n📹 Media Flow:')
			let hasInboundVideo = false
			let hasOutboundVideo = false
			let totalBytesReceived = 0
			let totalBytesSent = 0

			stats.forEach((report) => {
				if (report.type === 'inbound-rtp' && report.mediaType === 'video') {
					hasInboundVideo = true
					totalBytesReceived += report.bytesReceived || 0
					console.log('  Inbound Video:', report.bytesReceived, 'bytes')
				}
				if (report.type === 'outbound-rtp' && report.mediaType === 'video') {
					hasOutboundVideo = true
					totalBytesSent += report.bytesSent || 0
					console.log('  Outbound Video:', report.bytesSent, 'bytes')
				}
			})

			if (!hasInboundVideo && !hasOutboundVideo) {
				console.log('  ⚠️ No video streams detected!')
			}
		} catch (error) {
			console.error('❌ Error getting stats:', error)
		}

		console.log('\n' + '='.repeat(50) + '\n')
	}

	// Recommendations
	console.log('💡 Recommendations:')
	console.log('1. If using mobile network and connection fails:')
	console.log('   - Check if TURN relay candidates are available')
	console.log(
		'   - Try adding ?forceRelay=true to URL to test with forced relay'
	)
	console.log('2. If no relay candidates are found:')
	console.log('   - TURN server may not be configured properly')
	console.log('   - Check Cloudflare TURN service configuration')
	console.log('3. Enable debug mode with Ctrl+Shift+Alt+D to see more info')
})()
