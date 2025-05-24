# Cross-Network Video Connection Issue Analysis

## ✅ ISSUE RESOLVED (2025-01-24)

### Final Status: SUCCESS

The cross-network video connection issue has been **successfully resolved**. The problem was with the Cloudflare TURN service configuration.

### Evidence of Resolution:

- **TURN relay candidates working**: `relay: 6` candidates generated
- **Cross-network connection successful**: `ICE connection state: checking → connected`
- **Video streams working**: E2EE encryption/decryption transforms active
- **Mobile network detection working**: Properly detects cellular vs WiFi

### What Was Fixed:

1. **Cloudflare TURN Service**: `TURN_SERVICE_TOKEN` was missing/invalid and has been corrected
2. **ICE Candidate Generation**: Now generating both STUN and TURN candidates properly
3. **NAT Traversal**: TURN relay enables connection through mobile network NATs
4. **Logging Cleanup**: Reduced verbose logging while maintaining essential diagnostics

### Current Behavior:

- **WiFi ↔ WiFi**: Works via direct connection (STUN)
- **WiFi ↔ 5G**: Works via TURN relay
- **5G ↔ 5G**: Works via TURN relay
- **Corporate networks**: Should work via TURN relay

---

## Original Problem Summary

When meeting participants are on different networks (e.g., one on WiFi and another on 5G/mobile data), video feeds appeared blank between them, even though WebSocket events (like raise hand) continued to work. This issue did not occur when both users were on the same WiFi network.

## Key Observations from Logs

### WiFi User (Working):

- ICE connection state: `new → checking → connected` ✅
- E2EE transforms set up successfully
- Stable connection established
- Video/audio streams working

### 5G User (Failing):

- ICE connection state: `new → checking → failed → closed` (repeated cycle) ❌
- Multiple ICE restart attempts that fail
- Error: "Session is not ready yet"
- HTTP 425 errors indicating connection not established
- E2EE group creation happens but connection never stabilizes

## Root Cause

The issue stems from **NAT traversal and firewall restrictions** that are more stringent on mobile networks:

1. **Symmetric NAT on Mobile Networks**: Mobile carriers often use symmetric NAT which makes peer-to-peer connections difficult
2. **Firewall Restrictions**: Mobile networks may block certain UDP ports needed for WebRTC
3. **TURN Server Issues**: The application may not be using TURN servers properly for relay when direct connection fails

## Technical Analysis

### 1. ICE Candidate Gathering

When users are on different networks, WebRTC needs to:

- Gather local candidates (host candidates)
- Discover public IP via STUN
- Use TURN relay when direct connection fails

The logs show the 5G user's ICE connection repeatedly failing, suggesting:

- STUN/TURN configuration may be incomplete
- Mobile network is blocking direct peer-to-peer UDP traffic
- No fallback to TURN relay is occurring

### 2. Connection State Loop

The 5G user experiences this cycle:

```
new → checking → failed → closed → new → checking → failed...
```

This indicates:

- ICE candidates are being gathered
- Connection attempt starts (checking)
- No viable connection path is found (failed)
- Connection is terminated (closed)
- System retries but faces same issue

### 3. Why WebSocket Events Work

WebSocket events (raise hand, user status) work because:

- WebSocket uses TCP over HTTP/HTTPS
- Goes through the signaling server (not peer-to-peer)
- Mobile networks allow standard HTTP/HTTPS traffic
- No NAT traversal required for server communication

### 4. E2EE Timing Issues

The E2EE system attempts to set up encryption before a stable connection exists:

- E2EE worker initializes and creates MLS group
- Encryption transforms are applied to non-existent media streams
- This adds complexity to an already failing connection

## Current Implementation Gaps

### 1. ICE Server Configuration

Looking at the code, ICE servers are loaded from `getIceServers.server` but we need to verify:

- Are TURN servers included in the configuration?
- Are credentials properly set for TURN servers?
- Is the TURN server accessible from mobile networks?

### 2. ICE Restart Logic

The current implementation has ICE restart logic but:

- It only triggers after connection fails
- Doesn't address the root cause (NAT/firewall)
- No progressive fallback strategy (STUN → TURN)

### 3. Network-Specific Handling

The code doesn't differentiate between network types:

- Same ICE configuration for all networks
- No mobile-specific optimizations
- No relay-forcing option for problematic networks

## Recommended Solutions

### 1. Ensure TURN Server Configuration

```typescript
const iceServers = [
	{ urls: 'stun:stun.l.google.com:19302' },
	{
		urls: 'turn:turnserver.example.com:3478',
		username: 'username',
		credential: 'password',
	},
	{
		urls: 'turn:turnserver.example.com:443?transport=tcp',
		username: 'username',
		credential: 'password',
	},
]
```

### 2. Force TURN Relay for Mobile Networks

Detect mobile networks and force relay:

```typescript
const isMobileNetwork =
	navigator.connection?.type === 'cellular' ||
	navigator.connection?.effectiveType?.includes('g')

if (isMobileNetwork) {
	// Force relay by filtering out non-relay candidates
	pc.onicecandidate = (event) => {
		if (event.candidate?.type === 'relay') {
			// Only send relay candidates
			sendCandidate(event.candidate)
		}
	}
}
```

### 3. Implement ICE Transport Policy

```typescript
const configuration = {
	iceServers,
	iceTransportPolicy: isMobileNetwork ? 'relay' : 'all',
}
```

### 4. Add Connection Diagnostics

Implement diagnostic logging to identify the exact failure point:

```typescript
pc.onicecandidateerror = (event) => {
	console.error('ICE Candidate Error:', {
		errorCode: event.errorCode,
		errorText: event.errorText,
		url: event.url,
		address: event.address,
		port: event.port,
	})
}
```

### 5. Progressive Enhancement Strategy

1. Try direct peer-to-peer connection first
2. If that fails, try STUN-assisted connection
3. If that fails, force TURN relay
4. Provide user feedback about connection quality

## Immediate Actions

1. **Verify TURN Server Configuration**: Check if TURN servers are properly configured in the environment
2. **Add ICE Candidate Logging**: Log all ICE candidates to see what's being gathered
3. **Test Force-Relay Mode**: Add a debug flag to force TURN relay
4. **Monitor ICE Gathering State**: Ensure all candidate types are being gathered

## Testing Approach

1. Enable verbose WebRTC logging: `chrome://webrtc-internals/`
2. Test with explicit TURN-only configuration
3. Use network throttling to simulate mobile conditions
4. Test with VPN to simulate different network topologies

## Conclusion

The issue is primarily about NAT traversal and firewall restrictions on mobile networks preventing direct peer-to-peer connections. The solution requires proper TURN server configuration and intelligent fallback strategies based on network conditions.

## Implemented Solution (2025-01-24)

Based on the analysis, the following changes have been implemented:

### 1. Enhanced ICE Diagnostics

- Added comprehensive ICE candidate logging in `usePeerConnection` hook
- Track candidate statistics (host, srflx, relay) for both local and remote
- Log ICE candidate errors with detailed information
- Monitor ICE gathering state changes

### 2. Mobile Network Detection

- Added `isMobileNetwork()` helper function that detects:
  - Cellular connections via Network Information API
  - Mobile devices via User Agent fallback
- Expose mobile network status in room context

### 3. Force TURN Relay Mode (Configurable)

- Automatically detect mobile networks and force TURN relay
- **DISABLED BY DEFAULT** to prevent breaking WiFi connections
- Can be enabled via URL parameter: `?forceRelay=true`
- Only triggers on explicitly cellular connections (not WiFi with mobile speeds)
- Logs when mobile network is detected

### 4. Connection Diagnostics Component

- New `ConnectionDiagnostics` component shows:
  - Current ICE connection state
  - Network type (Mobile/Fixed)
  - ICE candidate statistics
  - Warning if no TURN candidates on mobile
- Only visible in debug mode (Ctrl+Shift+Alt+D)

### 5. Debug Scripts

- `debug-connection.js`: Browser console script for detailed diagnostics
- `debug-video.js`: Existing script for video stream debugging

## Usage Instructions

### For Users Experiencing Issues:

1. **Enable Debug Mode**:

   - Press `Ctrl+Shift+Alt+D` to enable debug information
   - Connection diagnostics will appear in bottom-left corner

2. **Check TURN Configuration**:

   - Look for "TURN" candidates in the diagnostics
   - If on mobile and no TURN candidates, this is the issue

3. **Test With Force Relay**:

   - Add `?forceRelay=true` to the room URL to enable TURN relay forcing
   - Add `?debugRelay=true` to force relay mode for debugging (works on any network)
   - This forces relay mode for testing TURN connectivity

4. **Run Browser Diagnostics**:
   - Open browser console (F12)
   - Copy and paste contents of `debug-connection.js`
   - Review the detailed connection analysis

### For Developers:

1. **Monitor Logs**:

   - `🧊 ICE Candidate:` - Shows each candidate discovered
   - `❌ ICE Candidate Error:` - Shows gathering failures
   - `📱 Mobile network detected` - Confirms mobile detection
   - `🧊 ICE Servers configured:` - Shows TURN server availability

2. **Verify TURN Server**:

   - Ensure `TURN_SERVICE_ID` and `TURN_SERVICE_TOKEN` are set in environment
   - Check Cloudflare TURN service is active and configured
   - Verify TURN URLs are accessible from mobile networks

3. **Test Scenarios**:
   - WiFi to WiFi (should work normally)
   - WiFi to Mobile (test with and without forceRelay)
   - Mobile to Mobile (likely needs TURN relay)
   - Behind corporate firewall (definitely needs TURN)

## Next Steps

1. **Verify Cloudflare TURN Configuration**:

   - Check if TURN credentials are properly set in environment
   - Test TURN server connectivity from mobile networks
   - Ensure sufficient TURN bandwidth allocation

2. **Consider Alternative TURN Providers**:

   - If Cloudflare TURN has limitations, consider:
     - Twilio TURN
     - Xirsys
     - Self-hosted TURN server

3. **Implement Adaptive Strategy**:

   - Start with all candidate types
   - If connection fails, retry with relay-only
   - Show user-friendly messages about connection quality

4. **Add Metrics**:
   - Track successful connection rates by network type
   - Monitor TURN usage and costs
   - Identify problematic network configurations

## Current Status (2025-01-24 - Latest Update)

### Issue Confirmed: TURN Server Not Working

Based on the latest logs from both users:

**User 1 (WiFi)**:

- Incorrectly detected as mobile network (detection bug)
- `relay: 0` - No TURN candidates found
- ICE state: `new → checking → connected` (works because both on same network)

**User 2 (5G)**:

- Correctly detected as mobile network
- `relay: 0` - No TURN candidates found
- ICE state: `new → checking → closed` (fails repeatedly)
- HTTP 425 errors: "Session is not ready yet"

### Root Cause: Cloudflare TURN Service Issue

The logs show that **no TURN relay candidates are being generated** for either user, which means:

1. **Cloudflare TURN service is not responding properly**
2. **TURN_SERVICE_TOKEN may be missing or invalid**
3. **TURN service may not be activated in Cloudflare account**

### Evidence:

- Both users show `relay: 0` in ICE candidate statistics
- Warning: "No TURN relay candidates found - mobile connections may fail"
- Only `host` and `srflx` (STUN) candidates are generated
- No `relay` (TURN) candidates despite mobile network detection

## Immediate Actions Required

### 1. Verify Cloudflare TURN Configuration

```bash
# Check if TURN_SERVICE_TOKEN is set in environment
echo $TURN_SERVICE_TOKEN

# Test TURN service manually
curl -X POST \
  "https://rtc.live.cloudflare.com/v1/turn/keys/YOUR_TURN_SERVICE_ID/credentials/generate-ice-servers" \
  -H "Authorization: Bearer YOUR_TURN_SERVICE_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"ttl": 86400}'
```

### 2. Debug Mode Available

Set `TURN_SERVICE_ID=debug` in wrangler.toml to use public TURN servers for testing:

```toml
TURN_SERVICE_ID = "debug"
```

### 3. Test With Public TURN Servers

The debug mode provides fallback public TURN servers:

- `turn:openrelay.metered.ca:80`
- `turn:openrelay.metered.ca:443`
- `turn:openrelay.metered.ca:443?transport=tcp`

## Next Steps

1. **Check Cloudflare TURN Service Status**

   - Verify TURN service is activated in Cloudflare dashboard
   - Check TURN_SERVICE_TOKEN is correctly set in production environment
   - Test TURN API endpoint manually

2. **Test With Debug Mode**

   - Set `TURN_SERVICE_ID=debug` temporarily
   - Test cross-network connection with public TURN servers
   - Verify that TURN relay candidates are generated

3. **Fix Mobile Network Detection**

   - Current detection incorrectly flags WiFi as mobile
   - Need more conservative detection logic

4. **Monitor Server Logs**
   - Added detailed TURN service logging
   - Check server console for TURN API errors
   - Verify environment variables are loaded correctly
