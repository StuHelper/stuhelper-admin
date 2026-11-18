.PHONY: setup check browser storage-browser build dev generate preview
setup:
	LEFTHOOK=0 pnpm install --frozen-lockfile
	pnpm run setup
check:
	node scripts/check-platform-contract.mjs
	node scripts/check-contribution-contract.mjs
	pnpm exec stuhelper-check repository
	node scripts/check-storage-contract.mjs
	pnpm --dir scripts/contracts check
	pnpm check
	pnpm exec stuhelper-check workflows
browser:
	pnpm exec playwright test --config playwright.config.mjs $(if $(MODULE),tests/e2e/$(MODULE).spec.mjs,$(SPEC)) $(ARGS)
storage-browser:
	$(MAKE) browser
build:
	pnpm build
dev:
	pnpm dev
generate:
	pnpm generate

preview:
	pnpm --filter @stuhelper/admin exec vite preview --port $${STUHELPER_PREVIEW_PORT:-5174}
