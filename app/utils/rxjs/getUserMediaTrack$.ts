import { resilientTrack$ } from 'partytracks/client'
import { tap } from 'rxjs/operators';
import type { Observable } from 'rxjs'
import { getSortedDeviceListObservable } from './getDeviceListObservable'

export function getUserMediaTrack$(
	kind: 'audioinput' | 'videoinput'
): Observable<MediaStreamTrack> {
	console.log('getUserMediaTrack$ called', { kind });
	return resilientTrack$({
		kind,
		devicePriority$: getSortedDeviceListObservable(),
		constraints:
			kind === 'videoinput'
				? { width: { ideal: 1280 }, height: { ideal: 720 } }
				: {},
	}).pipe(
		tap({
			next: (track) => {
				console.log('getUserMediaTrack$ emitted track', { kind, track });
			}
		})
	);
}
