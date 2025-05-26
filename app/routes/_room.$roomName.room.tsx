import type { LoaderFunctionArgs } from '@remix-run/cloudflare'
import { json, redirect } from '@remix-run/cloudflare'
import {
	useLoaderData,
	useNavigate,
	useParams,
	useSearchParams,
} from '@remix-run/react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
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
import { TranscriptionServiceWrapper } from '~/components/TranscriptionServiceWrapper'
import { SubtitleOverlay } from '~/components/SubtitleOverlay'
import { getTranscriptionProvider } from '~/config/featureFlags'
import { useSpeakerTracker } from '~/hooks/useSpeakerTracker'
import { UserSpeakingDetector } from '~/hooks/useMultiUserSpeakingDetection'
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
		_hasDb: Boolean(context.env.DB), // Prefixed with _ to indicate unused variable
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
		if (e2eeEnabled && identity?.id && e2eeOnJoin) {
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
	}, [e2eeEnabled, identity, identity?.id, e2eeOnJoin]) // Only call once when identity is established

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

	// Removing unused variable to fix lint warning
	// const allUsersArray = [...otherUsers, { id: identity?.id }].filter((u) => u.id)

	useEffect(() => {
		if (!identity) return
		// Record users in room for activity tracking
		otherUsers.forEach((u) => {
			if (u.speaking || u.raisedHand) recordActivity(u)
		})
	}, [otherUsers, recordActivity, identity])

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
		startTime?: number
		endTime?: number
	}

	const [transcriptions, setTranscriptions] = useState<Transcription[]>([])
	
	// Handle incoming transcription messages from WebSocket
	useEffect(() => {
		const handleMessage = (event: MessageEvent) => {
			try {
				const message = JSON.parse(event.data)
				if (message.type === 'transcription') {
					setTranscriptions(prev => [...prev, message.transcription])
				}
			} catch (error) {
				// Ignore non-JSON messages
			}
		}
		
		if (websocket) {
			websocket.addEventListener('message', handleMessage)
			return () => {
				websocket.removeEventListener('message', handleMessage)
			}
		}
	}, [websocket])
	
	// Function to broadcast transcription to all users
	const broadcastTranscription = useCallback((transcription: Transcription) => {
		if (websocket) {
			websocket.send(JSON.stringify({
				type: 'sendTranscription',
				transcription: {
					id: transcription.id,
					text: transcription.text,
					timestamp: transcription.timestamp,
					speaker: transcription.speaker,
					userId: transcription.userId
				}
			}))
		}
	}, [websocket])
	
	// Initialize speaker tracker for correlating speech with transcriptions
	const speakerTracker = useSpeakerTracker()
	
	// Get actual audio tracks from PullAudioTracks context
	const pulledAudioTracks = usePulledAudioTracks()

	// Track speaking status for yourself
	const userIsSpeaking = useIsSpeaking(userMedia.audioStreamTrack)
	
	// Handle speaking detection updates from individual user components
	const handleSpeakingChange = useCallback((userId: string, userName: string, isSpeaking: boolean) => {
		speakerTracker.updateSpeakerStatus(userId, userName, isSpeaking)
		// Temporary debug log to verify speaker tracking is working
		if (isSpeaking) {
			console.log('🎤 Speaker started:', userName)
		}
	}, [speakerTracker])
	
	// Update speaker tracker when speaking status changes
	useEffect(() => {
		if (identity?.id && identity?.name) {
			speakerTracker.updateSpeakerStatus(identity.id, identity.name, userIsSpeaking)
			// Temporary debug log to verify self speaker tracking is working
			if (userIsSpeaking) {
				console.log('🎤 Self started speaking:', identity.name)
			}
		}
	}, [userIsSpeaking, identity?.id, identity?.name, speakerTracker])
	
	// Debug speaker tracker state periodically (disabled to reduce console spam)
	// useEffect(() => {
	// 	const interval = setInterval(() => {
	// 		speakerTracker.debugSpeakerState()
	// 	}, 5000)
	// 	return () => clearInterval(interval)
	// }, [speakerTracker])
	

	const isTranscriptionHost = useMemo(() => {
		// Only proceed if we have our own identity
		if (!identity?.id) {
			return false
		}

		// If you're alone in the room, you're the host
		if (otherUsers.length === 0) {
			return true
		}

		// Create a list of all users (including yourself) with valid IDs
		const allUsers = [
			{ id: identity.id, name: identity.name },
			...otherUsers.filter(u => u.id) // Only include users with valid IDs
		]
		
		// Sort by ID consistently (lexicographic) to ensure same order on all clients
		allUsers.sort((a, b) => a.id.localeCompare(b.id))
		
		// First user in sorted list is the transcription host
		const hostId = allUsers[0]?.id
		const isHost = hostId === identity.id
		
		// Debug logging to track host selection (commented to reduce console spam)
		// console.log('🎤 Transcription Host Selection:', {
		// 	myId: identity.id,
		// 	allUserIds: allUsers.map(u => u.id),
		// 	selectedHostId: hostId,
		// 	amIHost: isHost
		// })
		
		return isHost
	}, [otherUsers, identity?.id, identity?.name])

	const allRemoteAudioTrackIds = useMemo(() => {
		return otherUsers
			.filter((u) => u.id !== identity?.id && u.tracks.audio)
			.map((u) => u.tracks.audio!)
			.filter((track): track is string => track !== undefined)
	}, [otherUsers, identity])

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
	const [showSubtitles, setShowSubtitles] = useState(true)
	
	// Track the current transcription host and clear transcriptions when it changes
	const prevHostId = useRef<string | null>(null)
	
	useEffect(() => {
		// Determine the current host ID
		const currentHostId = isTranscriptionHost ? identity?.id || null : null
		
		// If the host changed, clear transcriptions to start fresh
		if (prevHostId.current && prevHostId.current !== currentHostId) {
			console.log('🎤 Host changed - clearing transcriptions')
			setTranscriptions([])
		}
		
		prevHostId.current = currentHostId
	}, [isTranscriptionHost, identity?.id])

	const participantNames = useMemo(
		() =>
			[identity?.name, ...otherUsers.map((u) => u.name)].filter(
				Boolean
			) as string[],
		[identity?.name, otherUsers]
	)

	// Enhanced transcription callback with speaker detection and broadcasting
	const handleTranscription = useCallback((t: Transcription) => {
		console.log('🚨 TRANSCRIPTION CALLBACK TRIGGERED:', t)
		
		// Enhanced transcription callback with speaker detection
		const now = Date.now()
		
		// Try to get timing from the transcription object if available
		// Otherwise use a reasonable estimate with a more generous window
		const transcriptionStart = t.startTime || (now - 5000) // 5 seconds ago as fallback
		const transcriptionEnd = t.endTime || now
		
		console.log('⏰ Timing Debug:', {
			hasStartTime: Boolean(t.startTime),
			hasEndTime: Boolean(t.endTime),
			startTime: t.startTime,
			endTime: t.endTime,
			fallbackStart: transcriptionStart,
			fallbackEnd: transcriptionEnd,
			duration: transcriptionEnd - transcriptionStart
		})
		
		const primarySpeaker = speakerTracker.getPrimarySpeaker(transcriptionStart, transcriptionEnd)
		
		// Debug speaker detection
		console.log('🔍 Speaker Detection Debug:', {
			transcriptionTime: `${new Date(transcriptionStart).toLocaleTimeString()} - ${new Date(transcriptionEnd).toLocaleTimeString()}`,
			primarySpeaker: primarySpeaker,
			fallbackToHost: !primarySpeaker && isTranscriptionHost,
			hostName: identity?.name,
			originalSpeaker: t.speaker
		})
		
		// Fallback: if no speaker detected, try to find any recent speaker
		let finalSpeaker = primarySpeaker?.userName
		let finalUserId = primarySpeaker?.userId
		
		if (!finalSpeaker) {
			// Try to get the most recent speaker as a fallback
			const recentSpeaker = speakerTracker.getMostRecentSpeaker()
			console.log('🔍 Recent speaker fallback:', recentSpeaker)
			
			if (recentSpeaker) {
				finalSpeaker = recentSpeaker.userName
				finalUserId = recentSpeaker.userId
			}
		}
		
		// Final fallback: if still no speaker detected and we're the host, assume it's us
		if (!finalSpeaker && isTranscriptionHost && identity?.name) {
			finalSpeaker = identity.name
			finalUserId = identity.id
		}
		
		// Create enhanced transcription with speaker info
		const enhancedTranscription: Transcription = {
			...t,
			speaker: finalSpeaker || t.speaker || 'Unknown',
			userId: finalUserId
		}
		
		// Log only the final transcription result
		console.log('📝 Transcription:', `"${t.text}" - ${finalSpeaker || 'Unknown'}`)
		
		// Broadcast transcription to all users
		broadcastTranscription(enhancedTranscription)
		
		// Add to local state for immediate display
		setTranscriptions((prev) => [...prev, enhancedTranscription])
	}, [speakerTracker, isTranscriptionHost, identity?.name, identity?.id, broadcastTranscription])

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
					
					{/* Subtitle Overlay */}
					{transcriptionEnabled && (
						<SubtitleOverlay
							transcriptions={transcriptions}
							enabled={showSubtitles}
							maxLines={3}
							autoHideDelay={8000}
						/>
					)}
					
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
			{(() => {
				const currentProvider = getTranscriptionProvider()
				console.log('🎯 Transcription Setup Debug:', {
					transcriptionProvider,
					currentProvider,
					isTranscriptionHost,
					transcriptionEnabled,
					hasOpenAiTranscription,
					condition: isTranscriptionHost && transcriptionEnabled && (transcriptionProvider === 'openai' || transcriptionProvider === 'openai-realtime') && hasOpenAiTranscription
				})
				return null
			})()}
			{isTranscriptionHost &&
			transcriptionEnabled &&
			(transcriptionProvider === 'openai' || transcriptionProvider === 'openai-realtime') &&
			hasOpenAiTranscription && (
				<TranscriptionServiceWrapper
					audioTracks={actualAudioTracks}
					isActive={isTranscriptionHost}
					participants={participantNames}
					onTranscription={handleTranscription}
					provider={getTranscriptionProvider()}
					speakerTracker={speakerTracker}
				/>
			)}
			{transcriptionEnabled && (
				<div className="fixed top-4 right-4 z-50 bg-white border border-gray-300 rounded-lg p-4 shadow-lg">
					<div className="flex flex-col gap-2">
						<button
							onClick={() => setShowTranscription((v) => !v)}
							className="bg-blue-500 text-white px-4 py-2 rounded hover:bg-blue-600"
						>
							{showTranscription ? 'Hide' : 'Show'} Transcription
						</button>
						<button
							onClick={() => setShowSubtitles((v) => !v)}
							className="bg-green-500 text-white px-4 py-2 rounded hover:bg-green-600"
						>
							{showSubtitles ? 'Hide' : 'Show'} Subtitles
						</button>
					</div>
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
					<TranscriptionPanel 
						transcriptions={transcriptions} 
						isHost={isTranscriptionHost}
						hostName={(() => {
							// Find the current host's name
							if (isTranscriptionHost) return undefined // Don't show host name if you are the host
							const allUsersWithSelf = [
								{ id: identity?.id || '', name: identity?.name || '' },
								...otherUsers.filter(u => u.id)
							].sort((a, b) => a.id.localeCompare(b.id))
							return allUsersWithSelf[0]?.name
						})()}
					/>
				</div>
			)}
			
			{/* Individual speaking detectors for each remote user */}
			{otherUsers.map(user => {
				if (!user.id || !user.name || !user.tracks.audio) return null
				
				const audioTrack = pulledAudioTracks[user.tracks.audio] || null
				
				return (
					<UserSpeakingDetector
						key={user.id}
						userId={user.id}
						userName={user.name}
						audioTrack={audioTrack}
						onSpeakingChange={handleSpeakingChange}
					/>
				)
			})}
		</PullAudioTracks>
	)
}