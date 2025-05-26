import React from 'react'
import { useTranscriptionServiceFactory } from '~/hooks/useTranscriptionServiceFactory'
import { transcriptStorage } from '~/utils/transcriptStorage'
import type { Transcription } from './TranscriptionService'

type Props = {
  audioTracks: MediaStreamTrack[]
  onTranscription: (t: Transcription) => void
  isActive: boolean
  participants: string[]
  provider?: string
  speakerTracker?: {
    getPrimarySpeaker: (startTime: number, endTime: number) => { userId: string; userName: string; duration: number } | null
  }
}

/**
 * Modern wrapper component for transcription services that supports multiple providers.
 * This component uses the factory pattern to select between different transcription implementations.
 * 
 * Supported providers:
 * - 'openai' (default): Uses the legacy Whisper API implementation
 * - 'openai-realtime': Uses the WebRTC-based OpenAI Realtime API with lower latency
 */
export const TranscriptionServiceWrapper: React.FC<Props> = ({
  audioTracks,
  onTranscription,
  isActive,
  participants: _participants,
  provider = 'openai',
  speakerTracker
}) => {
  // Enhanced callback for realtime service that includes timing
  const handleRealtimeTranscription = React.useCallback((text: string, startTime?: number, endTime?: number) => {
    console.log('🔥 Realtime transcription received:', { text, startTime, endTime })
    
    // Create transcription with or without timing data
    const transcription: Transcription = {
      id: `realtime_${Date.now()}_${Math.random()}`,
      text,
      timestamp: Date.now(),
      isFinal: true,
      speaker: 'OpenAI Realtime', // Will be overridden by parent component
      ...(startTime && { startTime }),
      ...(endTime && { endTime })
    }
    
    // Save to storage and notify parent
    transcriptStorage.addTranscript(transcription)
    onTranscription(transcription)
  }, [onTranscription])

  // Use our factory hook to get the appropriate transcription service
  const { transcripts } = useTranscriptionServiceFactory(
    audioTracks,
    {
      enabled: isActive,
      provider,
      speakerTracker,
      onTranscriptionWithSpeaker: provider === 'openai-realtime' ? handleRealtimeTranscription : undefined
    }
  )
  
  // Forward transcripts to the parent component
  const lastTranscriptCount = React.useRef(0)
  
  React.useEffect(() => {
    console.log('📜 TranscriptionServiceWrapper useEffect:', { provider, transcriptsLength: transcripts.length })
    
    // Skip processing for realtime provider since it uses the callback
    if (provider === 'openai-realtime') {
      console.log('⏭️ Skipping useEffect for realtime provider')
      return
    }
    
    // Only process new transcripts to avoid infinite loops
    if (transcripts.length > lastTranscriptCount.current) {
      const newTranscripts = transcripts.slice(lastTranscriptCount.current)
      lastTranscriptCount.current = transcripts.length
      
      // Process each new transcript
      newTranscripts.forEach(text => {
        const transcription: Transcription = {
          id: `${provider}_${Date.now()}_${Math.random()}`,
          text,
          timestamp: Date.now(),
          isFinal: true,
          speaker: provider === 'openai-realtime' ? 'OpenAI Realtime' : 'OpenAI Whisper'
        }
        
        // Save to storage and notify parent
        transcriptStorage.addTranscript(transcription)
        onTranscription(transcription)
      })
    }
  }, [transcripts.length, onTranscription, provider]) // Only depend on length, not the full array
  
  return null // No UI, just a service
}
