import React, { useState } from 'react';

export default function ImageSidebar({ images, onAddToCanvas, onDelete, collapsed, onToggle }) {
    const [hoveredId, setHoveredId] = useState(null);

    const handleDragStart = (e, imageId) => {
        e.dataTransfer.setData('application/x-poentry-image', String(imageId));
        e.dataTransfer.effectAllowed = 'copy';
    };

    return (
        <>
            {/* Toggle button moved below the sidebar so that '.sidebar-open ~ .sidebar-toggle' works */}

            {/* Sidebar panel */}
            <div className={`image-sidebar ${collapsed ? 'sidebar-collapsed' : 'sidebar-open'}`}>
                <div className="sidebar-header">
                    <span className="sidebar-title">📎 Images</span>
                    <span className="sidebar-count">{images.length}</span>
                </div>

                {images.length === 0 ? (
                    <div className="sidebar-empty">
                        <p>No images yet</p>
                        <p className="sidebar-hint">Paste (Cmd+V), upload, or drag an image</p>
                    </div>
                ) : (
                    <div className="sidebar-grid">
                        {images.map((img) => (
                            <div
                                key={img.id}
                                className="sidebar-thumb-wrapper"
                                onMouseEnter={() => setHoveredId(img.id)}
                                onMouseLeave={() => setHoveredId(null)}
                                draggable
                                onDragStart={(e) => handleDragStart(e, img.id)}
                            >
                                <img
                                    src={img.thumbnail}
                                    alt={img.filename}
                                    className="sidebar-thumb"
                                    onClick={() => onAddToCanvas(img.id)}
                                    title="Click or drag to add to canvas"
                                    draggable={false}
                                />
                                {hoveredId === img.id && (
                                    <button
                                        className="sidebar-delete-btn"
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            onDelete(img.id);
                                        }}
                                        title="Remove image"
                                    >
                                        ×
                                    </button>
                                )}
                            </div>
                        ))}
                    </div>
                )}
            </div>

            {/* Toggle button — always visible */}
            <button
                className="sidebar-toggle"
                onClick={onToggle}
                title={collapsed ? 'Show images' : 'Hide images'}
            >
                {collapsed ? '🖼️' : '◀'}
            </button>
        </>
    );
}
