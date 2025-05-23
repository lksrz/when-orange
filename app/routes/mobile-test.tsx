import { useMobileViewportHeight } from '~/hooks/useMobileViewportHeight'

export default function MobileTest() {
	useMobileViewportHeight()

	return (
		<div className="h-mobile-screen flex flex-col bg-blue-100">
			<div className="flex-1 bg-green-200 p-4 flex items-center justify-center">
				<div className="text-center">
					<h1 className="text-2xl font-bold mb-4">Mobile Viewport Test</h1>
					<p className="mb-2">This area should fill the available space</p>
					<p className="text-sm text-gray-600">
						Height: var(--viewport-height)
					</p>
				</div>
			</div>
			<div className="h-16 bg-red-500 flex items-center justify-center text-white font-bold">
				Bottom Toolbar (should always be visible)
			</div>
		</div>
	)
}
