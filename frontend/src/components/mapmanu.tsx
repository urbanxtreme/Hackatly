import React, { useState, useEffect, useCallback } from 'react';
import { getMap, initMap } from '../api';
import './mapmanu.css';

interface MapManuProps {
  onClose: () => void;
  onMapSaved: (newGrid: number[][]) => void;
}

const GRID_SIZE = 30;

const MapManu: React.FC<MapManuProps> = ({ onClose, onMapSaved }) => {
  const [grid, setGrid] = useState<number[][]>([]);
  const [isDrawing, setIsDrawing] = useState(false);
  const [drawMode, setDrawMode] = useState<number>(1); // 1 = draw obstacle, 0 = erase

  // Fetch initial map on load
  useEffect(() => {
    getMap()
      .then(data => {
        if (data && data.map && data.map.length === GRID_SIZE) {
          setGrid(data.map);
        } else {
          // Fallback empty grid if API fails or is uninitialized
          setGrid(Array.from({ length: GRID_SIZE }, () => Array(GRID_SIZE).fill(0)));
        }
      })
      .catch(err => {
        console.error("Failed to load map API:", err);
        setGrid(Array.from({ length: GRID_SIZE }, () => Array(GRID_SIZE).fill(0)));
      });
  }, []);

  const handleMouseDown = (x: number, z: number) => {
    setIsDrawing(true);
    const newMode = grid[x][z] === 1 ? 0 : 1;
    setDrawMode(newMode);
    updateCell(x, z, newMode);
  };

  const handleMouseEnter = (x: number, z: number) => {
    if (isDrawing) updateCell(x, z, drawMode);
  };

  const handleMouseUp = () => {
    setIsDrawing(false);
  };

  const updateCell = useCallback((x: number, z: number, val: number) => {
    setGrid(prev => {
      const newGrid = [...prev];
      newGrid[x] = [...newGrid[x]];
      newGrid[x][z] = val;
      return newGrid;
    });
  }, []);

  const handleClear = () => {
    setGrid(Array.from({ length: GRID_SIZE }, () => Array(GRID_SIZE).fill(0)));
  };

  const handleSave = async () => {
    try {
      await initMap(grid);
      onMapSaved(grid);
    } catch (err) {
      console.error("Failed to save map:", err);
      alert("Error saving blueprint. Check terminal.");
    }
  };

  if (grid.length === 0) return null; // Loading

  return (
    <div className="mapmanu-overlay" onMouseUp={handleMouseUp} onMouseLeave={handleMouseUp}>
      <div className="mapmanu-modal">
        <div className="mapmanu-header">
          <h2>Blueprint Editor</h2>
          <button className="btn-manu close" onClick={onClose}>×</button>
        </div>
        
        <div className="mapmanu-editor-hint" style={{ color: '#88aadd', fontSize: '0.8rem', textAlign: 'center' }}>
          Click and drag to draw or erase storage racks.
        </div>

        <div className="mapmanu-grid">
          {grid.map((row, x) => 
            row.map((val, z) => (
              <div
                key={`${x}-${z}`}
                className={`mapmanu-cell ${val === 1 ? 'obstacle' : ''}`}
                onMouseDown={() => handleMouseDown(x, z)}
                onMouseEnter={() => handleMouseEnter(x, z)}
                // Prevent default drag behaviors to make painting smooth
                onDragStart={e => e.preventDefault()} 
              />
            ))
          )}
        </div>

        <div className="mapmanu-footer">
          <div className="mapmanu-controls">
            <button className="btn-manu" onClick={handleClear}>Clear All</button>
          </div>
          <button className="btn-manu save" onClick={handleSave}>Deploy Blueprint</button>
        </div>
      </div>
    </div>
  );
};

export default MapManu;
