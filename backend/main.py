from fastapi import FastAPI, HTTPException, Body
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from typing import List, Optional
import os
import glob
import pyopenms as oms
import numpy as np

app = FastAPI()

# Allow CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"], # Vite default port
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# Global cache
loaded_files = {} # { filepath: exp }
# Fast access indices: { filepath: { "ms1_rts": np.array, "ms1_indices": [exp_idx, ...], "ms2_mzs": np.array, "ms2_rts": np.array, "ms2_indices": [exp_idx, ...], "scan_list": [...] } }
file_indices = {}

def load_ms_data(filepath):
    if filepath in loaded_files:
        return loaded_files[filepath]
    
    if not os.path.exists(filepath):
        raise FileNotFoundError(f"File not found: {filepath}")

    exp = oms.MSExperiment()
    oms.MzMLFile().load(filepath, exp)
    loaded_files[filepath] = exp
    
    # Pre-build indices and scan list
    ms1_rts = []
    ms1_indices = []
    ms2_mzs = []
    ms2_rts = []
    ms2_indices = []
    scan_list = []
    
    ms1_count = 0
    for i, spec in enumerate(exp.getSpectra()):
        rt = float(spec.getRT())
        level = spec.getMSLevel()
        
        if level == 1:
            ms1_rts.append(rt)
            ms1_indices.append(i)
            
            mzs, intensities = spec.get_peaks()
            base_peak_idx = np.argmax(intensities) if len(intensities) > 0 else -1
            scan_list.append({
                "id": ms1_count,
                "rt": rt,
                "tic": float(np.sum(intensities)),
                "base_peak_mz": float(mzs[base_peak_idx]) if base_peak_idx != -1 else 0.0,
                "base_peak_int": float(intensities[base_peak_idx]) if base_peak_idx != -1 else 0.0
            })
            ms1_count += 1
        elif level == 2:
            precursors = spec.getPrecursors()
            if precursors:
                ms2_mzs.append(float(precursors[0].getMZ()))
                ms2_rts.append(rt)
                ms2_indices.append(i)
    
    file_indices[filepath] = {
        "ms1_rts": np.array(ms1_rts),
        "ms1_indices": ms1_indices,
        "ms2_mzs": np.array(ms2_mzs),
        "ms2_rts": np.array(ms2_rts),
        "ms2_indices": ms2_indices,
        "scan_list": scan_list
    }
    
    return exp

@app.get("/browse-files")
def browse_files(path: Optional[str] = None):
    # Default to home directory if no path provided
    if path is None or path == "":
        path = os.path.expanduser("~")
    
    if not os.path.exists(path) or not os.path.isdir(path):
         raise HTTPException(status_code=404, detail="Path not found or is not a directory")
    
    try:
        items = os.listdir(path)
    except PermissionError:
        raise HTTPException(status_code=403, detail="Permission denied")

    folders = []
    files = []
    
    for item in sorted(items):
        if item.startswith('.'): continue # Skip hidden files
        
        full_path = os.path.join(path, item)
        if os.path.isdir(full_path):
            folders.append(item)
        elif item.lower().endswith(('.mzml', '.xml')):
            files.append(item)
            
    return {
        "current_path": path,
        "parent_path": os.path.dirname(path),
        "folders": folders,
        "files": files
    }

@app.post("/get-tic")
def get_tic(filepath: str = Body(..., embed=True)):
    if not os.path.exists(filepath):
        raise HTTPException(status_code=404, detail="File not found")

    try:
        exp = load_ms_data(filepath)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

    rts = []
    ints = []
    
    # Get TIC
    for spec in exp.getSpectra():
        if spec.getMSLevel() == 1:
            rts.append(spec.getRT())
            mzs, intensities = spec.get_peaks()
            ints.append(float(np.sum(intensities)))
    
    # Safe limit for high resolution
    if len(rts) > 100000:
        step = len(rts) // 100000
        rts = rts[::step]
        ints = ints[::step]
            
    return {"rts": rts, "ints": ints}

@app.post("/extract-chromatogram")
def extract_chromatogram(
    filepath: str = Body(...),
    min_mz: float = Body(...),
    max_mz: float = Body(...)
):
    if not os.path.exists(filepath):
        raise HTTPException(status_code=404, detail="File not found")

    try:
        exp = load_ms_data(filepath)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

    rts = []
    ints = []
    
    for spec in exp.getSpectra():
        if spec.getMSLevel() == 1:
            rts.append(spec.getRT())
            mzs, intensities = spec.get_peaks()
            mask = (mzs >= min_mz) & (mzs <= max_mz)
            ints.append(float(np.sum(intensities[mask])))
    
    # Safe limit to prevent browser crash, but high enough for full resolution
    if len(rts) > 100000:
        step = len(rts) // 100000
        rts = rts[::step]
        ints = ints[::step]
            
    return {"rts": rts, "ints": ints}

@app.post("/get-spectrum")
def get_spectrum(
    filepath: str = Body(...),
    rt: float = Body(...)
):
    if not os.path.exists(filepath):
        raise HTTPException(status_code=404, detail="File not found")
    
    try:
        exp = load_ms_data(filepath)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

    indices = file_indices.get(filepath)
    if not indices:
        raise HTTPException(status_code=500, detail="Indices not found")
        
    ms1_rts = indices["ms1_rts"]
    # Binary search for closest RT
    idx = np.searchsorted(ms1_rts, rt)
    
    # Check current and previous
    best_idx_in_ms1 = idx
    if idx >= len(ms1_rts):
        best_idx_in_ms1 = len(ms1_rts) - 1
    elif idx > 0:
        if abs(ms1_rts[idx-1] - rt) < abs(ms1_rts[idx] - rt):
            best_idx_in_ms1 = idx - 1
            
    best_exp_idx = indices["ms1_indices"][best_idx_in_ms1]
    best_spec = exp.getSpectra()[best_exp_idx]
    
    if best_spec:
        mzs, ints = best_spec.get_peaks()
        rt_actual = best_spec.getRT()
        
        # Identify peaks with MS2 (optimized)
        has_ms2_mzs = []
        ms2_rts = indices["ms2_rts"]
        ms2_mzs_all = indices["ms2_mzs"]
        
        # Filter MS2 precursors by RT window (1 minute)
        mask = np.abs(ms2_rts - rt_actual) < 60.0
        candidate_mzs = np.sort(ms2_mzs_all[mask])
        
        if len(candidate_mzs) > 0 and len(mzs) > 0:
            # Find closest candidate for each mz
            match_indices = np.searchsorted(candidate_mzs, mzs)
            
            # Vectorized closeness check
            # Check candidate at match_indices and candidate at match_indices - 1
            left_indices = np.maximum(0, match_indices - 1)
            right_indices = np.minimum(len(candidate_mzs) - 1, match_indices)
            
            diff_left = np.abs(candidate_mzs[left_indices] - mzs)
            diff_right = np.abs(candidate_mzs[right_indices] - mzs)
            
            # Combine
            is_match = (diff_left < 0.1) | (diff_right < 0.1)
            has_ms2_mzs = mzs[is_match].tolist()

        return {
            "mzs": mzs.tolist(),
            "ints": ints.tolist(),
            "rt": rt_actual,
            "has_ms2": has_ms2_mzs
        }
    
    raise HTTPException(status_code=404, detail="Spectrum not found")

@app.get("/get-demo-path")
def get_demo_path():
    demo_path = os.path.join(os.path.dirname(__file__), "dummy.mzML")
    if os.path.exists(demo_path):
        return {"path": demo_path}
    raise HTTPException(status_code=404, detail="Demo file not found")

@app.post("/get-ms2-spectrum")
def get_ms2_spectrum(
    filepath: str = Body(...),
    precursor_mz: float = Body(...),
    rt: float = Body(...)
):
    try:
        exp = load_ms_data(filepath)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
        
    indices = file_indices.get(filepath)
    if not indices:
        raise HTTPException(status_code=500, detail="Indices not found")
        
    ms2_mzs = indices["ms2_mzs"]
    ms2_rts = indices["ms2_rts"]
    
    # 1. Filter by MZ tolerance (0.2 Da)
    mz_mask = np.abs(ms2_mzs - precursor_mz) < 0.2
    if not np.any(mz_mask):
        raise HTTPException(status_code=404, detail="MS2 precursor not found")
        
    # 2. Within those, find closest RT (within 120s window)
    matching_rts = ms2_rts[mz_mask]
    matching_indices = np.array(indices["ms2_indices"])[mz_mask]
    
    rt_diffs = np.abs(matching_rts - rt)
    valid_rt_mask = rt_diffs < 120
    
    if not np.any(valid_rt_mask):
        raise HTTPException(status_code=404, detail="MS2 RT out of range")
        
    best_match_idx = np.argmin(rt_diffs[valid_rt_mask])
    best_ms2_idx = matching_indices[valid_rt_mask][best_match_idx]
                        
    if best_ms2_idx != -1:
        spec = exp.getSpectra()[best_ms2_idx]
        mzs, ints = spec.get_peaks()
        return {
            "mzs": mzs.tolist(),
            "ints": ints.tolist(),
            "rt": spec.getRT(),
            "precursor_mz": spec.getPrecursors()[0].getMZ()
        }
        
    raise HTTPException(status_code=404, detail="MS2 spectrum not found")
    
@app.post("/get-scan-list")
def get_scan_list(filepath: str = Body(..., embed=True)):
    if not os.path.exists(filepath):
        raise HTTPException(status_code=404, detail="File not found")

    indices = file_indices.get(filepath)
    if not indices:
        # Fallback to loading it
        load_ms_data(filepath)
        indices = file_indices.get(filepath)
        
    return indices["scan_list"] if indices else []

# Serve static files from React build
# Use absolute path relative to this file
backend_dir = os.path.dirname(os.path.abspath(__file__))
root_dir = os.path.dirname(backend_dir)
frontend_path = os.path.join(root_dir, "frontend", "dist")

# We mount static files at a specific subpath if we want to avoid shadowing, 
# but for a SPA we usually want "/" to serve the index.
# To avoid shadowing @app.get routes, we mount it AFTER all other routes are defined.

@app.get("/{full_path:path}")
async def serve_react_app(full_path: str):
    # If the path looks like a file (has an extension), try to serve it from dist
    file_path = os.path.join(frontend_path, full_path)
    if os.path.isfile(file_path):
        return FileResponse(file_path)
    
    # Fallback to index.html for SPA routing
    index_path = os.path.join(frontend_path, "index.html")
    if os.path.exists(index_path):
        return FileResponse(index_path)
    
    return {"message": "Frontend not built yet. Ensure 'npm run build' was successful in the frontend folder."}
