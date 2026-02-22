import React, { useEffect, useRef, useState, useCallback } from 'react';
import * as fabric from 'fabric';

// ── Toolbar constants ──────────────────────────────────────────────────────────
const FONTS = ['Courier New', 'Arial', 'Georgia', 'Times New Roman', 'Verdana', 'Helvetica'];
const FONT_SIZES = [10, 12, 14, 16, 18, 20, 24, 28, 32, 36, 48, 64];

// ── Shared toolbar button style ───────────────────────────────────────────────
const btnStyle = (active) => ({
  cursor: 'pointer',
  padding: '4px 8px',
  border: '1px solid',
  borderColor: active ? '#333' : '#ccc',
  borderRadius: '4px',
  background: active ? '#333' : 'white',
  color: active ? 'white' : '#333',
  fontWeight: 'bold',
  fontSize: '13px',
  lineHeight: '1',
  minWidth: '28px',
});

const divider = {
  width: '1px',
  background: '#ddd',
  margin: '0 4px',
  alignSelf: 'stretch',
};

// ── Helper: get the style of the current selection (or whole object if none) ──
function getSelectionStyle(tb) {
  if (!tb) return {};
  if (tb.isEditing) {
    const start = tb.selectionStart ?? 0;
    const end = tb.selectionEnd ?? 0;
    // If there's a real selection, grab the style of the first selected char
    if (end > start) return tb.getSelectionStyles(start, start + 1)[0] ?? {};
    // Cursor only — return current "pending" style
    return tb.getSelectionStyles(start, start + 1)[0] ?? {};
  }
  // Not editing: return object-level style
  return {
    fontFamily: tb.fontFamily,
    fontSize: tb.fontSize,
    fontWeight: tb.fontWeight,
    fontStyle: tb.fontStyle,
    underline: tb.underline,
    linethrough: tb.linethrough,
    textAlign: tb.textAlign,
  };
}

const DigitalJournal = () => {
  const canvasRef = useRef(null);
  const [fabricCanvas, setFabricCanvas] = useState(null);
  // Persists the last known text selection so toolbar clicks can restore it
  // after the mousedown on the button blurs the canvas and clears isEditing.
  const lastSelRef = useRef({ textbox: null, start: 0, end: 0 });

  // Toolbar state — reflects the active selection / active textbox
  const [activeTextbox, setActiveTextbox] = useState(null);
  const [fmt, setFmt] = useState({
    fontFamily: 'Courier New',
    fontSize: 20,
    fontWeight: 'normal',
    fontStyle: 'normal',
    underline: false,
    linethrough: false,
    textAlign: 'left',
  });

  // Grid Configuration
  const GRID_SIZE = 30;
  const DOT_SIZE = 1.5;

  // ── Sync toolbar state from canvas selection ─────────────────────────────
  const syncFmt = useCallback((tb) => {
    if (!tb) { setActiveTextbox(null); return; }
    setActiveTextbox(tb);
    const s = getSelectionStyle(tb);
    setFmt({
      fontFamily: s.fontFamily ?? tb.fontFamily ?? 'Courier New',
      fontSize: s.fontSize ?? tb.fontSize ?? 20,
      fontWeight: s.fontWeight ?? tb.fontWeight ?? 'normal',
      fontStyle: s.fontStyle ?? tb.fontStyle ?? 'normal',
      underline: s.underline ?? tb.underline ?? false,
      linethrough: s.linethrough ?? tb.linethrough ?? false,
      textAlign: tb.textAlign ?? 'left',
    });
  }, []);

  // ── Canvas initialisation ────────────────────────────────────────────────
  useEffect(() => {
    const canvas = new fabric.Canvas(canvasRef.current, {
      height: window.innerHeight,
      width: window.innerWidth,
      selection: true,
    });

    // Dotted background
    const patternSourceCanvas = document.createElement('canvas');
    patternSourceCanvas.width = GRID_SIZE;
    patternSourceCanvas.height = GRID_SIZE;
    const ctx = patternSourceCanvas.getContext('2d');
    ctx.fillStyle = '#cccccc';
    ctx.beginPath();
    ctx.arc(GRID_SIZE / 2, GRID_SIZE / 2, DOT_SIZE, 0, 2 * Math.PI);
    ctx.fill();
    canvas.set('backgroundColor', new fabric.Pattern({ source: patternSourceCanvas, repeat: 'repeat' }));
    canvas.requestRenderAll();

    // Snap to grid
    canvas.on('object:moving', ({ target }) => {
      target.set({
        left: Math.round(target.left / GRID_SIZE) * GRID_SIZE,
        top: Math.round(target.top / GRID_SIZE) * GRID_SIZE,
      });
    });

    // ── Textbox resize: bake scaleX into width, anchor top ──────────────
    canvas.on('before:transform', (options) => {
      const target = options.transform?.target;
      if (target && target.type === 'textbox') {
        target._anchorTop = target.top;
      }
    });

    canvas.on('object:scaling', ({ target }) => {
      if (target.type !== 'textbox') return;
      const newWidth = Math.max(target.width * target.scaleX, 20);
      target._lockedWidth = newWidth;
      target.set({ width: newWidth, scaleX: 1, scaleY: 1 });
      target.initDimensions();
      if (target._anchorTop !== undefined) target.top = target._anchorTop;
      target.setCoords();
    });

    canvas.on('object:scaled', ({ target }) => {
      if (target?.type === 'textbox') delete target._anchorTop;
    });

    // ── Sync toolbar when selection / editing state changes ──────────────
    const onSelect = ({ selected }) => syncFmt(selected?.[0]?.type === 'textbox' ? selected[0] : null);
    const onDeselect = () => syncFmt(null);
    const onChanged = ({ target }) => syncFmt(target);

    canvas.on('selection:created', onSelect);
    canvas.on('selection:updated', onSelect);
    canvas.on('selection:cleared', onDeselect);
    canvas.on('text:selection:changed', ({ target }) => {
      // Persist selection so toolbar clicks can restore it after mousedown blurs
      if (target?.isEditing) {
        lastSelRef.current = {
          textbox: target,
          start: target.selectionStart,
          end: target.selectionEnd,
        };
      }
      onChanged({ target });
    });
    canvas.on('text:changed', onChanged);

    setFabricCanvas(canvas);
    return () => canvas.dispose();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Delete key handler ───────────────────────────────────────────────────
  useEffect(() => {
    if (!fabricCanvas) return;
    const handleKeyDown = (e) => {
      if (e.key !== 'Delete' && e.key !== 'Backspace') return;
      const active = fabricCanvas.getActiveObject();
      if (active?.isEditing) return;
      const objs = fabricCanvas.getActiveObjects();
      if (!objs.length) return;
      fabricCanvas.remove(...objs);
      fabricCanvas.discardActiveObject();
      fabricCanvas.requestRenderAll();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [fabricCanvas]);

  // ── Formatting helpers ───────────────────────────────────────────────────
  // Problem: clicking a toolbar button fires mousedown → canvas loses focus →
  // Fabric fires selection:cleared → activeTextbox becomes null in React state
  // → applyStyle exits early before onClick even runs.
  //
  // Fix A (buttons): onMouseDown on the toolbar div calls e.preventDefault()
  //   for non-select targets so focus never leaves the canvas.
  // Fix B (selects + belt-and-suspenders): use lastSelRef.current.textbox
  //   as the target instead of activeTextbox state so we always have a reference
  //   to the Fabric object even if React state has been cleared.
  const applyStyle = useCallback((styles) => {
    // Resolve the target textbox: prefer activeTextbox if it's editing, 
    // otherwise use the saved reference.
    const tb = (activeTextbox && activeTextbox.isEditing)
      ? activeTextbox
      : (lastSelRef.current.textbox ?? activeTextbox);

    if (!tb) return;

    // Determine the target selection range
    let start = 0;
    let end = 0;

    if (tb.isEditing) {
      // Use live values if editing
      start = tb.selectionStart;
      end = tb.selectionEnd;
    } else if (tb === lastSelRef.current.textbox) {
      // Restore from ref if not editing
      start = lastSelRef.current.start;
      end = lastSelRef.current.end;
    }

    // Check if we have a range to format
    const hasRange = start !== end;

    if (hasRange) {
      // Ensure we are in editing mode to apply per-character styles
      if (!tb.isEditing) {
        tb.enterEditing();
      }

      // Explicitly restore selection so Fabric applies styles to the correct range
      tb.selectionStart = start;
      tb.selectionEnd = end;

      // Apply styles to each character in the selection range
      for (let i = start; i < end; i++) {
        const existing = tb.getSelectionStyles(i, i + 1)[0] || {};
        tb.setSelectionStyles({ ...existing, ...styles }, i, i + 1);
      }
    } else {
      // No range selected
      if (tb.isEditing) {
        // Cursor placed: set styles for the next typed character.
        // Fabric v7 doesn't have a clean "pending style" API, so we
        // merge into the hidden _styleMap that getSelectionStyles reads
        // at the cursor position. We also update the object-level props
        // so newly typed text inherits them.
        Object.assign(tb, styles);
      } else {
        // Object selected (not editing): apply style object-wide
        tb.set(styles);
      }
    }

    // Clear the character width measurement cache so Fabric re-measures
    // with the new font weight / style / family. Without this, Fabric
    // reuses stale glyph widths and the bold/italic glyphs don't render.
    if (tb._clearCache) tb._clearCache();
    tb.dirty = true;
    tb.initDimensions();
    tb.setCoords();
    tb.canvas?.requestRenderAll();
    syncFmt(tb);
  }, [activeTextbox, syncFmt]);

  const toggleBold = () => {
    const next = fmt.fontWeight === 'bold' ? 'normal' : 'bold';
    applyStyle({ fontWeight: next });
  };
  const toggleItalic = () => {
    const next = fmt.fontStyle === 'italic' ? 'normal' : 'italic';
    applyStyle({ fontStyle: next });
  };
  const toggleUnderline = () => applyStyle({ underline: !fmt.underline });
  const toggleStrike = () => applyStyle({ linethrough: !fmt.linethrough });

  const setFont = (e) => applyStyle({ fontFamily: e.target.value });
  const setFontSize = (e) => {
    const size = parseInt(e.target.value, 10);
    if (!isNaN(size) && size > 0) applyStyle({ fontSize: size });
  };
  const setAlign = (align) => {
    if (!activeTextbox) return;
    activeTextbox.set({ textAlign: align });
    // initDimensions must run so Fabric's enlargeSpaces() applies justify layout
    activeTextbox.initDimensions();
    activeTextbox.canvas?.requestRenderAll();
    syncFmt(activeTextbox);
  };

  // ── Add text box ─────────────────────────────────────────────────────────
  const addTextBox = () => {
    if (!fabricCanvas) return;
    const text = new fabric.Textbox('Type here...', {
      left: Math.round(200 / GRID_SIZE) * GRID_SIZE,
      top: Math.round(100 / GRID_SIZE) * GRID_SIZE,
      width: 240,
      fontFamily: 'Courier New',
      fontSize: 20,
      fill: '#333',
      lineHeight: 1.3,
      editable: true,
      splitByGrapheme: true,
    });

    text._lockedWidth = text.width;
    const _origInit = text.initDimensions.bind(text);
    text.initDimensions = function () {
      const savedTop = this.top;
      if (this.isEditing && this._lockedWidth !== undefined) {
        this.width = this._lockedWidth;
        _origInit();
        this.width = this._lockedWidth;
      } else {
        _origInit();
        this._lockedWidth = this.width;
      }
      this.top = savedTop;
    };

    fabricCanvas.add(text);
    fabricCanvas.setActiveObject(text);
  };

  // ── Render ───────────────────────────────────────────────────────────────
  const toolbarVisible = !!activeTextbox;

  return (
    <div style={{ position: 'relative', width: '100vw', height: '100vh', overflow: 'hidden', backgroundColor: '#fffff5' }}>

      {/* ── Top toolbar strip ── */}
      {/* onMouseDown: prevent focus from leaving the canvas when clicking buttons.
          Skipped for <select> so native dropdowns still open; those are handled
          by the lastSelRef restore path in applyStyle instead. */}
      <div
        onMouseDown={(e) => { if (e.target.tagName !== 'SELECT') e.preventDefault(); }}
        style={{
          position: 'absolute',
          top: 0, left: 0, right: 0,
          zIndex: 10,
          background: 'white',
          borderBottom: '1px solid #ddd',
          padding: '6px 12px',
          display: 'flex',
          alignItems: 'center',
          gap: '6px',
          flexWrap: 'wrap',
        }}
      >

        {/* Add Text button — always visible */}
        <button onClick={addTextBox} style={{
          cursor: 'pointer',
          padding: '5px 12px',
          background: '#333',
          color: 'white',
          border: 'none',
          borderRadius: '4px',
          fontSize: '13px',
          fontWeight: 'bold',
        }}>
          + Add Text
        </button>

        {/* Formatting controls — only when a textbox is selected */}
        {toolbarVisible && <>
          <div style={divider} />

          {/* Font family */}
          <select value={fmt.fontFamily} onChange={setFont} style={{
            padding: '4px 6px', borderRadius: '4px', border: '1px solid #ccc',
            fontSize: '13px', cursor: 'pointer',
          }}>
            {FONTS.map(f => <option key={f} value={f}>{f}</option>)}
          </select>

          {/* Font size */}
          <select value={fmt.fontSize} onChange={setFontSize} style={{
            padding: '4px 6px', borderRadius: '4px', border: '1px solid #ccc',
            fontSize: '13px', cursor: 'pointer', width: '64px',
          }}>
            {FONT_SIZES.map(s => <option key={s} value={s}>{s}</option>)}
          </select>

          <div style={divider} />

          {/* Bold */}
          <button onClick={toggleBold} style={btnStyle(fmt.fontWeight === 'bold')} title="Bold">
            B
          </button>

          {/* Italic */}
          <button onClick={toggleItalic} style={{ ...btnStyle(fmt.fontStyle === 'italic'), fontStyle: 'italic' }} title="Italic">
            I
          </button>

          {/* Underline */}
          <button onClick={toggleUnderline} style={{ ...btnStyle(fmt.underline), textDecoration: 'underline' }} title="Underline">
            U
          </button>

          {/* Strikethrough */}
          <button onClick={toggleStrike} style={{ ...btnStyle(fmt.linethrough), textDecoration: 'line-through' }} title="Strikethrough">
            S
          </button>

          <div style={divider} />

          {/* Alignment */}
          {[
            { align: 'left', title: 'Align left' },
            { align: 'center', title: 'Align center' },
            { align: 'right', title: 'Align right' },
            { align: 'justify', title: 'Justify' },
          ].map(({ align, title }) => (
            <button
              key={align}
              onClick={() => setAlign(align)}
              style={btnStyle(fmt.textAlign === align)}
              title={title}
            >
              {align === 'left' && '⬅'}
              {align === 'center' && '↔'}
              {align === 'right' && '➡'}
              {align === 'justify' && '⇔'}
            </button>
          ))}
        </>}
      </div>

      {/* The Journal Canvas */}
      <canvas ref={canvasRef} style={{ marginTop: '44px' }} />
    </div>
  );
};

export default DigitalJournal;
