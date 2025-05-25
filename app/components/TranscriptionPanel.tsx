import React from 'react'

type Transcription = {
	text: string
	timestamp: number
	speaker?: string
}

export const TranscriptionPanel: React.FC<{
	transcriptions: Transcription[]
	isHost?: boolean
	hostName?: string
}> = ({ transcriptions, isHost = false, hostName }) => (
	<div className="p-4 bg-white rounded shadow max-h-64 overflow-y-auto">
		<div className="flex items-center justify-between mb-2">
			<h3 className="font-bold">Transcription</h3>
			{isHost && (
				<span className="text-xs bg-green-100 text-green-800 px-2 py-1 rounded-full">
					🎤 Host
				</span>
			)}
			{!isHost && hostName && (
				<span className="text-xs bg-gray-100 text-gray-600 px-2 py-1 rounded-full">
					Host: {hostName}
				</span>
			)}
		</div>
		<ul>
			{transcriptions.length === 0 && (
				<li>
					<span style={{ color: 'red', fontWeight: 'bold' }}>
						[TranscriptionPanel] No transcriptions to display.
					</span>
				</li>
			)}
			{transcriptions.map((t, i) => (
				<li key={i}>
					<span className="text-xs text-gray-400">
						[{new Date(t.timestamp).toLocaleTimeString()}]
					</span>{' '}
					<b>{t.speaker}:</b> {t.text}
				</li>
			))}
		</ul>
	</div>
)
