import type { LoaderFunctionArgs } from '@remix-run/cloudflare'
import { json } from '@remix-run/cloudflare'
import {
	useLoaderData,
	useNavigate,
	useParams,
	useSearchParams,
} from '@remix-run/react'
import { useEffect, useState, useMemo } from 'react'
import { useMount, useWindowSize } from 'react-use'
import invariant from 'tiny-invariant'
import { AiButton } from '~/components/AiButton'
import { CameraButton } from '~/components/CameraButton'
import { CopyButton } from '~/components/CopyButton'
import { HighPacketLossWarningsToast } from '~/components/HighPacketLossWarningsToast'
import { IceDisconnectedToast } from '~/components/IceDisconnectedToast'
import { LeaveRoomButton } from '~/components/LeaveRoomButton'
import { MicButton } from '~/components/MicButton'
import { OverflowMenu } from '~/components/OverflowMenu'
import { ParticipantLayout } from '~/components/ParticipantLayout'
import { PullAudioTracks } from '~/components/PullAudioTracks'
import { RaiseHandButton } from '~/components/RaiseHandButton'
import { ScreenshareButton } from '~/components/ScreenshareButton'
import Toast from '~/components/Toast'
import useBroadcastStatus from '~/hooks/useBroadcastStatus'
import useIsSpeaking from '~/hooks/useIsSpeaking'
import { useRoomContext } from '~/hooks/useRoomContext'
import { useShowDebugInfoShortcut } from '~/hooks/useShowDebugInfoShortcut'
import useSounds from '~/hooks/useSounds'
import useStageManager from '~/hooks/useStageManager'
import { useUserJoinLeaveToasts } from '~/hooks/useUserJoinLeaveToasts'
import getUsername from '~/utils/getUsername.server'
import isNonNullable from '~/utils/isNonNullable'
import { TranscriptionService } from "~/components/TranscriptionService";
import { TranscriptionPanel } from "~/components/TranscriptionPanel";
import { usePulledAudioTracks } from "~/components/PullAudioTracks";

export const loader = async ({ request, context }: LoaderFunctionArgs) => {
	const username = await getUsername(request)

	return json({
		username,
		bugReportsEnabled: Boolean(
			context.env.FEEDBACK_URL &&
				context.env.FEEDBACK_QUEUE &&
				context.env.FEEDBACK_STORAGE
		),
		mode: context.mode,
		hasDb: Boolean(context.env.DB),
		hasAiCredentials: Boolean(
			context.env.OPENAI_API_TOKEN && context.env.OPENAI_MODEL_ENDPOINT
		),
		hasTranscriptionCredentials: Boolean(context.env.DEEPGRAM_SECRET),
		transcriptionProvider: context.env.TRANSCRIPTION_PROVIDER || 'deepgram',
		hasOpenAiTranscription: Boolean(context.env.OPENAI_API_TOKEN),
		transcriptionEnabled: context.env.TRANSCRIPTION_ENABLED === 'true',
		aiInviteEnabled: context.env.AI_INVITE_ENABLED === 'true',
		e2eeEnabled: context.env.E2EE_ENABLED === 'true',
	})
}

export default function Room() {
	const { joined } = useRoomContext()
	const navigate = useNavigate()
	const { roomName } = useParams<{ roomName: string }>()
	invariant(roomName, 'roomName is required')
	const { mode, bugReportsEnabled } = useLoaderData<typeof loader>()
	const [search] = useSearchParams()

	useEffect(() => {
		if (!joined && mode !== 'development')
			navigate(`/${roomName}${search.size > 0 ? '?' + search.toString() : ''}`)
	}, [joined, mode, navigate, roomName, search])

	if (!joined && mode !== 'development') return null

	return (
		<Toast.Provider>
			<JoinedRoom bugReportsEnabled={bugReportsEnabled} roomName={roomName} />
		</Toast.Provider>
	)
}

function JoinedRoom({
	bugReportsEnabled,
	roomName,
}: {
	bugReportsEnabled: boolean
	roomName: string
}) {
	const { hasDb, hasAiCredentials, transcriptionProvider, hasOpenAiTranscription, transcriptionEnabled, aiInviteEnabled, e2eeEnabled } = useLoaderData<typeof loader>()
	const {
		userMedia,
		partyTracks,
		pushedTracks,
		showDebugInfo,
		pinnedTileIds,
		e2eeOnJoin,
		room: {
			otherUsers,
			websocket,
			identity,
			roomState: { meetingId },
		},
	} = useRoomContext()

	useShowDebugInfoShortcut()

	const [raisedHand, setRaisedHand] = useState(false)
	const speaking = useIsSpeaking(userMedia.audioStreamTrack)

	useMount(() => {
		if (otherUsers.length > 5) {
			userMedia.turnMicOff()
		}
	})

	// Initialize E2EE after peer connection is established
	useEffect(() => {
		if (e2eeEnabled && identity) {
			const isFirstUser = otherUsers.length === 0
			console.log('🔐 Calling e2eeOnJoin with firstUser:', isFirstUser, 'identity:', identity.id)
			e2eeOnJoin(isFirstUser)
		}
	}, [e2eeEnabled, identity?.id, e2eeOnJoin]) // Only call once when identity is established

	useBroadcastStatus({
		userMedia,
		partyTracks: partyTracks,
		websocket,
		identity,
		pushedTracks,
		raisedHand,
		speaking,
	})

	useSounds(otherUsers)
	useUserJoinLeaveToasts(otherUsers)

	const { width } = useWindowSize()

	const someScreenshare =
		otherUsers.some((u) => u.tracks.screenshare) ||
		Boolean(identity?.tracks.screenshare)
	const stageLimit = width < 600 ? 2 : someScreenshare ? 5 : 8

	const { recordActivity, actorsOnStage } = useStageManager(
		otherUsers,
		stageLimit,
		identity
	)

	useEffect(() => {
		otherUsers.forEach((u) => {
			if (u.speaking || u.raisedHand) recordActivity(u)
		})
	}, [otherUsers, recordActivity])

	const pinnedActors = actorsOnStage.filter((u) => pinnedTileIds.includes(u.id))
	const unpinnedActors = actorsOnStage.filter(
		(u) => !pinnedTileIds.includes(u.id)
	)

	interface Transcription {
		id: string
		text: string
		timestamp: number
		isFinal: boolean
		userId?: string
		speaker?: string
	}

	const [transcriptions, setTranscriptions] = useState<Transcription[]>([])

	const isTranscriptionHost = useMemo(() => {
		// Use the first joined user as the transcription host
		// If you're alone in the room, you're the host
		// If there are others, check if you're the first in the sorted list
		if (otherUsers.length === 0) {
			return true // You're alone, so you're the host
		}
		
		// Create a list of all users (including yourself) and sort by ID for consistency
		const allUsers = [...otherUsers, { id: identity?.id }].filter(u => u.id)
		allUsers.sort((a, b) => (a.id || '').localeCompare(b.id || ''))
		
		return allUsers[0]?.id === identity?.id
	}, [otherUsers, identity])

	const allRemoteAudioTrackIds = useMemo(() => {
		return otherUsers
			.filter((u) => u.id !== identity?.id && u.tracks.audio)
			.map((u) => u.tracks.audio!)
			.filter((track): track is string => track !== undefined)
	}, [otherUsers, identity])

	// Get actual audio tracks from PullAudioTracks context
	const pulledAudioTracks = usePulledAudioTracks()
	
	// Convert track IDs to actual MediaStreamTrack objects and include own microphone
	const actualAudioTracks = useMemo(() => {
		const remoteTracks = allRemoteAudioTrackIds
			.map(trackId => pulledAudioTracks[trackId])
			.filter((track): track is MediaStreamTrack => track !== undefined)
		
		// Add user's own audio track if available
		if (userMedia.audioStreamTrack) {
			remoteTracks.push(userMedia.audioStreamTrack)
		}
		
		return remoteTracks
	}, [allRemoteAudioTrackIds, pulledAudioTracks, userMedia.audioStreamTrack])

       const [showTranscription, setShowTranscription] = useState(false)

       const participantNames = useMemo(
               () => [
                       identity?.name,
                       ...otherUsers.map((u) => u.name),
               ].filter(Boolean) as string[],
               [identity?.name, otherUsers]
       )

	return (
		<PullAudioTracks
			audioTracks={otherUsers.map((u) => u.tracks.audio).filter(isNonNullable)}
		>
			<div className="h-[100vh] flex flex-col bg-white">
				<div className="relative flex-1 min-h-0">
					<div
						className="absolute inset-0 flex isolate gap-[var(--gap)] p-2 sm:p-[var(--gap)] pb-[calc(4rem+env(safe-area-inset-bottom))]"
						style={
							{
								'--gap': '1rem',
							} as any
						}
					>
						{pinnedActors.length > 0 && (
							<div className="flex-grow-[5] overflow-hidden relative">
								<ParticipantLayout users={pinnedActors.filter(isNonNullable)} />
							</div>
						)}
						<div className="flex-grow overflow-hidden relative">
							<ParticipantLayout users={unpinnedActors.filter(isNonNullable)} />
						</div>
					</div>
					<Toast.Viewport className="absolute bottom-0 right-0" />
				</div>
				<div className="fixed bottom-0 left-0 right-0 flex pt-0 sm:pt-0 gap-1 sm:gap-4 text-sm p-2 sm:p-4 bg-white border-t border-gray-200 pb-[env(safe-area-inset-bottom)]">
					{hasAiCredentials && aiInviteEnabled && <AiButton recordActivity={recordActivity} />}
					<MicButton warnWhenSpeakingWhileMuted />
					<CameraButton />
					<ScreenshareButton />
					<RaiseHandButton
						raisedHand={raisedHand}
						onClick={() => setRaisedHand(!raisedHand)}
					/>
					<OverflowMenu bugReportsEnabled={bugReportsEnabled} />
					<LeaveRoomButton roomName={roomName} />
					{showDebugInfo && meetingId && (
						<CopyButton contentValue={meetingId}>Meeting Id</CopyButton>
					)}
				</div>
			</div>
			<HighPacketLossWarningsToast />
			<IceDisconnectedToast />
			{isTranscriptionHost && transcriptionEnabled && transcriptionProvider === 'openai' && hasOpenAiTranscription && (
                               <TranscriptionService
                                       audioTracks={actualAudioTracks}
                                       isActive={isTranscriptionHost}
                                       participants={participantNames}
                                       onTranscription={(t) =>
                                               setTranscriptions((prev) => [...prev, t])
                                       }
                               />
			)}
			{transcriptionEnabled && (
				<div className="fixed top-4 right-4 z-50 bg-white border border-gray-300 rounded-lg p-4 shadow-lg">
					<button 
						onClick={() => setShowTranscription((v) => !v)}
						className="bg-blue-500 text-white px-4 py-2 rounded hover:bg-blue-600"
					>
						{showTranscription ? "Hide" : "Show"} Transcription
					</button>
					<div className="text-sm text-gray-600 mt-2">
						Host: {isTranscriptionHost ? 'Yes' : 'No'} | 
						Provider: {transcriptionProvider} | 
						OpenAI: {hasOpenAiTranscription ? 'Yes' : 'No'}
						<br />
						Audio Tracks: {actualAudioTracks.length} | 
						Mic: {userMedia.audioStreamTrack ? 'Yes' : 'No'} | 
						Remote: {Object.keys(pulledAudioTracks).length}
					</div>
				</div>
			)}
			{transcriptionEnabled && showTranscription && (
				<div className="fixed top-20 right-4 z-40 w-80 h-96 bg-white border border-gray-300 rounded-lg shadow-lg">
					<TranscriptionPanel transcriptions={transcriptions} />
				</div>
			)}
		</PullAudioTracks>
	)
}
