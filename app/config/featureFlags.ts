/**
 * Feature flags for the application
 *
 * This file contains feature flags that can be used to enable or disable features
 * in the application. This is useful for rolling out new features gradually or
 * implementing A/B testing.
 */

export const featureFlags = {
	/**
	 * Set to true to use the new OpenAI Realtime API for transcription.
	 * When false, the legacy Whisper API will be used.
	 */
	useRealtimeTranscription: true,
}

/**
 * Get the transcription provider based on feature flag settings
 *
 * @returns The transcription provider name
 */
export function getTranscriptionProvider(): string {
	return featureFlags.useRealtimeTranscription ? 'openai-realtime' : 'openai'
}
