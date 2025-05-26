import React, { useEffect, useState } from 'react'

interface Transcription {
  id: string
  text: string
  timestamp: number
  speaker?: string
}

interface Props {
  transcriptions: Transcription[]
  enabled: boolean
  maxLines?: number
  autoHideDelay?: number
}

/**
 * Real-time subtitle overlay component
 * Displays recent transcriptions as subtitles over the video area
 */
export const SubtitleOverlay: React.FC<Props> = ({
  transcriptions,
  enabled,
  maxLines = 3,
  autoHideDelay = 8000 // 8 seconds
}) => {
  const [visibleTranscriptions, setVisibleTranscriptions] = useState<Transcription[]>([])

  // Update visible transcriptions when new ones arrive
  useEffect(() => {
    if (!enabled || transcriptions.length === 0) {
      setVisibleTranscriptions([])
      return
    }

    // Get the most recent transcriptions
    const recent = transcriptions.slice(-maxLines)
    setVisibleTranscriptions(recent)

    // Auto-hide after delay
    const timeout = setTimeout(() => {
      setVisibleTranscriptions([])
    }, autoHideDelay)

    return () => clearTimeout(timeout)
  }, [transcriptions, enabled, maxLines, autoHideDelay])

  if (!enabled || visibleTranscriptions.length === 0) {
    return null
  }

  return (
    <div className="absolute bottom-4 left-4 right-4 z-30 pointer-events-none">
      <div className="flex flex-col gap-1 items-center">
        {visibleTranscriptions.map((transcription, index) => (
          <div
            key={transcription.id}
            className={`
              max-w-4xl px-4 py-2 rounded-lg
              bg-black/70 text-white text-center
              transition-opacity duration-300
              ${index === visibleTranscriptions.length - 1 ? 'opacity-100' : 'opacity-75'}
            `}
            style={{
              fontSize: 'clamp(14px, 2.5vw, 18px)',
              lineHeight: '1.4'
            }}
          >
            {transcription.speaker && (
              <span className="text-yellow-300 font-medium mr-2">
                {transcription.speaker}:
              </span>
            )}
            <span>{transcription.text}</span>
          </div>
        ))}
      </div>
    </div>
  )
}