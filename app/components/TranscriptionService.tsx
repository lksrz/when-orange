import { useEffect } from "react";

type Transcription = {
  id: string;
  text: string;
  timestamp: number;
  isFinal: boolean;
  userId?: string;
  speaker?: string;
};

// Helper function to convert AudioBuffer to WAV format
function audioBufferToWav(buffer: AudioBuffer): ArrayBuffer {
  const length = buffer.length;
  const numberOfChannels = buffer.numberOfChannels;
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

  // Convert float samples to 16-bit PCM
  let offset = headerSize;
  for (let i = 0; i < length; i++) {
    for (let channel = 0; channel < numberOfChannels; channel++) {
      const sample = Math.max(-1, Math.min(1, buffer.getChannelData(channel)[i]));
      const intSample = sample < 0 ? sample * 0x8000 : sample * 0x7FFF;
      view.setInt16(offset, intSample, true);
      offset += 2;
    }
  }

  return arrayBuffer;
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

  useEffect(() => {
    if (!isActive || audioTracks.length === 0) return;

    console.log('Starting OpenAI transcription service');
    
    // Use the first audio track (user's microphone)
    const primaryAudioTrack = audioTracks[0];
    const combinedStream = new MediaStream([primaryAudioTrack]);

    let mediaRecorder: MediaRecorder;
    let isRecording = false;
    let recordingInterval: NodeJS.Timeout;

    (async () => {
      try {
        // Get OpenAI token
        const resp = await fetch('/api/transcription-token', { method: 'POST' });
        if (!resp.ok) {
          throw new Error(`Failed to get OpenAI token: ${resp.status}`);
        }
        const { token }: { token: string } = await resp.json();

        // Attempt realtime WebSocket connection
        const prompt = `This is transcription of an online meeting with participants: ${participants.join(', ')}.`;
        let ws: WebSocket | null = null;
        let useRealtime = true;
        try {
          ws = new WebSocket(
            `wss://api.openai.com/v1/realtime?intent=transcription&access_token=${token}`
          );

          ws.addEventListener('open', () => {
            ws?.send(
              JSON.stringify({
                type: 'transcription_session.update',
                input_audio_format: 'pcm16',
                input_audio_transcription: {
                  model: 'gpt-4o-transcribe',
                  prompt,
                  language: 'en',
                },
              })
            );
          });

          ws.addEventListener('message', (event) => {
            try {
              const data = JSON.parse(event.data);
              if (data.text) {
                onTranscription({
                  id: `openai_${Date.now()}_${Math.random()}`,
                  text: data.text,
                  timestamp: Date.now(),
                  isFinal: true,
                  speaker: 'OpenAI',
                });
              }
            } catch (e) {
              console.error('Realtime transcription parse error', e);
            }
          });

          ws.addEventListener('error', () => {
            console.warn('Realtime WebSocket failed, falling back to POST');
            useRealtime = false;
          });
        } catch (err) {
          console.warn('Realtime WebSocket setup failed, falling back to POST');
          useRealtime = false;
        }

        // Create MediaRecorder
        mediaRecorder = new MediaRecorder(combinedStream, {
          mimeType: 'audio/webm;codecs=opus',
        });

        const audioChunks: Blob[] = [];

        mediaRecorder.ondataavailable = (event) => {
          if (event.data.size > 100) {
            audioChunks.push(event.data);
          }
        };

        mediaRecorder.onstop = async () => {
          if (audioChunks.length === 0) {
            restartRecording();
            return;
          }

          try {
            // Create audio blob
            const recordedBlob = new Blob(audioChunks, { type: 'audio/webm;codecs=opus' });
            audioChunks.length = 0;

            // Skip tiny audio files (likely silence)
            if (recordedBlob.size < 5000) {
              restartRecording();
              return;
            }

            // Convert to WAV and check for silence
            const conversionAudioContext = new AudioContext();
            const arrayBuffer = await recordedBlob.arrayBuffer();
            const audioBuffer = await conversionAudioContext.decodeAudioData(arrayBuffer);
            
            // Check for silence using RMS
            const channelData = audioBuffer.getChannelData(0);
            const rms = Math.sqrt(channelData.reduce((sum, sample) => sum + sample * sample, 0) / channelData.length);
            
            // Skip if too quiet (silence)
            if (rms < 0.01) {
              console.log('Skipping silent audio, RMS:', rms.toFixed(4));
              await conversionAudioContext.close();
              restartRecording();
              return;
            }
            
            // Convert to WAV
            const wavBuffer = audioBufferToWav(audioBuffer);
            await conversionAudioContext.close();

            if (useRealtime && ws && ws.readyState === WebSocket.OPEN) {
              // send via realtime websocket
              const base64 = btoa(String.fromCharCode(...new Uint8Array(wavBuffer)));
              ws.send(
                JSON.stringify({
                  type: 'input_audio_buffer.append',
                  audio: base64,
                })
              );
            } else {
              const audioBlob = new Blob([wavBuffer], { type: 'audio/wav' });
              console.log('Sending audio to OpenAI via POST:', audioBlob.size, 'bytes, RMS:', rms.toFixed(4));
              const formData = new FormData();
              formData.append('file', audioBlob, 'audio.wav');
              formData.append('model', 'gpt-4o-transcribe');
              formData.append('language', 'en');
              formData.append('response_format', 'json');
              formData.append('prompt', prompt);

              const transcriptionResp = await fetch('https://api.openai.com/v1/audio/transcriptions', {
                method: 'POST',
                headers: { Authorization: `Bearer ${token}` },
                body: formData,
              });

              if (transcriptionResp.ok) {
                const transcriptionData = (await transcriptionResp.json()) as { text?: string };
                if (transcriptionData.text && transcriptionData.text.trim()) {
                  onTranscription({
                    id: `openai_${Date.now()}_${Math.random()}`,
                    text: transcriptionData.text,
                    timestamp: Date.now(),
                    isFinal: true,
                    speaker: 'OpenAI',
                  });
                }
              } else {
                console.error('OpenAI transcription failed:', transcriptionResp.status);
              }
            }
          } catch (error) {
            console.error('Transcription error:', error);
          }

          restartRecording();
        };

        const restartRecording = () => {
          if (isRecording && mediaRecorder.state === 'inactive') {
            try {
              mediaRecorder.start(1000); // Request data every 1s
            } catch (error) {
              console.error('Error restarting MediaRecorder:', error);
            }
          }
        };

        // Start recording
        isRecording = true;
        mediaRecorder.start(1000);
        
        // Set up interval to create 8-second audio chunks
        recordingInterval = setInterval(() => {
          if (mediaRecorder.state === 'recording') {
            mediaRecorder.stop();
          }
        }, 8000);

      } catch (error) {
        console.error('Error setting up OpenAI transcription:', error);
      }
    })();

    // Cleanup
    return () => {
      isRecording = false;
      if (recordingInterval) {
        clearInterval(recordingInterval);
      }
      if (mediaRecorder && mediaRecorder.state === 'recording') {
        mediaRecorder.stop();
      }
    };
  }, [isActive, audioTracks, onTranscription, participants]);

  return null; // No UI, just a service
};