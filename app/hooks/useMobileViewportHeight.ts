import { useEffect, useRef } from 'react'

/**
 * Hook to handle mobile viewport height issues caused by dynamic browser UI
 * (address bar, toolbar, etc.) that changes the available viewport height.
 *
 * This sets CSS custom properties that can be used instead of 100vh
 * to ensure content is always visible above mobile browser UI.
 */
export function useMobileViewportHeight() {
	const timeoutRef = useRef<number>()

	useEffect(() => {
		function setViewportHeight() {
			// Get the actual viewport height
			const vh = window.innerHeight

			// Set CSS custom property for current viewport height
			document.documentElement.style.setProperty('--viewport-height', `${vh}px`)
		}

		// Set initial viewport height
		setViewportHeight()

		// Update on resize (handles mobile browser UI changes)
		const handleResize = () => {
			// Small debounce to avoid too many updates
			if (timeoutRef.current) {
				clearTimeout(timeoutRef.current)
			}
			timeoutRef.current = window.setTimeout(setViewportHeight, 50)
		}

		window.addEventListener('resize', handleResize, { passive: true })

		// Also listen for orientation changes on mobile
		const handleOrientationChange = () => {
			// Delay to let the browser settle after orientation change
			setTimeout(setViewportHeight, 150)
		}

		window.addEventListener('orientationchange', handleOrientationChange, {
			passive: true,
		})

		// Visual viewport API support for better mobile handling
		let visualViewportHandler: (() => void) | undefined

		if (window.visualViewport) {
			visualViewportHandler = () => {
				// Use visual viewport height if available (more accurate for mobile)
				const height = window.visualViewport?.height || window.innerHeight
				document.documentElement.style.setProperty(
					'--viewport-height',
					`${height}px`
				)
			}

			window.visualViewport.addEventListener('resize', visualViewportHandler, {
				passive: true,
			})
		}

		// Handle page visibility changes (iOS Safari sometimes needs this)
		const handleVisibilityChange = () => {
			if (!document.hidden) {
				setTimeout(setViewportHeight, 100)
			}
		}

		document.addEventListener('visibilitychange', handleVisibilityChange, {
			passive: true,
		})

		// Cleanup function
		return () => {
			if (timeoutRef.current) {
				clearTimeout(timeoutRef.current)
			}
			window.removeEventListener('resize', handleResize)
			window.removeEventListener('orientationchange', handleOrientationChange)
			document.removeEventListener('visibilitychange', handleVisibilityChange)

			if (window.visualViewport && visualViewportHandler) {
				window.visualViewport.removeEventListener(
					'resize',
					visualViewportHandler
				)
			}
		}
	}, [])
}
