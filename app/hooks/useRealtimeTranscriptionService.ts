import { useCallback, useEffect, useRef, useState } from 'react'

interface RealtimeTranscriptionOptions {
  enabled: boolean
  transcriptionProvider?: string
  onTranscriptionWithSpeaker?: (text: string, speakerId?: string, speakerName?: string) => void
}

/**
 * Hook for using OpenAI's Realtime API for transcription
 * This implementation connects directly to OpenAI's servers using WebRTC
 * and processes transcriptions in real-time with lower latency
 */
export function useRealtimeTranscriptionService(
  tracks: MediaStreamTrack[] = [],
  options: RealtimeTranscriptionOptions = { enabled: false }
) {
  const { enabled, transcriptionProvider, onTranscriptionWithSpeaker } = options
  const [isActive, setIsActive] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<Error | null>(null)
  const [transcripts, setTranscripts] = useState<string[]>([])
  
  // References to maintain WebRTC connections
  const peerConnectionRef = useRef<RTCPeerConnection | null>(null)
  const dataChannelRef = useRef<RTCDataChannel | null>(null)
  const ephemeralTokenRef = useRef<string | null>(null)
  
  // Track ongoing transcription timing for speaker correlation
  const ongoingTranscriptions = useRef<Map<string, { startTime: number }>>(new Map())
  
  // Only use realtime if explicitly enabled and provider is openai-realtime
  const useRealtime = enabled && transcriptionProvider === 'openai-realtime'
  
  // Clean up function to close connections
  const cleanup = useCallback(() => {
    try {
      if (dataChannelRef.current) {
        dataChannelRef.current.close()
        dataChannelRef.current = null
      }
      
      if (peerConnectionRef.current) {
        peerConnectionRef.current.close()
        peerConnectionRef.current = null
      }
      
      ephemeralTokenRef.current = null
      setIsActive(false)
    } catch (err) {
      console.error('Error cleaning up WebRTC connections:', err)
    }
  }, [])
  
  // Get ephemeral token from our backend
  const getEphemeralToken = useCallback(async () => {
    try {
      console.log('🎤 OpenAI Realtime: Requesting ephemeral token')
      setIsLoading(true)
      const response = await fetch('/api/transcription-token/realtime', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
      })
      
      if (!response.ok) {
        const errorData = await response.json() as { error?: string }
        throw new Error(`Failed to get token: ${errorData.error || response.statusText}`)
      }
      
      const data = await response.json() as { token: string }
      ephemeralTokenRef.current = data.token
      setIsLoading(false)
      return data.token
    } catch (err) {
      setIsLoading(false)
      setError(err instanceof Error ? err : new Error('Unknown error getting token'))
      throw err
    }
  }, [])
  
  // Initialize WebRTC connection with OpenAI
  const initializeWebRTC = useCallback(async (tracks: MediaStreamTrack[]) => {
    if (!tracks.length) return
    
    try {
      // Get token first
      const ephemeralToken = await getEphemeralToken()
      
      // Create a new peer connection
      const pc = new RTCPeerConnection()
      peerConnectionRef.current = pc
      
      // Add audio tracks
      tracks.forEach(track => {
        console.log('🎤 OpenAI Realtime: Adding track to peer connection', track.kind, track.enabled)
        pc.addTrack(track)
      })
      
      // Set up data channel for receiving transcription events
      const dc = pc.createDataChannel('oai-events')
      dataChannelRef.current = dc
      
      // Handle transcription messages
      dc.addEventListener('message', (event) => {
        try {
          const data = JSON.parse(event.data)
          const now = Date.now()
          
          // Track transcription timing for speaker correlation
          if (data.type === 'input_audio_buffer.speech_started') {
            const itemId = data.item_id
            if (itemId) {
              ongoingTranscriptions.current.set(itemId, { startTime: now })
              console.log('🎤 OpenAI Realtime: Speech started for item:', itemId)
            }
          }
          
          // Only handle completed transcriptions, not deltas (to avoid duplicates)
          else if (data.type === 'conversation.item.input_audio_transcription.completed') {
            const text = data.transcript?.trim()
            const itemId = data.item_id
            
            if (text && itemId) {
              // Get timing info for this transcription
              const timingInfo = ongoingTranscriptions.current.get(itemId)
              const startTime = timingInfo?.startTime || (now - 2000) // Default to 2 seconds ago if no start time
              const endTime = now
              
              console.log('🎤 OpenAI Realtime: Received transcript:', {
                text,
                itemId,
                startTime,
                endTime,
                duration: endTime - startTime
              })
              
              // Add to local state
              setTranscripts(prev => [...prev, text])
              
              // Call the speaker-aware callback if provided
              if (onTranscriptionWithSpeaker) {
                onTranscriptionWithSpeaker(text, undefined, undefined) // Will be filled by parent component
              }
              
              // Clean up timing info
              ongoingTranscriptions.current.delete(itemId)
            }
          }
          // Ignore other message types for now to reduce noise
        } catch (err) {
          console.error('Error processing transcript message:', err)
        }
      })
      
      // Log data channel state changes
      dc.addEventListener('open', () => {
        console.log('🎤 OpenAI Realtime: Data channel opened')
        setIsActive(true)
        
        // Enable input audio transcription
        const configEvent = {
          type: 'session.update',
          session: {
            input_audio_transcription: {
              model: 'whisper-1'
            }
          }
        }
        
        try {
          dc.send(JSON.stringify(configEvent))
          console.log('🎤 OpenAI Realtime: Sent transcription config:', configEvent)
        } catch (err) {
          console.error('🎤 OpenAI Realtime: Error sending config:', err)
        }
      })
      
      dc.addEventListener('close', () => {
        console.log('🎤 OpenAI Realtime: Data channel closed')
        setIsActive(false)
      })
      
      // Create and set local description
      const offer = await pc.createOffer()
      await pc.setLocalDescription(offer)
      
      // Connect to OpenAI's realtime API
      const sdpResponse = await fetch(
        'https://api.openai.com/v1/realtime?model=gpt-4o-realtime-preview-2024-12-17',
        {
          method: 'POST',
          body: offer.sdp,
          headers: {
            'Authorization': `Bearer ${ephemeralToken}`,
            'Content-Type': 'application/sdp',
          },
        }
      )
      
      if (!sdpResponse.ok) {
        throw new Error(`Failed to connect to OpenAI: ${sdpResponse.statusText}`)
      }
      
      // Set the remote description from OpenAI's answer
      const answer = {
        type: 'answer' as RTCSdpType,
        sdp: await sdpResponse.text(),
      }
      
      await pc.setRemoteDescription(answer)
      console.log('🎤 OpenAI Realtime: Connected to OpenAI')
      
    } catch (err) {
      console.error('Failed to initialize WebRTC connection:', err)
      setError(err instanceof Error ? err : new Error('Failed to initialize'))
      cleanup()
    }
  }, []) // Remove dependencies to prevent re-creation
  
  // Set up WebRTC connection when enabled and tracks change
  useEffect(() => {
    if (!useRealtime) {
      cleanup()
      return
    }
    
    if (tracks.length > 0) {
      console.log('🎤 OpenAI Realtime: Setting up transcription service')
      initializeWebRTC(tracks)
    }
    
    return () => {
      cleanup()
    }
  }, [useRealtime, tracks.length]) // Remove cleanup and initializeWebRTC from deps to prevent infinite loop
  
  // Return the same interface as the original useTranscriptionService hook
  return {
    isActive,
    isLoading,
    error,
    transcripts,
  }
}
