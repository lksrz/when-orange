import type { LoaderFunctionArgs } from '@remix-run/cloudflare'
import { json } from '@remix-run/cloudflare'
import { useLoaderData } from '@remix-run/react'
import { useState, useRef, useEffect } from 'react'
import type { Transcription } from '~/components/TranscriptionService'
import { TranscriptionServiceWrapper } from '~/components/TranscriptionServiceWrapper'
import { featureFlags } from '~/config/featureFlags'

/**
 * Test page for the OpenAI Realtime API integration
 */
export const loader = async ({ context }: LoaderFunctionArgs) => {
  return json({
    transcriptionProvider: context.env.TRANSCRIPTION_PROVIDER || 'openai',
    hasOpenAiTranscription: Boolean(context.env.OPENAI_API_TOKEN),
    transcriptionEnabled: context.env.TRANSCRIPTION_ENABLED === 'true',
  })
}

export default function TranscriptionTest() {
  const { 
    transcriptionProvider,
    hasOpenAiTranscription,
    transcriptionEnabled 
  } = useLoaderData<typeof loader>()
  
  const [useRealtime, setUseRealtime] = useState(featureFlags.useRealtimeTranscription)
  const [audioStream, setAudioStream] = useState<MediaStream | null>(null)
  const [transcripts, setTranscripts] = useState<Transcription[]>([])
  const [isRecording, setIsRecording] = useState(false)
  const [error, setError] = useState<string | null>(null)
  
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  
  // Toggle between Whisper and Realtime API
  const toggleRealtimeApi = () => {
    setUseRealtime(prev => !prev)
    // Clear transcripts when switching providers
    setTranscripts([])
  }
  
  // Start recording audio
  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      setAudioStream(stream)
      setIsRecording(true)
      
      // Create a new dummy transcript to show recording has started
      const startTranscript: Transcription = {
        id: `start_${Date.now()}`,
        text: 'Recording started. Transcription will appear here...',
        timestamp: Date.now(),
        isFinal: true,
        speaker: 'System'
      }
      setTranscripts([startTranscript])
      
      const mediaRecorder = new MediaRecorder(stream)
      mediaRecorderRef.current = mediaRecorder
      
      mediaRecorder.start()
      
    } catch (err) {
      console.error('Error starting recording:', err)
      setError(`Failed to start recording: ${err instanceof Error ? err.message : String(err)}`)
    }
  }
  
  // Stop recording audio
  const stopRecording = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop()
    }
    
    if (audioStream) {
      audioStream.getTracks().forEach(track => track.stop())
      setAudioStream(null)
    }
    
    setIsRecording(false)
    // Add a transcript to indicate recording stopped
    const stopTranscript: Transcription = {
      id: `stop_${Date.now()}`,
      text: '[Recording stopped]',
      timestamp: Date.now(),
      isFinal: true,
      speaker: 'System'
    }
    setTranscripts(prev => [...prev, stopTranscript])
  }
  
  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
        mediaRecorderRef.current.stop()
      }
      
      if (audioStream) {
        audioStream.getTracks().forEach(track => track.stop())
      }
    }
  }, [audioStream])
  
  if (!transcriptionEnabled) {
    return (
      <div className="p-8">
        <h1 className="text-2xl font-bold mb-4">Transcription Test</h1>
        <div className="bg-red-100 p-4 rounded">
          <p className="text-red-700">Transcription is not enabled. Enable it in your environment settings.</p>
        </div>
      </div>
    )
  }
  
  if (!hasOpenAiTranscription) {
    return (
      <div className="p-8">
        <h1 className="text-2xl font-bold mb-4">Transcription Test</h1>
        <div className="bg-red-100 p-4 rounded">
          <p className="text-red-700">OpenAI API token not configured. Set the OPENAI_API_TOKEN environment variable.</p>
        </div>
      </div>
    )
  }
  
  return (
    <div className="p-8">
      <h1 className="text-2xl font-bold mb-4">Transcription Test</h1>
      
      <div className="mb-6 bg-gray-100 p-4 rounded">
        <h2 className="text-xl mb-2">Environment Configuration</h2>
        <p><strong>Transcription Provider:</strong> {transcriptionProvider}</p>
        <p><strong>OpenAI API Available:</strong> {hasOpenAiTranscription ? 'Yes' : 'No'}</p>
        <p><strong>Transcription Enabled:</strong> {transcriptionEnabled ? 'Yes' : 'No'}</p>
      </div>
      
      <div className="mb-6">
        <h2 className="text-xl mb-2">API Selection</h2>
        <div className="flex items-center">
          <label className="inline-flex items-center mr-4">
            <input
              type="radio"
              checked={!useRealtime}
              onChange={() => toggleRealtimeApi()}
              className="form-radio h-5 w-5 text-blue-600"
            />
            <span className="ml-2">OpenAI Whisper API (Legacy)</span>
          </label>
          <label className="inline-flex items-center">
            <input
              type="radio"
              checked={useRealtime}
              onChange={() => toggleRealtimeApi()}
              className="form-radio h-5 w-5 text-blue-600"
            />
            <span className="ml-2">OpenAI Realtime API</span>
          </label>
        </div>
        <p className="mt-2 text-sm text-gray-600">
          Currently using: <strong>{useRealtime ? 'OpenAI Realtime API' : 'OpenAI Whisper API'}</strong>
        </p>
      </div>
      
      <div className="mb-6">
        <h2 className="text-xl mb-2">Recording Controls</h2>
        <div className="flex gap-4">
          <button
            onClick={startRecording}
            disabled={isRecording}
            className={`px-4 py-2 rounded ${
              isRecording 
                ? 'bg-gray-300 cursor-not-allowed' 
                : 'bg-blue-500 hover:bg-blue-600 text-white'
            }`}
          >
            Start Recording
          </button>
          <button
            onClick={stopRecording}
            disabled={!isRecording}
            className={`px-4 py-2 rounded ${
              !isRecording 
                ? 'bg-gray-300 cursor-not-allowed' 
                : 'bg-red-500 hover:bg-red-600 text-white'
            }`}
          >
            Stop Recording
          </button>
        </div>
        {error && (
          <div className="mt-4 p-3 bg-red-100 text-red-700 rounded">
            {error}
          </div>
        )}
      </div>
      
      <div>
        <h2 className="text-xl mb-2">Transcript</h2>
        <div className="bg-gray-100 p-4 rounded h-64 overflow-auto">
          {transcripts.length > 0 ? (
            <div className="space-y-2">
              {transcripts.map((t) => (
                <div key={t.id} className="p-2 bg-white rounded shadow">
                  <div className="text-sm text-gray-500">
                    {new Date(t.timestamp).toLocaleTimeString()} - {t.speaker}
                  </div>
                  <div className="mt-1">{t.text}</div>
                </div>
              ))}
            </div>
          ) : (
            'No transcript available. Start recording to generate a transcript.'
          )}
        </div>
      </div>
      
      {/* Invisible transcription service that processes audio when recording */}
      {isRecording && audioStream && (
        <TranscriptionServiceWrapper
          audioTracks={audioStream.getAudioTracks()}
          isActive={isRecording}
          participants={['You']}
          onTranscription={(t) => setTranscripts(prev => [...prev, t])}
          provider={useRealtime ? 'openai-realtime' : 'openai'}
        />
      )}
    </div>
  )
}
