#!/bin/bash
cd "$(dirname "$0")" || exit 1

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js is not installed. Install Node 20 LTS from https://nodejs.org (or: brew install node@20) and try again."
  read -r -p "Press Enter to close..."
  exit 1
fi

if [ ! -d node_modules ]; then
  echo "Installing dependencies..."
  npm install || { read -r -p "Press Enter to close..."; exit 1; }
fi

[ -f .env ] || cp .env.example .env

npm start
