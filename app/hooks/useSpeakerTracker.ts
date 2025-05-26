import { useCallback, useRef, useState } from 'react'

interface SpeakerActivity {
  userId: string
  userName: string
  startTime: number
  endTime?: number
  isActive: boolean
}

interface SpeakerInfo {
  userId: string
  userName: string
  duration: number
}

/**
 * Hook to track which users are speaking and correlate with transcription timing
 * This helps identify who was speaking during transcription chunks
 */
export function useSpeakerTracker() {
  const [activeSpeakers, setActiveSpeakers] = useState<Set<string>>(new Set())
  const speakerActivities = useRef<SpeakerActivity[]>([])
  
  // Track when a user starts/stops speaking
  const updateSpeakerStatus = useCallback((userId: string, userName: string, isSpeaking: boolean) => {
    const now = Date.now()
    
    setActiveSpeakers(prev => {
      const newSet = new Set(prev)
      if (isSpeaking) {
        newSet.add(userId)
      } else {
        newSet.delete(userId)
      }
      return newSet
    })
    
    // Update activities log
    if (isSpeaking) {
      // User started speaking
      speakerActivities.current.push({
        userId,
        userName,
        startTime: now,
        isActive: true
      })
    } else {
      // User stopped speaking - find the most recent active entry for this user
      const activeEntry = speakerActivities.current
        .reverse()
        .find(activity => activity.userId === userId && activity.isActive)
      
      if (activeEntry) {
        activeEntry.endTime = now
        activeEntry.isActive = false
      }
      
      // Restore original order
      speakerActivities.current.reverse()
    }
    
    // Cleanup old activities (keep last 30 seconds)
    const cutoffTime = now - 30000
    speakerActivities.current = speakerActivities.current.filter(
      activity => activity.startTime > cutoffTime
    )
  }, [])
  
  // Get the primary speaker during a time range (for transcription correlation)
  const getPrimarySpeaker = useCallback((startTime: number, endTime: number): SpeakerInfo | null => {
    console.log('🔍 Speaker Tracker Debug:', {
      requestedTimeRange: `${new Date(startTime).toLocaleTimeString()} - ${new Date(endTime).toLocaleTimeString()}`,
      totalActivities: speakerActivities.current.length,
      recentActivities: speakerActivities.current.slice(-3).map(a => ({
        user: a.userName,
        time: `${new Date(a.startTime).toLocaleTimeString()} - ${a.endTime ? new Date(a.endTime).toLocaleTimeString() : 'ongoing'}`,
        active: a.isActive
      }))
    })
    
    const relevantActivities = speakerActivities.current.filter(activity => {
      const activityStart = activity.startTime
      const activityEnd = activity.endTime || Date.now()
      
      // Check if activity overlaps with the time range
      const overlaps = activityStart <= endTime && activityEnd >= startTime
      
      return overlaps
    })
    
    if (relevantActivities.length === 0) {
      return null
    }
    
    // Calculate overlap duration for each speaker
    const speakerDurations = new Map<string, { userName: string; duration: number }>()
    
    relevantActivities.forEach(activity => {
      const activityStart = Math.max(activity.startTime, startTime)
      const activityEnd = Math.min(activity.endTime || Date.now(), endTime)
      const overlapDuration = Math.max(0, activityEnd - activityStart)
      
      if (overlapDuration > 0) {
        const existing = speakerDurations.get(activity.userId)
        speakerDurations.set(activity.userId, {
          userName: activity.userName,
          duration: (existing?.duration || 0) + overlapDuration
        })
      }
    })
    
    if (speakerDurations.size === 0) {
      return null
    }
    
    // Find the speaker with the longest duration
    let primarySpeaker: { userId: string; userName: string; duration: number } | null = null
    
    for (const [userId, { userName, duration }] of speakerDurations) {
      if (!primarySpeaker || duration > primarySpeaker.duration) {
        primarySpeaker = { userId, userName, duration }
      }
    }
    
    return primarySpeaker
  }, [])
  
  // Get current active speakers
  const getCurrentActiveSpeakers = useCallback((): string[] => {
    return Array.from(activeSpeakers)
  }, [activeSpeakers])
  
  // Get the most recent speaker (for fallback when timing correlation fails)
  const getMostRecentSpeaker = useCallback((): SpeakerInfo | null => {
    if (speakerActivities.current.length === 0) {
      return null
    }
    
    // Get the most recent activity
    const recentActivity = speakerActivities.current
      .sort((a, b) => b.startTime - a.startTime)[0]
    
    if (!recentActivity) {
      return null
    }
    
    return {
      userId: recentActivity.userId,
      userName: recentActivity.userName,
      duration: (recentActivity.endTime || Date.now()) - recentActivity.startTime
    }
  }, [])
  
  // Debug function to log current state
  const debugSpeakerState = useCallback(() => {
    console.log('🎤 Speaker Tracker State:', {
      activeSpeakers: Array.from(activeSpeakers),
      recentActivities: speakerActivities.current.slice(-5), // Last 5 activities
      totalActivities: speakerActivities.current.length
    })
  }, [activeSpeakers])
  
  return {
    updateSpeakerStatus,
    getPrimarySpeaker,
    getCurrentActiveSpeakers,
    getMostRecentSpeaker,
    activeSpeakers: Array.from(activeSpeakers),
    debugSpeakerState
  }
}