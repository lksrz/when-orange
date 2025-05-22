import type { ActionFunctionArgs } from '@remix-run/cloudflare'

/**
 * API endpoint to provide OpenAI authentication token for real-time transcription
 */
export const action = async ({ context }: ActionFunctionArgs) => {
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization'
  }

  // Check if OpenAI credentials are configured
  if (!context.env.OPENAI_API_TOKEN) {
    return new Response(JSON.stringify({
      error: 'OpenAI transcription not configured',
      message: 'OPENAI_API_TOKEN environment variable is not set'
    }), {
      status: 503,
      headers: {
        'Content-Type': 'application/json',
        ...corsHeaders
      }
    })
  }

  try {
    // Return the OpenAI API token for client-side use
    // Note: In production, you might want to create a time-limited token
    // or use a different authentication method for better security
    return new Response(JSON.stringify({
      token: context.env.OPENAI_API_TOKEN,
      model: 'whisper-1',
      timestamp: Date.now()
    }), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        ...corsHeaders
      }
    })
  } catch (error) {
    console.error('Error providing OpenAI token:', error)
    return new Response(JSON.stringify({
      error: 'Failed to provide authentication token',
      message: error instanceof Error ? error.message : 'Unknown error'
    }), {
      status: 500,
      headers: {
        'Content-Type': 'application/json',
        ...corsHeaders
      }
    })
  }
}

// Handle CORS preflight
export const loader = async () => {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization'
    }
  })
}