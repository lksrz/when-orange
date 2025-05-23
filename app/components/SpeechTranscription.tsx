import { useLoaderData } from '@remix-run/react'
import { type FC, useCallback, useEffect, useState } from 'react'
import useTranscriptionService from '~/hooks/useTranscriptionService'
import useUserMedia from '~/hooks/useUserMedia'
import type { loader } from '~/routes/_room.$roomName.room'

// Constants for managing transcription history
const DEFAULT_MAX_TRANSCRIPTION_HISTORY = 50
const LOW_MEMORY_MAX_TRANSCRIPTION_HISTORY = 20
const MAX_TRANSCRIPTION_AGE_MS = 5 * 60 * 1000 // 5 minutes

// Function to determine max history size based on device memory
const getMaxTranscriptionHistory = () => {
	// Check if we have access to device memory info
	if (window.navigator && 'deviceMemory' in window.navigator) {
		// Use type assertion to access deviceMemory property
		const memory = (window.navigator as any).deviceMemory as number
		// If device has less than 4GB RAM, use reduced history size
		return memory > 4
			? DEFAULT_MAX_TRANSCRIPTION_HISTORY
			: LOW_MEMORY_MAX_TRANSCRIPTION_HISTORY
	}
	// Default to standard size if deviceMemory is not available
	return DEFAULT_MAX_TRANSCRIPTION_HISTORY
}

interface TranscriptionResult {
	text: string
	isFinal: boolean
	timestamp: number
}

/**
 * SpeechTranscription Component
 *
 * This component manages speech-to-text transcription for the current user.
 * It uses WebSockets to securely connect to Deepgram through our server,
 * which protects the API key.
 */
export const SpeechTranscription: FC = () => {
	// Check if transcription is enabled
	const { hasTranscriptionCredentials } = useLoaderData<typeof loader>()

	// STARTUP DIAGNOSTIC LOG (even more visible)
	console.log(
		'%c 🎤🎤🎤 SPEECH TRANSCRIPTION COMPONENT LOADED 🎤🎤🎤',
		'background: #FF5733; color: white; font-size: 16px; font-weight: bold; padding: 8px 12px; border-radius: 4px;'
	)

	// Debugging info
	console.log(
		'%c Transcription status:',
		'background: purple; color: white; font-weight: bold;',
		{
			enabled: hasTranscriptionCredentials,
			hostname: window.location.hostname,
			url: window.location.href,
		}
	)

	// Check for debug feature flags
	useEffect(() => {
		const debugFlag = new URLSearchParams(window.location.search).get(
			'debug_transcription'
		)
		if (debugFlag) {
			localStorage.setItem(
				'use_old_transcription_path',
				debugFlag === 'old' ? 'true' : 'false'
			)
			console.log(
				'%c Transcription debug flag set:',
				'background: purple; color: white; font-weight: bold;',
				debugFlag
			)
		}
	}, [])

	if (!hasTranscriptionCredentials) {
		console.log(
			'%c 🎤 NOTE: Transcription is DISABLED - credentials not configured',
			'background: orange; color: white; font-weight: bold; padding: 4px 6px; border-radius: 3px;'
		)
	} else {
		console.log(
			'%c 🎤 Transcription is ENABLED and ready',
			'background: lime; color: black; font-weight: bold; padding: 4px 6px; border-radius: 3px;'
		)
	}

	// Get access to the user's audio track
	const userMedia = useUserMedia()
	const audioTrack = userMedia.audioStreamTrack

	// Store transcription results with memory management
	const [transcriptions, setTranscriptions] = useState<TranscriptionResult[]>(
		[]
	)
	const [isTranscribing, setIsTranscribing] = useState(false)

	// Memo-ize the max history size, calculated once when the component mounts
	const [maxHistory] = useState(getMaxTranscriptionHistory)

	// Function to add a transcription while managing memory
	const addTranscription = useCallback(
		(text: string, isFinal: boolean) => {
			const now = Date.now()

			setTranscriptions((prev) => {
				// Add the new transcription
				const newTranscriptions = [...prev, { text, isFinal, timestamp: now }]

				// Filter out old transcriptions and limit the array size
				return newTranscriptions
					.filter((t) => now - t.timestamp < MAX_TRANSCRIPTION_AGE_MS) // Remove old entries
					.slice(-maxHistory) // Limit array size based on device memory
			})

			// Log the transcription
			console.log(
				`%c 🎤 Speech Transcription: %c ${text}`,
				'background: #ffa500; color: white; font-weight: bold; padding: 4px 6px; border-radius: 3px;',
				'color: #333; font-style: italic; font-size: 14px;'
			)
		},
		[maxHistory]
	)

	// Use our transcription service hook
	const transcriptionService = useTranscriptionService({
		onTranscription: addTranscription,
		onError: (error) => {
			console.error('Transcription error:', error)
		},
		onStatusChange: (status) => {
			setIsTranscribing(status === 'connected')

			if (status === 'connected') {
				console.log(
					'%c 🎤 Transcription service connected',
					'background: green; color: white; font-weight: bold;'
				)
			} else if (status === 'disconnected') {
				console.log(
					'%c 🎤 Transcription service disconnected',
					'background: red; color: white; font-weight: bold;'
				)
			} else {
				console.log(
					'%c 🎤 Connecting to transcription service...',
					'background: orange; color: white; font-weight: bold;'
				)
			}
		},
	})

	// Log when we have an audio track
	useEffect(() => {
		if (audioTrack) {
			console.log(
				'%c 🎤 Audio track available for transcription',
				'background: green; color: white; font-weight: bold;'
			)

			// Start transcription when we have an audio track
			if (hasTranscriptionCredentials) {
				transcriptionService.startTranscription(audioTrack)
			}
		} else {
			console.log(
				'%c 🎤 No audio track available for transcription',
				'background: red; color: white; font-weight: bold;'
			)
		}

		// Clean up on unmount or when track changes
		return () => {
			if (isTranscribing) {
				transcriptionService.stopTranscription()
			}
		}
	}, [
		audioTrack,
		hasTranscriptionCredentials,
		isTranscribing,
		transcriptionService,
	])

	// No UI for now, just logging to console
	return null
}
