import { useEffect, useMemo, useState } from 'react'
import useTranscriptionService from './useTranscriptionService'
import { useRealtimeTranscriptionService } from './useRealtimeTranscriptionService'

interface TranscriptionServiceOptions {
  enabled: boolean
  provider?: string
  speakerTracker?: {
    getPrimarySpeaker: (startTime: number, endTime: number) => { userId: string; userName: string; duration: number } | null
  }
  onTranscriptionWithSpeaker?: (text: string, startTime?: number, endTime?: number) => void
}

interface TranscriptionResult {
  isActive: boolean
  isLoading: boolean
  error: Error | null
  transcripts: string[]
}

/**
 * Adapter for the legacy Whisper API hook to match the unified interface
 */
function useWhisperAdapter(tracks: MediaStreamTrack[], enabled: boolean) {
  const [transcripts, setTranscripts] = useState<string[]>([])
  const [isLoading, setIsLoading] = useState(false)
  
  // Use the legacy hook
  const legacyService = useTranscriptionService({
    onTranscription: (text, isFinal) => {
      if (text && isFinal) {
        setTranscripts(prev => [...prev, text])
      }
    },
    onError: (error) => {
      console.error('Whisper API error:', error)
    },
    onStatusChange: (status) => {
      setIsLoading(status === 'connecting' || status === 'reconnecting')
    }
  })
  
  // Calculate isActive based on status
  const isActive = legacyService.status === 'connected'
  
  // Start/stop transcription based on tracks and enabled state
  useEffect(() => {
    if (!enabled || tracks.length === 0) {
      legacyService.stopTranscription()
      return
    }
    
    // Use the first audio track
    const audioTrack = tracks[0]
    if (audioTrack && audioTrack.kind === 'audio') {
      legacyService.startTranscription(audioTrack)
    }
    
    return () => {
      legacyService.stopTranscription()
    }
  }, [enabled, tracks, legacyService])
  
  return {
    isActive,
    isLoading,
    error: null, // Legacy hook doesn't expose errors directly
    transcripts
  }
}

/**
 * Factory hook that selects the appropriate transcription service based on the provider.
 * This allows seamless switching between different transcription implementations.
 * 
 * - 'openai' (default): Uses the legacy Whisper API implementation
 * - 'openai-realtime': Uses the new WebRTC-based OpenAI Realtime API
 */
export function useTranscriptionServiceFactory(
  tracks: MediaStreamTrack[] = [],
  options: TranscriptionServiceOptions = { enabled: false, provider: 'openai' }
): TranscriptionResult {
  const { enabled, provider = 'openai', speakerTracker, onTranscriptionWithSpeaker } = options
  
  // Use the adapter for the Whisper API to match the unified interface
  const whisperResult = useWhisperAdapter(tracks, enabled && provider === 'openai')
  
  // The Realtime API hook already matches our interface
  const realtimeResult = useRealtimeTranscriptionService(tracks, {
    enabled: enabled && provider === 'openai-realtime',
    transcriptionProvider: 'openai-realtime',
    onTranscriptionWithSpeaker: onTranscriptionWithSpeaker
  })
  
  // Use useMemo to select the appropriate result based on provider
  return useMemo(() => {
    if (provider === 'openai-realtime') {
      return realtimeResult
    }
    return whisperResult
  }, [provider, whisperResult, realtimeResult])
}
