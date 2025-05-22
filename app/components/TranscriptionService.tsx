import React, { useEffect, useRef, useState } from "react";

type Transcription = {
  id: string;
  text: string;
  timestamp: number;
  isFinal: boolean;
  userId?: string;
  speaker?: string;
};

type Props = {
  audioTracks: MediaStreamTrack[];
  onTranscription: (t: Transcription) => void;
  isActive: boolean; // Only true for the host
};

export const TranscriptionService: React.FC<Props> = ({
  audioTracks,
  onTranscription,
  isActive,
}) => {
  const audioContextRef = useRef<AudioContext | null>(null);
  const socketRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    if (!isActive) return;

    // 1. Setup AudioContext and connect tracks
    const audioContext = new AudioContext();
    audioContextRef.current = audioContext;
    const destination = audioContext.createMediaStreamDestination();

    audioTracks.forEach((track) => {
      const stream = new MediaStream([track]);
      const source = audioContext.createMediaStreamSource(stream);
      source.connect(destination);
    });

    // 2. Fetch OpenAI token and connect WebSocket
    let ws: WebSocket;
    (async () => {
      const resp = await fetch("/api/transcription-token");
      const { token }: { token: string } = await resp.json();
      ws = new WebSocket("wss://api.openai.com/v1/audio/transcriptions");
      socketRef.current = ws;

      ws.onopen = () => {
        ws.send(
          JSON.stringify({
            model: "whisper-1",
            language: "en",
            response_format: "json",
            temperature: 0,
            // ...other config
            token,
          })
        );
        // TODO: Start sending audio data here
      };

      ws.onmessage = (event) => {
        const data = JSON.parse(event.data);
        if (data.text) {
          onTranscription({
            id: `transcription_${Date.now()}_${Math.random()}`,
            text: data.text,
            timestamp: Date.now(),
            isFinal: true,
            speaker: data.speaker || "Unknown",
          });
        }
      };
    })();

    // 3. Cleanup
    return () => {
      audioContext.close();
      ws?.close();
    };
  }, [isActive, audioTracks, onTranscription]);

  return null; // No UI, just a service
};
