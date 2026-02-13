# Metabolomics Viewer App

A simple app to visualize metabolomics data from mzML/XML files.

## Features

- **Data Source Selection**: Browse localized folders for mzML files.
- **Chromatogram Extraction**: Extract XICs based on target mass and tolerance.
- **Interactive Visualization**: Click on chromatogram peaks to view mass spectra.

## Prerequisites

- Node.js & npm
- Python 3.8+

## Quick Start from Terminal

```bash
chmod +x run.sh
./run.sh
```

## Manual Setup

### Backend (FastAPI)

1. Navigate to `backend/`:
   ```bash
   cd backend
   ```
2. Create virtual environment (optional but recommended):
   ```bash
   python -m venv venv
   source venv/bin/activate
   ```
3. Install dependencies:
   ```bash
   pip install -r requirements.txt
   ```
4. Run server:
   ```bash
   uvicorn main:app --reload
   ```
   Server runs at `http://localhost:8000`.

### Frontend (React + Vite)

1. Navigate to `frontend/`:
   ```bash
   cd frontend
   ```
2. Install dependencies:
   ```bash
   npm install
   ```
3. Run dev server:
   ```bash
   npm run dev
   ```
   App runs at `http://localhost:5173`.

## Usage

1. Open the app in browser.
2. Enter the absolute path to your data folder (e.g., `/Users/yourname/data`).
3. Click "Load Folder".
4. Select a file from the dropdown.
5. Enter Target m/z and Tolerance.
6. Click "Extract XIC".
7. Click on points in the chromatogram to view spectra.
