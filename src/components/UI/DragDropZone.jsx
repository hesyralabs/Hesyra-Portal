import React, { useState, useRef } from 'react';
import { UploadCloud, FileType, X, CheckCircle2 } from 'lucide-react';
import { useNotifications } from '../../context/NotificationContext';
import styles from './DragDropZone.module.css';

const DragDropZone = ({ files, onFilesAdded, onFileRemoved, accept = ".stl,.ply,.obj,.zip,.dcm", multiple = true }) => {
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef(null);
  const { showToast } = useNotifications();

  const validateFiles = (fileList) => {
    const validExtensions = accept.split(',').map(ext => ext.trim().toLowerCase());
    const validFiles = [];
    
    fileList.forEach(file => {
      if (file.size === 0) {
        showToast(`Rejected "${file.name}": File is empty (0kb)`, 'error');
        return;
      }
      
      const fileExt = file.name.substring(file.name.lastIndexOf('.')).toLowerCase();
      if (!validExtensions.includes(fileExt)) {
        showToast(`Rejected "${file.name}": Invalid format. Accepts ${accept}`, 'error');
        return;
      }
      validFiles.push(file);
    });
    return validFiles;
  };

  const dragEvents = {
    onDragEnter: (e) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragging(true);
    },
    onDragLeave: (e) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragging(false);
    },
    onDragOver: (e) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragging(true);
    },
    onDrop: (e) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragging(false);
      
      const droppedFiles = Array.from(e.dataTransfer.files);
      if (droppedFiles.length > 0) {
        const validated = validateFiles(droppedFiles);
        if (validated.length > 0) onFilesAdded(validated);
      }
    }
  };

  const handleFileInput = (e) => {
    const selectedFiles = Array.from(e.target.files);
    if (selectedFiles.length > 0) {
      const validated = validateFiles(selectedFiles);
      if (validated.length > 0) onFilesAdded(validated);
    }
    // Reset input so the same file can be selected again if needed
    e.target.value = '';
  };

  return (
    <div className={styles.container}>
      <div 
        className={`${styles.dropZone} ${isDragging ? styles.isDragging : ''}`}
        {...dragEvents}
        onClick={() => fileInputRef.current?.click()}
      >
        <UploadCloud size={48} className={styles.icon} />
        <h3>{isDragging ? 'Drop files now' : 'Drag & drop files here'}</h3>
        <p>or click to browse from your computer</p>
        <div className={styles.acceptedTypes}>Accepts {accept.replace(/\./g, '').toUpperCase()}</div>
        
        <input 
          type="file" 
          ref={fileInputRef}
          className={styles.hiddenInput} 
          accept={accept}
          multiple={multiple}
          onChange={handleFileInput}
        />
      </div>

      {files.length > 0 && (
        <div className={styles.fileList}>
          <h4>Attached Scans ({files.length})</h4>
          {files.map((file, idx) => (
            <div key={`${file.name}-${idx}`} className={styles.fileItem}>
              <FileType size={20} className={styles.fileIcon} />
              <div className={styles.fileInfo}>
                <span className={styles.fileName}>{file.name}</span>
                <span className={styles.fileSize}>{(file.size / 1024 / 1024).toFixed(2)} MB</span>
              </div>
              <CheckCircle2 size={16} className={styles.successIcon} />
              <button 
                type="button"
                className={styles.removeBtn} 
                onClick={(e) => { e.stopPropagation(); onFileRemoved(idx); }}
                title="Remove file"
              >
                <X size={14} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default DragDropZone;
