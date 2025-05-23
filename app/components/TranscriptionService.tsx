import React, { useEffect, useRef, useCallback } from 'react';

// Types for transcription
export type Transcription = {
  id: string;
  text: string;
  timestamp: number;
  isFinal: boolean;
  speaker: string;
};

// Configuration
const REALTIME_API_URL = 'wss://api.openai.com/v1/realtime';
const CHUNK_DURATION_MS = 5000; // 5 seconds for POST API chunks
const MIN_AUDIO_LEVEL = 0.01; // Minimum RMS level to consider as speech
const RECONNECT_DELAY_MS = 2000; // Delay before attempting reconnection

// Helper function to convert AudioBuffer to WAV format
function audioBufferToWav(buffer: AudioBuffer): ArrayBuffer {
  const length = buffer.length;
  const numberOfChannels = 1; // Force mono for transcription
  const sampleRate = buffer.sampleRate;
  const bitsPerSample = 16;
  const bytesPerSample = bitsPerSample / 8;
  const blockAlign = numberOfChannels * bytesPerSample;
  const byteRate = sampleRate * blockAlign;
  const dataSize = length * blockAlign;
  const headerSize = 44;
  const totalSize = headerSize + dataSize;

  const arrayBuffer = new ArrayBuffer(totalSize);
  const view = new DataView(arrayBuffer);

  // WAV header
  const writeString = (offset: number, string: string) => {
    for (let i = 0; i < string.length; i++) {
      view.setUint8(offset + i, string.charCodeAt(i));
    }
  };

  writeString(0, 'RIFF');
  view.setUint32(4, totalSize - 8, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true); // PCM format
  view.setUint16(20, 1, true); // Linear PCM
  view.setUint16(22, numberOfChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);
  writeString(36, 'data');
  view.setUint32(40, dataSize, true);

  // Convert float samples to 16-bit PCM (mono)
  let offset = headerSize;
  const channelData = buffer.getChannelData(0); // Use first channel only
  for (let i = 0; i < length; i++) {
    const sample = Math.max(-1, Math.min(1, channelData[i]));
    const intSample = sample < 0 ? sample * 0x8000 : sample * 0x7FFF;
    view.setInt16(offset, intSample, true);
    offset += 2;
  }

  return arrayBuffer;
}

// Convert PCM16 audio to base64 for real-time API
function pcm16ToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

// Calculate RMS (Root Mean Square) for volume detection
function calculateRMS(audioData: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < audioData.length; i++) {
    sum += audioData[i] * audioData[i];
  }
  return Math.sqrt(sum / audioData.length);
}

type Props = {
  audioTracks: MediaStreamTrack[];
  onTranscription: (t: Transcription) => void;
  isActive: boolean; // Only true for the host
  participants: string[]; // names used for prompting
};

export const TranscriptionService: React.FC<Props> = ({
  audioTracks,
  onTranscription,
  isActive,
  participants,
}) => {
  const realtimeWsRef = useRef<WebSocket | null>(null);
  const fallbackModeRef = useRef<boolean>(false);
  const audioContextRef = useRef<AudioContext | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const tokenRef = useRef<string>('');
  const isConnectingRef = useRef<boolean>(false);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Generate prompt with participant names
  const generatePrompt = useCallback(() => {
    return `This is a transcription of an online meeting with participants: ${participants.join(', ')}. Please transcribe the conversation accurately, including speaker identification when possible.`;
  }, [participants]);

  // Setup real-time WebSocket connection
  const setupRealtimeConnection = useCallback(async (token: string) => {
    if (isConnectingRef.current || realtimeWsRef.current?.readyState === WebSocket.OPEN) {
      return;
    }

    isConnectingRef.current = true;
    
    try {
      console.log('Attempting to connect to OpenAI Realtime API...');
      
      const ws = new WebSocket(`${REALTIME_API_URL}?intent=transcription&authorization=${token}`);
      
      ws.addEventListener('open', () => {
        console.log('Connected to OpenAI Realtime API');
        isConnectingRef.current = false;
        fallbackModeRef.current = false;
        
        // Configure transcription session
        ws.send(JSON.stringify({
          type: 'transcription_session.update',
          input_audio_format: 'pcm16',
          input_audio_transcription: {
            model: 'gpt-4o-transcribe',
            prompt: generatePrompt(),
            language: 'en',
          },
          turn_detection: {
            type: 'server_vad',
            threshold: 0.5,
            prefix_padding_ms: 300,
            silence_duration_ms: 500,
          },
        }));
      });

      ws.addEventListener('message', (event) => {
        try {
          const data = JSON.parse(event.data);
          
          if (data.type === 'input_audio_transcription.completed') {
            const transcript = data.transcript;
            if (transcript && transcript.trim()) {
              onTranscription({
                id: `realtime_${Date.now()}_${Math.random()}`,
                text: transcript,
                timestamp: Date.now(),
                isFinal: true,
                speaker: 'OpenAI Realtime',
              });
            }
          } else if (data.type === 'error') {
            console.error('Realtime API error:', data.error);
            // If we get an error, switch to fallback mode
            fallbackModeRef.current = true;
            ws.close();
          }
        } catch (e) {
          console.error('Error parsing realtime message:', e);
        }
      });

      ws.addEventListener('error', (error) => {
        console.error('Realtime WebSocket error:', error);
        isConnectingRef.current = false;
        fallbackModeRef.current = true;
      });

      ws.addEventListener('close', () => {
        console.log('Realtime WebSocket closed');
        isConnectingRef.current = false;
        realtimeWsRef.current = null;
        
        // If not in fallback mode, try to reconnect
        if (!fallbackModeRef.current) {
          reconnectTimeoutRef.current = setTimeout(() => {
            setupRealtimeConnection(token);
          }, RECONNECT_DELAY_MS);
        }
      });

      realtimeWsRef.current = ws;
    } catch (error) {
      console.error('Failed to setup realtime connection:', error);
      isConnectingRef.current = false;
      fallbackModeRef.current = true;
    }
  }, [generatePrompt, onTranscription]);

  // Send audio chunk via POST API (fallback)
  const sendAudioChunkViaPost = useCallback(async (audioBlob: Blob, token: string) => {
    try {
      const formData = new FormData();
      formData.append('file', audioBlob, 'audio.wav');
      formData.append('model', 'gpt-4o-transcribe');
      formData.append('language', 'en');
      formData.append('response_format', 'json');
      formData.append('prompt', generatePrompt());

      const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
        method: 'POST',
        headers: { 
          'Authorization': `Bearer ${token}`,
        },
        body: formData,
      });

      if (response.ok) {
        const data = await response.json() as { text?: string };
        if (data.text && data.text.trim()) {
          onTranscription({
            id: `post_${Date.now()}_${Math.random()}`,
            text: data.text,
            timestamp: Date.now(),
            isFinal: true,
            speaker: 'OpenAI',
          });
        }
      } else {
        console.error('POST transcription failed:', response.status);
      }
    } catch (error) {
      console.error('Error sending audio chunk via POST:', error);
    }
  }, [generatePrompt, onTranscription]);

  // Setup audio processing
  const setupAudioProcessing = useCallback((stream: MediaStream, token: string) => {
    // Clean up existing audio context
    if (audioContextRef.current) {
      audioContextRef.current.close();
    }

    const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
    audioContextRef.current = audioContext;
    
    const source = audioContext.createMediaStreamSource(stream);
    const processor = audioContext.createScriptProcessor(4096, 1, 1);
    processorRef.current = processor;

    let audioBuffer: Float32Array[] = [];
    let lastSendTime = Date.now();

    processor.onaudioprocess = (e) => {
      const inputData = e.inputBuffer.getChannelData(0);
      audioBuffer.push(new Float32Array(inputData));

      const currentTime = Date.now();
      const shouldSendChunk = currentTime - lastSendTime >= CHUNK_DURATION_MS;

      if (shouldSendChunk && audioBuffer.length > 0) {
        // Combine audio buffers
        const totalLength = audioBuffer.reduce((acc, buf) => acc + buf.length, 0);
        const combinedBuffer = new Float32Array(totalLength);
        let offset = 0;
        for (const buf of audioBuffer) {
          combinedBuffer.set(buf, offset);
          offset += buf.length;
        }

        // Calculate RMS to check if there's actual audio
        const rms = calculateRMS(combinedBuffer);
        
        if (rms > MIN_AUDIO_LEVEL) {
          // Create audio buffer for conversion
          const audioBufferObj = audioContext.createBuffer(1, combinedBuffer.length, audioContext.sampleRate);
          audioBufferObj.copyToChannel(combinedBuffer, 0);

          if (!fallbackModeRef.current && realtimeWsRef.current?.readyState === WebSocket.OPEN) {
            // Send via real-time API
            const wavBuffer = audioBufferToWav(audioBufferObj);
            // Extract PCM data (skip WAV header)
            const pcmData = new Uint8Array(wavBuffer, 44);
            const base64Audio = pcm16ToBase64(pcmData.buffer);
            
            realtimeWsRef.current.send(JSON.stringify({
              type: 'input_audio_buffer.append',
              audio: base64Audio,
            }));
          } else {
            // Use POST API fallback
            const wavBuffer = audioBufferToWav(audioBufferObj);
            const audioBlob = new Blob([wavBuffer], { type: 'audio/wav' });
            sendAudioChunkViaPost(audioBlob, token);
          }
        }

        // Reset buffer and timer
        audioBuffer = [];
        lastSendTime = currentTime;
      }
    };

    source.connect(processor);
    processor.connect(audioContext.destination);
  }, [sendAudioChunkViaPost]);

  useEffect(() => {
    if (!isActive || audioTracks.length === 0) return;

    console.log('Starting OpenAI transcription service');
    
    let mediaRecorder: MediaRecorder | null = null;
    let isCleanedUp = false;

    (async () => {
      try {
        // Get OpenAI token
        const resp = await fetch('/api/transcription-token', { method: 'POST' });
        if (!resp.ok) {
          throw new Error(`Failed to get OpenAI token: ${resp.status}`);
        }
        const { token }: { token: string } = await resp.json();
        tokenRef.current = token;

        if (isCleanedUp) return;

        // Try to establish real-time connection first
        await setupRealtimeConnection(token);

        // Setup audio processing
        const primaryAudioTrack = audioTracks[0];
        const combinedStream = new MediaStream([primaryAudioTrack]);
        setupAudioProcessing(combinedStream, token);

        // Alternative: Use MediaRecorder for chunked recording (backup method)
        if (fallbackModeRef.current) {
          mediaRecorder = new MediaRecorder(combinedStream, {
            mimeType: 'audio/webm;codecs=opus'
          });

          const audioChunks: Blob[] = [];

          mediaRecorder.ondataavailable = (event) => {
            if (event.data.size > 0) {
              audioChunks.push(event.data);
            }
          };

          mediaRecorder.onstop = async () => {
            if (audioChunks.length === 0 || isCleanedUp) return;
            
            // Process and send the recorded chunk
            const audioBlob = new Blob(audioChunks, { type: 'audio/webm' });
            
            // Convert WebM to WAV for OpenAI API
            const arrayBuffer = await audioBlob.arrayBuffer();
            const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
            const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
            const wavBuffer = audioBufferToWav(audioBuffer);
            const wavBlob = new Blob([wavBuffer], { type: 'audio/wav' });
            
            await sendAudioChunkViaPost(wavBlob, token);
            audioContext.close();
          };

          // Start recording in chunks
          const recordingInterval = setInterval(() => {
            if (mediaRecorder?.state === 'recording') {
              mediaRecorder.stop();
              audioChunks.length = 0;
              setTimeout(() => {
                if (!isCleanedUp && mediaRecorder?.state === 'inactive') {
                  mediaRecorder.start();
                }
              }, 100);
            }
          }, CHUNK_DURATION_MS);

          mediaRecorder.start();
          
          return () => {
            clearInterval(recordingInterval);
          };
        }
      } catch (error) {
        console.error('TranscriptionService error:', error);
      }
    })();

    // Cleanup function
    return () => {
      isCleanedUp = true;
      
      // Close WebSocket
      if (realtimeWsRef.current) {
        realtimeWsRef.current.close();
        realtimeWsRef.current = null;
      }

      // Clear reconnect timeout
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = null;
      }

      // Stop MediaRecorder
      if (mediaRecorder && mediaRecorder.state !== 'inactive') {
        mediaRecorder.stop();
      }

      // Close audio context
      if (audioContextRef.current) {
        audioContextRef.current.close();
        audioContextRef.current = null;
      }

      // Disconnect processor
      if (processorRef.current) {
        processorRef.current.disconnect();
        processorRef.current = null;
      }
    };
  }, [isActive, audioTracks, participants, setupRealtimeConnection, setupAudioProcessing, sendAudioChunkViaPost]);

  return null; // No UI, just a service
};