#!/bin/bash
set -e

echo "Setting up ccc-agent package..."

# Move package.json.tmp to package.json if it doesn't exist
if [ ! -f "package.json" ] && [ -f "package.json.tmp" ]; then
    echo "Creating package.json..."
    mv package.json.tmp package.json
fi

# Install dependencies
echo "Installing dependencies..."
if command -v bun &> /dev/null; then
    bun install
else
    echo "Bun not found, using npm..."
    npm install
fi

# Build the project
echo "Building project..."
if command -v bun &> /dev/null; then
    bun run build
else
    npm run build
fi

# Make the binary executable
if [ -f "dist/index.js" ]; then
    chmod +x dist/index.js
fi

echo "Setup complete!"
echo ""
echo "To start the agent:"
echo "  export CCC_AGENT_ID='your-agent-id'"
echo "  export CCC_AGENT_SECRET='your-agent-secret'"
echo "  bun run dev"
