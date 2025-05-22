import type { LoaderFunctionArgs } from '@remix-run/cloudflare'
import { routePartyTracksRequest } from 'partytracks/server'

const proxy = async ({ request, context }: LoaderFunctionArgs) => {
	// Extract the path to check if it's a transcription request
	const url = new URL(request.url)
	const pathSegments = url.pathname.split('/')
	const lastSegment = pathSegments[pathSegments.length - 1]
	
	// Log all requests to the partytracks route for debugging
	console.log('Partytracks route handling request:', {
		url: request.url,
		method: request.method,
		upgrade: request.headers.get('Upgrade'),
		pathname: url.pathname,
		lastSegment
	})
	
	// If it's a transcription request, proxy directly to the transcription API
	// instead of redirecting, to handle WebSocket upgrades properly
	if (lastSegment === 'transcription') {
		console.log('Partytracks: Detected transcription request, forwarding to API endpoint')
		
		// For WebSocket upgrade requests, we need special handling
		if (request.headers.get('Upgrade')?.toLowerCase() === 'websocket') {
			console.log('Partytracks: Forwarding WebSocket upgrade request to transcription API')
			
			// Create a new request to our API endpoint
			const apiUrl = new URL(request.url)
			apiUrl.pathname = '/api/transcription'
			
			try {
				// Check if we have the transcription service available
				if (!context.env.transcriptionService) {
					console.error('Partytracks: transcriptionService not configured')
					return new Response('Transcription service not configured', { 
						status: 500, 
						headers: { 'Content-Type': 'text/plain' }
					})
				}
				
				// Create a new Durable Object ID
				const id = context.env.transcriptionService.newUniqueId()
				console.log(`Partytracks: Created new DO ID: ${id.toString()}`)
				
				// Get stub for the Durable Object
				const stub = context.env.transcriptionService.get(id)
				console.log('Partytracks: Created DO stub, forwarding request')
				
				// Forward the request directly to the Durable Object
				// Create a proper RequestInit object to avoid TypeScript errors
				const requestInit: RequestInit = {
					method: request.method,
					headers: request.headers,
					body: request.body
				}
				
				// Create a new URL for the stub fetch
				const requestUrl = new URL(request.url)
				
				return stub.fetch(requestUrl, requestInit)
			} catch (error) {
				console.error('Partytracks: Error handling transcription request:', error)
				return new Response(`WebSocket upgrade error: ${error instanceof Error ? error.message : 'Unknown error'}`, { 
					status: 500,
					headers: { 'Content-Type': 'text/plain' }
				})
			}
		}
		
		// For non-WebSocket requests, redirect to the API endpoint
		console.log('Partytracks: Redirecting non-WebSocket transcription request to API endpoint')
		return new Response(null, {
			status: 307, // Temporary redirect
			headers: {
				Location: `/api/transcription${url.search}`
			}
		})
	}
	
	// Otherwise, process all requests normally with the partytracks library
	console.log('Partytracks: Processing standard partytracks request')
	return routePartyTracksRequest({
		appId: context.env.CALLS_APP_ID,
		token: context.env.CALLS_APP_SECRET,
		callsApiBaseUrl: context.env.CALLS_API_URL,
		request,
	})
}

export const loader = proxy
export const action = proxy