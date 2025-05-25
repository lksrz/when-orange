import type { ActionFunctionArgs } from '@remix-run/cloudflare'

/**
 * API endpoint to provide OpenAI Realtime API authentication token
 * 
 * This endpoint specifically handles requests for the OpenAI Realtime API
 * with WebRTC, which requires an ephemeral token.
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
    console.error(`🎤 OpenAI Realtime Token API [${requestId}]: API token not configured`)
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
    // Make sure the TranscriptionService Durable Object is available
    if (!context.env.transcriptionService) {
      console.error(`🎤 OpenAI Realtime Token API [${requestId}]: TranscriptionService not configured`)
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
    console.log(`🎤 OpenAI Realtime Token API [${requestId}]: Using session token: ${sessionToken}`)

    // Create an ID for the Durable Object based on the session
    const idString = context.env.transcriptionService.idFromName(
      `openai-transcription-${sessionToken}`
    )
    console.log(`🎤 OpenAI Realtime Token API [${requestId}]: Using DO ID: ${idString.toString()}`)

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
        `🎤 OpenAI Realtime Token API [${requestId}]: DO returned error status: ${doResponse.status}`
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

    // Forward the successful response from the Durable Object
    const data = await doResponse.json()
    console.log(`🎤 OpenAI Realtime Token API [${requestId}]: Got token from DO, sending to client`)

    return new Response(
      JSON.stringify(data),
      {
        headers: {
          'Content-Type': 'application/json',
          'X-Request-ID': requestId,
          ...corsHeaders,
        },
      }
    )
  } catch (error) {
    console.error(`🎤 OpenAI Realtime Token API [${requestId}]: Error`, error)
    return new Response(
      JSON.stringify({
        error: 'Internal server error',
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

// Handle OPTIONS request for CORS preflight
export const loader = async ({ request }: ActionFunctionArgs) => {
  if (request.method === 'OPTIONS') {
    return new Response(null, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Token',
      },
    })
  }

  return new Response(
    JSON.stringify({
      error: 'Method not allowed',
      message: 'Use POST to request a token',
    }),
    {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    }
  )
}
