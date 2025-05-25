# Transcription Services in When Orange

This document outlines the transcription services implemented in the When Orange application, including the recent migration to the OpenAI Realtime API.

## Overview

When Orange supports real-time transcription using two main providers:

1. **OpenAI Whisper API** (Legacy): Batch-based transcription with higher latency but good accuracy
2. **OpenAI Realtime API** (New): WebRTC-based transcription with lower latency

## Architecture

The transcription system is structured with the following components:

### Server-Side Components

- `TranscriptionService.server.ts`: Durable Object that handles transcription requests
  - Supports both legacy Whisper API and new Realtime API token generation
  - Manages authentication and rate limiting
  - Supports path-based routing to differentiate between API types

### API Endpoints

The application provides several endpoints for transcription services:

- **Standard Token Endpoint**: `POST /api/transcription-token`
  - Returns a standard authentication token for the Whisper API
  - Used by the legacy transcription service

- **Realtime Token Endpoints**:
  - Path-based: `POST /api/transcription-token/realtime`
  - Query-based: `POST /api/transcription-token?type=realtime`
  - Both return ephemeral tokens for the OpenAI Realtime API with WebRTC
  - The dual implementation ensures compatibility with different client configurations

- **Test Endpoint**: `GET /api/transcription-test`
  - Interactive testing interface for both transcription providers
  - Allows toggling between Whisper and Realtime APIs
  - Displays real-time transcription results

### Client-Side Components

- **Factory Pattern**: `useTranscriptionServiceFactory.ts` selects the appropriate transcription service based on configuration
  - Abstracts away implementation details from components that use transcription
  - Allows seamless switching between providers

- **Legacy Implementation**: `useTranscriptionService.ts` connects to the Whisper API
  - Uses WebSockets for communication
  - Processes audio in chunks and sends to the API

- **Realtime Implementation**: `useRealtimeTranscriptionService.ts` connects to the OpenAI Realtime API
  - Uses WebRTC for direct connection to OpenAI's servers
  - Provides lower-latency transcription with continuous streaming

- **UI Components**: `TranscriptionServiceWrapper.tsx` wraps the transcription logic
  - Handles forwarding of transcription results to UI components
  - Manages audio tracks and service lifecycle

## Configuration

Transcription services can be configured through environment variables and feature flags:

### Environment Variables

- `OPENAI_API_TOKEN`: Required for both Whisper and Realtime APIs
- `TRANSCRIPTION_PROVIDER`: Set to 'openai' for Whisper API or 'openai-realtime' for Realtime API
- `TRANSCRIPTION_ENABLED`: Set to 'true' to enable transcription services

### Feature Flags

Feature flags in `app/config/featureFlags.ts` allow toggling between providers:

```typescript
export const featureFlags = {
  /**
   * Set to true to use the new OpenAI Realtime API for transcription.
   * When false, the legacy Whisper API will be used.
   */
  useRealtimeTranscription: true,
}
```

## Testing

A dedicated test page is available at `/api/transcription-test` for comparing both transcription implementations. This page allows:

1. Toggling between Whisper and Realtime APIs
2. Testing microphone input
3. Viewing transcription results in real-time

## Migration Guide

### Migration Steps

1. **Enable the Feature Flag**:
   - In `app/config/featureFlags.ts`, set `useRealtimeTranscription` to `true`
   - This switches the application to use the OpenAI Realtime API instead of the Whisper API

2. **Test Compatibility**:
   - Use the `/api/transcription-test` page to verify functionality
   - Test on different browsers and devices to ensure WebRTC compatibility
   - Check console logs for any WebRTC-related errors

3. **Monitor Performance**:
   - The Realtime API offers significantly lower latency compared to Whisper
   - Quality and accuracy characteristics may differ between APIs
   - Use logging to track transcription quality and success rates

4. **Gradual Rollout** (Recommended):
   - Consider implementing a user-specific or percentage-based rollout
   - Allow some users to continue using the legacy Whisper API during transition
   - Gather feedback on transcription quality before full migration

### Important Considerations

1. **Latency Improvements**: The Realtime API offers 300-500ms latency vs 2-3 seconds for Whisper

2. **Cost Considerations**: Review OpenAI's pricing for both APIs as they may differ
   - Realtime API is typically billed by time rather than by audio file size
   - Whisper API is billed by the minute of audio processed

3. **Browser Compatibility**: 
   - WebRTC is required for the Realtime API
   - Supported in Chrome 49+, Firefox 52+, Safari 11+, Edge 12+
   - Not supported in IE or some older mobile browsers

4. **Error Handling**: 
   - Implement robust error handling for both APIs
   - Realtime API can fail during the WebRTC setup process
   - Consider implementing automatic fallback to Whisper API when WebRTC fails

## Troubleshooting

### Common Issues

#### Authentication Issues

- **Token Request Failures**:
  - Check that `OPENAI_API_TOKEN` is properly set in environment variables
  - Verify token has appropriate permissions for both APIs
  - Check network connectivity to OpenAI servers

- **401/403 Errors**:
  - Token may have expired or been revoked
  - API key usage limits may have been reached
  - Check OpenAI dashboard for API key status

#### Transcription Issues

- **Microphone Access**:
  - Ensure the browser has permission to access the microphone
  - Some browsers require HTTPS for microphone access
  - Check browser console for permission-related errors

- **WebRTC Connection Failures**:
  - Check network connectivity and firewall settings
  - Corporate networks may block WebRTC traffic
  - Try connecting through a different network

- **Audio Quality Issues**:
  - Use a sample rate of at least 16kHz for best results
  - Reduce background noise for better accuracy
  - Maintain consistent speaking volume

### Debugging

1. **Enable Verbose Logging**:
   - Set `DEBUG=true` in the environment to enable detailed logging
   - Check browser console and server logs for errors

2. **Test Individual Components**:
   - Use the test script (`test-transcription-api.sh`) to verify API endpoints
   - Use `/api/transcription-test` to test end-to-end functionality

3. **Browser Compatibility**:
   - Test in multiple browsers if experiencing issues
   - Use browser developer tools to check for WebRTC support

4. **Network Analysis**:
   - Use browser network inspector to check API requests
   - Verify that WebRTC traffic is not being blocked

## Future Improvements

Planned enhancements for the transcription system:

1. Speaker diarization (identifying who is speaking)
2. Improved error recovery and reconnection logic
3. Fallback mechanisms between providers for reliability
4. Performance optimizations for mobile devices
