# E2EE Video Fix & Grid Height Fix Test Plan

## Issues Fixed

### 1. E2EE Black Screen Issue

After adding the "ENCRYPTED" status indicator, participants can't see or hear each other (black screens only).

**Root Cause**: Race condition between E2EE receiver transform setup and video track decryption.

### 2. Grid Height Issue

The participant grid div takes 100% height instead of just the area above the bottom toolbar.

**Root Cause**: Incorrect height calculation that didn't properly account for the fixed bottom toolbar.

## Fixes Applied

### E2EE Fix

1. Added proper worker readiness tracking (`workerReady` state)
2. Added readiness checks with timeout to `setupSenderTransform` and `setupReceiverTransform` methods
3. Added `e2eeReady` state that only becomes true when worker is ready AND joined
4. Updated E2EE indicator to only show when `e2eeReady` is true
5. Added proper initialization delays and error handling

### Grid Height Fix

1. Changed participant area from `pb-[calc(5rem+env(safe-area-inset-bottom))]` to explicit height calculation
2. Set participant area height to `h-[calc(100vh-5rem-env(safe-area-inset-bottom))]`
3. Added explicit height to bottom toolbar: `h-[5rem]`

## Test Steps

### 1. Test Grid Height Fix (Both E2EE enabled/disabled)

- Open room in browser
- Verify participant area stops exactly where bottom toolbar begins
- Verify no overlap between participant grid and toolbar
- Test on different screen sizes
- Test with mobile viewport (`env(safe-area-inset-bottom)`)

### 2. Test E2EE Disabled (Control)

- Set `E2EE_ENABLED=false` in environment
- Join room with 2+ participants
- Verify video and audio work normally
- Verify no "ENCRYPTED" indicator appears
- Verify grid height fix works

### 3. Test E2EE Enabled - Clear Cache First

```bash
# Clear Wrangler cache
rm -rf .wrangler/state/v3/cache/
npm run build
npm run dev
```

### 4. Test E2EE Enabled - First User

- Set `E2EE_ENABLED=true` in environment
- Join room as first user
- Check browser console for logs:
  - `🔐 E2EE ready state changed`
  - `🔐 Initializing and creating group as first user`
  - `🔐 Setting up sender transform for video`
- Verify "ENCRYPTED" indicator appears when ready (not immediately)
- Verify own video works
- Verify grid height is correct

### 5. Test E2EE Enabled - Second User

- Join room as second user
- Check browser console for logs:
  - `🔐 E2EE ready state changed`
  - `🔐 Initializing worker as joining user`
  - `🔐 Setting up receiver transform for video`
  - `📨 incoming e2eeMlsMessage from peer`
- Verify "ENCRYPTED" indicator appears when ready
- **CRITICAL**: Verify can see and hear first user (no black screen)
- Verify first user can see and hear second user
- Verify grid height is correct

### 6. Test Multiple Users

- Add 3rd and 4th users
- Verify all participants can see/hear each other
- Verify all show "ENCRYPTED" indicator only when ready
- Verify grid layout adapts correctly

## Expected Console Logs

```
🔐 E2EE ready state changed: { enabled: true, workerReady: false, joined: false, isReady: false }
🔐 E2EE ready state changed: { enabled: true, workerReady: true, joined: false, isReady: false }
🔐 E2EE ready state changed: { enabled: true, workerReady: true, joined: true, isReady: true }
🔐 Setting up E2EE event handlers, worker ready: true joined: true
🔐 Setting up sender transform for video
🔐 Setting up receiver transform for video
```

## Success Criteria

### Grid Height Fix

- ✅ Participant area uses exact available space above toolbar
- ✅ No overlap between grid and toolbar
- ✅ Responsive on different screen sizes

### E2EE Fix

- ✅ No black screens when E2EE is enabled
- ✅ All participants can see and hear each other
- ✅ "ENCRYPTED" indicator only appears when encryption is fully operational
- ✅ No race condition errors in console
- ✅ Proper initialization sequence in logs
- ✅ Timeout handling for worker readiness

## Cache Clearing Commands

If changes don't take effect:

```bash
# Clear Wrangler cache
rm -rf .wrangler/state/v3/cache/

# Clear browser cache (hard refresh)
Cmd+Shift+R (Mac) / Ctrl+Shift+R (Windows)

# Force rebuild
npm run build
npm run dev
```
