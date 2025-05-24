import { useOutletContext } from '@remix-run/react'
import type { PartyTracks } from 'partytracks/client'
import type { Dispatch, SetStateAction } from 'react'
import type { UserMedia } from '~/hooks/useUserMedia'
import type useRoom from './useRoom'
import type { useRoomHistory } from './useRoomHistory'

export type RoomContextType = {
	traceLink?: string
	feedbackEnabled: boolean
	userDirectoryUrl?: string
	joined: boolean
	setJoined: Dispatch<SetStateAction<boolean>>
	pinnedTileIds: string[]
	setPinnedTileIds: Dispatch<SetStateAction<string[]>>
	showDebugInfo: boolean
	setShowDebugInfo: Dispatch<SetStateAction<boolean>>
	audioOnlyMode: boolean
	setAudioOnlyMode: Dispatch<SetStateAction<boolean>>
	dataSaverMode: boolean
	setDataSaverMode: Dispatch<SetStateAction<boolean>>
	userMedia: UserMedia
	partyTracks: PartyTracks
	iceConnectionState: RTCIceConnectionState
	iceRestartInProgress: boolean
	manualIceRestart: () => void
	isSessionReady: () => boolean
	executeWhenReady: (
		operation: () => Promise<void>,
		maxRetries?: number
	) => Promise<boolean>
	iceCandidateStats: {
		local: { host: number; srflx: number; relay: number }
		remote: { host: number; srflx: number; relay: number }
	}
	isMobileNetwork: boolean
	room: ReturnType<typeof useRoom>
	roomHistory: ReturnType<typeof useRoomHistory>
	simulcastEnabled: boolean
	e2eeEnabled: boolean
	e2eeSafetyNumber?: string
	e2eeOnJoin: (firstUser: boolean) => void
	pushedTracks: {
		video?: string
		audio?: string
		screenshare?: string
	}
}

export function useRoomContext() {
	return useOutletContext<RoomContextType>()
}
