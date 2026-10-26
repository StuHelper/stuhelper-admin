.PHONY: setup check build dev generate
setup:
	LEFTHOOK=0 pnpm install --frozen-lockfile
	pnpm run setup
check:
	pnpm exec stuhelper-check repository
	node scripts/check-storage-contract.mjs
	pnpm --dir scripts/contracts check
	pnpm check
	pnpm exec stuhelper-check workflows
storage-browser:
	pnpm exec playwright test --config playwright.storage.config.mjs
build:
	pnpm build
dev:
	pnpm dev
generate:
	pnpm generate

preview:
	pnpm --filter @stuhelper/admin exec vite preview --port $${STUHELPER_PREVIEW_PORT:-5174}
