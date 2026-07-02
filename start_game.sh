#!/bin/bash

# Get the directory where this script is located
PROJECT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"

echo "===================================================="
echo "  EYES ON ME - PROJECT STARTER (Linux/macOS)"
echo "===================================================="
echo

# Start Backend
echo "[1/2] Starting Backend API Server (Uvicorn)..."
cd "$PROJECT_DIR/backend"
if [ -f ".venv/bin/python" ]; then
  .venv/bin/python -m uvicorn app.main:app --reload --host 127.0.0.1 --port 8000 &
else
  python3 -m uvicorn app.main:app --reload --host 127.0.0.1 --port 8000 &
fi
BACKEND_PID=$!

# Start Frontend
echo "[2/2] Starting Frontend Vite Server..."
cd "$PROJECT_DIR/frontend"
npm run dev &
FRONTEND_PID=$!

echo
echo "===================================================="
echo " Servers have been launched in the background!"
echo " Please open: http://localhost:5173/?p1demo"
echo " Press Ctrl+C to stop both servers."
echo "===================================================="
echo

# Function to clean up background processes on exit
cleanup() {
  echo
  echo "Shutting down servers..."
  kill $BACKEND_PID 2>/dev/null
  kill $FRONTEND_PID 2>/dev/null
  exit
}

# Trap SIGINT (Ctrl+C) and call cleanup
trap cleanup SIGINT

# Keep script running to keep processes alive and allow clean shutdown
wait
