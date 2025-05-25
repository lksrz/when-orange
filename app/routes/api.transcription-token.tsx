import type { ActionFunctionArgs } from '@remix-run/cloudflare'

/**
 * API endpoint to provide OpenAI authentication token for transcription services
 *
 * This endpoint returns the necessary authentication for the following providers:
 * 1. Standard OpenAI Whisper API (legacy provider)
 * 2. OpenAI Realtime API with WebRTC (new provider with ephemeral tokens)
 * 
 * The endpoint supports two different paths:
 * - POST /api/transcription-token - Returns token for standard Whisper API
 * - POST /api/transcription-token/realtime - Returns ephemeral token for Realtime API
 */
export const action = async ({ context, request }: ActionFunctionArgs) => {
	const corsHeaders = {
		'Access-Control-Allow-Origin': '*',
		'Access-Control-Allow-Methods': 'POST, OPTIONS',
		'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Token',
	}

	// Create a unique request ID for tracing
	const requestId = crypto.randomUUID()

	// Check if OpenAI credentials are configured
	if (!context.env.OPENAI_API_TOKEN) {
		console.error(`🎤 OpenAI Token API [${requestId}]: API token not configured`)
		return new Response(
			JSON.stringify({
				error: 'OpenAI transcription not configured',
				message: 'OPENAI_API_TOKEN environment variable is not set',
				requestId,
			}),
			{
				status: 503,
				headers: {
					'Content-Type': 'application/json',
					'X-Request-ID': requestId,
					...corsHeaders,
				},
			}
		)
	}

	try {
		const url = new URL(request.url)
		// Check for either path ending with /realtime or query parameter ?type=realtime
		// The path could be /api/transcription-token/realtime or it could include /realtime in other positions
		const isRealtimeRequest = url.pathname.endsWith('/realtime') || 
			url.pathname.includes('/realtime/') || 
			url.searchParams.get('type') === 'realtime'

		console.log(`🎤 OpenAI Token API [${requestId}]: Request type: ${isRealtimeRequest ? 'realtime' : 'standard'}`)

		// For the new realtime API with WebRTC, we need to use the Durable Object to generate ephemeral tokens
		if (isRealtimeRequest) {
			// Make sure the TranscriptionService Durable Object is available
			if (!context.env.transcriptionService) {
				console.error(`🎤 OpenAI Token API [${requestId}]: TranscriptionService not configured`)
				return new Response(
					JSON.stringify({
						error: 'Transcription service not configured',
						message: 'Durable Object not available',
						requestId,
					}),
					{
						status: 503,
						headers: {
							'Content-Type': 'application/json',
							'X-Request-ID': requestId,
							...corsHeaders,
						},
					}
				)
			}

			// Extract session token from request headers or generate a random one
			const sessionToken = request.headers.get('X-Token') || crypto.randomUUID()
			console.log(`🎤 OpenAI Token API [${requestId}]: Using session token: ${sessionToken}`)

			// Create an ID for the Durable Object based on the session
			const idString = context.env.transcriptionService.idFromName(
				`openai-transcription-${sessionToken}`
			)
			console.log(`🎤 OpenAI Token API [${requestId}]: Using DO ID: ${idString.toString()}`)

			// Get the Durable Object stub
			const stub = context.env.transcriptionService.get(idString)

			// Forward the request to the Durable Object to get an ephemeral token
			const doResponse = await stub.fetch(new Request(`https://dummy-host/realtime-token`, {
				method: 'GET',
				headers: {
					'X-Token': sessionToken,
					'X-Request-ID': requestId,
				},
			}))

			// Check for errors from the Durable Object
			if (!doResponse.ok) {
				console.error(
					`🎤 OpenAI Token API [${requestId}]: DO returned error status: ${doResponse.status}`
				)
				return new Response(
					await doResponse.text(),
					{
						status: doResponse.status,
						headers: {
							'Content-Type': 'application/json',
							'X-Request-ID': requestId,
							...corsHeaders,
						},
					}
				)
			}

			// Return the ephemeral token response from the Durable Object
			const doData = await doResponse.json() as Record<string, unknown>
			console.log(`🎤 OpenAI Token API [${requestId}]: Successfully obtained realtime token`)
			return new Response(
				JSON.stringify({
					...doData,
					provider: 'openai-realtime',
					timestamp: Date.now(),
					requestId,
				}),
				{
					status: 200,
					headers: {
						'Content-Type': 'application/json',
						'X-Request-ID': requestId,
						...corsHeaders,
					},
				}
			)
		}

		// Legacy path: Standard Whisper API token
		console.log(`🎤 OpenAI Token API [${requestId}]: Returning standard Whisper API token`)
		return new Response(
			JSON.stringify({
				token: context.env.OPENAI_API_TOKEN,
				model: 'gpt-4o-transcribe',
				provider: 'openai',
				type: 'standard',
				transcriptionUrl: 'https://api.openai.com/v1/audio/transcriptions',
				timestamp: Date.now(),
				requestId,
			}),
			{
				status: 200,
				headers: {
					'Content-Type': 'application/json',
					'X-Request-ID': requestId,
					...corsHeaders,
				},
			}
		)
	} catch (error) {
		console.error(`🎤 OpenAI Token API [${requestId}]: Error:`, error)
		return new Response(
			JSON.stringify({
				error: 'Failed to provide authentication token',
				message: error instanceof Error ? error.message : 'Unknown error',
				requestId,
			}),
			{
				status: 500,
				headers: {
					'Content-Type': 'application/json',
					'X-Request-ID': requestId,
					...corsHeaders,
				},
			}
		)
	}
}

// Handle CORS preflight
export const loader = async () => {
	return new Response(null, {
		status: 204,
		headers: {
			'Access-Control-Allow-Origin': '*',
			'Access-Control-Allow-Methods': 'POST, OPTIONS',
			'Access-Control-Allow-Headers': 'Content-Type, Authorization',
		},
	})
}
