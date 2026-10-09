import type { Env } from './types/Env'
import type { ChatCard } from './types/GoogleChatApi'
import { isCostKillSwitchOn } from './utils/costGuard.server'

export const queue = async (batch: MessageBatch<ChatCard>, env: Env) => {
	if (isCostKillSwitchOn(env)) {
		// Returning normally would ack (delete) every message; retry them later
		// instead. Messages are lost only if the switch outlasts max_retries.
		console.warn('[cost-guard] queue: kill switch on, retrying batch later')
		batch.retryAll({ delaySeconds: 300 })
		return
	}
	for (const message of batch.messages) {
		if (env.FEEDBACK_URL) {
			try {
				await fetch(env.FEEDBACK_URL, {
					method: 'post',
					body: JSON.stringify(message.body),
				})
			} catch (error) {
				message.retry()
			}
		} else {
			console.log('would have posted to feedback URL', message)
		}
	}
}
