interface MediaTrackConstraintsWithLabels extends MediaTrackConstraintSet {
	advanced?: MediaTrackConstraintSet[]
	label?: string
}

interface MediaStreamConstraintsWithLabels {
	audio?: boolean | MediaTrackConstraintsWithLabels
	peerIdentity?: string
	preferCurrentTab?: boolean
	video?: boolean | MediaTrackConstraintsWithLabels
}

/**
 * utility that basically has the same API as getUserMedia
 * but can accept a 'label' property on the audio and video
 * media track constraints that it will fallback to if it cannot
 * find the device id.
 */
export async function getUserMediaExtended(
	constraints?: MediaStreamConstraintsWithLabels
) {
	console.log('getUserMediaExtended called', { constraints });
	const devices = await navigator.mediaDevices.enumerateDevices()

	if (devices.filter((d) => d.label !== '').length === 0) {
		// request both audio and video together so we can only show
		// the user one prompt.
		await navigator.mediaDevices
			.getUserMedia({
				video: true,
				audio: true,
			})
			.then((ms) => {
				ms.getTracks().forEach((t) => t.stop())
			})
	}

	if (!constraints) return navigator.mediaDevices.getUserMedia()
	const { audio, video, peerIdentity, preferCurrentTab } = constraints

	const newContsraints: MediaStreamConstraints = {
		peerIdentity,
		preferCurrentTab,
	}

	if (typeof audio === 'object') {
		const { label, deviceId, ...rest } = audio
		const foundDevice =
			devices.find((d) => d.deviceId === deviceId) ??
			devices.find((d) => d.label === label && d.kind === 'audioinput')
		newContsraints.audio = { ...rest, deviceId: foundDevice?.deviceId }
	} else {
		newContsraints.audio = audio
	}

	if (typeof video === 'object') {
		const { label, deviceId, ...rest } = video
		const foundDevice =
			devices.find((d) => d.deviceId === deviceId) ??
			devices.find((d) => d.label === label && d.kind === 'videoinput')
		newContsraints.video = { ...rest, deviceId: foundDevice?.deviceId }
	} else {
		newContsraints.video = video
	}

	const stream = await navigator.mediaDevices.getUserMedia(newContsraints);
	console.log('getUserMediaExtended obtained stream', { stream, tracks: stream.getTracks() });
	return stream;
}
