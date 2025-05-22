import type { FC } from 'react'
import { playSound } from '~/utils/playSound'
import { Button } from './Button'
import { Icon } from './Icon/Icon'
import { Tooltip } from './Tooltip'

interface RaiseHandButtonProps {
	raisedHand: boolean
	onClick: () => void
}

export const RaiseHandButton: FC<RaiseHandButtonProps> = ({
	raisedHand,
	onClick,
}) => (
	<Tooltip content={raisedHand ? 'Lower hand' : 'Raise Hand'}>
		<Button
			displayType={raisedHand ? 'orange' : 'secondary'}
			onClick={(_e) => {
				onClick && onClick()
				if (!raisedHand) playSound('raiseHand')
			}}
			className="flex items-center gap-2 text-xs"
		>
			<span className="hidden md:inline lg:hidden">
				{raisedHand ? 'Hand' : 'Hand'}
			</span>
			<span className="hidden lg:inline">
				{raisedHand ? 'Lower hand' : 'Raise hand'}
			</span>
			<Icon type="handRaised" />
		</Button>
	</Tooltip>
)
