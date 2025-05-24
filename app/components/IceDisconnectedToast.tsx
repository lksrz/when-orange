import Toast, { Root } from '~/components/Toast'
import { useConditionForAtLeast } from '~/hooks/useConditionForAtLeast'
import { useRoomContext } from '../hooks/useRoomContext'
import { Button } from './Button'
import { Icon } from './Icon/Icon'

export function IceDisconnectedToast() {
	const {
		iceConnectionState,
		iceRestartInProgress,
		userMedia,
		manualIceRestart,
	} = useRoomContext()

	const disconnectedForAtLeastTwoSeconds = useConditionForAtLeast(
		iceConnectionState === 'disconnected',
		2000
	)

	const handleRefreshMedia = () => {
		// Force refresh of media tracks by toggling camera/mic
		if (userMedia.videoEnabled) {
			userMedia.turnCameraOff()
			setTimeout(() => userMedia.turnCameraOn(), 100)
		}
		if (userMedia.audioEnabled) {
			userMedia.turnMicOff()
			setTimeout(() => userMedia.turnMicOn(), 100)
		}
	}

	const handleManualRestart = () => {
		console.log('🔄 User triggered manual ICE restart')
		manualIceRestart()
	}

	// Don't show if not disconnected for long enough
	if (!disconnectedForAtLeastTwoSeconds) {
		return null
	}

	return (
		<Root duration={Infinity}>
			<div className="space-y-2 text-sm">
				<div className="font-bold">
					<Toast.Title className="flex items-center gap-2">
						<Icon type="WifiIcon" />
						{iceRestartInProgress ? 'Reconnecting...' : 'Connection lost'}
					</Toast.Title>
				</div>
				<Toast.Description>
					{iceRestartInProgress
						? 'Attempting to restore connection after network change...'
						: 'Network connection interrupted. This may happen when switching between WiFi and mobile data.'}
				</Toast.Description>
				{!iceRestartInProgress && (
					<div className="flex gap-2 mt-2">
						<Button
							displayType="secondary"
							onClick={handleRefreshMedia}
							className="text-xs px-2 py-1"
						>
							<Icon type="CheckIcon" className="w-3 h-3 mr-1" />
							Refresh
						</Button>
						<Button
							displayType="secondary"
							onClick={handleManualRestart}
							className="text-xs px-2 py-1"
						>
							<Icon type="ArrowUpOnSquareIcon" className="w-3 h-3 mr-1" />
							Manual Restart
						</Button>
					</div>
				)}
				{iceRestartInProgress && (
					<div className="flex items-center gap-2 mt-2 text-xs text-gray-400">
						<div className="animate-spin w-3 h-3 border border-gray-400 border-t-transparent rounded-full"></div>
						Automatic recovery in progress...
					</div>
				)}
			</div>
		</Root>
	)
}
