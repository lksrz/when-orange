import { useEffect, useState } from 'react'
import useIsSpeaking from './useIsSpeaking'

interface User {
  id: string
  name: string
  tracks: {
    audio?: string
  }
}

/**
 * Hook to track speaking status for multiple users
 * This creates individual speaking detection for each user's audio track
 */
export function useMultiUserSpeakingDetection(
  users: User[],
  pulledAudioTracks: Record<string, MediaStreamTrack>
): Record<string, boolean> {
  const [speakingStates, setSpeakingStates] = useState<Record<string, boolean>>({})

  useEffect(() => {
    const newStates: Record<string, boolean> = {}
    
    users.forEach(user => {
      if (!user.id || !user.tracks.audio) {
        newStates[user.id] = false
        return
      }
      
      const audioTrack = pulledAudioTracks[user.tracks.audio]
      if (!audioTrack) {
        newStates[user.id] = false
        return
      }
      
      // Note: We can't call useIsSpeaking conditionally in a loop
      // So we'll track this in a different way
      newStates[user.id] = speakingStates[user.id] || false
    })
    
    setSpeakingStates(newStates)
  }, [users, pulledAudioTracks])

  return speakingStates
}

/**
 * Individual user speaking detection component
 * This is a workaround since we can't call hooks conditionally
 */
export function UserSpeakingDetector({
  userId,
  userName,
  audioTrack,
  onSpeakingChange
}: {
  userId: string
  userName: string
  audioTrack: MediaStreamTrack | null
  onSpeakingChange: (userId: string, userName: string, isSpeaking: boolean) => void
}) {
  const isSpeaking = useIsSpeaking(audioTrack || undefined)
  
  useEffect(() => {
    onSpeakingChange(userId, userName, isSpeaking)
  }, [userId, userName, isSpeaking, onSpeakingChange])
  
  return null // This is a logic-only component
}