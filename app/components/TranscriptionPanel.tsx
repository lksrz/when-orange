import React from 'react'

type Transcription = {
	text: string
	timestamp: number
	speaker?: string
}

export const TranscriptionPanel: React.FC<{
	transcriptions: Transcription[]
}> = ({ transcriptions }) => (
	<div className="p-4 bg-white rounded shadow max-h-64 overflow-y-auto">
		<h3 className="font-bold mb-2">Transcription</h3>
		<ul>
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
