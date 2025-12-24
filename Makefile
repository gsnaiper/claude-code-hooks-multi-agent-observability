# Multi-Agent Observability - Development Makefile

.PHONY: help dev server client stop restart clean typecheck logs

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
