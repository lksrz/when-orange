import { redirect } from '@remix-run/cloudflare'
import { commitSession, getSession } from '~/session'
import { ACCESS_AUTHENTICATED_USER_EMAIL_HEADER } from './constants'

export async function setUsername(
	username: string,
	request: Request,
	returnUrl: string = '/'
) {
	const session = await getSession(request.headers.get('Cookie'))
	session.set('username', username)
	throw redirect(returnUrl, {
		headers: {
			'Set-Cookie': await commitSession(session),
		},
	})
}

/**
 * Utility for getting the username. In production, this basically
 * gets the Cf-Access-Authenticated-User-Email header.
 * In development we allow manually setting this via the username query param.
 */
export default async function getUsername(request: Request) {
	// First check if there's an access header
	const accessUsername = request.headers.get(ACCESS_AUTHENTICATED_USER_EMAIL_HEADER)
	if (accessUsername) return accessUsername

	// Get the current session (if any)
	const session = await getSession(request.headers.get('Cookie'))
	const sessionUsername = session.get('username')

	// Check if a username is provided via query parameter
	const url = new URL(request.url)
	const queryUsername = url.searchParams.get('username')
	// If a username is provided and doesn't match the session (or there is no session),
	// call setUsername which sets the cookie and redirects back to the cleaned URL
	if (queryUsername && sessionUsername !== queryUsername) {
		url.searchParams.delete('username')
		return setUsername(queryUsername, request, url.toString())
	}

	if (sessionUsername) return sessionUsername

	return null
}
