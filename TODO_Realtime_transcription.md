# Implementation Plan: Real-time Transcription for Meeting App

## Overview

This plan outlines how to add real-time transcription to our meeting application, where the meeting organizer/first participant acts as the transcription host to avoid centralizing voice transmission through our servers. The system will leverage OpenAI's real-time transcription API via WebRTC to process the audio locally on the organizer's client.

## Architecture

1. **Transcription Host Designation**:
   - The first participant to join (or meeting organizer) becomes the "transcription host"
   - This client will receive all audio streams (which it already does in the current implementation)
   - The audio processing for transcription happens entirely on this client

2. **Data Flow**:
   - Audio streams flow from participants → SFU → Transcription host (via existing WebRTC connections)
   - Transcription host processes audio and sends to OpenAI via WebSocket
   - Transcription results stored on host client
   - (Future enhancement) Results can be shared with other participants

## Implementation Tasks

### Phase 1: Basic Infrastructure

1. **Create a Transcription Service Component**
   - Create `components/TranscriptionService.tsx`
   - Integrate with existing `AudioStream` component
   - Add logic to determine transcription host (first joiner/organizer)
   - Add UI toggle controls for transcription

2. **Audio Processing**
   - Implement audio track collection and optional mixing
   - Set up AudioContext and audio worklet for processing
   - Handle multiple speaker streams

3. **OpenAI WebSocket Connection**
   - Implement WebSocket connection to OpenAI's transcription endpoint
   - Add authentication management (secure token handling)
   - Set up audio data streaming format as per OpenAI requirements
   - Handle reconnection logic for dropped connections

4. **Transcription Storage**
   - Implement local storage of transcription results
   - Add timestamp alignment with meeting time

### Phase 2: UX and Enhancements

1. **Transcription Display UI**
   - Create a collapsible panel to show transcriptions
   - Add speaker identification if available
   - Implement search functionality in transcription
   - Add export functionality (text, SRT, etc.)

2. **Host Failover**
   - Implement logic to transfer host duties if the transcription host leaves
   - Add graceful reconnection and transcription continuation

3. **UI Indicators**
   - Add visual indicators that transcription is active
   - Show transcription status to all participants

### Phase 3: Advanced Features

1. **Server Integration**
   - Add API endpoints to store transcriptions on the server
   - Implement authentication and authorization for transcription access

2. **Participant Sharing**
   - Add functionality to share transcription with other participants in real-time
   - Implement differentiated access controls

3. **Post-Processing**
   - Add summarization features using LLMs
   - Implement meeting highlights extraction
   - Add action items identification

## Technical Implementation Details

### Audio Stream Collection

```tsx
// In TranscriptionService.tsx
const mediaStreamsRef = useRef<Map<string, MediaStreamTrack>>(new Map());

const handleTrackAdded = (id: string, track: MediaStreamTrack) => {
  if (track.kind === 'audio') {
    mediaStreamsRef.current.set(id, track);
    // Connect to audio processor if already running
    if (isTranscribing && audioContextRef.current) {
      connectTrackToProcessor(id, track);
    }
  }
};
```

### OpenAI WebSocket Implementation

```tsx
// In TranscriptionService.tsx
const setupOpenAIConnection = async () => {
  // Fetch a short-lived token from our backend to authorize OpenAI API usage
  const response = await fetch('/api/transcription-token');
  const { token } = await response.json();
  
  // Connect to OpenAI's streaming transcription API
  const socket = new WebSocket('wss://api.openai.com/v1/audio/transcriptions');
  
  socket.onopen = () => {
    socket.send(JSON.stringify({
      model: "whisper-1",
      language: "en",
      response_format: "json",
      temperature: 0,
      // Additional configurations
    }));
  };
  
  socket.onmessage = (event) => {
    const data = JSON.parse(event.data);
    if (data.text) {
      // Handle the transcription text
      setTranscriptions(prev => [...prev, {
        text: data.text,
        timestamp: Date.now(),
        speaker: data.speaker || 'Unknown'
      }]);
    }
  };
  
  socketRef.current = socket;
};
```

### Audio Processing

```tsx
// In TranscriptionService.tsx
const setupAudioProcessing = async () => {
  const audioContext = new AudioContext();
  audioContextRef.current = audioContext;
  
  // Create a single destination for all audio
  const destinationNode = audioContext.createMediaStreamDestination();
  
  // Optional: Add noise suppression
  await audioContext.audioWorklet.addModule('/noise/noise-suppressor-worklet.esm.js');
  
  // Connect all tracks to the processor
  for (const [id, track] of mediaStreamsRef.current.entries()) {
    connectTrackToProcessor(id, track);
  }
  
  // Create processor to format audio for OpenAI
  const workletModule = `
    class OpenAIAudioProcessor extends AudioWorkletProcessor {
      process(inputs, outputs) {
        // Format audio data for OpenAI
        // Send via the socket connection
        // ...
        return true;
      }
    }
    registerProcessor('openai-processor', OpenAIAudioProcessor);
  `;
  
  const blob = new Blob([workletModule], { type: 'text/javascript' });
  const workletUrl = URL.createObjectURL(blob);
  
  await audioContext.audioWorklet.addModule(workletUrl);
  const processorNode = new AudioWorkletNode(audioContext, 'openai-processor');
  
  // Connect processor to destination
  processorNode.connect(destinationNode);
  
  // Store references
  audioProcessorRef.current = processorNode;
};
```

## Integration with Existing Code

### Host Determination

```tsx
// In Room.tsx
const isTranscriptionHost = useMemo(() => {
  // First person to join becomes host
  const sortedUsers = [...room.roomState.users].sort((a, b) => 
    new Date(a.joinedAt).getTime() - new Date(b.joinedAt).getTime()
  );
  
  return sortedUsers[0]?.id === identity?.id;
}, [room.roomState.users, identity]);

// Then pass to TranscriptionService
<TranscriptionService isHost={isTranscriptionHost} />
```

### UI Integration

```tsx
// In Layout.tsx
const [showTranscription, setShowTranscription] = useState(false);

// Add to toolbar
<button 
  onClick={() => setShowTranscription(prev => !prev)}
  className={`toolbar-button ${showTranscription ? 'active' : ''}`}
>
  <Icon type="transcription" />
  <span>Transcription</span>
</button>

// Add panel
{showTranscription && (
  <TranscriptionPanel 
    transcriptions={transcriptions}
    isHost={isTranscriptionHost}
  />
)}
```

## Technical Considerations

1. **Browser Compatibility**:
   - Ensure compatibility with major browsers
   - Test with different AudioContext implementations

2. **Performance**:
   - Monitor CPU/memory usage on host client
   - Optimize audio processing for lower-end devices
   - Consider quality vs performance tradeoffs

3. **Security**:
   - Implement token-based OpenAI API authentication
   - Never expose API keys in client-side code
   - Use short-lived tokens generated by backend

4. **Privacy**:
   - Add clear indication when transcription is active
   - Allow participants to opt out of transcription
   - Consider data retention policies

5. **Network Resilience**:
   - Handle WebSocket reconnections
   - Implement backoff strategy for API rate limits
   - Cache transcription data to prevent loss on reconnection

## Testing Strategy

1. **Unit Tests**:
   - Test component rendering
   - Test host determination logic
   - Test transcription data structures

2. **Integration Tests**:
   - Test WebSocket connection to OpenAI
   - Test audio stream processing
   - Test UI interactions

3. **Load/Performance Tests**:
   - Measure performance with increasing number of participants
   - Test with different audio quality settings
   - Benchmark CPU/memory usage

4. **User Testing**:
   - Test with different accents and languages
   - Validate transcription accuracy
   - Collect feedback on UI/UX

## Success Metrics

1. Transcription accuracy rate (>85%)
2. Host client stability (no crashes up to 10 participants)
3. Latency between speech and transcription (<2s)
4. User satisfaction rating (>4/5)

## Future Enhancements

1. Server-side transcription storage
2. Multi-language support
3. Transcription search and indexing
4. Meeting insights and analytics
5. Integration with calendar apps for meeting minutes

## Timeline Estimate

- Phase 1: 2-3 weeks
- Phase 2: 2 weeks
- Phase 3: 3-4 weeks

Total: 7-9 weeks for full implementation 