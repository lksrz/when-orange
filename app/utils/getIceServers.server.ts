import type { Env } from '~/types/Env'

export async function getIceServers({
	TURN_SERVICE_ID,
	TURN_SERVICE_TOKEN,
}: Env): Promise<undefined | RTCIceServer[]> {
	console.log('🔧 TURN Service Configuration:', {
		hasId: !!TURN_SERVICE_ID,
		hasToken: !!TURN_SERVICE_TOKEN,
		idLength: TURN_SERVICE_ID?.length || 0,
		tokenLength: TURN_SERVICE_TOKEN?.length || 0,
	})

	// Debug mode: use public TURN servers for testing
	// This can be enabled by setting TURN_SERVICE_ID to "debug"
	if (TURN_SERVICE_ID === 'debug') {
		console.log('🔧 Debug mode: Using public TURN servers for testing')
		return [
			{ urls: 'stun:stun.l.google.com:19302' },
			{
				urls: 'turn:openrelay.metered.ca:80',
				username: 'openrelayproject',
				credential: 'openrelayproject',
			},
			{
				urls: 'turn:openrelay.metered.ca:443',
				username: 'openrelayproject',
				credential: 'openrelayproject',
			},
			{
				urls: 'turn:openrelay.metered.ca:443?transport=tcp',
				username: 'openrelayproject',
				credential: 'openrelayproject',
			},
		]
	}

	if (TURN_SERVICE_TOKEN === undefined || TURN_SERVICE_ID === undefined) {
		console.warn('⚠️ TURN service not configured - missing ID or TOKEN')
		console.warn('  TURN_SERVICE_ID:', TURN_SERVICE_ID ? 'present' : 'missing')
		console.warn(
			'  TURN_SERVICE_TOKEN:',
			TURN_SERVICE_TOKEN ? 'present' : 'missing'
		)
		return
	}

	try {
		console.log('🔧 Fetching TURN credentials from Cloudflare...')
		const url = `https://rtc.live.cloudflare.com/v1/turn/keys/${TURN_SERVICE_ID}/credentials/generate-ice-servers`
		console.log('🔧 TURN API URL:', url)

		const response = await fetch(url, {
			method: 'POST',
			body: JSON.stringify({ ttl: 86400 }),
			headers: {
				Authorization: `Bearer ${TURN_SERVICE_TOKEN}`,
				'Content-Type': 'application/json',
			},
		})

		console.log('🔧 TURN API Response:', {
			status: response.status,
			statusText: response.statusText,
			headers: Object.fromEntries(response.headers.entries()),
		})

		if (!response.ok) {
			const errorText = await response.text()
			console.error('❌ TURN service request failed:', {
				status: response.status,
				statusText: response.statusText,
				body: errorText,
			})
			return
		}

		const data = (await response.json()) as { iceServers: RTCIceServer[] }
		console.log('✅ TURN credentials received:', {
			serverCount: data.iceServers?.length || 0,
			servers: data.iceServers?.map((server) => ({
				urls: Array.isArray(server.urls) ? server.urls : [server.urls],
				hasCredentials: !!(server.username && server.credential),
				urlTypes: Array.isArray(server.urls)
					? server.urls.map((url) => url.split(':')[0])
					: [server.urls.split(':')[0]],
			})),
		})

		// Validate that we have TURN servers
		const hasTurnServers = data.iceServers?.some((server) => {
			const urls = Array.isArray(server.urls) ? server.urls : [server.urls]
			return urls.some((url) => url.includes('turn:'))
		})

		if (!hasTurnServers) {
			console.warn('⚠️ No TURN servers found in response, only STUN servers')
		} else {
			console.log('✅ TURN servers found in response')
		}

		return data.iceServers
	} catch (error) {
		console.error('❌ Error fetching TURN credentials:', error)
		if (error instanceof Error) {
			console.error('❌ Error details:', {
				name: error.name,
				message: error.message,
				stack: error.stack,
			})
		}

		// Provide fallback STUN servers if TURN service fails
		console.log('🔄 Using fallback STUN servers due to TURN service failure')
		return [
			{ urls: 'stun:stun.l.google.com:19302' },
			{ urls: 'stun:stun1.l.google.com:19302' },
			{ urls: 'stun:stun2.l.google.com:19302' },
		]
	}
}
