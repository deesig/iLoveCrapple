import React, { useEffect, useRef, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import * as fabric from 'fabric';
import { useAuth } from './AuthContext';
import ImageSidebar from './ImageSidebar';

// ── Toolbar constants ──────────────────────────────────────────────────────────
const FONTS = [
  'Courier New', 'Arial', 'Georgia', 'Times New Roman', 'Verdana', 'Helvetica',
  'Atma', 'Averia Serif Libre', 'DM Sans', 'DM Serif Text', 'Google Sans',
  'IBM Plex Serif', 'Instrument Serif', 'Manrope', 'Newsreader', 'Oswald',
  'Outfit', 'Public Sans', 'Roboto Flex', 'Sour Gummy', 'Story Script', 'Vollkorn'
];
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
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const canvasRef = useRef(null);
  const [fabricCanvas, setFabricCanvas] = useState(null);
  // Persists the last known text selection so toolbar clicks can restore it
  // after the mousedown on the button blurs the canvas and clears isEditing.
  const lastSelRef = useRef({ textbox: null, start: 0, end: 0 });

  // Toolbar state — reflects the active selection / active textbox
  const [activeTextbox, setActiveTextbox] = useState(null);
  const [saveStatus, setSaveStatus] = useState('');
  const saveTimerRef = useRef(null);
  const [userImages, setUserImages] = useState([]);
  const [sessionAudios, setSessionAudios] = useState([]);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const fileInputRef = useRef(null);
  const audioInputRef = useRef(null);
  const [contextMenu, setContextMenu] = useState(null); // { x, y, target }
  const [fmt, setFmt] = useState({
    fontFamily: 'Courier New',
    fontSize: 20,
    fontWeight: 'normal',
    fontStyle: 'normal',
    underline: false,
    linethrough: false,
    textAlign: 'left',
  });

  // Page & Grid Configuration
  // 11" × 8.5" landscape at 96 PPI (Google Docs letter size)
  const PAGE_W = 8.5 * 180;   // 1056px
  const PAGE_H = 11 * 180; // 816px
  const PAGE_MARGIN = 40; // px margin around page
  const GRID_SIZE = 30;
  const DOT_SIZE = 1.5;
  const pageRef = useRef(null); // reference to the page background rect

  // ── initDimensions override helper — applied to every textbox ──────────
  // Extracts the initDimensions override into a reusable function so it can
  // be applied both to newly created textboxes AND to textboxes loaded from
  // saved JSON.
  const applyTextboxOverrides = useCallback((tb) => {
    tb._lockedWidth = tb._lockedWidth || tb.width;
    const _origInit = tb.initDimensions.bind(tb);
    tb.initDimensions = function () {
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
  }, []);

  // ── Canvas save (debounced) ───────────────────────────────────────────────
  const saveCanvas = useCallback((canvas) => {
    if (!canvas) return;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    setSaveStatus('Saving...');
    saveTimerRef.current = setTimeout(async () => {
      try {
        const json = canvas.toJSON(['splitByGrapheme', '_lockedWidth', '_isPageBg', '_isAudio', 'audioId', '_overlayId']);
        // Filter out the page background rect from saved data
        json.objects = json.objects.filter(o => !o._isPageBg);
        await fetch('/api/canvas', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ canvasJSON: json }),
        });
        setSaveStatus('Saved ✓');
        setTimeout(() => setSaveStatus(''), 2000);
      } catch (err) {
        console.error('Save failed:', err);
        setSaveStatus('Save failed');
      }
    }, 1500);
  }, []);

  // ── Load saved canvas ─────────────────────────────────────────────────────
  const loadCanvas = useCallback(async (canvas, activePageObj) => {
    try {
      const res = await fetch('/api/canvas', { credentials: 'include' });
      if (!res.ok) return;
      const { canvasJSON } = await res.json();
      if (!canvasJSON || !canvasJSON.objects?.length) return;

      // Clean up old duplicated pages and migrate element coordinates safely
      let oldPageLeft = null;
      let oldPageTop = null;
      canvasJSON.objects = canvasJSON.objects.filter((o) => {
        const isPageRect = o._isPageBg || (
          o.type && o.type.toLowerCase() === 'rect' &&
          !o.selectable && !o.evented
        );
        if (isPageRect) {
          if (oldPageLeft === null) {
            oldPageLeft = o.left;
            oldPageTop = o.top;
          }
          return false;
        }
        return true;
      });

      if (oldPageLeft !== null && oldPageLeft !== PAGE_MARGIN) {
        const dx = PAGE_MARGIN - oldPageLeft;
        const dy = PAGE_MARGIN - (oldPageTop ?? PAGE_MARGIN);
        canvasJSON.objects.forEach((o) => {
          if (o.left !== undefined) o.left += dx;
          if (o.top !== undefined) o.top += dy;
        });
      }

      await canvas.loadFromJSON(canvasJSON);

      // Re-apply our custom overrides to every loaded textbox
      // And fetch audio URLs for audio placeholders
      const loadedAudios = [];
      canvas.getObjects().forEach((obj) => {
        if (obj.type === 'textbox') {
          applyTextboxOverrides(obj);
        } else if (obj._isAudio && obj.audioId) {
          loadedAudios.push(obj);
        }
      });

      // Fetch base64 audio data for all loaded audio players
      if (loadedAudios.length > 0) {
        Promise.all(
          loadedAudios.map(async (obj) => {
            try {
              const r = await fetch(`/api/audio/${obj.audioId}`, { credentials: 'include' });
              if (!r.ok) return null;
              const data = await r.json();
              return { overlayId: obj._overlayId, url: data.audioData };
            } catch (e) {
              return null;
            }
          })
        ).then(results => {
          const valid = results.filter(r => r !== null);
          setSessionAudios(prev => [...prev, ...valid]);
        });
      }

      // Restore page rect (loadFromJSON replaces all objects)
      if (activePageObj) {
        canvas.add(activePageObj);
        canvas.sendObjectToBack(activePageObj);
      }
      canvas.set('backgroundColor', '#e8e8e8');
      canvas.requestRenderAll();
    } catch (err) {
      console.error('Load failed:', err);
    }
  }, [applyTextboxOverrides]);

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
    const canvasH = PAGE_H + PAGE_MARGIN * 2;
    const canvasW = PAGE_W - PAGE_MARGIN * 14;
    const canvas = new fabric.Canvas(canvasRef.current, {
      height: canvasH,
      width: canvasW,
      selection: true,
      fireRightClick: true,
      stopContextMenu: true,
      backgroundColor: '#e8e8e8',
    });

    // ── Page background rect (non-interactive, always at back) ──────────
    const pageLeft = PAGE_MARGIN;
    const pageTop = PAGE_MARGIN;

    // Create a dot-pattern tile for the page fill
    const dotTile = document.createElement('canvas');
    dotTile.width = GRID_SIZE;
    dotTile.height = GRID_SIZE;
    const dCtx = dotTile.getContext('2d');
    dCtx.fillStyle = '#fffff5';
    dCtx.fillRect(0, 0, GRID_SIZE, GRID_SIZE);
    dCtx.fillStyle = '#cccccc';
    dCtx.beginPath();
    dCtx.arc(GRID_SIZE / 2, GRID_SIZE / 2, DOT_SIZE, 0, Math.PI * 2);
    dCtx.fill();

    const page = new fabric.Rect({
      left: pageLeft,
      top: pageTop,
      width: PAGE_W,
      height: PAGE_H,
      fill: new fabric.Pattern({ source: dotTile, repeat: 'repeat' }),
      selectable: false,
      evented: false,
      hasControls: false,
      hoverCursor: 'default',
      shadow: new fabric.Shadow({ color: 'rgba(0,0,0,0.15)', blur: 12, offsetX: 2, offsetY: 4 }),
      _isPageBg: true,
    });
    canvas.add(page);
    canvas.sendObjectToBack(page);
    pageRef.current = page;

    // Snap to grid
    canvas.on('object:moving', ({ target }) => {
      if (target._isPageBg) return;
      target.set({
        left: Math.round(target.left / GRID_SIZE) * GRID_SIZE,
        top: Math.round(target.top / GRID_SIZE) * GRID_SIZE,
      });
    });

    // Sync HTML audio overlays on every render to exactly match Fabric object boundaries
    const syncAudioOverlays = () => {
      canvas.getObjects().forEach(o => {
        if (o._isAudio) {
          const el = document.getElementById(`audio-container-${o._overlayId}`);
          if (el) {
            const rect = o.getBoundingRect();
            el.style.left = `${rect.left}px`;
            el.style.top = `${rect.top}px`;
            el.style.width = `${rect.width}px`;
            el.style.height = `${rect.height}px`;
          }
        }
      });
    };
    canvas.on('after:render', syncAudioOverlays);

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

    // ── Auto-save triggers ─────────────────────────────────────────────────
    const triggerSave = () => saveCanvas(canvas);
    canvas.on('object:modified', triggerSave);
    canvas.on('text:changed', triggerSave);
    canvas.on('object:added', triggerSave);
    canvas.on('object:removed', triggerSave);

    // Load saved canvas data
    loadCanvas(canvas, page);

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
  const addTextBox = useCallback((eOrX, optY) => {
    if (!fabricCanvas) return;

    let left, top;
    // Handle if called with coordinates vs click event
    if (typeof eOrX === 'number' && typeof optY === 'number') {
      left = eOrX;
      top = optY;
    } else {
      // Place inside the page area
      const page = pageRef.current;
      left = page ? page.left + 100 : 200;
      top = page ? page.top + 30 : 100;
    }

    const text = new fabric.Textbox('Type here...', {
      left: Math.round(left / GRID_SIZE) * GRID_SIZE,
      top: Math.round(top / GRID_SIZE) * GRID_SIZE,
      width: 240,
      fontFamily: 'Outfit',
      fontSize: 20,
      fill: '#333',
      lineHeight: 1.3,
      editable: true,
      splitByGrapheme: true,
    });

    applyTextboxOverrides(text);
    fabricCanvas.add(text);
    fabricCanvas.setActiveObject(text);
  }, [fabricCanvas, applyTextboxOverrides]);

  // ── Add Audio ────────────────────────────────────────────────────────────
  const addAudioToCanvas = useCallback((audioId, dataUrl, x, y) => {
    if (!fabricCanvas) return;
    const page = pageRef.current;
    const pLeft = page ? page.left + 100 : 200;
    const pTop = page ? page.top + 30 : 100;

    const overlayId = Date.now().toString() + Math.random().toString(36).substr(2, 5);

    const rect = new fabric.Rect({
      left: x ?? Math.round(pLeft / GRID_SIZE) * GRID_SIZE,
      top: y ?? Math.round(pTop / GRID_SIZE) * GRID_SIZE,
      width: 300,
      height: 54, // standard HTML audio height
      fill: 'transparent',
      stroke: 'rgba(0,0,0,0)',
      rx: 10,
      ry: 10,
    });

    rect._isAudio = true;
    rect.audioId = audioId;
    rect._overlayId = overlayId;
    rect.setControlsVisibility({
      mt: false, mb: false, ml: true, mr: true,
      tl: false, tr: false, bl: false, br: false
    });

    fabricCanvas.add(rect);
    fabricCanvas.setActiveObject(rect);
    fabricCanvas.requestRenderAll();

    setSessionAudios(prev => [...prev, { overlayId, url: dataUrl }]);
  }, [fabricCanvas]);

  const handleUploadAudio = useCallback((e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (ev) => {
      const dataUrl = ev.target.result;
      try {
        const res = await fetch('/api/audio', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ audioData: dataUrl, filename: file.name, mimeType: file.type }),
        });
        if (!res.ok) throw new Error('Audio upload failed');
        const data = await res.json();
        addAudioToCanvas(data.id, dataUrl);
      } catch (err) {
        console.error('Audio upload error:', err);
      }
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  }, [addAudioToCanvas]);

  // ── Image helpers ────────────────────────────────────────────────────────
  const generateThumbnail = useCallback((dataUrl, maxSize = 150) => {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const scale = Math.min(maxSize / img.width, maxSize / img.height, 1);
        canvas.width = img.width * scale;
        canvas.height = img.height * scale;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL('image/jpeg', 0.7));
      };
      img.src = dataUrl;
    });
  }, []);

  const addImageToCanvas = useCallback((dataUrl, x, y) => {
    if (!fabricCanvas) return;
    const imgEl = new Image();
    imgEl.crossOrigin = 'anonymous';
    imgEl.onload = () => {
      const fImg = new fabric.FabricImage(imgEl, {
        left: x ?? 100,
        top: y ?? 100,
      });
      // Scale to fit reasonably on canvas (max 400px wide)
      const maxW = 400;
      if (fImg.width > maxW) {
        fImg.scaleToWidth(maxW);
      }
      fabricCanvas.add(fImg);
      fabricCanvas.setActiveObject(fImg);
      fabricCanvas.requestRenderAll();
    };
    imgEl.src = dataUrl;
  }, [fabricCanvas]);

  const uploadImageToServer = useCallback(async (dataUrl, filename = 'pasted-image') => {
    try {
      const thumbnail = await generateThumbnail(dataUrl);
      const res = await fetch('/api/images', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ imageData: dataUrl, thumbnail, filename }),
      });
      if (!res.ok) throw new Error('Upload failed');
      const data = await res.json();
      setUserImages((prev) => [{ id: data.id, thumbnail: data.thumbnail, filename: data.filename }, ...prev]);
    } catch (err) {
      console.error('Image upload error:', err);
    }
  }, [generateThumbnail]);

  const handleAddFromSidebar = useCallback(async (imageId) => {
    try {
      const res = await fetch(`/api/images/${imageId}`, { credentials: 'include' });
      if (!res.ok) return;
      const { imageData } = await res.json();
      addImageToCanvas(imageData);
    } catch (err) {
      console.error('Failed to load image:', err);
    }
  }, [addImageToCanvas]);

  const handleDeleteImage = useCallback(async (imageId) => {
    try {
      await fetch(`/api/images/${imageId}`, { method: 'DELETE', credentials: 'include' });
      setUserImages((prev) => prev.filter((img) => img.id !== imageId));
    } catch (err) {
      console.error('Failed to delete image:', err);
    }
  }, []);

  // ── Paste handler ───────────────────────────────────────────────────────
  useEffect(() => {
    const handlePaste = (e) => {
      // Don't intercept paste when a textbox is being edited
      if (fabricCanvas?.getActiveObject()?.isEditing) return;

      const items = e.clipboardData?.items;
      if (!items) return;

      for (const item of items) {
        if (item.type.startsWith('image/')) {
          e.preventDefault();
          const file = item.getAsFile();
          const reader = new FileReader();
          reader.onload = (ev) => {
            const dataUrl = ev.target.result;
            addImageToCanvas(dataUrl);
            uploadImageToServer(dataUrl, file.name || 'pasted-image');
          };
          reader.readAsDataURL(file);
          break;
        }
      }
    };

    window.addEventListener('paste', handlePaste);
    return () => window.removeEventListener('paste', handlePaste);
  }, [fabricCanvas, addImageToCanvas, uploadImageToServer]);

  // ── File upload handler ──────────────────────────────────────────────────
  const handleUploadImage = useCallback((e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const dataUrl = ev.target.result;
      addImageToCanvas(dataUrl);
      uploadImageToServer(dataUrl, file.name);
    };
    reader.readAsDataURL(file);
    // Reset so same file can be uploaded again
    e.target.value = '';
  }, [addImageToCanvas, uploadImageToServer]);

  // ── Load user images on mount ────────────────────────────────────────────
  useEffect(() => {
    fetch('/api/images', { credentials: 'include' })
      .then((res) => (res.ok ? res.json() : { images: [] }))
      .then(({ images }) => setUserImages(images))
      .catch(() => { });
  }, []);

  // ── Logout handler ──────────────────────────────────────────────────────
  const handleLogout = async () => {
    await logout();
    navigate('/', { replace: true });
  };

  // ── Drag-and-drop from sidebar ─────────────────────────────────────────
  const handleDragOver = useCallback((e) => {
    if (e.dataTransfer.types.includes('application/x-poentry-image') ||
      e.dataTransfer.types.includes('application/x-poentry-text')) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
    }
  }, []);

  const handleDrop = useCallback(async (e) => {
    const isText = e.dataTransfer.getData('application/x-poentry-text');
    const imageId = e.dataTransfer.getData('application/x-poentry-image');

    if (!imageId && !isText) return;
    e.preventDefault();

    // Calculate canvas-relative position
    const canvasEl = canvasRef.current;
    const rect = canvasEl.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    if (isText) {
      addTextBox(x, y);
      return;
    }

    try {
      const res = await fetch(`/api/images/${imageId}`, { credentials: 'include' });
      if (!res.ok) return;
      const { imageData } = await res.json();
      addImageToCanvas(imageData, x, y);
    } catch (err) {
      console.error('Drop image error:', err);
    }
  }, [addImageToCanvas, addTextBox]);

  // ── Right-click context menu ───────────────────────────────────────────
  useEffect(() => {
    if (!fabricCanvas) return;

    const onMouseDown = (opt) => {
      // Fabric.js v7 passes the native event at opt.e; right-click = e.button === 2
      if (opt.e?.button === 2) {
        opt.e.preventDefault();
        opt.e.stopPropagation();

        const target = opt.target;
        if (!target) {
          setContextMenu(null);
          return;
        }

        fabricCanvas.setActiveObject(target);
        fabricCanvas.requestRenderAll();
        setContextMenu({ x: opt.e.clientX, y: opt.e.clientY, target });
      } else {
        // Left or middle click — dismiss menu
        setContextMenu(null);
      }
    };

    fabricCanvas.on('mouse:down', onMouseDown);

    return () => {
      fabricCanvas.off('mouse:down', onMouseDown);
    };
  }, [fabricCanvas]);

  const handleZOrder = useCallback((action) => {
    if (!fabricCanvas || !contextMenu?.target) return;
    const obj = contextMenu.target;
    switch (action) {
      case 'front': fabricCanvas.bringObjectToFront(obj); break;
      case 'back': fabricCanvas.sendObjectToBack(obj); break;
      case 'forward': fabricCanvas.bringObjectForward(obj); break;
      case 'backward': fabricCanvas.sendObjectBackwards(obj); break;
    }
    fabricCanvas.requestRenderAll();
    setContextMenu(null);
  }, [fabricCanvas, contextMenu]);

  // Close context menu on click anywhere
  useEffect(() => {
    const close = () => setContextMenu(null);
    window.addEventListener('click', close);
    return () => window.removeEventListener('click', close);
  }, []);

  // ── Render ───────────────────────────────────────────────────────────────
  const toolbarVisible = !!activeTextbox;

  return (
    <div
      style={{ position: 'relative', width: '100vw', height: '100vh', overflow: 'hidden', backgroundColor: '#e8e8e8', display: 'flex', flexDirection: 'column' }}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >

      {/* ── User header (top-right) ── */}
      <div className="journal-header">
        <div className="journal-user-info">
          {user?.avatarUrl && <img src={user.avatarUrl} alt="" className="journal-avatar" />}
          <span className="journal-username">@{user?.username}</span>
        </div>
        {saveStatus && <span className="journal-save-status">{saveStatus}</span>}
        <button onClick={handleLogout} className="journal-logout-btn">Log out</button>
      </div>

      {/* ── Top toolbar strip ── */}
      {/* onMouseDown: prevent focus from leaving the canvas when clicking buttons.
          Skipped for <select> and draggable elements so native behaviors still work. */}
      <div
        onMouseDown={(e) => {
          if (e.target.tagName !== 'SELECT' && !e.target.draggable) e.preventDefault();
        }}
        style={{
          position: 'relative',
          zIndex: 10,
          background: 'white',
          borderBottom: '1px solid #ddd',
          padding: '6px 12px',
          display: 'flex',
          alignItems: 'center',
          gap: '6px',
          flexWrap: 'wrap',
          flexShrink: 0,
        }}
      >

        {/* Add Text button — always visible */}
        <button
          onClick={addTextBox}
          draggable
          onDragStart={(e) => {
            e.dataTransfer.setData('application/x-poentry-text', 'true');
            e.dataTransfer.effectAllowed = 'copy';
          }}
          title="Click to add or drag to canvas"
          style={{
            cursor: 'grab',
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

        {/* Upload Image button — always visible */}
        <button onClick={() => fileInputRef.current?.click()} style={{
          cursor: 'pointer',
          padding: '5px 12px',
          background: '#555',
          color: 'white',
          border: 'none',
          borderRadius: '4px',
          fontSize: '13px',
          fontWeight: 'bold',
        }}>
          🖼️ Add Image
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/jpeg,image/png"
          style={{ display: 'none' }}
          onChange={handleUploadImage}
        />

        {/* Upload Audio button — always visible */}
        <button onClick={() => audioInputRef.current?.click()} style={{
          cursor: 'pointer',
          padding: '5px 12px',
          background: '#7c6aef',
          color: 'white',
          border: 'none',
          borderRadius: '4px',
          fontSize: '13px',
          fontWeight: 'bold',
        }}>
          🎵 Add Audio
        </button>
        <input
          ref={audioInputRef}
          type="file"
          accept="audio/mp3,audio/mpeg,audio/wav"
          style={{ display: 'none' }}
          onChange={handleUploadAudio}
        />

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

      {/* The Journal Canvas — scrollable area below sticky toolbar */}
      <div style={{ flex: 1, overflow: 'auto' }}>
        <div style={{
          minWidth: `${Math.max(window.screen ? window.screen.availWidth : 1440, 1336)}px`,
          minHeight: '100%',
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'flex-start',
          paddingTop: '40px',
          paddingBottom: '40px',
          paddingLeft: sidebarCollapsed ? '36px' : '200px',
          transition: 'padding-left 0.2s ease'
        }}>
          <div style={{ position: 'relative' }}>
            <canvas ref={canvasRef} />

            {/* ── Native HTML overlays for interactive objects like audio ── */}
            {sessionAudios.map(a => (
              <div
                key={a.overlayId}
                id={`audio-container-${a.overlayId}`}
                style={{
                  position: 'absolute',
                  zIndex: 5,
                  pointerEvents: 'auto',
                  // Initial values, overridden live by syncAudioOverlays
                  left: -9999, top: -9999,
                }}
              >
                <audio
                  controls
                  src={a.url}
                  style={{ width: '100%', height: '100%', outline: 'none' }}
                  onMouseDown={(e) => e.stopPropagation()}
                />
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Image Sidebar */}
      <ImageSidebar
        images={userImages}
        onAddToCanvas={handleAddFromSidebar}
        onDelete={handleDeleteImage}
        collapsed={sidebarCollapsed}
        onToggle={() => setSidebarCollapsed((p) => !p)}
      />

      {/* Right-click context menu */}
      {contextMenu && (
        <div
          className="canvas-context-menu"
          style={{ top: contextMenu.y, left: contextMenu.x }}
          onClick={(e) => e.stopPropagation()}
        >
          <button onClick={() => handleZOrder('front')}>Bring to Front</button>
          <button onClick={() => handleZOrder('forward')}>Bring Forward</button>
          <button onClick={() => handleZOrder('backward')}>Send Backward</button>
          <button onClick={() => handleZOrder('back')}>Send to Back</button>
        </div>
      )}
    </div>
  );
};

export default DigitalJournal;
