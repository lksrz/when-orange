import type { LoaderFunctionArgs } from '@remix-run/cloudflare'

const proxy = async ({ request, context }: LoaderFunctionArgs) => {
	const url = new URL(request.url)
	const pathname = url.pathname.replace('/partytracks', '')
	const search = url.search

	// Build the target URL for Cloudflare RTC API
	const targetUrl = `${context.env.CALLS_API_URL}/apps/${context.env.CALLS_APP_ID}${pathname}${search}`

	console.log('Proxying request to:', targetUrl)
	console.log('Method:', request.method)
	console.log('Headers:', Object.fromEntries(request.headers.entries()))

	try {
		// Forward the request to Cloudflare RTC API
		const response = await fetch(targetUrl, {
			method: request.method,
			headers: {
				Authorization: `Bearer ${context.env.CALLS_APP_SECRET}`,
				'Content-Type':
					request.headers.get('Content-Type') || 'application/json',
				// Forward other relevant headers
				...(request.headers.get('Accept') && {
					Accept: request.headers.get('Accept')!,
				}),
			},
			body:
				request.method !== 'GET' && request.method !== 'HEAD'
					? await request.text()
					: undefined,
		})

		console.log('Response status:', response.status)
		console.log(
			'Response headers:',
			Object.fromEntries(response.headers.entries())
		)

		const responseText = await response.text()
		console.log('Response body:', responseText)

		// Return the response with the same status and headers
		return new Response(responseText, {
			status: response.status,
			statusText: response.statusText,
			headers: response.headers,
		})
	} catch (error) {
		console.error('Error proxying request:', error)
		return new Response('Internal Server Error', { status: 500 })
	}
}

export const loader = proxy
export const action = proxy
