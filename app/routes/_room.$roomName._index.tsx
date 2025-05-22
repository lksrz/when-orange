import { VisuallyHidden } from '@radix-ui/react-visually-hidden'
import type { LoaderFunctionArgs } from '@remix-run/cloudflare'
import { json } from '@remix-run/cloudflare'
import { useNavigate, useParams, useSearchParams } from '@remix-run/react'
import { useObservableAsValue } from 'partytracks/react'
import invariant from 'tiny-invariant'
import { AudioIndicator } from '~/components/AudioIndicator'
import { Button } from '~/components/Button'
import { CameraButton } from '~/components/CameraButton'
import { CopyButton } from '~/components/CopyButton'
import { Icon } from '~/components/Icon/Icon'
import { MicButton } from '~/components/MicButton'

import { SelfView } from '~/components/SelfView'
import { SettingsButton } from '~/components/SettingsDialog'
import { Spinner } from '~/components/Spinner'
import { Tooltip } from '~/components/Tooltip'
import { useRoomContext } from '~/hooks/useRoomContext'
import { useRoomUrl } from '~/hooks/useRoomUrl'
import getUsername from '~/utils/getUsername.server'

export const loader = async ({ request, context }: LoaderFunctionArgs) => {
	const username = await getUsername(request)
	invariant(username)
	return json({ username, callsAppId: context.env.CALLS_APP_ID })
}

let refreshCheckDone = false
function trackRefreshes() {
	if (refreshCheckDone) return
	if (typeof document === 'undefined') return

	const key = `previously loaded`
	const initialValue = sessionStorage.getItem(key)
	const refreshed = initialValue !== null
	sessionStorage.setItem(key, Date.now().toString())

	if (refreshed) {
		fetch(`/api/reportRefresh`, {
			method: 'POST',
		})
	}

	refreshCheckDone = true
}

export default function Lobby() {
	const { roomName } = useParams()
	const navigate = useNavigate()
	const { setJoined, userMedia, room, partyTracks } = useRoomContext()
	const { videoStreamTrack, audioStreamTrack, audioEnabled } = userMedia
	const session = useObservableAsValue(partyTracks.session$)
	const sessionError = useObservableAsValue(partyTracks.sessionError$)
	trackRefreshes()

	const joinedUsers = new Set(
		room.otherUsers.filter((u) => u.tracks.audio).map((u) => u.name)
	).size

	const roomUrl = useRoomUrl()

	const [params] = useSearchParams()
	const isLeft = params.get('left') === 'true'

	return (
		<div className="min-h-[calc(100vh-127px)] h-full flex flex-col items-center justify-center p-4">
			<div className="flex-1 min-h-0"></div>
			<div className="h-full space-y-4 w-full max-w-5xl">
				<div>
					{/* <h1 className="text-3xl font-bold">{roomName}</h1> */}
					<p className="text-sm text-zinc-500 dark:text-zinc-400">
						{`${joinedUsers} ${
							joinedUsers === 1 ? 'user' : 'users'
						} in the meeting.`}{' '}
					</p>
				</div>
				<div className="relative">
					{userMedia.videoEnabled ? (
						<SelfView
							className="aspect-[4/3] w-full h-[60vh]"
							videoTrack={videoStreamTrack}
						/>
					) : (
						<div className="bg-gray-200 w-full aspect-[4/3] grid place-items-center">
							<div className="h-[2em] w-[2em] grid place-items-center text-4xl md:text-6xl 2xl:text-8xl relative">
								<span className="relative grid w-full h-full uppercase rounded-full place-items-center">
									<Icon className="text-red-500" type="videoOff" />
								</span>
							</div>
						</div>
					)}
					<div className="absolute left-3 top-3">
						{!sessionError && !session?.sessionId ? (
							<Spinner className="text-zinc-100" />
						) : (
							audioStreamTrack && (
								<>
									{audioEnabled ? (
										<AudioIndicator audioTrack={audioStreamTrack} />
									) : (
										<Tooltip content="Mic is turned off">
											<div className="text-red-500 flex items-center gap-2">
												<Icon type="micOff" />
												<VisuallyHidden>Mic is turned off</VisuallyHidden>
											</div>
										</Tooltip>
									)}
								</>
							)
						)}
					</div>
				</div>
				{sessionError && (
					<div className="p-3 rounded-md text-sm text-zinc-800 bg-red-200 dark:text-zinc-200 dark:bg-red-700">
						{sessionError}
					</div>
				)}
				{(userMedia.audioUnavailableReason ||
					userMedia.videoUnavailableReason) && (
					<div className="p-3 rounded-md text-sm text-zinc-800 bg-zinc-200 dark:text-zinc-200 dark:bg-zinc-700">
						{userMedia.audioUnavailableReason === 'NotAllowedError' &&
							userMedia.videoUnavailableReason === undefined && (
								<p>Mic permission was denied.</p>
							)}
						{userMedia.videoUnavailableReason === 'NotAllowedError' &&
							userMedia.audioUnavailableReason === undefined && (
								<p>Camera permission was denied.</p>
							)}
						{userMedia.audioUnavailableReason === 'NotAllowedError' &&
							userMedia.videoUnavailableReason === 'NotAllowedError' && (
								<p>Mic and camera permissions were denied.</p>
							)}
						{userMedia.audioUnavailableReason === 'NotAllowedError' && (
							<p>
								Enable permission
								{userMedia.audioUnavailableReason &&
								userMedia.videoUnavailableReason
									? 's'
									: ''}{' '}
								and reload the page to join.
							</p>
						)}
						{userMedia.audioUnavailableReason === 'DevicesExhaustedError' && (
							<p>No working microphone found.</p>
						)}
						{userMedia.videoUnavailableReason === 'DevicesExhaustedError' && (
							<p>No working webcam found.</p>
						)}
						{userMedia.audioUnavailableReason === 'UnknownError' && (
							<p>Unknown microphone error.</p>
						)}
						{userMedia.videoUnavailableReason === 'UnknownError' && (
							<p>Unknown webcam error.</p>
						)}
					</div>
				)}
				<div className="flex gap-4 text-sm">
					<Button
						onClick={() => {
							setJoined(true)
							const newParams = new URLSearchParams(params)
							newParams.delete('left')
							navigate(
								'room' +
									(newParams.toString() ? '?' + newParams.toString() : '')
							)
						}}
						disabled={!session?.sessionId}
						className="flex items-center gap-2 text-xs relative z-10"
						autoFocus
					>
						{!!session?.sessionId && (
							<div className="absolute inset-0 border-2 border-green-600 rounded-md animate-ping" />
						)}
						<span className="md:inline">{isLeft ? 'Rejoin' : 'Join'}</span>
					</Button>
					<MicButton />
					<CameraButton />
					<SettingsButton />
					<Tooltip content="Copy meeting link">
						<CopyButton contentValue={roomUrl}></CopyButton>
					</Tooltip>
				</div>
			</div>
			<div className="flex flex-col justify-end flex-1 min-h-0"></div>
		</div>
	)
}