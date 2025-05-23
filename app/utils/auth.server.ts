/**
 * Utilities for handling authentication and tokens
 */

/**
 * Generates a signed authentication token for the transcription service
 * The token is a JWT-like structure that includes:
 * - username: The user's identifier
 * - timestamp: When the token was created
 * - expiry: When the token expires
 */
export async function generateAuthToken(
	username: string,
	secret: string
): Promise<string> {
	// Validate inputs
	if (!secret) {
		throw new Error(
			'AUTH_SECRET environment variable is required for token generation'
		)
	}

	if (
		!username ||
		typeof username !== 'string' ||
		username.length < 1 ||
		username.length > 255
	) {
		throw new Error('Valid username is required for token generation')
	}

	// Sanitize username (remove control characters and ensure it's not all whitespace)
	const sanitizedUsername = username
		.replace(/[\u0000-\u001F\u007F-\u009F]/g, '')
		.trim()
	if (!sanitizedUsername) {
		throw new Error('Username contains only whitespace or invalid characters')
	}

	// Create the payload
	const now = Date.now()
	const payload = {
		username: sanitizedUsername,
		timestamp: now,
		expiry: now + 24 * 60 * 60 * 1000, // 24 hour expiry
	}

	// Convert payload to string
	const payloadStr = JSON.stringify(payload)

	// Create the signature using SubtleCrypto
	const encoder = new TextEncoder()
	const secretKey = await crypto.subtle.importKey(
		'raw',
		encoder.encode(secret),
		{ name: 'HMAC', hash: 'SHA-256' },
		false,
		['sign']
	)

	const signature = await crypto.subtle.sign(
		'HMAC',
		secretKey,
		encoder.encode(payloadStr)
	)

	// Convert signature to base64
	const signatureBase64 = btoa(
		String.fromCharCode(...new Uint8Array(signature))
	)

	// Create token as base64-encoded payload + "." + signature
	return `${btoa(payloadStr)}.${signatureBase64}`
}

/**
 * Verifies an authentication token
 * Returns the username if valid, null if invalid
 */
export async function verifyAuthToken(
	token: string,
	secret: string
): Promise<string | null> {
	if (!token || !secret) {
		return null
	}

	try {
		// Split token into payload and signature
		const [payloadBase64, signatureBase64] = token.split('.')
		if (!payloadBase64 || !signatureBase64) {
			return null
		}

		// Decode payload
		const payloadStr = atob(payloadBase64)
		const payload = JSON.parse(payloadStr)

		// Check token expiry
		if (!payload.expiry || payload.expiry < Date.now()) {
			return null
		}

		// Verify signature
		const encoder = new TextEncoder()
		const secretKey = await crypto.subtle.importKey(
			'raw',
			encoder.encode(secret),
			{ name: 'HMAC', hash: 'SHA-256' },
			false,
			['verify']
		)

		// Decode signature from base64
		const signatureArray = Uint8Array.from(atob(signatureBase64), (c) =>
			c.charCodeAt(0)
		)

		// Verify the signature
		const isValid = await crypto.subtle.verify(
			'HMAC',
			secretKey,
			signatureArray,
			encoder.encode(payloadStr)
		)

		// If signature is valid, return the username
		return isValid ? payload.username : null
	} catch (error) {
		console.error('Error verifying auth token:', error)
		return null
	}
}
