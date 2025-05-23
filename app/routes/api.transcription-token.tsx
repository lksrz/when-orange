import type { ActionFunctionArgs } from '@remix-run/cloudflare'

/**
 * API endpoint to provide OpenAI authentication token for real-time transcription
 *
 * This endpoint returns the necessary authentication for both:
 * 1. Real-time WebSocket API (gpt-4o-transcribe via WebSocket)
 * 2. Standard transcription API (gpt-4o-transcribe via POST)
 */
export const action = async ({ context, request }: ActionFunctionArgs) => {
	const corsHeaders = {
		'Access-Control-Allow-Origin': '*',
		'Access-Control-Allow-Methods': 'POST, OPTIONS',
		'Access-Control-Allow-Headers': 'Content-Type, Authorization',
	}

	// Check if OpenAI credentials are configured
	if (!context.env.OPENAI_API_TOKEN) {
		return new Response(
			JSON.stringify({
				error: 'OpenAI transcription not configured',
				message: 'OPENAI_API_TOKEN environment variable is not set',
			}),
			{
				status: 503,
				headers: {
					'Content-Type': 'application/json',
					...corsHeaders,
				},
			}
		)
	}

	try {
		// Parse request body to check if ephemeral token is requested
		let requestBody: any = {}
		try {
			requestBody = await request.json()
		} catch {
			// If no body or invalid JSON, continue with defaults
		}

		const isRealtimeRequest = requestBody.realtime === true

		// For real-time API, we could generate an ephemeral token here
		// However, OpenAI's real-time API currently accepts the regular API key
		// In the future, this could be enhanced to call OpenAI's ephemeral token endpoint

		if (isRealtimeRequest) {
			// Future enhancement: Call OpenAI's ephemeral token endpoint
			// const ephemeralToken = await generateEphemeralToken(context.env.OPENAI_API_TOKEN);

			return new Response(
				JSON.stringify({
					token: context.env.OPENAI_API_TOKEN,
					model: 'gpt-4o-transcribe',
					type: 'realtime',
					realtimeUrl: 'wss://api.openai.com/v1/realtime',
					timestamp: Date.now(),
					expiresIn: 3600, // 1 hour (for future ephemeral tokens)
				}),
				{
					status: 200,
					headers: {
						'Content-Type': 'application/json',
						...corsHeaders,
					},
				}
			)
		}

		// Standard transcription API token
		return new Response(
			JSON.stringify({
				token: context.env.OPENAI_API_TOKEN,
				model: 'gpt-4o-transcribe',
				type: 'standard',
				transcriptionUrl: 'https://api.openai.com/v1/audio/transcriptions',
				timestamp: Date.now(),
			}),
			{
				status: 200,
				headers: {
					'Content-Type': 'application/json',
					...corsHeaders,
				},
			}
		)
	} catch (error) {
		console.error('Error providing OpenAI token:', error)
		return new Response(
			JSON.stringify({
				error: 'Failed to provide authentication token',
				message: error instanceof Error ? error.message : 'Unknown error',
			}),
			{
				status: 500,
				headers: {
					'Content-Type': 'application/json',
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
