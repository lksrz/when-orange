import { useRoomContext } from '~/hooks/useRoomContext'

export function ConnectionDiagnostics() {
	const {
		iceConnectionState,
		iceCandidateStats,
		isMobileNetwork,
		showDebugInfo,
	} = useRoomContext()

	if (!showDebugInfo) return null

	return (
		<div className="fixed bottom-20 left-4 bg-black/80 text-white p-4 rounded-lg text-xs font-mono max-w-sm">
			<h3 className="font-bold mb-2">Connection Diagnostics</h3>

			<div className="space-y-1">
				<div>
					ICE State:{' '}
					<span className={getStateColor(iceConnectionState)}>
						{iceConnectionState}
					</span>
				</div>
				<div>Network Type: {isMobileNetwork ? '📱 Mobile' : '💻 Fixed'}</div>

				<div className="mt-2">
					<div className="font-bold">ICE Candidates:</div>
					<div className="ml-2">
						Local - Host: {iceCandidateStats.local.host}, STUN:{' '}
						{iceCandidateStats.local.srflx}, TURN:{' '}
						{iceCandidateStats.local.relay}
					</div>
					<div className="ml-2">
						Remote - Host: {iceCandidateStats.remote.host}, STUN:{' '}
						{iceCandidateStats.remote.srflx}, TURN:{' '}
						{iceCandidateStats.remote.relay}
					</div>
				</div>

				{iceCandidateStats.local.relay === 0 && isMobileNetwork && (
					<div className="mt-2 text-yellow-400">
						⚠️ No TURN candidates found on mobile network
					</div>
				)}
			</div>
		</div>
	)
}

function getStateColor(state: RTCIceConnectionState): string {
	switch (state) {
		case 'connected':
		case 'completed':
			return 'text-green-400'
		case 'checking':
			return 'text-yellow-400'
		case 'disconnected':
		case 'failed':
		case 'closed':
			return 'text-red-400'
		default:
			return 'text-gray-400'
	}
}
