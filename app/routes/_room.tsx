import type { LoaderFunctionArgs } from '@remix-run/cloudflare'
import { json } from '@remix-run/cloudflare'
import { Outlet, useLoaderData, useParams } from '@remix-run/react'
import { useObservableAsValue, useValueAsObservable } from 'partytracks/react'
import { useEffect, useMemo, useState } from 'react'
import { from, of, switchMap } from 'rxjs'
import invariant from 'tiny-invariant'
import { EnsureOnline } from '~/components/EnsureOnline'
import { EnsurePermissions } from '~/components/EnsurePermissions'
import { Icon } from '~/components/Icon/Icon'
import { Spinner } from '~/components/Spinner'

import { useMobileViewportHeight } from '~/hooks/useMobileViewportHeight'
import { usePeerConnection } from '~/hooks/usePeerConnection'
import useRoom from '~/hooks/useRoom'
import type { RoomContextType } from '~/hooks/useRoomContext'
import { useRoomHistory } from '~/hooks/useRoomHistory'
import { useStablePojo } from '~/hooks/useStablePojo'
import useUserMedia from '~/hooks/useUserMedia'
import type { TrackObject } from '~/utils/callsTypes'
import { useE2EE } from '~/utils/e2ee'
import { getIceServers } from '~/utils/getIceServers.server'

function numberOrUndefined(value: unknown): number | undefined {
	const num = Number(value)
	return isNaN(num) ? undefined : num
}

function trackObjectToString(trackObject?: TrackObject) {
	if (!trackObject) return undefined
	return trackObject.sessionId + '/' + trackObject.trackName
}

export const loader = async ({ context }: LoaderFunctionArgs) => {
	const {
		env: {
			TRACE_LINK,
			API_EXTRA_PARAMS,
			MAX_WEBCAM_FRAMERATE,
			MAX_WEBCAM_BITRATE,
			MAX_WEBCAM_QUALITY_LEVEL,
			MAX_API_HISTORY,
			E2EE_ENABLED,
			EXPERIMENTAL_SIMULCAST_ENABLED,
		},
	} = context

	return json({
		userDirectoryUrl: context.env.USER_DIRECTORY_URL,
		traceLink: TRACE_LINK,
		apiExtraParams: API_EXTRA_PARAMS,
		iceServers: await getIceServers(context.env),
		feedbackEnabled: Boolean(
			context.env.FEEDBACK_URL &&
				context.env.FEEDBACK_QUEUE &&
				context.env.FEEDBACK_STORAGE
		),
		maxWebcamFramerate: numberOrUndefined(MAX_WEBCAM_FRAMERATE),
		maxWebcamBitrate: numberOrUndefined(MAX_WEBCAM_BITRATE),
		maxWebcamQualityLevel: numberOrUndefined(MAX_WEBCAM_QUALITY_LEVEL),
		maxApiHistory: numberOrUndefined(MAX_API_HISTORY),
		e2eeEnabled: E2EE_ENABLED === 'true',
		simulcastEnabled: EXPERIMENTAL_SIMULCAST_ENABLED === 'true',
	})
}

export default function RoomWithPermissions() {
	return (
		<EnsurePermissions>
			<EnsureOnline
				fallback={
					<div className="grid h-full place-items-center">
						<div>
							<h1 className="flex items-center gap-3 text-3xl font-black">
								<Icon type="SignalSlashIcon" />
								You are offline
							</h1>
						</div>
					</div>
				}
			>
				<RoomPreparation />
			</EnsureOnline>
		</EnsurePermissions>
	)
}

function RoomPreparation() {
	const { roomName } = useParams()
	invariant(roomName)
	const userMedia = useUserMedia()
	const room = useRoom({ roomName, userMedia })

	// Initialize mobile viewport height handling for loading state
	useMobileViewportHeight()

	return room.roomState.meetingId ? (
		<Room room={room} userMedia={userMedia} />
	) : (
		<div className="grid place-items-center h-mobile-screen">
			<Spinner className="text-gray-500" />
		</div>
	)
}

function tryToGetDimensions(videoStreamTrack?: MediaStreamTrack) {
	if (
		videoStreamTrack === undefined ||
		// TODO: Determine a better way to get dimensions in Firefox
		// where this isn't API isn't supported. For now, Firefox will
		// just not be constrained and scaled down by dimension scaling
		// but the bandwidth and framerate constraints will still apply
		// https://caniuse.com/?search=getCapabilities
		videoStreamTrack.getCapabilities === undefined
	) {
		return { height: 0, width: 0 }
	}
	const height = videoStreamTrack?.getCapabilities().height?.max ?? 0
	const width = videoStreamTrack?.getCapabilities().width?.max ?? 0

	return { height, width }
}

interface RoomProps {
	room: ReturnType<typeof useRoom>
	userMedia: ReturnType<typeof useUserMedia>
}

function Room({ room, userMedia }: RoomProps) {
	const [joined, setJoined] = useState(false)
	const [dataSaverMode, setDataSaverMode] = useState(false)
	const [encodingParamsStable, setEncodingParamsStable] = useState(true)
	const { roomName } = useParams()
	invariant(roomName)

	const {
		userDirectoryUrl,
		traceLink,
		feedbackEnabled,
		apiExtraParams,
		iceServers,
		maxWebcamBitrate = 1_200_000,
		maxWebcamFramerate = 24,
		maxWebcamQualityLevel = 1080,
		maxApiHistory = 100,
		e2eeEnabled,
		simulcastEnabled,
	} = useLoaderData<typeof loader>()

	const params = new URLSearchParams(apiExtraParams)

	invariant(room.roomState.meetingId, 'Meeting ID cannot be missing')
	params.set('correlationId', room.roomState.meetingId)

	const {
		partyTracks,
		iceConnectionState,
		iceRestartInProgress,
		manualIceRestart,
		isSessionReady,
		executeWhenReady,
		iceCandidateStats,
		isMobileNetwork,
	} = usePeerConnection({
		maxApiHistory,
		apiExtraParams: params.toString(),
		iceServers,
	})

	// Log ICE servers for debugging
	useEffect(() => {
		if (iceServers) {
			const turnServers = iceServers.filter((server) => {
				const urls = Array.isArray(server.urls) ? server.urls : [server.urls]
				return urls.some((url) => url.includes('turn:'))
			})

			console.log(
				'🧊 ICE Servers configured:',
				iceServers.map((server) => ({
					urls: Array.isArray(server.urls) ? server.urls : [server.urls],
					hasCredentials: !!(server.username && server.credential),
					type: Array.isArray(server.urls)
						? server.urls.some((url) => url.includes('turn:'))
							? 'TURN'
							: 'STUN'
						: server.urls.includes('turn:')
							? 'TURN'
							: 'STUN',
				}))
			)
			console.log('📱 Mobile network detected:', isMobileNetwork)

			if (turnServers.length > 0) {
				console.log('✅ TURN servers available for mobile network fallback')
			} else {
				console.warn(
					'⚠️ No TURN servers configured - mobile connections may fail'
				)
			}
		}
	}, [iceServers, isMobileNetwork])

	const roomHistory = useRoomHistory(partyTracks, room)

	// Handle encoding parameter stability during ICE transitions
	useEffect(() => {
		if (iceRestartInProgress) {
			console.log('🔧 Disabling encoding parameter updates during ICE restart')
			setEncodingParamsStable(false)
		}
	}, [iceRestartInProgress])

	// Listen for ICE connection restoration to re-enable encoding parameters
	useEffect(() => {
		const handleIceConnectionRestored = () => {
			console.log('🔧 Re-enabling encoding parameter updates after ICE restart')
			// Wait a bit longer to ensure transceivers are fully stable
			setTimeout(() => {
				setEncodingParamsStable(true)
			}, 1000)
		}

		window.addEventListener(
			'iceConnectionRestored',
			handleIceConnectionRestored
		)
		return () => {
			window.removeEventListener(
				'iceConnectionRestored',
				handleIceConnectionRestored
			)
		}
	}, [])

	// Additional safety: disable encoding params during any connection instability
	useEffect(() => {
		if (
			iceConnectionState === 'disconnected' ||
			iceConnectionState === 'failed'
		) {
			console.log(
				'🔧 Disabling encoding parameters due to connection instability:',
				iceConnectionState
			)
			setEncodingParamsStable(false)
		} else if (
			iceConnectionState === 'connected' ||
			iceConnectionState === 'completed'
		) {
			// Only re-enable if we're not in the middle of an ICE restart
			if (!iceRestartInProgress) {
				console.log('🔧 Connection stable, re-enabling encoding parameters')
				setTimeout(() => {
					setEncodingParamsStable(true)
				}, 500)
			}
		}
	}, [iceConnectionState, iceRestartInProgress])

	const scaleResolutionDownBy = useMemo(() => {
		const videoStreamTrack = userMedia.videoStreamTrack
		const { height, width } = tryToGetDimensions(videoStreamTrack)
		// we need to do this in case camera is in portrait mode
		const smallestDimension = Math.min(height, width)
		return Math.max(smallestDimension / maxWebcamQualityLevel, 1)
	}, [maxWebcamQualityLevel, userMedia.videoStreamTrack])

	const videoEncodingParams = useStablePojo<RTCRtpEncodingParameters[]>([
		{
			maxFramerate: maxWebcamFramerate,
			maxBitrate: maxWebcamBitrate,
			scaleResolutionDownBy,
		},
	])

	// Only update encoding parameters when the connection is stable
	const stableVideoEncodingParams = useMemo(() => {
		if (!encodingParamsStable) {
			// Return basic parameters during unstable periods
			console.log('🔧 Using basic encoding parameters during unstable period')
			return [
				{
					maxFramerate: maxWebcamFramerate,
					maxBitrate: maxWebcamBitrate,
					// Don't include scaleResolutionDownBy during unstable periods
				},
			]
		}
		console.log('🔧 Using full encoding parameters:', videoEncodingParams)
		return videoEncodingParams
	}, [
		videoEncodingParams,
		encodingParamsStable,
		maxWebcamFramerate,
		maxWebcamBitrate,
	])

	const videoTrackEncodingParams$ = useValueAsObservable<
		RTCRtpEncodingParameters[]
	>(stableVideoEncodingParams)
	const pushedVideoTrack$ = useMemo(
		() =>
			partyTracks.push(userMedia.videoTrack$, {
				sendEncodings$: videoTrackEncodingParams$,
			}),
		[partyTracks, userMedia.videoTrack$, videoTrackEncodingParams$]
	)

	const pushedVideoTrack = useObservableAsValue(pushedVideoTrack$)

	const pushedAudioTrack$ = useMemo(
		() =>
			partyTracks.push(userMedia.publicAudioTrack$, {
				sendEncodings$: of<RTCRtpEncodingParameters[]>([
					{
						networkPriority: 'high',
					},
				]),
			}),
		[partyTracks, userMedia.publicAudioTrack$]
	)
	const pushedAudioTrack = useObservableAsValue(pushedAudioTrack$)

	const pushedScreenSharingTrack$ = useMemo(() => {
		return userMedia.screenShareVideoTrack$.pipe(
			switchMap((track) =>
				track ? from(partyTracks.push(of(track))) : of(undefined)
			)
		)
	}, [partyTracks, userMedia.screenShareVideoTrack$])
	const pushedScreenSharingTrack = useObservableAsValue(
		pushedScreenSharingTrack$
	)
	const [pinnedTileIds, setPinnedTileIds] = useState<string[]>([])
	const [showDebugInfo, setShowDebugInfo] = useState(false)

	// E2EE integration
	const { e2eeSafetyNumber, onJoin } = useE2EE({
		enabled: e2eeEnabled,
		room,
		partyTracks,
	})

	const context: RoomContextType = {
		joined,
		setJoined,
		pinnedTileIds,
		setPinnedTileIds,
		showDebugInfo,
		setShowDebugInfo,
		audioOnlyMode: false,
		setAudioOnlyMode: () => {},
		dataSaverMode,
		setDataSaverMode,
		traceLink,
		userMedia,
		userDirectoryUrl,
		feedbackEnabled,
		partyTracks: partyTracks,
		roomHistory,
		iceConnectionState,
		iceRestartInProgress,
		manualIceRestart,
		room,
		simulcastEnabled,
		e2eeEnabled,
		e2eeSafetyNumber,
		e2eeOnJoin: onJoin,
		pushedTracks: {
			video: trackObjectToString(pushedVideoTrack),
			audio: trackObjectToString(pushedAudioTrack),
			screenshare: trackObjectToString(pushedScreenSharingTrack),
		},
		isSessionReady,
		executeWhenReady,
		iceCandidateStats,
		isMobileNetwork,
	}

	return <Outlet context={context} />
}
