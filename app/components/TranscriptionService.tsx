import React, { useCallback, useEffect, useRef } from 'react'

// Types for transcription
export type Transcription = {
	id: string
	text: string
	timestamp: number
	isFinal: boolean
	speaker: string
}

// Configuration
const CHUNK_DURATION_MS = 3000 // 3 seconds for audio chunks
const MIN_AUDIO_LEVEL = 0.001 // Lower threshold to capture more audio

// Helper function to convert AudioBuffer to WAV format
function audioBufferToWav(buffer: AudioBuffer): ArrayBuffer {
	const length = buffer.length
	const numberOfChannels = 1 // Force mono for transcription
	const sampleRate = buffer.sampleRate
	const bitsPerSample = 16
	const bytesPerSample = bitsPerSample / 8
	const blockAlign = numberOfChannels * bytesPerSample
	const byteRate = sampleRate * blockAlign
	const dataSize = length * blockAlign
	const headerSize = 44
	const totalSize = headerSize + dataSize

	const arrayBuffer = new ArrayBuffer(totalSize)
	const view = new DataView(arrayBuffer)

	// WAV header
	const writeString = (offset: number, string: string) => {
		for (let i = 0; i < string.length; i++) {
			view.setUint8(offset + i, string.charCodeAt(i))
		}
	}

	writeString(0, 'RIFF')
	view.setUint32(4, totalSize - 8, true)
	writeString(8, 'WAVE')
	writeString(12, 'fmt ')
	view.setUint32(16, 16, true) // PCM format
	view.setUint16(20, 1, true) // Linear PCM
	view.setUint16(22, numberOfChannels, true)
	view.setUint32(24, sampleRate, true)
	view.setUint32(28, byteRate, true)
	view.setUint16(32, blockAlign, true)
	view.setUint16(34, bitsPerSample, true)
	writeString(36, 'data')
	view.setUint32(40, dataSize, true)

	// Convert float samples to 16-bit PCM (mono)
	let offset = headerSize
	const channelData = buffer.getChannelData(0) // Use first channel only
	for (let i = 0; i < length; i++) {
		const sample = Math.max(-1, Math.min(1, channelData[i]))
		const intSample = sample < 0 ? sample * 0x8000 : sample * 0x7fff
		view.setInt16(offset, intSample, true)
		offset += 2
	}

	return arrayBuffer
}

// Calculate RMS (Root Mean Square) for volume detection
function calculateRMS(audioData: Float32Array): number {
	let sum = 0
	for (let i = 0; i < audioData.length; i++) {
		sum += audioData[i] * audioData[i]
	}
	return Math.sqrt(sum / audioData.length)
}

type Props = {
	audioTracks: MediaStreamTrack[]
	onTranscription: (t: Transcription) => void
	isActive: boolean // Only true for the host
	participants: string[] // names used for prompting
}

export const TranscriptionService: React.FC<Props> = ({
	audioTracks,
	onTranscription,
	isActive,
	participants: _participants,
}) => {
	const audioContextRef = useRef<AudioContext | null>(null)
	const processorRef = useRef<ScriptProcessorNode | null>(null)
	const tokenRef = useRef<string>('')

	// Send audio chunk to Whisper API
	const sendAudioChunkToWhisper = useCallback(
		async (audioBlob: Blob, token: string) => {
			try {
				console.log(
					`🎤 OpenAI: Sending audio chunk (${audioBlob.size} bytes) to Whisper API`
				)

				const formData = new FormData()
				formData.append('file', audioBlob, 'audio.wav')
				formData.append('model', 'whisper-1')
				formData.append('language', 'en')
				formData.append('response_format', 'json')

				const response = await fetch(
					'https://api.openai.com/v1/audio/transcriptions',
					{
						method: 'POST',
						headers: {
							Authorization: `Bearer ${token}`,
						},
						body: formData,
					}
				)

				if (response.ok) {
					const data = (await response.json()) as { text?: string }
					console.log(`🎤 OpenAI Whisper: Received transcript: "${data.text}"`)
					if (data.text && data.text.trim()) {
						console.log(
							`🎤 OpenAI Whisper: Adding valid transcript: "${data.text}"`
						)
						onTranscription({
							id: `whisper_${Date.now()}_${Math.random()}`,
							text: data.text,
							timestamp: Date.now(),
							isFinal: true,
							speaker: 'OpenAI Whisper',
						})
					} else {
						console.log(
							`🎤 OpenAI Whisper: Ignoring empty/whitespace transcript`
						)
					}
				} else {
					const errorText = await response.text()
					console.error(
						'🎤 OpenAI Whisper: API error:',
						response.status,
						errorText
					)
				}
			} catch (error) {
				console.error('🎤 OpenAI Whisper: Request failed:', error)
			}
		},
		[onTranscription]
	)

	// Setup audio processing
	const setupAudioProcessing = useCallback(
		(stream: MediaStream, token: string) => {
			console.log('🎤 OpenAI: Setting up audio processing for Whisper API')
			console.log(
				'🎤 OpenAI: Stream tracks:',
				stream
					.getTracks()
					.map(
						(t) => `${t.kind}: ${t.enabled}, ${t.readyState}, muted: ${t.muted}`
					)
			)
			console.log('🎤 OpenAI: Stream active:', stream.active)

			// Clean up existing audio context
			if (audioContextRef.current) {
				audioContextRef.current.close()
			}

			const audioContext = new (window.AudioContext ||
				(window as any).webkitAudioContext)()
			audioContextRef.current = audioContext

			console.log('🎤 OpenAI: Audio context state:', audioContext.state)
			console.log(
				'🎤 OpenAI: Audio context sample rate:',
				audioContext.sampleRate
			)

			// Resume audio context if suspended
			if (audioContext.state === 'suspended') {
				audioContext.resume().then(() => {
					console.log('🎤 OpenAI: Audio context resumed')
				})
			}

			const source = audioContext.createMediaStreamSource(stream)
			const processor = audioContext.createScriptProcessor(4096, 1, 1)
			processorRef.current = processor

			let audioBuffer: Float32Array[] = []
			let lastSendTime = Date.now()

			processor.onaudioprocess = (e) => {
				const inputData = e.inputBuffer.getChannelData(0)
				audioBuffer.push(new Float32Array(inputData))

				const currentTime = Date.now()
				const shouldSendChunk = currentTime - lastSendTime >= CHUNK_DURATION_MS

				if (shouldSendChunk && audioBuffer.length > 0) {
					// Combine audio buffers
					const totalLength = audioBuffer.reduce(
						(acc, buf) => acc + buf.length,
						0
					)
					const combinedBuffer = new Float32Array(totalLength)
					let offset = 0
					for (const buf of audioBuffer) {
						combinedBuffer.set(buf, offset)
						offset += buf.length
					}

					// Calculate RMS to check if there's actual audio
					const rms = calculateRMS(combinedBuffer)

					// Log occasionally to debug
					if (Math.random() < 0.1) {
						// 10% of the time
						console.log(
							`🎤 OpenAI: Audio RMS level: ${rms.toFixed(4)}, Min threshold: ${MIN_AUDIO_LEVEL}`
						)
					}

					if (rms > MIN_AUDIO_LEVEL) {
						console.log(
							`🎤 OpenAI: Processing audio chunk (${combinedBuffer.length} samples, RMS: ${rms.toFixed(4)})`
						)

						// Create audio buffer for conversion
						const audioBufferObj = audioContext.createBuffer(
							1,
							combinedBuffer.length,
							audioContext.sampleRate
						)
						audioBufferObj.copyToChannel(combinedBuffer, 0)

						// Convert to WAV and send to Whisper API
						const wavBuffer = audioBufferToWav(audioBufferObj)
						const audioBlob = new Blob([wavBuffer], { type: 'audio/wav' })
						sendAudioChunkToWhisper(audioBlob, token)
					} else {
						// Log when audio is too quiet
						if (Math.random() < 0.01) {
							// 1% of the time
							console.log(
								`🎤 OpenAI: Audio too quiet (RMS: ${rms.toFixed(4)}), skipping`
							)
						}
					}

					// Reset buffer and timer
					audioBuffer = []
					lastSendTime = currentTime
				}
			}

			source.connect(processor)
			processor.connect(audioContext.destination)
		},
		[sendAudioChunkToWhisper]
	)

	useEffect(() => {
		if (!isActive || audioTracks.length === 0) {
			console.log(
				'🎤 OpenAI: Not starting - isActive:',
				isActive,
				'audioTracks:',
				audioTracks.length
			)
			return
		}

		console.log('🎤 OpenAI: Starting Whisper transcription service')
		console.log(
			'🎤 OpenAI: Audio tracks:',
			audioTracks.map((t) => `${t.kind}: ${t.enabled}, ${t.readyState}`)
		)

		let isCleanedUp = false

		;(async () => {
			try {
				// Get OpenAI token
				const resp = await fetch('/api/transcription-token', { method: 'POST' })
				if (!resp.ok) {
					throw new Error(`Failed to get OpenAI token: ${resp.status}`)
				}
				const { token }: { token: string } = await resp.json()
				tokenRef.current = token
				console.log('🎤 OpenAI: Token obtained successfully')

				if (isCleanedUp) return

				// Setup audio processing with Whisper API
				// Combine all available audio tracks so we can
				// capture remote participants as well as the
				// local microphone. If the browser does not
				// support mixing multiple tracks, it will fall
				// back to the first track.
				const validTracks = audioTracks.filter(
					(t) => t && t.readyState === 'live'
				)
				const trackInfo = validTracks.map(
					(t) => `${t.id}:${t.kind}:${t.readyState}`
				)
				console.log('🎤 OpenAI: Using audio tracks:', trackInfo)

				const combinedStream = new MediaStream(validTracks)
				setupAudioProcessing(combinedStream, token)
			} catch (error) {
				console.error('🎤 OpenAI: TranscriptionService error:', error)
			}
		})()

		// Cleanup function
		return () => {
			isCleanedUp = true

			// Close audio context
			if (audioContextRef.current) {
				audioContextRef.current.close()
				audioContextRef.current = null
			}

			// Disconnect processor
			if (processorRef.current) {
				processorRef.current.disconnect()
				processorRef.current = null
			}
		}
	}, [isActive, audioTracks, setupAudioProcessing])

	return null // No UI, just a service
}
