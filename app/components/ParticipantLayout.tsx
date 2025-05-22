import { createGrid } from 'good-grid'
import { useGridDimensions } from 'good-grid/react'
import { useId, useRef } from 'react'
import { Flipper } from 'react-flip-toolkit'
import type { User } from '~/types/Messages'
import { Participant } from './Participant'

export function ParticipantLayout(props: { users: User[] }) {
	const $el = useRef<HTMLDivElement>(null)
	const gap = 8 // Default gap value

	// Hook that listens to resize of the element and returns its dimensions
	const dimensions = useGridDimensions($el)

	const { width, height, getPosition } = createGrid({
		dimensions,
		count: props.users.length,
		aspectRatio: '4/3', // Using your aspect ratio from the original layout
		gap,
	})

	const id = useId()

	if (props.users.length === 0) {
		return null
	}

	return (
		<Flipper flipKey={id + props.users.length}>
			<div
				className="absolute inset-0 h-full w-full isolate"
				ref={$el}
				style={{
					padding: gap + 'px',
				}}
			>
				{props.users.map((user, i) => {
					const { top, left } = getPosition(i)
					return (
						<Participant
							style={{
								width,
								height,
								top,
								left,
								position: 'absolute',
								transition: '0.4s all',
							}}
							key={user.id}
							user={user}
						/>
					)
				})}
			</div>
		</Flipper>
	)
}
