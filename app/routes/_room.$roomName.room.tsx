import type { LoaderFunctionArgs } from '@remix-run/cloudflare'
import { json, redirect } from '@remix-run/cloudflare'
import {
	useLoaderData,
	useNavigate,
	useParams,
	useSearchParams,
} from '@remix-run/react'
import { useEffect, useMemo, useState } from 'react'
import { useMount, useWindowSize } from 'react-use'
import invariant from 'tiny-invariant'
import { AiButton } from '~/components/AiButton'
import { CameraButton } from '~/components/CameraButton'
import { ConnectionDiagnostics } from '~/components/ConnectionDiagnostics'
import { CopyButton } from '~/components/CopyButton'
import { HighPacketLossWarningsToast } from '~/components/HighPacketLossWarningsToast'
import { IceDisconnectedToast } from '~/components/IceDisconnectedToast'
import { LeaveRoomButton } from '~/components/LeaveRoomButton'
import { MicButton } from '~/components/MicButton'
import { OverflowMenu } from '~/components/OverflowMenu'
import { ParticipantLayout } from '~/components/ParticipantLayout'
import {
	PullAudioTracks,
	usePulledAudioTracks,
} from '~/components/PullAudioTracks'
import { RaiseHandButton } from '~/components/RaiseHandButton'
import { ScreenshareButton } from '~/components/ScreenshareButton'
import Toast from '~/components/Toast'
import { TranscriptionPanel } from '~/components/TranscriptionPanel'
import { TranscriptionService } from '~/components/TranscriptionService'
import useBroadcastStatus from '~/hooks/useBroadcastStatus'
import useIsSpeaking from '~/hooks/useIsSpeaking'
import { useMobileViewportHeight } from '~/hooks/useMobileViewportHeight'
import { useRoomContext } from '~/hooks/useRoomContext'
import { useShowDebugInfoShortcut } from '~/hooks/useShowDebugInfoShortcut'
import useSounds from '~/hooks/useSounds'
import useStageManager, { screenshareSuffix } from '~/hooks/useStageManager'
import { useUserJoinLeaveToasts } from '~/hooks/useUserJoinLeaveToasts'
import getUsername from '~/utils/getUsername.server'
import isNonNullable from '~/utils/isNonNullable'

export const loader = async ({ request, context }: LoaderFunctionArgs) => {
	const url = new URL(request.url)
	const usernameParam = url.searchParams.get('username')

	// If username parameter is provided but user doesn't have a username set,
	// redirect to set-username to set it automatically
	if (usernameParam) {
		const currentUsername = await getUsername(request)
		if (!currentUsername) {
			const returnUrl = url.pathname + url.search
			const setUsernameUrl = `/set-username?username=${encodeURIComponent(usernameParam)}&return-url=${encodeURIComponent(returnUrl)}`
			throw redirect(setUsernameUrl)
		}
	}

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
	const {
		hasDb,
		hasAiCredentials,
		transcriptionProvider,
		hasOpenAiTranscription,
		transcriptionEnabled,
		aiInviteEnabled,
		e2eeEnabled,
	} = useLoaderData<typeof loader>()
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

	// Initialize mobile viewport height handling
	useMobileViewportHeight()

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
			// Use a more reliable method to determine if this is the first user
			// We'll start as a joining user and let the E2EE system handle group creation if needed
			const isFirstUser = false // Always start as joining user, E2EE will create group if none exists
			console.log(
				'🔐 Calling e2eeOnJoin with firstUser:',
				isFirstUser,
				'identity:',
				identity.id
			)
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

	const { width, height } = useWindowSize()
	const isMobilePortrait = width < 600 && width < height

	const someScreenshare =
		otherUsers.some((u) => u.tracks.screenshare) ||
		Boolean(identity?.tracks.screenshare)
	// Increase stage limit for mobile to ensure all participants are visible
	// In portrait mode with screenshare, we need at least the screensharer + other participants
	const stageLimit = width < 600 
		? (isMobilePortrait && someScreenshare ? Math.max(4, otherUsers.length + 1) : 3) 
		: someScreenshare ? 5 : 8

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

	// Find screen sharing actors first - they should always be prioritized
	// Screen share actors have IDs ending with the screenshareSuffix
	const screenSharingActors = actorsOnStage.filter((u) => u.id.endsWith(screenshareSuffix))
	const nonScreenSharingActors = actorsOnStage.filter((u) => !u.id.endsWith(screenshareSuffix))
	
	// For desktop/tablet layout, screen sharers are always pinned and shown as main
	const pinnedActors = screenSharingActors.length > 0 
		? screenSharingActors 
		: actorsOnStage.filter((u) => pinnedTileIds.includes(u.id))
	const unpinnedActors = screenSharingActors.length > 0
		? nonScreenSharingActors
		: actorsOnStage.filter((u) => !pinnedTileIds.includes(u.id))

	// Determine actors for the special mobile screenshare layout
	let mobileLayoutScreenActor: (typeof actorsOnStage)[0] | null = null
	let mobileLayoutRowActors: typeof actorsOnStage = []

	if (isMobilePortrait && someScreenshare) {
		// Find the screen sharing actor (prioritize local user if they're sharing)
		const localUserIsSharing = !!identity?.tracks.screenshare

		if (localUserIsSharing && identity) {
			// If local user is sharing, they MUST be the main screen actor.
			// Look for the screenshare version of the local user
			mobileLayoutScreenActor =
				actorsOnStage.find((actor) => actor.id === identity.id + screenshareSuffix) || null
		} else {
			// Pick the first screen sharer from the stage
			mobileLayoutScreenActor =
				actorsOnStage.find((actor) => actor.id.endsWith(screenshareSuffix)) || null
		}

		// If we found a screen sharer, all others go to the row below
		if (mobileLayoutScreenActor) {
			mobileLayoutRowActors = actorsOnStage.filter(
				(actor) => actor.id !== mobileLayoutScreenActor!.id
			)
		} else {
			// Fallback: no screen sharer found on stage
			mobileLayoutRowActors = actorsOnStage
		}
	}

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
		const allUsers = [...otherUsers, { id: identity?.id }].filter((u) => u.id)
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
			.map((trackId) => pulledAudioTracks[trackId])
			.filter((track): track is MediaStreamTrack => track !== undefined)

		// Add user's own audio track if available
		if (userMedia.audioStreamTrack) {
			remoteTracks.push(userMedia.audioStreamTrack)
		}

		return remoteTracks
	}, [allRemoteAudioTrackIds, pulledAudioTracks, userMedia.audioStreamTrack])

	const [showTranscription, setShowTranscription] = useState(false)

	const participantNames = useMemo(
		() =>
			[identity?.name, ...otherUsers.map((u) => u.name)].filter(
				Boolean
			) as string[],
		[identity?.name, otherUsers]
	)

	return (
		<PullAudioTracks
			audioTracks={otherUsers.map((u) => u.tracks.audio).filter(isNonNullable)}
		>
			<div className="h-mobile-screen flex flex-col bg-white">
				<div className="flex-1 relative overflow-hidden">
					<div
						className={`absolute inset-0 isolate p-2 pb-0 ${
							isMobilePortrait && someScreenshare ? 'flex flex-col' : 'flex'
						} gap-[var(--gap)]`}
						style={
							{
								'--gap': '0.5rem',
							} as any
						}
					>
						{isMobilePortrait && someScreenshare ? (
							<>
								{mobileLayoutScreenActor && (
									<div className="w-full flex-1 overflow-hidden relative">
										<ParticipantLayout
											users={[mobileLayoutScreenActor].filter(isNonNullable)}
										/>
									</div>
								)}
								{mobileLayoutRowActors.length > 0 && (
									<div className="w-full flex-shrink-0 overflow-hidden relative" style={{ height: 'min(25vh, 150px)' }}>
										<div className="h-full flex gap-2 px-2">
											{mobileLayoutRowActors.slice(0, 3).map((actor) => (
												<div key={actor.id} className="flex-1 h-full relative overflow-hidden rounded-lg">
													<ParticipantLayout
														users={[actor].filter(isNonNullable)}
													/>
												</div>
											))}
										</div>
										{mobileLayoutRowActors.length > 3 && (
											<div className="absolute bottom-1 right-2 bg-black/50 text-white text-xs px-2 py-1 rounded">
												+{mobileLayoutRowActors.length - 3} more
											</div>
										)}
									</div>
								)}
							</>
						) : (
							<>
								{pinnedActors.length > 0 && (
									<div className="flex-grow-[5] overflow-hidden relative">
										<ParticipantLayout
											users={pinnedActors.filter(isNonNullable)}
										/>
									</div>
								)}
								{unpinnedActors.length > 0 && (
									<div
										className={`overflow-hidden relative ${
											pinnedActors.length > 0 ? 'flex-grow' : 'flex-grow w-full'
										}`}
									>
										<ParticipantLayout
											users={unpinnedActors.filter(isNonNullable)}
										/>
									</div>
								)}
							</>
						)}
					</div>
					<Toast.Viewport className="absolute bottom-0 right-0" />
				</div>
				<div className="flex-shrink-0 flex items-center justify-center gap-2 text-sm p-0 px-2 bg-white pb-[env(safe-area-inset-bottom)] h-[3rem]">
					{hasAiCredentials && aiInviteEnabled && (
						<AiButton recordActivity={recordActivity} />
					)}
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
			<ConnectionDiagnostics />
			{isTranscriptionHost &&
				transcriptionEnabled &&
				transcriptionProvider === 'openai' &&
				hasOpenAiTranscription && (
					<TranscriptionService
						audioTracks={actualAudioTracks}
						isActive={isTranscriptionHost}
						participants={participantNames}
						onTranscription={(t) => setTranscriptions((prev) => [...prev, t])}
					/>
				)}
			{transcriptionEnabled && (
				<div className="fixed top-4 right-4 z-50 bg-white border border-gray-300 rounded-lg p-4 shadow-lg">
					<button
						onClick={() => setShowTranscription((v) => !v)}
						className="bg-blue-500 text-white px-4 py-2 rounded hover:bg-blue-600"
					>
						{showTranscription ? 'Hide' : 'Show'} Transcription
					</button>
					<div className="text-sm text-gray-600 mt-2">
						Host: {isTranscriptionHost ? 'Yes' : 'No'} | Provider:{' '}
						{transcriptionProvider} | OpenAI:{' '}
						{hasOpenAiTranscription ? 'Yes' : 'No'}
						<br />
						Audio Tracks: {actualAudioTracks.length} | Mic:{' '}
						{userMedia.audioStreamTrack ? 'Yes' : 'No'} | Remote:{' '}
						{Object.keys(pulledAudioTracks).length}
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