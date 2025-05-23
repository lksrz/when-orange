/** @type {import('eslint').Linter.Config} */
module.exports = {
	extends: ['@remix-run/eslint-config', '@remix-run/eslint-config/node'],
	ignorePatterns: [
		'/public/noise/*',
		'/public/e2ee/wasm-pkg/*',
		'/public/e2ee/worker.js',
	],
	rules: {
		'@typescript-eslint/no-extra-semi': ['off'],
		'@typescript-eslint/no-unused-vars': [
			'warn',
			{
				// vars: "all",
				varsIgnorePattern: '^_',
				// args: "after-used",
				argsIgnorePattern: '^_',
			},
		],
	},
}
