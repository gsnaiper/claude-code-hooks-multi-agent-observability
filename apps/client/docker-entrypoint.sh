#!/bin/sh
set -e

# Default values
BACKEND_HOST=${BACKEND_HOST:-server}
BACKEND_PORT=${BACKEND_PORT:-4000}

# Substitute environment variables in nginx config
envsubst '${BACKEND_HOST} ${BACKEND_PORT}' < /etc/nginx/conf.d/default.conf.template > /etc/nginx/conf.d/default.conf

echo "Gateway configured: backend=${BACKEND_HOST}:${BACKEND_PORT}"

exec "$@"
