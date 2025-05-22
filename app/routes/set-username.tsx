import { redirect, type ActionFunctionArgs } from '@remix-run/cloudflare'
import { Form } from '@remix-run/react'
import invariant from 'tiny-invariant'
import { Button } from '~/components/Button'
import { Input } from '~/components/Input'
import { ACCESS_AUTHENTICATED_USER_EMAIL_HEADER } from '~/utils/constants'
import { setUsername } from '~/utils/getUsername.server'

export const action = async ({ request }: ActionFunctionArgs) => {
	const url = new URL(request.url)
	const returnUrl = url.searchParams.get('return-url') ?? '/'
	const accessUsername = request.headers.get(
		ACCESS_AUTHENTICATED_USER_EMAIL_HEADER
	)
	if (accessUsername) throw redirect(returnUrl)
	const { username } = Object.fromEntries(await request.formData())
	invariant(typeof username === 'string')
	return setUsername(username, request, returnUrl)
}

export default function SetUsername() {
	return (
		<div className="min-h-[calc(100vh-127px)] h-full container mx-auto px-4 py-8 flex items-center">
			<div className="w-full">
				<h1 className="text-center text-3xl font-bold text-gray-900 sm:text-4xl md:text-5xl mb-8">
					Your name
				</h1>

				<div className="max-w-lg mx-auto bg-white p-6 rounded-lg shadow">
					<Form className="space-y-6" method="post">
						<div>
							<label htmlFor="username">Enter your display name</label>
							<Input
								autoComplete="off"
								autoFocus
								required
								type="text"
								id="username"
								name="username"
							/>
						</div>
						<Button type="submit">Submit</Button>
					</Form>
				</div>
			</div>
		</div>
	)
}
