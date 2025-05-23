# Screen Share E2EE Fix

## Problem Description

Users were experiencing MLS (Message Layer Security) ratchet errors during screen sharing:

- "Frame decryption failed: Cannot create decryption secrets from own sender ratchet or encryption secrets from the sender ratchets of other members"
- "This is the wrong ratchet type" errors
- "Ciphertext generation out of bounds" errors

## Root Cause

The issue was caused by **multiple video sender transforms** being active simultaneously:

1. **Regular video track** → creates sender transform #1
2. **Screen share video track** → creates sender transform #2
3. Both transforms try to encrypt frames using the **same MLS state**
4. Frame sequence numbers get **out of order**, causing ratchet state confusion
5. Decryption fails because expected sequence doesn't match actual sequence

The MLS protocol expects a **single sender ratchet per participant**, but having both regular video and screen share video created multiple senders, violating this assumption.

## Solution Implemented

### 1. Transform Management in EncryptionWorker

Modified `app/utils/e2ee.ts` to track active sender transforms:

```typescript
// Track active sender transforms to avoid conflicts
private _activeSenderTransforms = new Map<string, RTCRtpSender>()
```

### 2. Single Video Transform Enforcement

When setting up a new video sender transform:

```typescript
if (trackKind === 'video') {
	// Check if we already have an active video sender transform
	const existingSender = this._activeSenderTransforms.get('video')
	if (existingSender && existingSender !== sender) {
		console.log(
			'🔐 Removing existing video sender transform before setting up new one'
		)

		// Clear the existing transform
		if (existingSender.transform) {
			existingSender.transform = null
		}

		// Wait for cleanup to complete
		await new Promise((resolve) => setTimeout(resolve, 100))
	}

	// Track this sender as the active video sender
	this._activeSenderTransforms.set('video', sender)
}
```

### 3. Improved Setup Chain

Enhanced the useE2EE hook to chain setup operations and avoid race conditions:

```typescript
let setupPromise = Promise.resolve()

const subscription = partyTracks.transceiver$.subscribe((transceiver) => {
	if (transceiver.direction === 'sendonly') {
		// Chain setup operations to avoid race conditions
		setupPromise = setupPromise.then(async () => {
			await encryptionWorker.setupSenderTransform(transceiver.sender)
		})
	}
})
```

### 4. Cleanup Methods

Added methods to properly clean up transforms:

```typescript
// Clean up a specific transform
cleanupSenderTransform(trackKind: 'video' | 'audio') {
    const sender = this._activeSenderTransforms.get(trackKind)
    if (sender) {
        console.log(`🔐 Cleaning up ${trackKind} sender transform`)
        if (sender.transform) {
            sender.transform = null
        }
        this._activeSenderTransforms.delete(trackKind)
    }
}
```

## How It Works

1. **Initial State**: User has regular video → one video sender transform
2. **Screen Share Start**: New screen share track → removes old transform, sets up new one
3. **Screen Share End**: Screen share track ends → regular video resumes with new transform
4. **Result**: Only one video sender transform active at any time

## Verification Steps

### 1. Console Logging

Look for these log messages during screen sharing:

```
🔐 Setting up sender transform for video track: [trackId]
🔐 Removing existing video sender transform before setting up new one
🔐 Successfully set up sender transform for video trackId: [trackId]
```

### 2. Error Monitoring

Check that these errors no longer appear:

```
Frame decryption failed: Cannot create decryption secrets...
This is the wrong ratchet type
Ciphertext generation out of bounds
```

### 3. Screen Share Testing

1. Join a room with E2EE enabled
2. Start video call with another participant
3. Start screen sharing
4. Switch between regular video and screen share multiple times
5. Verify no MLS errors in console
6. Verify both participants can see encrypted content correctly

### 4. Browser DevTools

Monitor the Network/Console tabs for:

- No MLS-related errors
- Successful E2EE transform setup messages
- Smooth transitions between video sources

## Technical Notes

- **MLS Library**: Uses OpenMLS with ratchet tolerances (OUT_OF_ORDER_TOLERANCE: 500, MAX_MESSAGE_SEQ_JUMP: 1000)
- **WebRTC**: Works with both RTCRtpScriptTransform (Firefox) and createEncodedStreams (Chrome)
- **Partytracks**: Integrates with the existing partytracks system for track management
- **Thread Safety**: Uses Rust's thread-local state management for MLS operations

## Future Improvements

1. **Track Lifecycle Management**: Better tracking of track state changes
2. **Error Recovery**: Automatic recovery from ratchet desync errors
3. **Performance**: Optimize transform setup/teardown timing
4. **Monitoring**: Add metrics for E2EE health and performance

This fix ensures that **screen sharing works seamlessly with end-to-end encryption** by maintaining proper MLS ratchet state management.
