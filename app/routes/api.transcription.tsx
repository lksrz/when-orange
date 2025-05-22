import type { ActionFunctionArgs, LoaderFunctionArgs } from '@remix-run/cloudflare'

/**
 * Transcription API WebSocket endpoint
 * 
 * This endpoint handles both HTTP requests and WebSocket connections for the speech transcription service.
 * It follows Cloudflare's WebSocket pattern, creating a pair and forwarding messages
 * to the Durable Object that handles the actual transcription service.
 */

// Add an action function to handle HTTP POST requests for status checks
export const action = async ({ request, context }: ActionFunctionArgs) => {
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization'
  }
  
  // Return service status
  return new Response(JSON.stringify({
    status: 'available',
    hasTranscriptionService: Boolean(context.env.transcriptionService),
    hasDeepgramSecret: Boolean(context.env.DEEPGRAM_SECRET),
    supportsWebSockets: true,
    timestamp: Date.now()
  }), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      ...corsHeaders
    }
  })
}

// Loader to handle WebSocket connections and HTTP GET requests
export const loader = async ({ request, context }: LoaderFunctionArgs) => {
  // Create a unique request ID for tracking
  const requestId = crypto.randomUUID().substring(0, 8)
  
  // Simplified CORS headers that work with WebSockets
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, Upgrade, Connection',
    'X-Request-ID': requestId
  }

  // Enhanced debugging with more detailed information
  console.log(`🔌 Transcription API [${requestId}]: Request received`, {
    url: request.url,
    method: request.method,
    upgrade: request.headers.get('Upgrade'),
    origin: request.headers.get('Origin'),
    host: request.headers.get('Host'),
    connection: request.headers.get('Connection'),
    cfRay: request.headers.get('CF-Ray'),
    cfWorker: request.headers.get('CF-Worker'),
    cfConnectingIp: request.headers.get('CF-Connecting-IP'),
    allHeaders: Object.fromEntries([...request.headers.entries()])
  })

  // Enhanced environment diagnostics
  console.log(`🔌 Transcription API [${requestId}]: Environment check`, {
    hasTranscriptionService: Boolean(context.env.transcriptionService),
    hasDeepgramSecret: Boolean(context.env.DEEPGRAM_SECRET),
    mode: context.mode || 'unknown',
  })

  // Ensure we have the necessary Durable Object
  if (!context.env.transcriptionService) {
    console.error(`🔌 Transcription API [${requestId}]: transcriptionService not configured in env`)
    return new Response(JSON.stringify({
      error: 'Transcription service not configured',
      requestId,
      timestamp: Date.now()
    }), { 
      status: 500, 
      headers: { 
        'Content-Type': 'application/json',
        ...corsHeaders
      }
    })
  }

  // Handle OPTIONS request for CORS preflight
  if (request.method === 'OPTIONS') {
    console.log(`🔌 Transcription API [${requestId}]: Handling OPTIONS request (CORS preflight)`)
    return new Response(null, {
      status: 204,
      headers: corsHeaders
    })
  }

  // Handle HTTP GET for service availability and status check
  // If it's a regular HTTP request, return service info instead of 426
  const upgradeHeader = request.headers.get('Upgrade')
  if (!upgradeHeader || upgradeHeader.toLowerCase() !== 'websocket') {
    console.log(`🔌 Transcription API [${requestId}]: Normal HTTP request received, returning service info`)
    
    return new Response(JSON.stringify({
      status: 'available',
      supportsWebSockets: true,
      hasTranscriptionService: Boolean(context.env.transcriptionService),
      hasDeepgramSecret: Boolean(context.env.DEEPGRAM_SECRET),
      message: 'Transcription service is available',
      websocketUrl: `${request.url.replace('http', 'ws')}?token=${Date.now()}`,
      requestId,
      timestamp: Date.now()
    }), { 
      status: 200,
      headers: { 
        'Content-Type': 'application/json',
        ...corsHeaders
      }
    })
  }

  // Extract URL parameters
  const url = new URL(request.url)
  const token = url.searchParams.get('token') || ''
  // Add a cache busting parameter if there's none in the URL
  const cacheBuster = url.searchParams.get('_') || Date.now().toString()
  
  try {
    console.log(`🔌 Transcription API [${requestId}]: Processing WebSocket upgrade request`, {
      token: token ? `${token.substring(0, 5)}...` : 'none',
      cacheBuster: cacheBuster.substring(0, 5) + '...',
      url: url.toString()
    })
    
    // Create a WebSocket pair - this is the key to Cloudflare WebSocket handling
    const pair = new WebSocketPair()
    
    // Accept the server-side socket right away
    const server: WebSocket = pair[1] as any
    ;(server as any).accept()
    
    // Create a unique ID for this session using a deterministic but secure method
    // This way, reconnections from the same user token will go to the same DO
    const idString = context.env.transcriptionService.idFromName(token || crypto.randomUUID())
    console.log(`🔌 Transcription API [${requestId}]: Using DO ID: ${idString.toString()}`)
    
    // Get the Durable Object stub
    const stub = context.env.transcriptionService.get(idString)
    
    // Add a ping/keepalive interval
    const pingInterval = setInterval(() => {
      if (server.readyState === WebSocket.OPEN) {
        try {
          server.send(JSON.stringify({
            type: 'ping',
            timestamp: Date.now(),
            requestId
          }))
        } catch (error) {
          console.error(`🔌 Transcription API [${requestId}]: Error sending ping:`, error)
          clearInterval(pingInterval)
        }
      } else {
        clearInterval(pingInterval)
      }
    }, 30000) // ping every 30 seconds
    
    // WebSocket event handlers
    server.addEventListener('message', async (event: MessageEvent) => {
      try {
        const data = event.data
        // Use full URL for Durable Object fetch
        const doUrl = new URL(url.toString())
        
        // Forward the message to the Durable Object
        console.log(`🔌 Transcription API [${requestId}]: Forwarding message to DO`, {
          dataType: data instanceof ArrayBuffer ? 'binary' : 'json',
          dataSize: data instanceof ArrayBuffer ? data.byteLength : (data.length || 'unknown')
        })
        
        const response = await stub.fetch(doUrl.toString(), {
          method: 'POST',
          headers: {
            'Content-Type': data instanceof ArrayBuffer ? 'application/octet-stream' : 'application/json',
            'X-Token': token,
            'X-Request-ID': requestId
          },
          body: data
        })
        
        // Check response and forward any returned data to the client
        if (response.ok) {
          const contentType = response.headers.get('Content-Type') || ''
          
          if (contentType.includes('application/json')) {
            const jsonData = await response.json()
            server.send(JSON.stringify(jsonData))
          } else if (contentType.includes('application/octet-stream')) {
            const binaryData = await response.arrayBuffer()
            server.send(binaryData)
          }
        } else {
          // Error handling
          console.error(`🔌 Transcription API [${requestId}]: DO returned error status: ${response.status}`)
          server.send(JSON.stringify({
            type: 'error',
            message: `Server error: ${response.status}`,
            requestId,
            timestamp: Date.now()
          }))
        }
      } catch (error) {
        console.error(`🔌 Transcription API [${requestId}]: Error forwarding message:`, error)
        server.send(JSON.stringify({
          type: 'error',
          message: 'Internal server error processing message',
          requestId,
          timestamp: Date.now()
        }))
      }
    })
    
    // When the client closes the connection
    server.addEventListener('close', async (event: CloseEvent) => {
      try {
        console.log(`🔌 Transcription API [${requestId}]: WebSocket closed with code ${event.code} reason: ${event.reason || 'none'}`)
        // Clean up the ping interval
        clearInterval(pingInterval)
        
        // Notify the Durable Object
        await stub.fetch(url.toString(), {
          method: 'DELETE',
          headers: {
            'Content-Type': 'application/json',
            'X-Token': token,
            'X-Close-Code': event.code.toString(),
            'X-Close-Reason': event.reason || 'none',
            'X-Request-ID': requestId
          }
        })
      } catch (error) {
        console.error(`🔌 Transcription API [${requestId}]: Error handling WebSocket close:`, error)
      }
    })
    
    // Handle errors
    server.addEventListener('error', (event: Event) => {
      console.error(`🔌 Transcription API [${requestId}]: WebSocket error:`, event)
      // Clean up the ping interval
      clearInterval(pingInterval)
    })
    
    // Initialize the session in the Durable Object
    try {
      console.log(`🔌 Transcription API [${requestId}]: Initializing DO session`)
      
      const initResponse = await stub.fetch(url.toString(), {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'X-Token': token,
          'X-Request-ID': requestId
        },
        body: JSON.stringify({ 
          type: 'setup',
          timestamp: Date.now(),
          userAgent: request.headers.get('User-Agent') || 'unknown',
          requestId
        })
      })
      
      // Check if initialization was successful
      if (!initResponse.ok) {
        let errorText = 'Unknown error';
        try {
          // Try to parse as JSON first
          const errorData = await initResponse.json() as { error?: string; message?: string };
          errorText = errorData.error || errorData.message || JSON.stringify(errorData);
        } catch {
          // Fall back to plain text
          errorText = await initResponse.text();
        }
        
        console.error(`🔌 Transcription API [${requestId}]: Error initializing session:`, {
          status: initResponse.status,
          error: errorText
        })
        
        server.send(JSON.stringify({
          type: 'error',
          message: 'Failed to initialize transcription service',
          details: errorText,
          requestId,
          timestamp: Date.now()
        }))
      } else {
        // Parse the response
        const responseData = await initResponse.json();
        console.log(`🔌 Transcription API [${requestId}]: DO initialization successful`, responseData)
        
        // Send welcome message
        server.send(JSON.stringify({
          type: 'status',
          status: 'connected',
          message: 'WebSocket connection established',
          requestId,
          timestamp: Date.now()
        }))
      }
    } catch (error) {
      console.error(`🔌 Transcription API [${requestId}]: Error during initialization:`, error)
      server.send(JSON.stringify({
        type: 'error',
        message: 'Error initializing connection',
        details: error instanceof Error ? error.message : 'Unknown error',
        requestId,
        timestamp: Date.now()
      }))
    }
    
    // Return the WebSocket to the client with a 101 Switching Protocols status
    console.log(`🔌 Transcription API [${requestId}]: Returning WebSocket upgrade response`)
    return new Response(null, {
      status: 101,
      webSocket: pair[0],
      headers: {
        'Upgrade': 'websocket',
        'Connection': 'Upgrade',
        ...corsHeaders
      }
    })
  } catch (error) {
    console.error(`🔌 Transcription API [${requestId}]: Error processing WebSocket upgrade:`, error)
    return new Response(JSON.stringify({
      error: `WebSocket upgrade error: ${error instanceof Error ? error.message : 'Unknown error'}`,
      requestId,
      timestamp: Date.now()
    }), { 
      status: 500,
      headers: { 
        'Content-Type': 'application/json',
        ...corsHeaders
      }
    })
  }
}