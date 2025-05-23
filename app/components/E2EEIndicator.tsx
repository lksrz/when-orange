import { Icon } from './Icon/Icon'

interface E2EEIndicatorProps {
	isEncrypted: boolean
}

export function E2EEIndicator({ isEncrypted }: E2EEIndicatorProps) {
	if (!isEncrypted) return null

	return (
		<div className="absolute bottom-2 right-2 flex items-center gap-1 px-2 py-1 bg-black/80 rounded text-xs text-white/80 backdrop-blur-sm">
			<Icon type="LockClosedIcon" className="w-3 h-3" />
			<span className="text-[10px] font-medium">ENCRYPTED</span>
		</div>
	)
}
