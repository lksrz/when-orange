import type { ActionFunction, LoaderFunctionArgs } from '@remix-run/cloudflare'
import { json, redirect } from '@remix-run/cloudflare'
import { Form, useLoaderData, useNavigate } from '@remix-run/react'
import invariant from 'tiny-invariant'
import { Button } from '~/components/Button'
import { Input } from '~/components/Input'
import { Label } from '~/components/Label'
import { useUserMetadata } from '~/hooks/useUserMetadata'
import { ACCESS_AUTHENTICATED_USER_EMAIL_HEADER } from '~/utils/constants'
import getUsername from '~/utils/getUsername.server'

export const loader = async ({ request, context }: LoaderFunctionArgs) => {
	const directoryUrl = context.USER_DIRECTORY_URL
	const username = await getUsername(request)
	invariant(username)
	const usedAccess = request.headers.has(ACCESS_AUTHENTICATED_USER_EMAIL_HEADER)
	return json({ username, usedAccess, directoryUrl })
}

export const action: ActionFunction = async ({ request }) => {
	const formData = await request.formData()
	const room = formData.get('room')
	invariant(typeof room === 'string')

	// If room is empty or only whitespace, redirect to whenmeet.me
	if (!room.trim()) {
		return redirect('https://whenmeet.me')
	}

	return redirect(room.replace(/ /g, '-'))
}

export default function Index() {
	const { username, usedAccess } = useLoaderData<typeof loader>()
	const navigate = useNavigate()
	const { data } = useUserMetadata(username)

	return (
		<div className="min-h-[calc(100vh-127px)] h-full container mx-auto px-4 py-8 flex items-center">
			<div className="w-full">
				<h1 className="text-center text-3xl font-bold text-gray-900 sm:text-4xl md:text-5xl mb-8">
					Join a meeting
				</h1>

				<div className="max-w-lg mx-auto bg-white p-6 rounded-lg shadow">
					<div>
						<div className="flex items-center mb-4">
							<p className="text-sm text-gray-500">
								Your display name: {data?.displayName}
							</p>
							&nbsp;
							{!usedAccess && (
								<a
									className="block text-sm underline text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200"
									href="/set-username"
								>
									Change
								</a>
							)}
						</div>
					</div>
					<Form className="space-y-6" method="post">
						<div>
							<Label htmlFor="room">Meeting ID</Label>
							<Input
								autoComplete="off"
								name="room"
								id="room"
								type="text"
								autoFocus
								required
							/>
						</div>
						<Button type="submit">Join</Button>
					</Form>
				</div>
			</div>
		</div>
	)
}
