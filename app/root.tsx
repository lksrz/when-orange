import {
	json,
	redirect,
	type LinksFunction,
	type LoaderFunctionArgs,
	type MetaFunction,
} from '@remix-run/cloudflare'
import {
	Links,
	LiveReload,
	Meta,
	Outlet,
	Scripts,
	ScrollRestoration,
	useLoaderData,
	useLocation,
} from '@remix-run/react'
import { parse } from 'cookie'
import type { FC, ReactNode } from 'react'
import { useRef } from 'react'
import { useFullscreen, useToggle } from 'react-use'

import { QueryClient, QueryClientProvider } from 'react-query'
import tailwind from '~/styles/tailwind.css'
import { elementNotContainedByClickTarget } from './utils/elementNotContainedByClickTarget'
import getUsername from './utils/getUsername.server'
import { cn } from './utils/style'

function addOneDay(date: Date): Date {
	const result = new Date(date)
	result.setTime(result.getTime() + 24 * 60 * 60 * 1000)
	return result
}

export const loader = async ({ request, context }: LoaderFunctionArgs) => {
	const url = new URL(request.url)
	const username = await getUsername(request)
	if (!username && url.pathname !== '/set-username') {
		const redirectUrl = new URL(url)
		redirectUrl.pathname = '/set-username'
		redirectUrl.searchParams.set('return-url', request.url)
		throw redirect(redirectUrl.toString())
	}

	const defaultResponse = json({
		userDirectoryUrl: context.env.USER_DIRECTORY_URL,
	})

	// we only care about verifying token freshness if request was a user
	// initiated document request.
	// https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Sec-Fetch-User
	const secFetchUser = request.headers.get('Sec-Fetch-User')
	if (secFetchUser !== '?1') return defaultResponse
	const cookiesHeader = request.headers.get('Cookie')
	if (!cookiesHeader) return defaultResponse
	const { CF_Authorization } = parse(cookiesHeader)
	if (!CF_Authorization) return defaultResponse

	const [, payload] = CF_Authorization.split('.')
	const data = JSON.parse(atob(payload))
	const expires = new Date(data.exp * 1000)
	const now = new Date()
	if (addOneDay(now) > expires) {
		const headers = new Headers()
		;['CF_Authorization', 'CF_AppSession'].forEach((cookieName) =>
			headers.append(
				'Set-Cookie',
				`${cookieName}=; Expires=${new Date(0).toUTCString()}; Path=/;`
			)
		)

		throw redirect(request.url, { headers })
	}

	return defaultResponse
}

export const meta: MetaFunction = () => [
	{
		title: 'WhenMeet.me Call',
	},
]

export const links: LinksFunction = () => [
	{ rel: 'stylesheet', href: tailwind },
	{
		rel: 'apple-touch-icon',
		sizes: '180x180',
		href: '/apple-touch-icon.png?v=orange-emoji',
	},
	{
		rel: 'icon',
		type: 'image/png',
		sizes: '32x32',
		href: '/favicon-32x32.png?v=orange-emoji',
	},
	{
		rel: 'icon',
		type: 'image/png',
		sizes: '16x16',
		href: '/favicon-16x16.png?v=orange-emoji',
	},
	{
		rel: 'manifest',
		href: '/site.webmanifest',
		crossOrigin: 'use-credentials',
	},
	{
		rel: 'mask-icon',
		href: '/safari-pinned-tab.svg?v=orange-emoji',
		color: '#faa339',
	},
	{
		rel: 'shortcut icon',
		href: '/favicon.ico?v=orange',
	},
]

const Document: FC<{ children?: ReactNode }> = ({ children }) => {
	const fullscreenRef = useRef<HTMLBodyElement>(null)
	const [fullscreenEnabled, toggleFullscreen] = useToggle(false)
	const location = useLocation()
	useFullscreen(fullscreenRef, fullscreenEnabled, {
		onClose: () => toggleFullscreen(false),
	})
	return (
		// some extensions add data attributes to the html
		// element that React complains about.
		<html lang="en" suppressHydrationWarning>
			<head>
				<meta charSet="utf-8" />
				<meta name="viewport" content="width=device-width, initial-scale=1" />
				<meta name="apple-mobile-web-app-title" content="WhenMeet.me Call" />
				<meta name="application-name" content="WhenMeet.me Call" />
				<meta name="msapplication-TileColor" content="#ffffff" />
				<meta
					name="theme-color"
					content="#ffffff"
				/>
				<Meta />
				<Links />
			</head>
			<body
				className={cn(
					'bg-gray-100',
					'min-h-screen',
					'flex flex-col flex-grow'
				)}
				ref={fullscreenRef}
				onDoubleClick={(e) => {
					if (
						e.target instanceof HTMLElement &&
						!elementNotContainedByClickTarget(e.target)
					)
						toggleFullscreen()
				}}
			>
				{!location.pathname.endsWith('/room') && <Header />}
				{children}
				<ScrollRestoration />
				<div className="hidden" suppressHydrationWarning>
					{/* Replaced in entry.server.ts */}
					__CLIENT_ENV__
				</div>
				{!location.pathname.endsWith('/room') && <Footer />}
				<Scripts />
				<LiveReload />
			</body>
		</html>
	)
}

export const ErrorBoundary = () => {
	return (
		<Document>
			<div className="grid h-full place-items-center">
				<p>
					It looks like there was an error, but don't worry it has been
					reported. Sorry about that!
				</p>
			</div>
		</Document>
	)
}

const queryClient = new QueryClient()

export default function App() {
	const { userDirectoryUrl } = useLoaderData<typeof loader>()
	return (
		<Document>
			<div id="root" className="h-full bg-inherit isolate">
				<QueryClientProvider client={queryClient}>
					<Outlet
						context={{
							userDirectoryUrl,
						}}
					/>
				</QueryClientProvider>
			</div>
		</Document>
	)
}

export const Footer = () => {
	return (
		<footer className="bg-gray-50 border-t border-gray-200 py-4">
			<div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
				<div className="flex justify-between items-center">
					<p className="text-sm text-gray-500">
			© {new Date().getFullYear()} WhenMeet.me
			</p>
			<a href="https://whenmeet.me/privacy" className="text-sm text-gray-500 hover:text-gray-700">
			Privacy Policy
			</a>
		</div>
		</div>
		</footer>
	)
}

export const Header = () => {
	return (
	  <nav className="bg-white shadow-sm">
		<div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
		  <div className="flex items-center justify-between h-16">
			<div className="flex items-center gap-4">
			  <div className="text-xl font-semibold hidden sm:block">
				<a href="https://whenmeet.me/" className="no-underline">WhenMeet<span className="text-blue-500">?</span>me</a>
			  </div>
			  <div className="text-xl font-semibold sm:hidden">
				<a href="https://whenmeet.me/" className="no-underline">WhenMeet<span className="text-blue-500">?</span>me</a>
			  </div>
				<button
				  onClick={() => window.location.href = 'https://whenmeet.me/'}
				  className="bg-blue-500 text-white px-3 sm:px-4 py-2 rounded hover:bg-blue-600 text-sm whitespace-nowrap"
				>
				  New Event
				</button>
			</div>
		  </div>
		</div>
	  </nav>
	)
  } 