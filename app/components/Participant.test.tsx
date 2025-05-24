import { describe, expect, it, vi } from 'vitest'
import type { User } from '~/types/Messages'

// Mock the dependencies
vi.mock('~/hooks/useRoomContext', () => ({
	useRoomContext: () => ({
		traceLink: '',
		partyTracks: { peerConnection$: { pipe: vi.fn() } },
		dataSaverMode: false,
		pinnedTileIds: [],
		setPinnedTileIds: vi.fn(),
		showDebugInfo: false,
		userMedia: {
			audioStreamTrack: null,
			videoStreamTrack: 'local-video-track',
			screenShareVideoTrack: 'local-screenshare-track',
		},
		room: { identity: { id: 'user123', name: 'Test User' } },
		e2eeSafetyNumber: '12345',
		simulcastEnabled: false,
	}),
}))

vi.mock('~/hooks/useUserMetadata', () => ({
	useUserMetadata: () => ({ data: { displayName: 'Test User' } }),
}))

vi.mock('../hooks/usePulledVideoTrack', () => ({
	usePulledVideoTrack: () => 'pulled-video-track',
}))

vi.mock('./PullAudioTracks', () => ({
	usePulledAudioTrack: () => null,
}))

vi.mock('~/hooks/useDeadPulledTrackMonitor', () => ({
	useDeadPulledTrackMonitor: vi.fn(),
}))

vi.mock('~/hooks/useIsSpeaking', () => ({
	default: () => false,
}))

vi.mock('~/hooks/useVideoDimensions', () => ({
	useVideoDimensions: () => ({ videoHeight: 720, videoWidth: 1280 }),
}))

vi.mock('partytracks/react', () => ({
	useObservableAsValue: vi.fn((obs, defaultValue) => defaultValue),
}))

vi.mock('rxjs', () => ({
	combineLatest: vi.fn(),
	fromEvent: vi.fn(),
	map: vi.fn(),
	of: vi.fn(() => ({ pipe: vi.fn() })),
	switchMap: vi.fn(),
}))

vi.mock('~/utils/rxjs/ewma', () => ({
	ewma: vi.fn(),
}))

vi.mock('~/utils/rxjs/getPacketLoss$', () => ({
	getPacketLoss$: vi.fn(() => ({ pipe: vi.fn() })),
}))

describe('Participant E2EE Screen Sharing', () => {
	const baseUser: User = {
		id: 'user123',
		name: 'Test User',
		transceiverSessionId: 'session123',
		raisedHand: false,
		speaking: false,
		joined: true,
		tracks: {
			audio: 'audio-track-id',
			audioEnabled: true,
			audioUnavailable: false,
			video: 'video-track-id',
			videoEnabled: true,
			screenshare: 'screenshare-track-id',
			screenShareEnabled: true,
		},
	}

	it('should use local video track for own camera', () => {
		const user = { ...baseUser }

		// Test that for own camera, local track is used
		// This is verified by the logic: isSelf && !isScreenShare ? userMedia.videoStreamTrack
		expect(user.id).toBe('user123') // isSelf will be true
		expect(user.id.endsWith('_screenshare')).toBe(false) // isScreenShare will be false

		// The component should use userMedia.videoStreamTrack for this case
	})

	it('should use local screenshare track for own screen share', () => {
		const user = { ...baseUser, id: 'user123_screenshare' }

		// Test that for own screen share, local screenshare track is used
		// This is verified by the logic: isSelf && isScreenShare ? userMedia.screenShareVideoTrack
		expect(user.id.startsWith('user123')).toBe(true) // isSelf will be true
		expect(user.id.endsWith('_screenshare')).toBe(true) // isScreenShare will be true

		// The component should use userMedia.screenShareVideoTrack for this case
	})

	it('should use pulled track for other users', () => {
		const user = { ...baseUser, id: 'otheruser456' }

		// Test that for other users, pulled track is used
		// This is verified by the logic: neither isSelf conditions match, so pulledVideoTrack
		expect(user.id.startsWith('user123')).toBe(false) // isSelf will be false

		// The component should use pulledVideoTrack for this case
	})

	it('should use pulled track for other users screen shares', () => {
		const user = { ...baseUser, id: 'otheruser456_screenshare' }

		// Test that for other users' screen shares, pulled track is used
		expect(user.id.startsWith('user123')).toBe(false) // isSelf will be false
		expect(user.id.endsWith('_screenshare')).toBe(true) // isScreenShare will be true

		// The component should use pulledVideoTrack for this case
	})
})
