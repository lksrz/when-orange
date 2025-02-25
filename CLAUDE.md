# Orange Meets - Claude Helper

## Build/Lint/Test Commands
- Build: `npm run build`
- Lint: `npm run lint`
- Prettier: `npm run prettier`
- Typecheck: `npm run typecheck`
- Run tests: `npm run test`
- Run single test: `npm run test -- -t 'test name'`
- E2E tests: `npm run test:e2e`
- Check all: `npm run check`

## Code Style
- TypeScript strict mode with React
- Tabs for indentation, no semicolons, single quotes
- Organized imports (using prettier-plugin-organize-imports)
- PascalCase for components, camelCase for functions/variables
- Use explicit type annotations for function parameters
- Use React hooks and functional components
- Error handling with try/catch blocks and proper error typing
- Use tailwind for styling via className
- Prefer async/await over Promises
- Use Radix UI components where applicable