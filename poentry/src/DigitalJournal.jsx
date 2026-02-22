import React, { useEffect, useRef, useState } from 'react';
import * as fabric from 'fabric'; // Make sure you installed fabric v6

const DigitalJournal = () => {
  const canvasRef = useRef(null);
  const [fabricCanvas, setFabricCanvas] = useState(null);

  // Grid Configuration
  const GRID_SIZE = 30; // Distance between dots
  const DOT_SIZE = 1.5;   // Radius of the dot

  useEffect(() => {
    // 1. Initialize the Fabric Canvas
    // We attach it to the <canvas> element referenced by canvasRef
    const canvas = new fabric.Canvas(canvasRef.current, {
      height: window.innerHeight, // Full screen height
      width: window.innerWidth,   // Full screen width
      selection: true,            // Enable group selection
    });

    // 2. Create the Dotted Pattern Programmatically
    // We create a tiny off-screen canvas to draw one dot, then use it as a pattern
    const patternSourceCanvas = document.createElement('canvas');
    patternSourceCanvas.width = GRID_SIZE;
    patternSourceCanvas.height = GRID_SIZE;
    const ctx = patternSourceCanvas.getContext('2d');

    // Draw the dot
    ctx.fillStyle = '#cccccc'; // Light gray dot color
    ctx.beginPath();
    ctx.arc(GRID_SIZE / 2, GRID_SIZE / 2, DOT_SIZE, 0, 2 * Math.PI);
    ctx.fill();

    // 3. Apply the pattern to the main canvas background
    const pattern = new fabric.Pattern({
      source: patternSourceCanvas,
      repeat: 'repeat',
    });
    
    canvas.set('backgroundColor', pattern);
    canvas.requestRenderAll();

    // 4. Snap to Grid Logic
    canvas.on('object:moving', (options) => {
      const target = options.target;
      target.set({
        left: Math.round(target.left / GRID_SIZE) * GRID_SIZE,
        top: Math.round(target.top / GRID_SIZE) * GRID_SIZE
      });
    });

    // 5. Fix Textbox resizing — bake scaleX into width so text reflows
    //    instead of stretching. Without this, dragging the resize handle
    //    scales all lines uniformly and breaks word-wrap for every line
    //    after the first.
    canvas.on('object:scaling', (options) => {
      const target = options.target;
      if (target.type === 'textbox') {
        const newWidth = Math.max(target.width * target.scaleX, 20);
        target._lockedWidth = newWidth;
        target.set({ width: newWidth, scaleX: 1, scaleY: 1 });
        target.initDimensions();
        target.setCoords();
      }
    });

    setFabricCanvas(canvas);

    // Cleanup on unmount to prevent memory leaks
    return () => {
      canvas.dispose();
    };
  }, []);

  // Handle object deletion
  useEffect(() => {
    if (!fabricCanvas) return;

    const handleKeyDown = (e) => {
      if (e.key === 'Delete' || e.key === 'Backspace') {
        const activeObjects = fabricCanvas.getActiveObjects();
        
        if (activeObjects.length) {
          // Check if the active object is currently being edited
          const activeObject = fabricCanvas.getActiveObject();
          if (activeObject && activeObject.isEditing) {
            return;
          }

          fabricCanvas.remove(...activeObjects);
          fabricCanvas.discardActiveObject();
          fabricCanvas.requestRenderAll();
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [fabricCanvas]);

  // Function to add a Freeform Text Box
  const addTextBox = () => {
    if (!fabricCanvas) return;

    const text = new fabric.Textbox('Type here...', {
      left: 200,
      top: 100,
      width: 240, // Initial wrap boundary — resize handle changes this, not the font
      fontFamily: 'Courier New', // Monospace fits the "journal" vibe well
      fontSize: 20,
      fill: '#333',
      lineHeight: 1.3,
      editable: true,
      splitByGrapheme: true, // Wrap at character boundaries so no word ever exceeds box width
    });

    // Prevent typing from expanding the box width, but allow resize handles to
    // change it. The key distinction: this.isEditing is true only while the
    // user is typing. Resize handle drags happen outside editing mode.
    // We also pin `top` on every call so height changes always grow downward,
    // never upward — Fabric would otherwise keep the center fixed and drift the top.
    text._lockedWidth = text.width;
    const _origInit = text.initDimensions.bind(text);
    text.initDimensions = function () {
      const savedTop = this.top;
      if (this.isEditing && this._lockedWidth !== undefined) {
        // Clamp before AND after so line-break computation uses the locked width
        this.width = this._lockedWidth;
        _origInit();
        this.width = this._lockedWidth;
      } else {
        _origInit();
        // Sync _lockedWidth to whatever the resize handle just set
        this._lockedWidth = this.width;
      }
      // Restore top so height changes always expand the bottom, not the top
      this.top = savedTop;
    };

    fabricCanvas.add(text);
    fabricCanvas.setActiveObject(text);
  };

  return (
    <div style={{ position: 'relative', width: '100vw', height: '100vh', overflow: 'hidden', backgroundColor: '#fffff5' }}>
      {/* Floating Toolbar */}
      <div style={{
        position: 'absolute',
        top: 20,
        left: 20,
        zIndex: 10,
        background: 'white',
        padding: '10px',
        borderRadius: '8px',
        boxShadow: '0 4px 6px rgba(0,0,0,0.1)'
      }}>
        <button onClick={addTextBox} style={{ 
          cursor: 'pointer', 
          padding: '8px 16px', 
          background: '#333', 
          color: 'white', 
          border: 'none', 
          borderRadius: '4px' 
        }}>
          + Add Text
        </button>
      </div>

      {/* The Journal Page */}
      <canvas ref={canvasRef} />
    </div>
  );
};

export default DigitalJournal;