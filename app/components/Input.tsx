import { forwardRef } from 'react'
import { cn } from '~/utils/style'

export const Input = forwardRef<
	HTMLInputElement,
	JSX.IntrinsicElements['input']
>(({ className, ...rest }, ref) => (
	<input
		className={cn(
			'mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500',
			className
		)}
		{...rest}
		ref={ref}
	/>
))

Input.displayName = 'Input'
