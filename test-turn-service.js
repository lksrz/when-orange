// Test script for Cloudflare TURN service
// Run with: node test-turn-service.js

const TURN_SERVICE_ID =
	process.env.TURN_SERVICE_ID || '3d47c5a790a0b730d98bf6ebf0e37553'
const TURN_SERVICE_TOKEN = process.env.TURN_SERVICE_TOKEN

console.log('🔧 Testing Cloudflare TURN Service...')
console.log('TURN_SERVICE_ID:', TURN_SERVICE_ID)
console.log('TURN_SERVICE_TOKEN:', TURN_SERVICE_TOKEN ? 'present' : 'MISSING')

if (!TURN_SERVICE_TOKEN) {
	console.error('❌ TURN_SERVICE_TOKEN environment variable is not set')
	console.log('💡 Set it with: export TURN_SERVICE_TOKEN=your_token_here')
	process.exit(1)
}

async function testTurnService() {
	try {
		const url = `https://rtc.live.cloudflare.com/v1/turn/keys/${TURN_SERVICE_ID}/credentials/generate-ice-servers`
		console.log('🔧 Testing URL:', url)

		const response = await fetch(url, {
			method: 'POST',
			body: JSON.stringify({ ttl: 86400 }),
			headers: {
				Authorization: `Bearer ${TURN_SERVICE_TOKEN}`,
				'Content-Type': 'application/json',
			},
		})

		console.log('📊 Response Status:', response.status, response.statusText)
		console.log(
			'📊 Response Headers:',
			Object.fromEntries(response.headers.entries())
		)

		if (!response.ok) {
			const errorText = await response.text()
			console.error('❌ TURN service failed:', errorText)
			return
		}

		const data = await response.json()
		console.log('✅ TURN service response:', JSON.stringify(data, null, 2))

		// Analyze the response
		if (data.iceServers && Array.isArray(data.iceServers)) {
			console.log('\n📊 ICE Servers Analysis:')
			data.iceServers.forEach((server, index) => {
				const urls = Array.isArray(server.urls) ? server.urls : [server.urls]
				const types = urls.map((url) => url.split(':')[0])
				console.log(`  Server ${index + 1}:`)
				console.log(`    URLs: ${urls.join(', ')}`)
				console.log(`    Types: ${types.join(', ')}`)
				console.log(
					`    Has credentials: ${!!(server.username && server.credential)}`
				)
			})

			const hasTurn = data.iceServers.some((server) => {
				const urls = Array.isArray(server.urls) ? server.urls : [server.urls]
				return urls.some((url) => url.includes('turn:'))
			})

			console.log(
				`\n${hasTurn ? '✅' : '❌'} TURN servers ${hasTurn ? 'found' : 'NOT found'}`
			)
		} else {
			console.error('❌ Invalid response format - no iceServers array')
		}
	} catch (error) {
		console.error('❌ Error testing TURN service:', error.message)
		if (error.cause) {
			console.error('❌ Cause:', error.cause)
		}
	}
}

testTurnService()
