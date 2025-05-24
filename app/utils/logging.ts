import { type ApiHistoryEntry } from 'partytracks/client'

export type LogEvent =
	| {
			eventName: 'onStart'
			meetingId?: string
	  }
	| {
			eventName: 'alarm'
			meetingId?: string
	  }
	| {
			eventName: 'onConnect'
			meetingId?: string
			foundInStorage: boolean
			connectionId: string
	  }
	| {
			eventName: 'onClose'
			meetingId?: string
			connectionId: string
			code: number
			reason: string
			wasClean: boolean
	  }
	| {
			eventName: 'userLeft'
			meetingId?: string
			connectionId: string
	  }
	| {
			eventName: 'cleaningUpConnections'
			meetingId?: string
			connectionsFound: number
			websocketsFound: number
			websocketStatuses: number[]
	  }
	| {
			eventName: 'userTimedOut'
			meetingId?: string
			connectionId: string
	  }
	| {
			eventName: 'startingMeeting'
			meetingId?: string
	  }
	| {
			eventName: 'endingMeeting'
			meetingId?: string
	  }
	| {
			eventName: 'meetingIdNotFoundInCleanup'
	  }
	| {
			eventName: 'errorBroadcastingToUser'
			meetingId?: string
			connectionId: string
	  }
	| {
			eventName: 'onErrorHandler'
			error: unknown
	  }
	| {
			eventName: 'onErrorHandlerDetails'
			meetingId?: string
			connectionId: string
			error: unknown
	  }
	| {
			eventName: 'errorHandlingMessage'
			meetingId?: string
			connectionId: string
			error: unknown
	  }
	| {
			eventName: 'clientNegotiationRecord'
			entry: ApiHistoryEntry
			meetingId?: string
			connectionId: string
			sessionId?: string
	  }
	| {
			eventName: 'e2eeSessionCleanup'
			meetingId?: string
			connectionId: string
			targetUserId: string
	  }
	| {
			eventName: 'cleanupDuplicateUser'
			meetingId?: string
			username: string
			oldConnectionId: string
			newConnectionId: string
	  }

export function log(event: LogEvent) {
	console.log(event)
}
