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
  provider = 'openai'
}) => {
  // Use our factory hook to get the appropriate transcription service
  const { transcripts } = useTranscriptionServiceFactory(
    audioTracks,
    {
      enabled: isActive,
      provider
    }
  )
  
  // Forward transcripts to the parent component
  const lastTranscriptCount = React.useRef(0)
  
  React.useEffect(() => {
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
