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
		hasTranscriptionCredentials: !!context.env.DEEPGRAM_SECRET,
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
				<meta name="theme-color" content="#ffffff" />
				<Meta />
				<Links />
			</head>
			<body
				className={cn('bg-gray-100', 'min-h-screen', 'flex flex-col flex-grow')}
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
					<p className="text-[10px] sm:text-sm text-gray-500">
						© {new Date().getFullYear()} WhenMeet.me
					</p>
					<div className="flex items-center justify-center gap-1 sm:gap-2">
						<p className="text-[10px] sm:text-sm text-gray-500">Powered by</p>
						<img
							src="cflogo.png"
							alt="Cloudflare Logo"
							className="h-[16px] sm:h-[20px]"
						/>
						<div className="h-[30px] w-[30px] overflow-hidden">
							<svg
								xmlns="http://www.w3.org/2000/svg"
								fill="none"
								height="30"
								width="30"
								viewBox="0 0 120 120"
								className="hidden sm:block"
							>
								<g clip-path="url(#clip0_327_2248)">
									<mask
										id="mask0_327_2248"
										width="314"
										height="289"
										x="-197"
										y="-85"
										maskUnits="userSpaceOnUse"
										style={{ maskType: 'alpha' }}
									>
										<path
											stroke="#F63"
											stroke-linecap="round"
											stroke-width="1.4"
											d="M92.88 88.89V30.14M98.63 38.82v41.96M104.38 50.6v18.7M110.2 55.76l-.07 7M116 52.81l-.03 14.28M23.86 88.89V30.14M69.87 73.42V45.45M46.87 80.79V38.83M87.13 96.25V23.52M18.11 68.27V51.5M64.12 77.84V41.48M41.12 84.47V34.12M81.38 106.55V11.96M12.36 68.27V51.5M58.37 77.84V41.48M35.37 99.2V19.67M7 75V45M.86 141.9V-23.16M75.62 90.36V28.82M52.62 74.9V44.13M29.61 82.26V37.5"
										></path>
									</mask>
									<g mask="url(#mask0_327_2248)">
										<path
											fill="url(#paint0_linear_327_2248)"
											fill-opacity=".4"
											d="M121 115H4V5h117v110Z"
										></path>
									</g>
									<path
										fill="url(#paint1_linear_327_2248)"
										fill-rule="evenodd"
										d="M51.92 51.5c1.2-2.34 6.43-4.21 7.6-5.04l.79-.7-.52-11.55s-6.79-4.48-13.93 1.6c-13.49 11.98 12.37 56.77 29.5 51.08 9-3.1 8.52-11.22 8.52-11.22l-9.93-6.28-1.3.6c-1.25.43-5.24 3.93-7.86 3.8-2.28-.04-13.97-20.3-12.87-22.28Z"
										clip-rule="evenodd"
									></path>
									<path
										stroke="#fff"
										stroke-width="1.03"
										d="m69.11 73.06 11.99 9.59M55.35 48.25l-2.3-15.17"
									></path>
								</g>
								<defs>
									<linearGradient
										id="paint0_linear_327_2248"
										x1="114.22"
										x2="8.98"
										y1="77.19"
										y2="77.74"
										gradientUnits="userSpaceOnUse"
									>
										<stop stop-color="#F63"></stop>
										<stop offset=".45" stop-color="#F6821F"></stop>
										<stop offset=".96" stop-color="#FBAD41"></stop>
									</linearGradient>
									<linearGradient
										id="paint1_linear_327_2248"
										x1="58.57"
										x2="70.38"
										y1="76.75"
										y2="32.68"
										gradientUnits="userSpaceOnUse"
									>
										<stop stop-color="#F63"></stop>
										<stop offset=".37" stop-color="#F6821F"></stop>
										<stop offset=".69" stop-color="#FBAD41"></stop>
										<stop offset=".99" stop-color="#FFE9CB"></stop>
									</linearGradient>
									<clipPath id="clip0_327_2248">
										<path fill="#fff" d="M0 0h120v120H0z"></path>
									</clipPath>
								</defs>
							</svg>
						</div>
					</div>
					<a
						href="https://whenmeet.me/privacy"
						className="text-[10px] sm:text-sm text-gray-500 hover:text-gray-700"
					>
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
							<a href="https://whenmeet.me/" className="no-underline">
								WhenMeet<span className="text-blue-500 font-bold">?</span>me
							</a>
						</div>
						<div className="text-xl font-semibold sm:hidden">
							<a href="https://whenmeet.me/" className="no-underline">
								WhenMeet<span className="text-blue-500">?</span>me
							</a>
						</div>
						<button
							onClick={() => (window.location.href = 'https://whenmeet.me/')}
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
