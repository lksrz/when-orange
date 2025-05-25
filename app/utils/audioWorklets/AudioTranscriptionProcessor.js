/**
 * AudioTranscriptionProcessor.js
 *
 * This is a placeholder for a future AudioWorklet implementation that will replace
 * the deprecated ScriptProcessorNode used in the transcription service.
 *
 * TODO: Implement this AudioWorkletProcessor when we migrate away from ScriptProcessorNode.
 * See: https://developer.mozilla.org/en-US/docs/Web/API/AudioWorkletProcessor
 */

class AudioTranscriptionProcessor extends AudioWorkletProcessor {
	// Process method - called for each block of audio
	process(inputs, outputs, parameters) {
		// Get input audio data
		const input = inputs[0]
		if (!input || !input.length) return true

		// Get the first channel of the input (mono audio)
		const audioData = input[0]

		// Convert Float32Array to Int16Array for Deepgram
		const samples = new Int16Array(audioData.length)
		for (let i = 0; i < audioData.length; i++) {
			// Clamp values to [-1, 1] range
			const s = Math.max(-1, Math.min(1, audioData[i]))
			// Convert to 16-bit integer range
			samples[i] = s < 0 ? s * 0x8000 : s * 0x7fff
		}

		// Send the processed data to the main thread
		// Debug: log before posting audio buffer
		console.log('[AudioWorklet] Posting audio buffer to main thread', {
			sampleLength: samples.length,
			type: typeof samples[0]
		});
		this.port.postMessage(
			{
				type: 'audio-data',
				data: samples.buffer,
			},
			[samples.buffer]
		)

		// Return true to keep the processor alive
		return true
	}
}

// Register the processor
registerProcessor('audio-transcription-processor', AudioTranscriptionProcessor)
