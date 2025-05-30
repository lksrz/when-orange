// Direct static imports to ensure the modules are included in the bundle
import '@tensorflow/tfjs-backend-webgl';
import * as bodySegmentation from '@tensorflow-models/body-segmentation';

// Use a direct import to ensure the package is bundled despite sideEffects:[] in package.json
// This import is specifically needed for the selfie segmentation to work properly
import '@mediapipe/selfie_segmentation';

// We need to add this line to trick the bundler into keeping the import
// This creates a side effect that ensures the module is included
// @ts-ignore - Deliberately accessing a property to create side effect
const _ensureMediaPipeIncluded = typeof window !== 'undefined' ? window['__mediapipeSelfieSegmentationLoaded'] = true : null;

export default async function blurVideoTrack(
	originalVideoStreamTrack: MediaStreamTrack
) {
	const segmenter = await bodySegmentation.createSegmenter(
		bodySegmentation.SupportedModels.MediaPipeSelfieSegmentation,
		{
			runtime: 'mediapipe',
			modelType: 'general',
			solutionPath:
				'https://cdn.jsdelivr.net/npm/@mediapipe/selfie_segmentation',
		}
	)

	const { height: h = 0, width: w = 0 } = originalVideoStreamTrack.getSettings()

	const video = document.createElement('video')
	video.height = h
	video.width = w
	// needed for iOS Safari to allow playing
	video.muted = true
	// needed for iOS Safari to allow playing
	video.setAttribute('playsinline', '')
	const loaded = new Promise((res) =>
		video.addEventListener('loadedmetadata', res, { once: true })
	)
	const mediaStream = new MediaStream()
	mediaStream.addTrack(originalVideoStreamTrack)
	video.srcObject = mediaStream
	video.play()
	await loaded

	const canvas = document.createElement('canvas')
	// we need to create a context in order for this to work with firefox
	const _contex = canvas.getContext('2d')
	canvas.height = h
	canvas.width = w

	async function drawBlur() {
		const segmentation = await segmenter.segmentPeople(video)
		const foregroundThreshold = 0.6
		const backgroundBlurAmount = 12
		const edgeBlurAmount = 3
		const flipHorizontal = false

		await bodySegmentation.drawBokehEffect(
			canvas,
			video,
			segmentation,
			foregroundThreshold,
			backgroundBlurAmount,
			edgeBlurAmount,
			flipHorizontal
		)
	}

	const blurredTrack = canvas.captureStream().getVideoTracks()[0]

	let t = -1
	async function tick() {
		await drawBlur()
		t = window.setTimeout(tick, 1000 / 30) // 30fps
	}

	await drawBlur()
	tick()

	blurredTrack.stop = () => {
		clearTimeout(t)
		MediaStreamTrack.prototype.stop.call(originalVideoStreamTrack)
	}

	// if the device generating this stream is disconnected, we should stop
	originalVideoStreamTrack.addEventListener('ended', (e) => {
		blurredTrack.stop()
		// proxy ended event to blurredTrack
		blurredTrack.dispatchEvent(e)
	})

	blurredTrack.getSettings = () => originalVideoStreamTrack.getSettings()

	return blurredTrack
}
