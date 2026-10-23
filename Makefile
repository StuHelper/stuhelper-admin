export PATH := $(CURDIR)/.tools/bin:$(PATH)

.PHONY: setup check build dev generate
setup:
	mkdir -p .tools/bin
	corepack enable --install-directory .tools/bin pnpm
	corepack pnpm install --frozen-lockfile
	corepack pnpm run setup
check:
	corepack pnpm check
build:
	corepack pnpm build
dev:
	corepack pnpm dev
generate:
	corepack pnpm generate

preview:
	corepack pnpm --filter @stuhelper/admin exec vite preview --port $${STUHELPER_PREVIEW_PORT:-5174}
