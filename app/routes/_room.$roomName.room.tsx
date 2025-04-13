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
	const { hasDb, hasAiCredentials } = useLoaderData<typeof loader>()
	const {
		userMedia,
		partyTracks,
		pushedTracks,
		showDebugInfo,
		pinnedTileIds,
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

	const [transcriptions, setTranscriptions] = useState<Transcription[]>([])

	const isTranscriptionHost = useMemo(() => {
		const sortedUsers = [...otherUsers].sort((a, b) =>
			new Date(a.joinedAt).getTime() - new Date(b.joinedAt).getTime()
		)
		return sortedUsers[0]?.id === identity?.id
	}, [otherUsers, identity])

	const allRemoteAudioTracks = useMemo(() => {
		return otherUsers
			.filter((u) => u.id !== identity?.id)
			.flatMap((u) => u.tracks.audio)
	}, [otherUsers, identity])

	const [showTranscription, setShowTranscription] = useState(false)

	return (
		<PullAudioTracks
			audioTracks={otherUsers.map((u) => u.tracks.audio).filter(isNonNullable)}
		>
			<div className="h-[100vh] flex flex-col bg-white">
				<div className="relative flex-1 min-h-0">
					<div
						className="absolute inset-0 flex isolate gap-[var(--gap)] p-2 sm:p-[var(--gap)]"
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
				<div className="flex pt-0 sm:pt-0 gap-1 sm:gap-4 text-sm p-2 sm:p-4 ">
					{hasAiCredentials && <AiButton recordActivity={recordActivity} />}
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
			{isTranscriptionHost && (
				<TranscriptionService
					audioTracks={allRemoteAudioTracks}
					isActive={isTranscriptionHost}
					onTranscription={(t) =>
						setTranscriptions((prev) => [...prev, t])
					}
				/>
			)}
			<button onClick={() => setShowTranscription((v) => !v)}>
				{showTranscription ? "Hide" : "Show"} Transcription
			</button>
			{showTranscription && (
				<TranscriptionPanel transcriptions={transcriptions} />
			)}
		</PullAudioTracks>
	)
}
