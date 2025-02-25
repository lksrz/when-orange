import type { FC } from 'react'
import { useKey } from 'react-use'
import { useRoomContext } from '~/hooks/useRoomContext'
import { errorMessageMap } from '~/hooks/useUserMedia'
import { metaKey } from '~/utils/metaKey'
import type { ButtonProps } from './Button'
import { Button } from './Button'
import { Icon } from './Icon/Icon'
import { Tooltip } from './Tooltip'

export const CameraButton: FC<ButtonProps> = ({ onClick, ...rest }) => {
	const {
		userMedia: {
			turnCameraOff,
			turnCameraOn,
			videoEnabled,
			videoUnavailableReason,
		},
	} = useRoomContext()

	const toggle = () => {
		videoEnabled ? turnCameraOff() : turnCameraOn()
	}

	useKey((e) => {
		if (e.key === 'e' && e.metaKey) {
			e.preventDefault()
			return true
		}
		return false
	}, toggle)

	const videoUnavailableMessage = videoUnavailableReason
		? errorMessageMap[videoUnavailableReason]
		: null

	return (
		<Tooltip
			content={
				videoUnavailableMessage ??
				`Turn camera ${videoEnabled ? 'off' : 'on'} (${metaKey}E)`
			}
		>
			<Button
				displayType={videoEnabled ? 'secondary' : 'danger'}
				disabled={!!videoUnavailableMessage}
				onClick={(e) => {
					toggle()
					onClick && onClick(e)
				}}
				{...rest}
				className="flex items-center gap-2 text-xs"
			>
				<span className="hidden md:inline lg:hidden">
					{videoEnabled ? 'Cam off' : 'Cam on'}
				</span>
				<span className="hidden lg:inline">
					{videoEnabled ? 'Camera off' : 'Camera on'}
				</span>
				<Icon type={videoEnabled ? 'videoOn' : 'videoOff'} />
			</Button>
		</Tooltip>
	)
}
