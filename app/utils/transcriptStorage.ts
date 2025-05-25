import type { Transcription } from '~/components/TranscriptionService'

/**
 * Utility for storing and retrieving transcripts
 * Provides a simple interface for managing transcription data across components
 */
class TranscriptStorage {
  private transcripts: Transcription[] = []
  private listeners: Set<(transcripts: Transcription[]) => void> = new Set()

  /**
   * Add a new transcript to storage and notify listeners
   */
  addTranscript(transcript: Transcription): void {
    this.transcripts.push(transcript)
    this.notifyListeners()
  }

  /**
   * Add multiple transcripts to storage and notify listeners
   */
  addTranscripts(newTranscripts: Transcription[]): void {
    this.transcripts.push(...newTranscripts)
    this.notifyListeners()
  }

  /**
   * Get all stored transcripts
   */
  getTranscripts(): Transcription[] {
    return [...this.transcripts]
  }

  /**
   * Clear all stored transcripts and notify listeners
   */
  clearTranscripts(): void {
    this.transcripts = []
    this.notifyListeners()
  }

  /**
   * Subscribe to transcript changes
   * Returns an unsubscribe function
   */
  subscribe(listener: (transcripts: Transcription[]) => void): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  /**
   * Notify all listeners of transcript changes
   */
  private notifyListeners(): void {
    const transcriptsCopy = [...this.transcripts]
    this.listeners.forEach(listener => {
      try {
        listener(transcriptsCopy)
      } catch (error) {
        console.error('Error in transcript listener:', error)
      }
    })
  }
}

// Export a singleton instance
export const transcriptStorage = new TranscriptStorage()
