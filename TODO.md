# Transcription & Speaker Detection TODO

## ✅ Completed
- [x] OpenAI Realtime API integration
- [x] Single transcription host system
- [x] Host failover when user leaves
- [x] Visual host indicators
- [x] Basic speaker tracking infrastructure
- [x] Transcription timing correlation framework

## 🚧 In Progress

### 1. **Speaker Detection for Transcriptions**
**Status**: Implemented but debugging needed

**Progress**:
- ✅ Speaker tracker infrastructure created
- ✅ Self speaking detection working
- ✅ Debug logging added
- ❌ Remote user speaking detection still placeholder
- ❌ Speaker correlation returning `undefined`

**Next Steps**:
- Debug why `speakerTracker.getPrimarySpeaker()` returns null
- Implement actual `useIsSpeaking` hooks for remote users
- Verify timing correlation logic

### 2. **Enhanced Timing Correlation**
**Status**: Improved, using OpenAI timing data

**Progress**:
- ✅ Now uses actual speech start/end times from OpenAI events
- ✅ Falls back to 3-second window if no timing data
- ✅ Better logging for debugging timing issues

**Current Issue**: Need to verify timing data is being passed correctly

## 🔄 Next Priority Tasks

### 3. **Real-time Subtitles Display**
**Status**: ✅ **COMPLETED**

**Progress**:
- ✅ Created `SubtitleOverlay` component
- ✅ Positioned over video area with proper z-index
- ✅ Shows last 3 lines of transcription
- ✅ Auto-hides after 8 seconds
- ✅ Responsive text sizing with `clamp()`
- ✅ Semi-transparent background for readability
- ✅ Toggle button to show/hide subtitles
- ✅ Integrated with room component

**Features**:
- Shows speaker names in different color
- Stacked display with newest at bottom
- Pointer-events disabled (doesn't block video interaction)
- Smooth opacity transitions

### 4. **Multi-language Translation**
**Status**: Not started

**Requirements**:
- Detect browser language for each user
- Translate transcriptions to user's preferred language
- Show original language if same as detected language
- Handle real-time translation with minimal delay

**Implementation Plan**:
- Integrate translation API (Google Translate, DeepL, or OpenAI)
- Detect user's browser language (`navigator.language`)
- Add language preference setting
- Create translation service hook
- Cache translations to avoid re-translating same text

### 5. **Language Detection & Optimization**
**Status**: Not started

**Requirements**:
- Detect conversation language after first few transcriptions
- Pass detected language to OpenAI for better accuracy
- Handle multilingual conversations
- Store language preference per room

**Implementation Plan**:
- Language detection service (first 3-5 transcriptions)
- Update OpenAI Realtime API session with detected language
- Add language setting to room state
- Handle language switching mid-conversation

## 🏗️ Architecture Improvements

### 6. **Transcription Broadcasting**
**Status**: Deferred (single host working for now)

**Future**: Share transcriptions between all users instead of single host system
- Add transcription messages to room WebSocket
- Sync transcription state across users
- Handle conflicts and ordering

### 7. **Transcription Persistence**
**Status**: Not started

**Future**: Save transcriptions to database
- Store transcriptions per room
- Include speaker identification
- Allow transcript export
- Meeting summary generation

### 8. **Advanced Speaker Features**
**Status**: Ideas for future

**Possible Features**:
- Speaker identification with voice recognition
- Custom speaker names/labels
- Speaker avatars in transcriptions
- Speaking time analytics

## 🐛 Current Bugs to Fix

1. **Speaker Detection Returns `undefined`**
   - `speakerTracker.getPrimarySpeaker()` returns null
   - Need to verify speaker tracking is working
   - Check timing correlation logic

2. **Remote User Speaking Detection Missing**
   - Currently placeholder implementation
   - Need actual `useIsSpeaking` integration for remote audio tracks

3. **Timing Accuracy**
   - 2-second estimation window too crude
   - Use actual OpenAI speech timing events
   - Better correlation with local audio monitoring

## 📋 Implementation Order

**Phase 1**: Fix Current Issues
1. Fix speaker detection (return actual speakers, not undefined)
2. Implement remote user speaking detection
3. Improve timing correlation

**Phase 2**: User-Facing Features  
1. Real-time subtitle display
2. Browser language detection
3. Basic translation integration

**Phase 3**: Advanced Features
1. Automatic language detection
2. Language optimization for OpenAI
3. Advanced subtitle styling and positioning

**Phase 4**: Polish & Performance
1. Translation caching
2. Performance optimizations
3. Error handling improvements
4. Mobile UI improvements

## 🔧 Technical Notes

**Remote User Speaking Detection Strategy**:
```typescript
// Need to create individual hooks for each remote user
otherUsers.forEach(user => {
  const audioTrack = pulledAudioTracks[user.tracks.audio]
  const isSpeaking = useIsSpeaking(audioTrack) // This needs to work
  speakerTracker.updateSpeakerStatus(user.id, user.name, isSpeaking)
})
```

**Translation API Options**:
- OpenAI GPT-4 (already have API key, good quality)
- Google Translate API (fast, supports many languages)
- DeepL API (high quality, limited languages)
- Browser built-in translation (free, varies by browser)

**Subtitle Positioning Strategy**:
- Overlay on video container
- Bottom 20% of video area
- Semi-transparent background
- Respect safe zones on mobile