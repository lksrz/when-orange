// Debug script for video reception issues
// Run this in browser console to check video track status

console.log('🔍 Video Reception Debug Script')

// Check if we have peer connections
const peerConnections = []
// Try to find peer connections in global scope or common locations
if (window.RTCPeerConnection) {
	console.log('✅ RTCPeerConnection is available')
}

// Function to debug a peer connection
function debugPeerConnection(pc) {
	console.log('🔍 Debugging PeerConnection:', pc)
	console.log('📊 Connection State:', pc.connectionState)
	console.log('🧊 ICE Connection State:', pc.iceConnectionState)
	console.log('📡 Signaling State:', pc.signalingState)

	const transceivers = pc.getTransceivers()
	console.log('📺 Total Transceivers:', transceivers.length)

	transceivers.forEach((transceiver, index) => {
		console.log(`📺 Transceiver ${index}:`, {
			direction: transceiver.direction,
			currentDirection: transceiver.currentDirection,
			sender: {
				track: transceiver.sender.track,
				trackKind: transceiver.sender.track?.kind,
				trackId: transceiver.sender.track?.id,
				trackEnabled: transceiver.sender.track?.enabled,
				trackReadyState: transceiver.sender.track?.readyState,
			},
			receiver: {
				track: transceiver.receiver.track,
				trackKind: transceiver.receiver.track?.kind,
				trackId: transceiver.receiver.track?.id,
				trackEnabled: transceiver.receiver.track?.enabled,
				trackReadyState: transceiver.receiver.track?.readyState,
			},
		})
	})

	// Check for remote streams
	pc.getReceivers().forEach((receiver, index) => {
		if (receiver.track && receiver.track.kind === 'video') {
			console.log(`🎥 Video Receiver ${index}:`, {
				trackId: receiver.track.id,
				enabled: receiver.track.enabled,
				readyState: receiver.track.readyState,
				muted: receiver.track.muted,
				transform: receiver.transform ? 'Present' : 'None',
			})
		}
	})
}

// Function to check video elements
function debugVideoElements() {
	const videoElements = document.querySelectorAll('video')
	console.log('🎥 Found video elements:', videoElements.length)

	videoElements.forEach((video, index) => {
		console.log(`🎥 Video Element ${index}:`, {
			src: video.src,
			srcObject: video.srcObject,
			videoWidth: video.videoWidth,
			videoHeight: video.videoHeight,
			paused: video.paused,
			ended: video.ended,
			readyState: video.readyState,
			networkState: video.networkState,
			currentTime: video.currentTime,
			duration: video.duration,
		})

		if (video.srcObject && video.srcObject.getTracks) {
			const tracks = video.srcObject.getTracks()
			console.log(
				`📹 Tracks for video ${index}:`,
				tracks.map((track) => ({
					kind: track.kind,
					id: track.id,
					enabled: track.enabled,
					readyState: track.readyState,
					muted: track.muted,
				}))
			)
		}
	})
}

// Try to find peer connections in common React contexts
function findPeerConnections() {
	// Check if partytracks is available
	try {
		// Look for React fiber data
		const reactRoot = document.querySelector('#root')
		if (reactRoot && reactRoot._reactInternalFiber) {
			console.log('🔍 React fiber found, searching for peer connections...')
		}

		// Check for common global variables
		if (window.peerConnection) {
			console.log('✅ Found global peerConnection')
			debugPeerConnection(window.peerConnection)
		}

		// Check for partyTracks
		if (window.partyTracks) {
			console.log('✅ Found global partyTracks')
		}
	} catch (error) {
		console.log('ℹ️ Could not access React internals:', error.message)
	}
}

// Run debug checks
console.log('🚀 Starting video debug checks...')
findPeerConnections()
debugVideoElements()

// Export functions for manual use
window.debugVideo = {
	debugPeerConnection,
	debugVideoElements,
	findPeerConnections,
}

console.log('✅ Debug functions available as window.debugVideo')
console.log('💡 Usage: window.debugVideo.debugVideoElements()')
