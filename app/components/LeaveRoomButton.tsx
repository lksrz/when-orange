import { VisuallyHidden } from '@radix-ui/react-visually-hidden'
import { useNavigate } from '@remix-run/react'
import type { FC } from 'react'
import { Button } from './Button'
import { Icon } from './Icon/Icon'
import { Tooltip } from './Tooltip'

interface LeaveRoomButtonProps {
	roomName: string
}

export const LeaveRoomButton: FC<LeaveRoomButtonProps> = ({ roomName }) => {
	const navigate = useNavigate()
	return (
		<Tooltip content="Leave">
			<Button
				displayType="danger"
				onClick={() => {
					navigate(`/${roomName}?left=true`)
				}}
				className="flex items-center gap-2 text-xs"
			>
				<span className="hidden lg:inline">Leave</span>
				<Icon type="phoneXMark" />
			</Button>
		</Tooltip>
	)
}
