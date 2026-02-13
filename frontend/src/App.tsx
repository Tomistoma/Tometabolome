import { useState, useEffect } from 'react';
import Plot from 'react-plotly.js';
import Split from 'react-split'; // Split panes
import './App.css'; 

// Define types for API responses
interface ChromatogramResponse { rts: number[]; ints: number[]; }
interface SpectrumResponse { mzs: number[]; ints: number[]; rt: number; has_ms2?: number[]; }
interface MS2Response { mzs: number[]; ints: number[]; rt: number; precursor_mz: number; }
interface Scan {
  id: number;
  rt: number;
  tic: number;
  base_peak_mz: number;
  base_peak_int: number;
}

const BACKEND_URL = import.meta.env.MODE === 'production' ? '' : 'http://localhost:8000';

function App() {
  // --- STATE ---
  // Browser
  const [manualPath, setManualPath] = useState<string>('');
  
  // Selection & Input
  const [selectedFile, setSelectedFile] = useState<string>(''); 
  const [targetMz, setTargetMz] = useState<number>(150.0);
  const [ppmTol, setPpmTol] = useState<number>(200.0);
  
  // Data
  const [ticData, setTicData] = useState<{ x: number[], y: number[] } | null>(null);
  const [chromData, setChromData] = useState<{ x: number[], y: number[] } | null>(null); // XIC
  const [spectrumData, setSpectrumData] = useState<SpectrumResponse | null>(null);
  
  // UI Control
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [plotRevision, setPlotRevision] = useState<number>(0); 
  const [sidebarVisible] = useState<boolean>(true);
  const [scanList, setScanList] = useState<Scan[]>([]);
  const [currentScanIdx, setCurrentScanIdx] = useState<number>(-1);
  const [chromXRange, setChromXRange] = useState<[number, number] | null>(null);
  const [ctrlPressed, setCtrlPressed] = useState<boolean>(false);
  const [normalizeSpectrum, setNormalizeSpectrum] = useState<boolean>(false);
  const [msXRange, setMsXRange] = useState<[number, number] | null>(null);
  const [ms2Data, setMs2Data] = useState<MS2Response | null>(null);
  const [ms2XRange, setMs2XRange] = useState<[number, number] | null>(null);
  const [ms2Loading, setMs2Loading] = useState<boolean>(false);
  const [showHelp, setShowHelp] = useState<boolean>(false);

  // --- EFFECTS ---
  // Initial demo load removed to favor user upload
  useEffect(() => { 
    // fetchDirectory(''); // Not needed anymore
  }, []);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Control' || e.key === 'Meta') setCtrlPressed(true);

      if (scanList.length === 0) return;
      if (e.key === 'ArrowRight') {
        const nextIdx = Math.min(scanList.length - 1, currentScanIdx + 1);
        if (nextIdx !== currentScanIdx) updateSpectrumByIndex(nextIdx);
      } else if (e.key === 'ArrowLeft') {
        const prevIdx = Math.max(0, currentScanIdx - 1);
        if (prevIdx !== currentScanIdx) updateSpectrumByIndex(prevIdx);
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.key === 'Control' || e.key === 'Meta') setCtrlPressed(false);
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [scanList, currentScanIdx]);

  // --- HELPERS ---
  const getStickData = (mzs: number[], ints: number[], highlightMzs: number[] = []) => {
    const x: number[] = [];
    const y: number[] = [];
    const hx: number[] = [];
    const hy: number[] = [];
    
    for (let i = 0; i < mzs.length; i++) {
      const mz = mzs[i];
      const intensity = ints[i];
      const isHighlighted = highlightMzs.some(m => Math.abs(m - mz) < 0.1);
      
      if (isHighlighted) {
        hx.push(mz, mz, null as any);
        hy.push(0, intensity, null as any);
      } else {
        x.push(mz, mz, null as any);
        y.push(0, intensity, null as any);
      }
    }
    return { x, y, hx, hy };
  };

  const calculateMaxVisibleY = (mzs: number[], ints: number[], range: [number, number] | null) => {
    if (!ints || ints.length === 0) return 1;
    if (!range) return Math.max(...ints) || 1;
    let max = 0;
    for (let i = 0; i < mzs.length; i++) {
        if (mzs[i] >= range[0] && mzs[i] <= range[1]) {
            if (ints[i] > max) max = ints[i];
        }
    }
    return (max > 0) ? max : 1;
  };

  // --- ACTIONS ---
  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    
    // Clear old data immediately to show loading state is fresh
    setSelectedFile('');
    setTicData(null); setChromData(null); setSpectrumData(null);
    setScanList([]); setCurrentScanIdx(-1);
    
    const formData = new FormData();
    formData.append('file', file);
    
    setLoading(true); setError(null);
    try {
        const response = await fetch(`${BACKEND_URL}/upload`, {
            method: 'POST',
            body: formData
        });
        if (!response.ok) {
            const errData = await response.json();
            throw new Error(errData.detail || 'Upload failed.');
        }
        const data = await response.json();
        
        setSelectedFile(data.filepath);
        // Sequential fetch to ensure stability
        await fetchTic(data.filepath);
        await fetchScanList(data.filepath);
    } catch (err: any) { 
        setError(`Upload Error: ${err.message}`); 
    } finally { 
        setLoading(false); 
    }
  };

  const loadDemoData = async () => {
    setLoading(true); setError(null);
    try {
        const response = await fetch(`${BACKEND_URL}/get-demo-path`);
        if (!response.ok) throw new Error('Demo file not available.');
        const data = await response.json();
        setSelectedFile(data.path);
        setTicData(null); setChromData(null); setSpectrumData(null);
        setScanList([]); setCurrentScanIdx(-1);
        fetchTic(data.path);
        fetchScanList(data.path);
    } catch (err: any) { setError(err.message); } finally { setLoading(false); }
  };

  const handleManualPathSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (manualPath) {
        setSelectedFile(manualPath);
        fetchTic(manualPath);
        fetchScanList(manualPath);
    }
  };

  const fetchScanList = async (filepath: string) => {
    setLoading(true);
    try {
        const response = await fetch(`${BACKEND_URL}/get-scan-list`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ filepath })
        });
        if (!response.ok) throw new Error('Failed to get scan list');
        const data: Scan[] = await response.json();
        setScanList(data);
    } catch (err: any) { console.error(err.message); }
    finally { setLoading(false); }
  };

  const fetchTic = async (filepath: string) => {
    setLoading(true);
    setChromXRange(null); // Reset zoom on new file
    try {
        const response = await fetch(`${BACKEND_URL}/get-tic`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ filepath })
        });
        if (!response.ok) {
            const errData = await response.json().catch(() => null);
            throw new Error(errData?.detail || 'Failed to get TIC');
        }
        const data: ChromatogramResponse = await response.json();
        setTicData({ x: data.rts, y: data.ints });
        setPlotRevision(prev => prev + 1); 
    } catch (err: any) { setError(err.message); } finally { setLoading(false); }
  };

  const fetchChromatogram = async () => {
    if (!selectedFile) return;
    setLoading(true); setError(null); setSpectrumData(null); 
    const delta = targetMz * (ppmTol / 1e6);
    const minMzVal = targetMz - delta;
    const maxMzVal = targetMz + delta;
    try {
      const response = await fetch(`${BACKEND_URL}/extract-chromatogram`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filepath: selectedFile, min_mz: minMzVal, max_mz: maxMzVal })
      });
      if (!response.ok) throw new Error('Failed to extract chromatogram');
      const data: ChromatogramResponse = await response.json();
      setChromData({ x: data.rts, y: data.ints });
      setPlotRevision(prev => prev + 1); 
    } catch (err: any) { setError(err.message); } finally { setLoading(false); }
  };

  const [integrationMode, setIntegrationMode] = useState<boolean>(false);
  const [integratedArea, setIntegratedArea] = useState<number | null>(null);
  const [integratedPoints, setIntegratedPoints] = useState<{ x: number[], y: number[] } | null>(null);

  const calculateIntegration = (event: any) => {
    // If no points/range, it might be a deselect or early drag. 
    // We only clear if explicitly told or if integratedMode is being toggled.
    if (!event || (!event.points && !event.range)) {
      return;
    }

    let selectedX: number[] = [];
    let selectedY: number[] = [];

    // Prioritize range (Box Selection)
    // Range is more robust for small peaks and zoom levels
    const rangeX = event.range?.x || (event.points && event.points.length > 0 ? [Math.min(...event.points.map((p:any)=>p.x)), Math.max(...event.points.map((p:any)=>p.x))] : null);

    if (rangeX && activeChromData) {
        const [minX, maxX] = rangeX;
        activeChromData.x.forEach((rtSec, i) => {
            const rtMin = rtSec / 60.0;
            if (rtMin >= minX && rtMin <= maxX) {
                selectedX.push(rtMin);
                selectedY.push(activeChromData.y[i]);
            }
        });
    }

    if (selectedX.length < 2) {
      // Don't clear active selection while dragging (onSelecting might return empty for a split sec)
      return;
    }

    let area = 0;
    for (let i = 0; i < selectedX.length - 1; i++) {
        const x1 = selectedX[i] * 60.0;
        const x2 = selectedX[i+1] * 60.0;
        const y1 = selectedY[i];
        const y2 = selectedY[i+1];
        area += ((y1 + y2) / 2) * (x2 - x1);
    }
    
    setIntegratedArea(area);
    setIntegratedPoints({ x: selectedX, y: selectedY });
  };

  const fetchSpectrum = async (rt_sec: number) => {
    if (!selectedFile) return;
    setLoading(true);
    try {
      const response = await fetch(`${BACKEND_URL}/get-spectrum`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filepath: selectedFile, rt: rt_sec })
      });
      if (!response.ok) throw new Error('Failed to fetch spectrum');
      const data: SpectrumResponse = await response.json();
      setSpectrumData(data);
      setMs2Data(null); 
      setMsXRange(null); 
      
      if (scanList.length > 0) {
        const closestIdx = scanList.reduce((prev, curr, idx) => {
            return (Math.abs(curr.rt - data.rt) < Math.abs(scanList[prev].rt - data.rt) ? idx : prev);
        }, 0);
        setCurrentScanIdx(closestIdx);
        setTimeout(() => {
          const row = document.getElementById(`scan-row-${closestIdx}`);
          if (row) row.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        }, 50); 
      }
    } catch (err: any) { setError(err.message); } finally { setLoading(false); }
  };

  const updateSpectrumByIndex = (idx: number) => {
    if (idx < 0 || idx >= scanList.length) return;
    setCurrentScanIdx(idx);
    fetchSpectrum(scanList[idx].rt);
    // Scroll table to row
    const row = document.getElementById(`scan-row-${idx}`);
    if (row) row.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  };

  const handlePlotClick = async (event: any) => {
    if (!selectedFile) return;
    
    let rt_min: number | null = null;
    
    // 1. Try to find a point with x coordinate
    if (event.points && event.points.length > 0) {
        for (const p of event.points) {
            if (p.x !== undefined && p.x !== null) {
                rt_min = p.x;
                break;
            }
        }
    }
    
    // 2. Fallback: try to calculate X from mouse position relative to the graph
    if (rt_min === null && event.event && event.event.target) {
        const gd = event.event.target.closest('.js-plotly-plot');
        if (gd && gd._fullLayout && gd._fullLayout.xaxis) {
            const xaxis = gd._fullLayout.xaxis;
            // Get position within the plot area
            const bbox = gd.getBoundingClientRect();
            const xPixel = event.event.clientX - bbox.left - gd._fullLayout.margin.l;
            rt_min = xaxis.p2c(xPixel);
        }
    }
    
    if (rt_min === null || rt_min < 0) return;
    
    const rt_sec = rt_min * 60.0;
    fetchSpectrum(rt_sec);
  };

  const fetchMs2Spectrum = async (precursor: number, rt_sec: number) => {
    if (!selectedFile) return;
    setMs2Loading(true);
    try {
        const response = await fetch(`${BACKEND_URL}/get-ms2-spectrum`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ filepath: selectedFile, precursor_mz: precursor, rt: rt_sec })
        });
        if (!response.ok) return;
        const data: MS2Response = await response.json();
        setMs2Data(data);
        setMs2XRange(null);
    } catch (err: any) { console.error(err); }
    finally { setMs2Loading(false); }
  };

  const handleMs1Click = (event: any) => {
    console.log("MS1 Plot Clicked:", event);
    if (!event.points || event.points.length === 0 || !spectrumData || !spectrumData.has_ms2) {
        console.log("No points or no MS2 data available.");
        return;
    }
    
    // Find the clicked m/z from any point in the event
    for (const p of event.points) {
        const mz = p.x;
        console.log("Checking point MZ:", mz);
        // Check if this MZ matches any of our known MS2 precursors (0.1 Da tolerance for click)
        const match = spectrumData.has_ms2.find(m => Math.abs(m - mz) < 0.1);
        if (match !== undefined) {
            console.log("Found MS2 match!", match);
            fetchMs2Spectrum(match, spectrumData.rt);
            break;
        }
    }
  };

  // --- RENDER HELPERS ---
  const activeChromData = chromData || ticData;
  const activeChromTitle = chromData ? `Extracted Ion Chromatogram (m/z ${targetMz})` : `Total Ion Chromatogram (TIC)`;
  const activeChromColor = chromData ? '#007bff' : '#444';

  const dMz = targetMz * (ppmTol / 1e6);
  const minMzVal = targetMz - dMz;
  const maxMzVal = targetMz + dMz;

  return (
    <div className="container">
      <header style={{ display: 'flex', alignItems: 'center', gap: '20px', padding: '10px 20px', backgroundColor: '#181818', borderBottom: '1px solid #333', boxShadow: '0 2px 10px rgba(0,0,0,0.5)' }}>
        <h1 style={{ margin: 0, fontSize: '1.4rem', color: '#ffc107', letterSpacing: '1px' }}>TOMETABOLOME</h1>
        
        <div style={{ display: 'flex', gap: '15px', marginLeft: '20px' }}>
            <label className="action-btn" style={{ backgroundColor: '#28a745', cursor: 'pointer', padding: '8px 16px', borderRadius: '4px', fontSize: '0.9rem', fontWeight: 'bold', display: 'flex', alignItems: 'center', gap: '8px' }}>
                📂 Open Local File 
                <input type="file" accept=".mzML,.xml" style={{ display: 'none' }} onChange={handleFileUpload} />
            </label>
            
            <button className="action-btn" onClick={loadDemoData} style={{ backgroundColor: '#444', padding: '8px 16px', borderRadius: '4px' }}>
                🧪 Load Demo
            </button>
        </div>

        <button 
            className="action-btn" 
            onClick={() => setShowHelp(true)} 
            style={{ backgroundColor: '#007bff', marginLeft: 'auto', padding: '8px 16px', borderRadius: '4px' }}
        >
            ❓ Help & Controls
        </button>
      </header>
      
      <div className="main-layout" style={{ display: 'flex', flexDirection: 'row', flex: 1, overflow: 'hidden' }}>
        {sidebarVisible && (
            <div className="sidebar" style={{ width: '300px', flexShrink: 0, borderRight: '1px solid #333' }}>
                <div style={{ padding: '10px', borderBottom: '1px solid #333' }}>
                    <h3 style={{ margin: '0 0 10px 0', fontSize: '1rem' }}>Feature Table (Scans)</h3>
                    <div style={{ fontSize: '0.8rem', color: '#888' }}>
                        {scanList.length} scans found in file.
                    </div>
                </div>
                
                {/* Manual path entry reserved for advanced local use */}
                <div style={{ padding: '10px', backgroundColor: '#222', borderBottom: '1px solid #333' }}>
                    <form onSubmit={handleManualPathSubmit} style={{ display: 'flex', gap: '5px' }}>
                        <input 
                            type="text" 
                            placeholder="Direct path (advanced)..." 
                            value={manualPath}
                            onChange={(e) => setManualPath(e.target.value)}
                            style={{ flex: 1, fontSize: '0.7rem', padding: '4px' }}
                        />
                        <button type="submit" style={{ padding: '4px 8px', fontSize: '0.7rem' }}>Go</button>
                    </form>
                </div>

                <div className="file-list" style={{ flex: 1, overflowY: 'auto' }}>
                    {/* Scan list is rendered here instead of file browser */}
                    {scanList.map((scan, idx) => (
                        <div 
                            key={idx}
                            id={`scan-row-${idx}`}
                            className={`file-item file ${currentScanIdx === idx ? 'active' : ''}`}
                            onClick={() => updateSpectrumByIndex(idx)}
                            style={{ fontSize: '0.8rem', padding: '8px' }}
                        >
                            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                                <span>RT: {(scan.rt / 60.0).toFixed(2)}m</span>
                                <span style={{ color: '#888' }}>m/z {scan.base_peak_mz.toFixed(2)}</span>
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        )}

        <div className="content" style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
            <div className="controls">
                <div className="input-group">
                    <label>Target m/z:</label>
                    <input type="number" step="0.0001" value={targetMz} onChange={(e) => setTargetMz(parseFloat(e.target.value))} />
                </div>
                <div className="input-group">
                    <label>Tolerance (ppm):</label>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <input type="number" step="1" style={{ width: '80px' }} value={ppmTol} onChange={(e) => setPpmTol(parseFloat(e.target.value))} />
                        <div style={{ color: '#aaa', fontSize: '0.85rem' }}>
                            ({minMzVal.toFixed(4)} - {maxMzVal.toFixed(4)} m/z)
                        </div>
                    </div>
                </div>

                <div className="input-group" style={{ borderLeft: '1px solid #444', paddingLeft: '15px' }}>
                    <label>Peak Integration:</label>
                    <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                        <button 
                            onClick={() => { setIntegrationMode(!integrationMode); if(integrationMode) { setIntegratedArea(null); setIntegratedPoints(null); } }}
                            style={{ backgroundColor: integrationMode ? '#dc3545' : '#28a745', minWidth: '100px' }}
                        >
                            {integrationMode ? 'Exit Mode' : 'Start Mode'}
                        </button>
                        <input 
                            type="text" 
                            readOnly 
                            placeholder="Area Value"
                            value={integratedArea ? integratedArea.toExponential(4) : ''} 
                            style={{ width: '120px', textAlign: 'center', backgroundColor: '#222', borderColor: '#444', color: '#ffc107', fontWeight: 'bold' }}
                        />
                        {integratedArea && (
                            <span style={{ color: '#ffc107', fontWeight: 'bold', fontSize: '1rem' }}>
                                Result: {integratedArea.toExponential(4)}
                            </span>
                        )}
                    </div>
                </div>

                <div className="input-group" style={{ borderLeft: '1px solid #444', paddingLeft: '15px' }}>
                    <label>MS View:</label>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <input 
                            type="checkbox" 
                            id="normalize-ms" 
                            checked={normalizeSpectrum} 
                            onChange={(e) => setNormalizeSpectrum(e.target.checked)} 
                        />
                        <label htmlFor="normalize-ms" style={{ cursor: 'pointer', color: '#eee' }}>Normalize (0-100%)</label>
                    </div>
                </div>

                <div style={{ flex: 1 }}></div>
                {chromData && (
                    <button onClick={() => setChromData(null)} style={{ backgroundColor: '#6c757d' }}>
                        Back to TIC
                    </button>
                )}
                <button className="action-btn" onClick={loadDemoData} style={{ backgroundColor: '#28a745' }}>
                    Load Demo Data
                </button>
                <button className="action-btn" onClick={fetchChromatogram} disabled={!selectedFile}>
                    Extract XIC
                </button>
            </div>

            {selectedFile && <div className="selected-info">Selected: {selectedFile}</div>}
            {loading && !activeChromData && <div className="loading" style={{textAlign: "center"}}>Loading...</div>}
            {error && <div className="error">{error}</div>}

            <Split className="plots-split" sizes={[50, 50]} minSize={100} gutterSize={5} direction="horizontal" style={{ height: 'calc(100vh - 150px)' }}>
                {/* LEFT COLUMN: Chromatogram and Scan Table */}
                <div className="left-column" style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
                    <Split direction="vertical" sizes={[50, 50]} minSize={100} gutterSize={5} style={{ height: '100%' }}>
                        <div className="chromatogram-pane" style={{ overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
                            {activeChromData ? (
                                <>
                                    <h3 style={{ margin: '5px' }}>{activeChromTitle}</h3>
                                    <Plot
                                        data={[
                                            {
                                                x: activeChromData.x.map(t => t / 60.0), y: activeChromData.y,
                                                type: 'scatter', mode: 'lines', line: { width: 1.0, color: activeChromColor },
                                                name: 'Intensity', hoverinfo: 'y'
                                            },
                                            integratedPoints && {
                                                x: integratedPoints.x, y: integratedPoints.y, type: 'scatter', mode: 'lines',
                                                fill: 'tozeroy', fillcolor: 'rgba(255, 193, 7, 0.4)', line: { color: '#ffc107', width: 2 },
                                                name: 'Integrated Peak', hoverinfo: 'skip'
                                            },
                                            (() => {
                                                if (!spectrumData) return null;
                                                const maxY = Math.max(...activeChromData.y);
                                                return {
                                                    x: [spectrumData.rt / 60.0, spectrumData.rt / 60.0],
                                                    y: [0, maxY],
                                                    type: 'scatter', mode: 'lines',
                                                    line: { color: 'red', width: 2, dash: 'dash' },
                                                    name: 'Current Scan', hoverinfo: 'skip'
                                                };
                                            })(),
                                            (() => {
                                                const maxY = Math.max(...activeChromData.y);
                                                return {
                                                    x: activeChromData.x.map(t => t / 60.0), 
                                                    y: activeChromData.x.map(() => maxY),
                                                    type: 'scatter', mode: 'lines', fill: 'tozeroy', fillcolor: 'rgba(0,0,0,0)',
                                                    line: { color: 'transparent' }, hoverinfo: 'x', showlegend: false
                                                };
                                            })()
                                        ].filter(Boolean) as any}
                                        layout={{ 
                                            autosize: true, margin: { l: 70, r: 20, t: 30, b: 40 }, uirevision: plotRevision, showlegend: false,
                                            xaxis: { title: { text: 'Time (min)' }, range: chromXRange || undefined },
                                            yaxis: { title: { text: 'Intensity' }, tickformat: '.2e' },
                                            dragmode: ctrlPressed ? 'pan' : (integrationMode ? 'select' : 'zoom'),
                                            hovermode: 'x unified'
                                        }}
                                        config={{ doubleClick: 'reset+autosize', displayModeBar: true, scrollZoom: true }}
                                        useResizeHandler={true} style={{ width: "100%", height: "100%" }}
                                        onClick={handlePlotClick}
                                        onSelected={integrationMode ? calculateIntegration : undefined}
                                        onRelayout={(e: any) => {
                                            if (e['xaxis.range[0]'] !== undefined) setChromXRange([e['xaxis.range[0]'], e['xaxis.range[1]']]);
                                            else if (e['xaxis.autorange'] || e['autosize']) setChromXRange(null);
                                        }}
                                    />
                                </>
                            ) : <div className="placeholder-msg">Open a file to see Chromatogram</div>}
                        </div>
                        <div className="table-pane" style={{ overflow: 'hidden', display: 'flex', flexDirection: 'column', borderTop: '1px solid #444' }}>
                            <h3 style={{ margin: '5px' }}>Feature / Scan Table</h3>
                            <div className="scan-table-container" style={{ flex: 1, overflowY: 'auto' }}>
                                {scanList.length > 0 ? (
                                    <table className="scan-table">
                                        <thead>
                                            <tr><th>Scan #</th><th>RT (min)</th><th>Base Peak</th><th>TIC</th></tr>
                                        </thead>
                                        <tbody>
                                            {scanList.map((scan, idx) => (
                                                <tr key={scan.id} className={currentScanIdx === idx ? 'active' : ''} onClick={() => updateSpectrumByIndex(idx)}>
                                                    <td>{scan.id + 1}</td>
                                                    <td>{(scan.rt / 60.0).toFixed(4)}</td>
                                                    <td>{scan.base_peak_mz.toFixed(4)}</td>
                                                    <td>{scan.tic.toExponential(2)}</td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                ) : <p style={{ textAlign: 'center', color: '#666' }}>No scans loaded</p>}
                            </div>
                        </div>
                    </Split>
                </div>

                {/* RIGHT COLUMN: MS1 and MS2 */}
                <div className="right-column" style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
                    <Split direction="vertical" sizes={[50, 50]} minSize={100} gutterSize={5} style={{ height: '100%' }}>
                        <div className="ms1-pane" style={{ overflow: 'hidden', display: 'flex', flexDirection: 'column', position: 'relative' }}>
                            {loading && !activeChromData && (
                                <div className="loading-overlay" style={{
                                    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
                                    backgroundColor: 'rgba(0,0,0,0.5)', zIndex: 10,
                                    display: 'flex', justifyContent: 'center', alignItems: 'center',
                                    color: '#007bff', fontWeight: 'bold'
                                }}>
                                    Loading MS1 Spectrum...
                                </div>
                            )}
                            {spectrumData ? (
                                <>
                                    <h3 style={{ margin: '5px' }}>Mass Spectrum (RT: {(spectrumData.rt / 60.0).toFixed(2)} min)</h3>
                                    <Plot
                                        data={[
                                            ...(() => {
                                                const sticks = getStickData(spectrumData.mzs, spectrumData.ints, spectrumData.has_ms2 || []);
                                                const maxInt = Math.max(...spectrumData.ints);
                                                return [
                                                    {
                                                        x: sticks.x,
                                                        y: normalizeSpectrum ? sticks.y.map((v: number | null) => v === null ? null : (v / maxInt) * 100.0) : sticks.y,
                                                        type: 'scatter', mode: 'lines',
                                                        line: { width: 1.0, color: '#444' },
                                                        hoverinfo: 'none',
                                                        name: 'MS Stick'
                                                    },
                                                    {
                                                        x: sticks.hx,
                                                        y: normalizeSpectrum ? sticks.hy.map((v: number | null) => v === null ? null : (v / maxInt) * 100.0) : sticks.hy,
                                                        type: 'scatter', mode: 'lines',
                                                        line: { width: 2.0, color: '#ff5722' },
                                                        hoverinfo: 'none',
                                                        name: 'MS2 Precursor'
                                                    }
                                                ];
                                            })(),
                                            {
                                                x: spectrumData.mzs,
                                                y: normalizeSpectrum ? spectrumData.ints.map(v => (v / Math.max(...spectrumData.ints)) * 100.0) : spectrumData.ints,
                                                type: 'scatter', mode: 'markers',
                                                marker: { 
                                                    size: 3, 
                                                    color: spectrumData.mzs.map(mz => spectrumData.has_ms2?.some(m => Math.abs(m - mz) < 0.1) ? '#ff5722' : '#444') 
                                                },
                                                text: spectrumData.mzs.map(mz => spectrumData.has_ms2?.some(m => Math.abs(m - mz) < 0.1) ? 'MS2 Available' : ''),
                                                hovertemplate: '%{x:.4f} (%{y:.2e})<br><b>%{text}</b><extra></extra>',
                                                name: 'Peaks'
                                            },
                                            (() => {
                                                const visibleX = msXRange || [Math.min(...spectrumData.mzs), Math.max(...spectrumData.mzs)];
                                                const filteredIndices = spectrumData.mzs.map((x, i) => ({ x, i })).filter(p => p.x >= visibleX[0] && p.x <= visibleX[1]);
                                                if (filteredIndices.length === 0) return null;
                                                const visibleY = filteredIndices.map(p => spectrumData.ints[p.i]);
                                                const maxVisibleY = Math.max(...visibleY);
                                                const labelThreshold = maxVisibleY * 0.05;
                                                const labelPoints = filteredIndices.filter(p => spectrumData.ints[p.i] >= labelThreshold);
                                                return {
                                                    x: labelPoints.map(p => p.x),
                                                    y: labelPoints.map(p => {
                                                        const v = spectrumData.ints[p.i];
                                                        return normalizeSpectrum ? (v / Math.max(...spectrumData.ints)) * 100.0 : v;
                                                    }),
                                                    mode: 'text', type: 'scatter', text: labelPoints.map(p => p.x.toFixed(4)),
                                                    textposition: 'top center', textfont: { size: 10, color: 'black', family: 'Arial Black' },
                                                    cliponaxis: false, showlegend: false, hoverinfo: 'none'
                                                };
                                            })() as any
                                        ]}
                                        layout={{ 
                                            autosize: true, margin: { l: 70, r: 20, t: 30, b: 40 }, uirevision: spectrumData.rt, showlegend: false,
                                            xaxis: { title: { text: 'm/z' }, range: msXRange || undefined },
                                            yaxis: { 
                                                title: { text: normalizeSpectrum ? 'Rel. Int (%)' : 'Intensity' }, 
                                                tickformat: normalizeSpectrum ? '.1f' : '.2e',
                                                range: [0, calculateMaxVisibleY(spectrumData.mzs, spectrumData.ints, msXRange) * (normalizeSpectrum ? 100/Math.max(...spectrumData.ints) : 1) * 1.1]
                                            },
                                            dragmode: ctrlPressed ? 'pan' : 'zoom', hovermode: 'closest'
                                        }}
                                        config={{ doubleClick: 'reset+autosize', displayModeBar: true, scrollZoom: true }}
                                        useResizeHandler={true} style={{ width: "100%", height: "100%" }}
                                        onClick={handleMs1Click}
                                        onRelayout={(e: any) => {
                                            if (e['xaxis.range[0]'] !== undefined) setMsXRange([e['xaxis.range[0]'], e['xaxis.range[1]']]);
                                            else if (e['xaxis.autorange'] || e['autosize']) setMsXRange(null);
                                        }}
                                    />
                                </>
                            ) : <div className="placeholder-msg">Select a scan to see MS1</div>}
                        </div>
                        <div className="ms2-pane" style={{ overflow: 'hidden', display: 'flex', flexDirection: 'column', borderTop: '1px solid #444', position: 'relative' }}>
                            {ms2Loading && (
                                <div className="loading-overlay" style={{
                                    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
                                    backgroundColor: 'rgba(0,0,0,0.5)', zIndex: 10,
                                    display: 'flex', justifyContent: 'center', alignItems: 'center',
                                    color: '#ff5722', fontWeight: 'bold'
                                }}>
                                    Loading MS2 Data...
                                </div>
                            )}
                            {ms2Data ? (
                                <>
                                    <h3 style={{ margin: '5px' }}>MS2 Spectrum (Precursor: {ms2Data.precursor_mz.toFixed(4)})</h3>
                                    <Plot
                                        data={[
                                            (() => {
                                                const sticks = getStickData(ms2Data.mzs, ms2Data.ints);
                                                return {
                                                    x: sticks.x,
                                                    y: sticks.y,
                                                    type: 'scatter', mode: 'lines',
                                                    line: { width: 1.0, color: '#ff5722' },
                                                    hoverinfo: 'none',
                                                    name: 'MS2 Stick'
                                                };
                                            })(),
                                            {
                                                x: ms2Data.mzs,
                                                y: ms2Data.ints,
                                                type: 'scatter', mode: 'markers',
                                                marker: { size: 2, color: '#ff5722' },
                                                hovertemplate: '%{x:.4f} (%{y:.2e})<extra></extra>',
                                                name: 'Fragments'
                                            },
                                            (() => {
                                                const visibleX = ms2XRange || [Math.min(...ms2Data.mzs), Math.max(...ms2Data.mzs)];
                                                const filteredIndices = ms2Data.mzs.map((x, i) => ({ x, i })).filter(p => p.x >= visibleX[0] && p.x <= visibleX[1]);
                                                if (filteredIndices.length === 0) return null;
                                                const visibleY = filteredIndices.map(p => ms2Data.ints[p.i]);
                                                const maxVisibleY = Math.max(...visibleY);
                                                const labelThreshold = maxVisibleY * 0.05;
                                                const labelPoints = filteredIndices.filter(p => ms2Data.ints[p.i] >= labelThreshold);
                                                return {
                                                    x: labelPoints.map(p => p.x), y: labelPoints.map(p => ms2Data.ints[p.i]), mode: 'text', type: 'scatter',
                                                    text: labelPoints.map(p => p.x.toFixed(4)), textposition: 'top center',
                                                    textfont: { size: 10, color: '#ff5722', family: 'Arial Black' }, cliponaxis: false, showlegend: false, hoverinfo: 'none'
                                                };
                                            })() as any
                                        ]}
                                        layout={{
                                            autosize: true, margin: { l: 70, r: 20, t: 30, b: 40 }, uirevision: ms2Data.rt, showlegend: false,
                                            xaxis: { title: { text: 'Fragment m/z' }, range: ms2XRange || undefined },
                                            yaxis: { 
                                                title: { text: 'Intensity' }, 
                                                tickformat: '.2e',
                                                range: [0, calculateMaxVisibleY(ms2Data.mzs, ms2Data.ints, ms2XRange) * 1.1]
                                            },
                                            dragmode: ctrlPressed ? 'pan' : 'zoom',
                                            hovermode: 'closest'
                                        }}
                                        config={{ doubleClick: 'reset+autosize', displayModeBar: true, scrollZoom: true }}
                                        useResizeHandler={true} style={{ width: "100%", height: "100%" }}
                                        onRelayout={(e: any) => {
                                            if (e['xaxis.range[0]'] !== undefined) setMs2XRange([e['xaxis.range[0]'], e['xaxis.range[1]']]);
                                            else if (e['xaxis.autorange'] || e['autosize']) setMs2XRange(null);
                                        }}
                                    />
                                    <button onClick={() => setMs2Data(null)} style={{ position: 'absolute', bottom: '10px', right: '10px', opacity: 0.7, fontSize: '0.7rem' }}>Clear MS2</button>
                                </>
                            ) : <div className="placeholder-msg">Click an orange peak to see MS2</div>}
                        </div>
                    </Split>
                </div>
            </Split>
        </div>
      </div>
      {showHelp && (
          <div 
              style={{ 
                  position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, 
                  backgroundColor: 'rgba(0,0,0,0.85)', zIndex: 1000, 
                  display: 'flex', justifyContent: 'center', alignItems: 'center', padding: '20px' 
              }}
              onClick={() => setShowHelp(false)}
          >
              <div 
                  style={{ 
                      backgroundColor: '#222', padding: '30px', borderRadius: '12px', 
                      maxWidth: '600px', border: '1px solid #444', boxShadow: '0 0 30px rgba(0,0,0,0.5)' 
                  }}
                  onClick={e => e.stopPropagation()}
              >
                  <h2 style={{ color: '#ffc107', marginTop: 0 }}>App Controls & Instructions</h2>
                  <ul style={{ lineHeight: '1.8', color: '#eee' }}>
                      <li><strong>Mouse Click:</strong> Click on Chromatogram (top-left) to view the MS1 spectrum at that time.</li>
                      <li><strong>Mouse Drag:</strong> Zoom into a region of any plot.</li>
                      <li><strong>Double Click:</strong> Reset zoom to show all data.</li>
                      <li><strong>Scroll Wheel:</strong> Zoom in/out at the mouse position.</li>
                      <li><strong>Arrow Left/Right:</strong> Navigate between scans (previous/next).</li>
                      <li><strong>Peak Integration:</strong> Click 'Start Mode', then drag over a peak in Chromatogram to calculate area.</li>
                      <li><strong>MS2 Viewing:</strong> Click on orange-highlighted peaks in MS1 (bottom-left) to see fragments.</li>
                  </ul>
                  <button 
                      onClick={() => setShowHelp(false)}
                      style={{ width: '100%', marginTop: '20px', padding: '10px', backgroundColor: '#007bff', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer' }}
                  >
                      Got it!
                  </button>
              </div>
          </div>
      )}
    </div>
  );
}

export default App;
