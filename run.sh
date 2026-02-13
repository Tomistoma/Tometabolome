#!/bin/bash

# Function to kill background processes on exit
cleanup() {
    echo "Stopping servers..."
    kill $(jobs -p)
}
trap cleanup EXIT

echo "Starting Backend..."
cd backend
# Check if uvicorn is installed, if not try pip install again
if ! command -v uvicorn &> /dev/null && ! python3 -m uvicorn --version &> /dev/null; then
    echo "Installing backend dependencies..."
    pip install -r requirements.txt
fi

python3 -m uvicorn main:app --reload --port 8000 &
BACKEND_PID=$!
cd ..

echo "Starting Frontend..."
cd frontend
if [ ! -d "node_modules" ]; then
    echo "Installing frontend dependencies..."
    npm install
fi
npm run dev
