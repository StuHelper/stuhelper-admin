.PHONY: setup check build dev generate
setup:
	pnpm install --frozen-lockfile
	pnpm run setup
check:
	pnpm exec stuhelper-check release
	pnpm check
	pnpm exec stuhelper-check workflows
build:
	pnpm build
dev:
	pnpm dev
generate:
	pnpm generate

preview:
	pnpm --filter @stuhelper/admin exec vite preview --port $${STUHELPER_PREVIEW_PORT:-5174}
