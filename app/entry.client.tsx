import { RemixBrowser } from '@remix-run/react'
import { startTransition } from 'react'
import { hydrateRoot } from 'react-dom/client'

// Import console filter to reduce logging noise from external libraries
import '~/utils/consoleFilter'

startTransition(() => {
	hydrateRoot(document, <RemixBrowser />)
})
