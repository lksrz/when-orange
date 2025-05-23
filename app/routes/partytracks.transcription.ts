import { type ActionFunctionArgs } from '@remix-run/cloudflare'
import { nanoid } from 'nanoid'
import invariant from 'tiny-invariant'
import type { Env } from '~/types/Env'
import { generateAuthToken } from '~/utils/auth.server'
import getUsername from '~/utils/getUsername.server'

/**
 * This handler manages WebSocket connections to the TranscriptionService.
 * It's separate from the catch-all partytracks handler.
 */
export async function action({ request, context }: ActionFunctionArgs) {
	const env = context.env as Env

	// Check if we have the required bindings
	invariant(
		env.transcriptionService,
		'TranscriptionService binding is required'
	)

	// Ensure we have an AUTH_SECRET for token generation
	invariant(
		env.AUTH_SECRET,
		'AUTH_SECRET is required for secure transcription service'
	)

	// Authenticate the user
	try {
		// Check if user is authenticated by retrieving their username
		const username = await getUsername(request)

		if (!username) {
			return new Response('Unauthorized: User not authenticated', {
				status: 401,
			})
		}

		// Check for WebSocket upgrade
		if (request.headers.get('Upgrade') !== 'websocket') {
			return new Response('Expected Upgrade: websocket', { status: 426 })
		}

		// Create a new WebSocket pair
		const webSocketPair = new WebSocketPair()
		const [client, server] = Object.values(webSocketPair)

		// Create a unique ID for this transcription session
		const sessionId = nanoid()

		// Generate an auth token for this session
		const authToken = await generateAuthToken(username, env.AUTH_SECRET)

		// Add session information to the URL for the Durable Object
		const url = new URL(request.url)
		url.searchParams.set('token', authToken)
		url.searchParams.set('sessionId', sessionId)

		// Get the Durable Object stub for the TranscriptionService
		const idString = env.transcriptionService.idFromName(sessionId)
		const transcriptionServiceStub = env.transcriptionService.get(idString)

		// Forward the WebSocket to the Durable Object by fetching with proper upgrade
		await transcriptionServiceStub.fetch(url.toString(), {
			method: 'GET',
			headers: request.headers,
		})

		// Accept the client-side WebSocket and return it to the client
		;(server as any).accept()

		return new Response(null, {
			status: 101,
			webSocket: client as WebSocket,
		} as ResponseInit)
	} catch (error) {
		console.error('Error establishing transcription connection:', error)
		return new Response('Authentication failed or server error', {
			status: 500,
		})
	}
}
