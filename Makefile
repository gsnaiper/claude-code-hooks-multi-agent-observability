# Multi-Agent Observability - Development Makefile

.PHONY: help dev server client stop restart clean typecheck logs test test-hitl test-watch test-coverage test-smoke health-check ci-test

# Default target
help:
	@echo "Usage: make [target]"
	@echo ""
	@echo "Development:"
	@echo "  dev        - Start both server and client"
	@echo "  server     - Start server only"
	@echo "  client     - Start client only (with --host for WSL)"
	@echo "  stop       - Stop all dev servers"
	@echo "  restart    - Stop and start all servers"
	@echo ""
	@echo "Checks:"
	@echo "  typecheck  - Run TypeScript type checking"
	@echo "  logs       - Show server logs"
	@echo ""
	@echo "Testing:"
	@echo "  test           - Run all tests"
	@echo "  test-hitl      - Run HITL tests only"
	@echo "  test-watch     - Run tests in watch mode"
	@echo "  test-coverage  - Run tests with coverage"
	@echo "  test-smoke     - Run smoke tests"
	@echo "  health-check   - Run health check"
	@echo "  ci-test        - Run CI test suite"
	@echo ""
	@echo "Cleanup:"
	@echo "  clean      - Kill all node/bun processes on dev ports"

# Start both server and client
dev: stop
	@echo "Starting server..."
	@cd apps/server && bun run dev &
	@sleep 2
	@echo "Starting client..."
	@cd apps/client && bun run dev --host &
	@sleep 3
	@echo ""
	@echo "Services started:"
	@echo "  Server: http://localhost:4000"
	@lsof -i :5173 -i :5174 -i :5175 2>/dev/null | grep LISTEN | head -1 | awk '{print "  Client: http://localhost:" $$9}' | sed 's/:$$//'
	@echo ""

# Start server only
server:
	@pkill -f "bun.*apps/server" 2>/dev/null || true
	@sleep 1
	@echo "Starting server on http://localhost:4000..."
	@cd apps/server && bun run dev

# Start client only
client:
	@pkill -f "vite" 2>/dev/null || true
	@sleep 1
	@echo "Starting client with --host..."
	@cd apps/client && bun run dev --host

# Stop all dev servers
stop:
	@echo "Stopping servers..."
	@pkill -f "vite" 2>/dev/null || true
	@pkill -f "bun.*apps/server" 2>/dev/null || true
	@fuser -k 4000/tcp 2>/dev/null || true
	@fuser -k 5173/tcp 2>/dev/null || true
	@fuser -k 5174/tcp 2>/dev/null || true
	@fuser -k 5175/tcp 2>/dev/null || true
	@sleep 1
	@echo "Servers stopped"

# Restart all servers
restart: stop dev

# TypeScript type checking
typecheck:
	@echo "Type checking client..."
	@cd apps/client && bunx vue-tsc --noEmit
	@echo "Client: OK"

# Show server logs
logs:
	@echo "Checking running processes..."
	@lsof -i :4000 -i :5173 -i :5174 -i :5175 2>/dev/null || echo "No servers running"

# Clean up - kill all related processes
clean:
	@echo "Killing all node/bun processes..."
	@pkill -9 -f "vite" 2>/dev/null || true
	@pkill -9 -f "bun" 2>/dev/null || true
	@fuser -k 4000/tcp 2>/dev/null || true
	@fuser -k 5173/tcp 2>/dev/null || true
	@fuser -k 5174/tcp 2>/dev/null || true
	@fuser -k 5175/tcp 2>/dev/null || true
	@echo "Cleanup complete"

# Testing commands
test:
	cd apps/server && bun test

test-hitl:
	cd apps/server && bun test src/hitl/__tests__/

test-watch:
	cd apps/server && bun test --watch

test-coverage:
	cd apps/server && bun test --coverage

test-smoke:
	bun run scripts/hitl-smoke-test.ts

health-check:
	bun run scripts/hitl-health-check.ts

# CI/CD
ci-test: test test-smoke
