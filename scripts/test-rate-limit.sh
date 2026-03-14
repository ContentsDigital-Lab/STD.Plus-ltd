#!/bin/bash

PORT="${PORT:-3000}"
URL="http://localhost:${PORT}/api/health"
MAX=200

echo "Sending $MAX requests to $URL..."
echo ""

for i in $(seq 1 $MAX); do
  STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$URL")
  if [ "$STATUS" -eq 429 ]; then
    echo "Request #$i: $STATUS  <-- RATE LIMITED"
  else
    echo "Request #$i: $STATUS"
  fi
done

echo ""
echo "Done."
