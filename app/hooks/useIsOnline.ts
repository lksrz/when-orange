import { useSyncExternalStore } from 'react'

// Check if we're in a Cloudflare environment where navigator.onLine is unreliable
function isCloudflareEnvironment() {
  return (
    typeof window !== 'undefined' && 
    (window.location.hostname.includes('cloudflare') || 
     window.location.hostname === 'call.whenmeet.me')
  )
}

// Get the current online status
function getSnapshot() {
  // On Cloudflare, always return true regardless of navigator.onLine
  if (isCloudflareEnvironment()) {
    // For debugging
    if (navigator.onLine === false) {
      console.log(
        '%c Browser incorrectly reports offline on Cloudflare, overriding to online',
        'background: orange; color: white; font-weight: bold;'
      )
    }
    return true
  }
  
  // Normal behavior for other environments
  return navigator.onLine
}

// Server snapshot always returns true
function getServerSnapshot() {
  return true
}

// Subscribe to online/offline events
function subscribe(callback: () => void) {
  // On Cloudflare, we still subscribe to events, but we'll override the value
  window.addEventListener('online', callback)
  window.addEventListener('offline', callback)
  return () => {
    window.removeEventListener('online', callback)
    window.removeEventListener('offline', callback)
  }
}

// Hook to check if we're online
export function useIsOnline() {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
}

// Export a helper for direct calls in non-React code
export function isOnline() {
  return isCloudflareEnvironment() ? true : navigator.onLine
}
