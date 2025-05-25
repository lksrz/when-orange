import { useObservableAsValue, useValueAsObservable } from 'partytracks/react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useLocalStorage } from 'react-use'
import { combineLatest, map, of, shareReplay, switchMap, tap } from 'rxjs'
import invariant from 'tiny-invariant'
import { blackCanvasStreamTrack } from '~/utils/blackCanvasStreamTrack'
import blurVideoTrack from '~/utils/blurVideoTrack'
import noiseSuppression from '~/utils/noiseSuppression'
import { prependDeviceToPrioritizeList } from '~/utils/rxjs/devicePrioritization'
import { getScreenshare$ } from '~/utils/rxjs/getScreenshare$'
import { getUserMediaTrack$ } from '~/utils/rxjs/getUserMediaTrack$'
import { inaudibleAudioTrack$ } from '~/utils/rxjs/inaudibleAudioTrack$'

export const errorMessageMap = {
	NotAllowedError:
		'Permission was denied. Grant permission and reload to enable.',
	NotFoundError: 'No device was found.',
	NotReadableError: 'Device is already in use.',
	OverconstrainedError: 'No device was found that meets constraints.',
	DevicesExhaustedError: 'All devices failed to initialize.',
	UnknownError: 'An unknown error occurred.',
}

type UserMediaError = keyof typeof errorMessageMap

export default function useUserMedia() {
	console.log('useUserMedia hook initialized');
	const [blurVideo, setBlurVideo] = useLocalStorage('blur-video', false)
	const [suppressNoise, setSuppressNoise] = useLocalStorage(
		'suppress-noise',
		false
	)
	// NOTE: in the past we've set this to be false by default in dev
	// but as long as we're using the web audio API to generate an inaudible
	// audio track we shouldn't do this because the audio track will not have
	// any packets flowing out over the peer connection if the audio context
	// fails to initialize due to no prior user interaction. If we need
	// to require user interaction, we might as well have that interaction
	// be for the user to manually mute themselves and not have to work around
	// this. Once Calls is handling audio tracks with no data flowing better
	// we should be able to go back to muting by default in dev.
	const [audioEnabled, setAudioEnabled] = useState(true)
	const [videoEnabled, setVideoEnabled] = useState(true)
	const [screenShareEnabled, setScreenShareEnabled] = useState(false)
	const [videoUnavailableReason, setVideoUnavailableReason] =
		useState<UserMediaError>()
	const [audioUnavailableReason, setAudioUnavailableReason] =
		useState<UserMediaError>()
	const [networkChangeDetected, setNetworkChangeDetected] = useState(false)

	const turnMicOff = useCallback(() => setAudioEnabled(false), [])
	const turnMicOn = useCallback(() => setAudioEnabled(true), [])
	const turnCameraOn = useCallback(() => setVideoEnabled(true), [])
	const turnCameraOff = useCallback(() => setVideoEnabled(false), [])
	const startScreenShare = useCallback(() => setScreenShareEnabled(true), [])
	const endScreenShare = useCallback(() => setScreenShareEnabled(false), [])

	// Network change detection
	useEffect(() => {
		const handleNetworkChange = () => {
			console.log('🌐 Network change detected, will refresh media tracks')
			setNetworkChangeDetected(true)
			// Reset after a short delay to trigger track refresh
			setTimeout(() => setNetworkChangeDetected(false), 100)
		}

		const handleIceConnectionRestored = () => {
			console.log('🔄 ICE connection restored, refreshing media tracks')
			setNetworkChangeDetected(true)
			// Reset after a short delay to trigger track refresh
			setTimeout(() => setNetworkChangeDetected(false), 100)
		}

		// Listen for network changes
		window.addEventListener('online', handleNetworkChange)
		window.addEventListener('offline', handleNetworkChange)
		window.addEventListener(
			'iceConnectionRestored',
			handleIceConnectionRestored
		)

		// Listen for connection type changes (mobile networks)
		if ('connection' in navigator) {
			const connection = (navigator as any).connection
			connection?.addEventListener('change', handleNetworkChange)
		}

		return () => {
			window.removeEventListener('online', handleNetworkChange)
			window.removeEventListener('offline', handleNetworkChange)
			window.removeEventListener(
				'iceConnectionRestored',
				handleIceConnectionRestored
			)
			if ('connection' in navigator) {
				const connection = (navigator as any).connection
				connection?.removeEventListener('change', handleNetworkChange)
			}
		}
	}, [])

	const blurVideo$ = useValueAsObservable(blurVideo)
	const videoEnabled$ = useValueAsObservable(videoEnabled)
	const networkChange$ = useValueAsObservable(networkChangeDetected)

	const videoTrack$ = useMemo(() => {
		const track$ = combineLatest([videoEnabled$, networkChange$]).pipe(
			switchMap(([enabled, networkChanged]) =>
				enabled
					? getUserMediaTrack$('videoinput').pipe(
							tap({
								next: (_track) => {
									if (networkChanged) {
										console.log('📹 Video track refreshed after network change')
									}
									// Clear any previous error when track is successfully obtained
									setVideoUnavailableReason(undefined)
								},
								error: (e) => {
									invariant(e instanceof Error)
									const reason =
										e.name in errorMessageMap
											? (e.name as UserMediaError)
											: 'UnknownError'
									if (reason === 'UnknownError') {
										console.error('Unknown error getting video track: ', e)
									}
									console.error('📹 Video track error:', reason, e)
									setVideoUnavailableReason(reason)
									setVideoEnabled(false)
								},
							})
						)
					: of(undefined)
			)
		)
		return combineLatest([blurVideo$, track$]).pipe(
			switchMap(([blur, track]) =>
				blur && track
					? blurVideoTrack(track)
					: of(track ?? blackCanvasStreamTrack())
			),
			shareReplay({
				refCount: true,
				bufferSize: 1,
			})
		)
	}, [videoEnabled$, blurVideo$, networkChange$])
	const videoTrack = useObservableAsValue(videoTrack$)
	const videoDeviceId = videoTrack?.getSettings().deviceId

	const suppressNoiseEnabled$ = useValueAsObservable(suppressNoise)
	const audioTrack$ = useMemo(() => {
		return combineLatest([
			combineLatest([
				getUserMediaTrack$('audioinput').pipe(
					tap({
						next: (_track) => {
							if (networkChangeDetected) {
								console.log('🎤 Audio track refreshed after network change')
							}
							// Clear any previous error when track is successfully obtained
							setAudioUnavailableReason(undefined)
						},
						error: (e) => {
							invariant(e instanceof Error)
							const reason =
								e.name in errorMessageMap
									? (e.name as UserMediaError)
									: 'UnknownError'
							if (reason === 'UnknownError') {
								console.error('Unknown error getting audio track: ', e)
							}
							console.error('🎤 Audio track error:', reason, e)
							setAudioUnavailableReason(reason)
							setAudioEnabled(false)
						},
					})
				),
				networkChange$,
			]).pipe(map(([track]) => track)),
			suppressNoiseEnabled$,
		]).pipe(
			switchMap(([track, suppressNoise]) =>
				of(suppressNoise && track ? noiseSuppression(track) : track)
			),
			shareReplay({
				refCount: true,
				bufferSize: 1,
			})
		)
	}, [suppressNoiseEnabled$, networkChangeDetected, networkChange$])

	const alwaysOnAudioStreamTrack = useObservableAsValue(audioTrack$)
	const audioDeviceId = alwaysOnAudioStreamTrack?.getSettings().deviceId
	const audioEnabled$ = useValueAsObservable(audioEnabled)
	const publicAudioTrack$ = useMemo(
		() =>
			audioEnabled$.pipe(
				switchMap((enabled) => (enabled ? audioTrack$ : inaudibleAudioTrack$)),
				shareReplay({
					refCount: true,
					bufferSize: 1,
				})
			),
		[audioEnabled$, audioTrack$]
	)
	const audioStreamTrack = useObservableAsValue(publicAudioTrack$)

	const screenShareVideoTrack$ = useMemo(
		() =>
			screenShareEnabled
				? getScreenshare$({ contentHint: 'text' }).pipe(
						tap({
							next: (ms) => {
								if (ms === undefined) {
									setScreenShareEnabled(false)
								}
							},
							finalize: () => setScreenShareEnabled(false),
						}),
						map((ms) => ms?.getVideoTracks()[0])
					)
				: of(undefined),
		[screenShareEnabled]
	)
	const screenShareVideoTrack = useObservableAsValue(screenShareVideoTrack$)

	const setVideoDeviceId = (deviceId: string) =>
		navigator.mediaDevices.enumerateDevices().then((devices) => {
			const device = devices.find((d) => d.deviceId === deviceId)
			if (device) prependDeviceToPrioritizeList(device)
		})

	const setAudioDeviceId = (deviceId: string) =>
		navigator.mediaDevices.enumerateDevices().then((devices) => {
			const device = devices.find((d) => d.deviceId === deviceId)
			if (device) prependDeviceToPrioritizeList(device)
		})

	return {
		turnMicOn,
		turnMicOff,
		audioStreamTrack,
		audioMonitorStreamTrack: alwaysOnAudioStreamTrack,
		audioEnabled,
		audioUnavailableReason,
		publicAudioTrack$,
		privateAudioTrack$: audioTrack$,
		audioDeviceId,
		setAudioDeviceId,

		setVideoDeviceId,
		videoDeviceId,
		turnCameraOn,
		turnCameraOff,
		videoEnabled,
		videoUnavailableReason,
		blurVideo,
		setBlurVideo,
		suppressNoise,
		setSuppressNoise,
		videoTrack$,
		videoStreamTrack: videoTrack,

		startScreenShare,
		endScreenShare,
		screenShareVideoTrack,
		screenShareEnabled,
		screenShareVideoTrack$,
	}
}

export type UserMedia = ReturnType<typeof useUserMedia>
