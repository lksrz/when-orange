import type { LinkProps } from '@remix-run/react'
import { Link } from '@remix-run/react'
import { forwardRef } from 'react'
import { cn } from '~/utils/style'

const displayTypeMap = {
	primary: [
		'text-white',
		'bg-blue-600 hover:bg-blue-700 active:bg-blue-800 focus:ring-blue-500 disabled:bg-blue-300',
		'border-blue-600 hover:border-blue-700 active:border-blue-800',
	],
	secondary: [
		'text-zinc-900 dark:text-zinc-100',
		'bg-zinc-200 hover:bg-zinc-300 dark:bg-zinc-700 dark:hover:bg-zinc-600 active:bg-zinc-400 dark:active:bg-zinc-700',
		'border-zinc-200 hover:border-zinc-300 dark:border-zinc-700 dark:hover:border-zinc-600',
	],
	orange: [
		'text-white',
		'bg-orange-500 hover:bg-orange-600 active:bg-orange-700',
		'border-orange-500 hover:border-orange-600 active:border-orange-700',
	],
	ghost: [
		'text-white hover:text-zinc-900',
		'bg-transparent hover:bg-white',
		'border-transparent hover:border-white',
	],
	danger: [
		'text-white',
		'bg-red-600 hover:bg-red-700 active:bg-red-800',
		'border-red-600 hover:border-red-700 active:border-red-800',
	],
	action: [
		'text-white',
		'bg-green-600 hover:bg-green-700 active:bg-green-800 focus:ring-green-500 disabled:bg-green-300',
		'border-green-600 hover:border-green-700 active:border-green-800',
	],
}

export type ButtonProps = Omit<JSX.IntrinsicElements['button'], 'ref'> & {
	displayType?: keyof typeof displayTypeMap
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
	({ className, displayType = 'action', disabled, onClick, ...rest }, ref) => (
		<button
			className={cn(
				'w-full flex py-2 justify-center px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white focus:outline-none focus:ring-2 focus:ring-offset-2',
				'uppercase',
				disabled && 'cursor-not-allowed opacity-50',
				displayTypeMap[displayType].join(' '),
				className
			)}
			aria-disabled={disabled}
			onClick={disabled ? (e) => e.preventDefault() : onClick}
			{...rest}
			ref={ref}
		/>
	)
)

Button.displayName = 'Button'

export const ButtonLink = forwardRef<
	HTMLAnchorElement,
	LinkProps & {
		displayType?: keyof typeof displayTypeMap
	}
>(({ className, displayType = 'primary', ...rest }, ref) => (
	// eslint-disable-next-line jsx-a11y/anchor-has-content
	<Link
		className={cn(
			'inline-block',
			'border-4',
			'rounded',
			'uppercase',
			'font-bold',
			'tracking-widest',
			'py-[.5em] px-[1em]',
			displayTypeMap[displayType].join(' '),
			className
		)}
		{...rest}
		ref={ref}
	/>
))

ButtonLink.displayName = 'Button'
