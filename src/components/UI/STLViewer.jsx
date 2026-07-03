import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RotateCcw, Play, Pause, Camera, AlertCircle } from 'lucide-react';

const STLViewer = ({ url, filename }) => {
  const mountRef = useRef(null);
  const controlsRef = useRef(null);
  const cameraRef = useRef(null);
  const rendererRef = useRef(null);
  const sceneRef = useRef(null);
  
  const [error, setError] = useState(null);
  const [isRotating, setIsRotating] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  const isRotatingRef = useRef(isRotating);
  useEffect(() => { isRotatingRef.current = isRotating; }, [isRotating]);

  const resetView = () => {
    if (controlsRef.current) controlsRef.current.reset();
  };

  const takeScreenshot = () => {
    if (rendererRef.current && sceneRef.current && cameraRef.current) {
      rendererRef.current.render(sceneRef.current, cameraRef.current);
      const dataUrl = rendererRef.current.domElement.toDataURL('image/png');
      const link = document.createElement('a');
      link.download = `hesyra-scan-${filename || 'capture'}.png`;
      link.href = dataUrl;
      link.click();
    }
  };

  useEffect(() => {
    if (!mountRef.current) return;
    setIsLoading(true);
    setError(null);
    let active = true;

    const container = mountRef.current;
    const width = container.clientWidth || 600;
    const height = container.clientHeight || 350;

    // ── Scene ───────────────────────────────────────────────────
    const scene = new THREE.Scene();
    sceneRef.current = scene;
    scene.background = new THREE.Color('#0f172a');

    // ── Camera ──────────────────────────────────────────────────
    const camera = new THREE.PerspectiveCamera(45, width / height, 0.01, 100000);
    camera.position.set(0, 80, 120);
    cameraRef.current = camera;

    // ── Renderer ────────────────────────────────────────────────
    const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    renderer.setSize(width, height);
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.domElement.style.display = 'block';
    renderer.domElement.style.width = '100%';
    renderer.domElement.style.height = '100%';
    rendererRef.current = renderer;
    container.appendChild(renderer.domElement);

    // ── Controls ────────────────────────────────────────────────
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    controls.target.set(0, 0, 0);
    controlsRef.current = controls;

    // ── Lights (3-point studio setup) ───────────────────────────
    scene.add(new THREE.AmbientLight(0xffffff, 0.6));
    const key = new THREE.DirectionalLight(0xffffff, 1.0);
    key.position.set(100, 100, 100);
    scene.add(key);
    const fill = new THREE.DirectionalLight(0xffffff, 0.4);
    fill.position.set(-80, 60, -60);
    scene.add(fill);
    const rim = new THREE.DirectionalLight(0xffffff, 0.3);
    rim.position.set(0, -50, -100);
    scene.add(rim);

    // ── Material (premium dental restoration look) ──────────────
    const material = new THREE.MeshStandardMaterial({
      color: 0xe5e7eb,
      roughness: 0.35,
      metalness: 0.1,
      side: THREE.DoubleSide,
    });

    let meshRef = null;

    // ── Fit model to camera view ────────────────────────────────
    const fitToScreen = (mesh) => {
      mesh.geometry.center();
      mesh.rotation.x = -Math.PI / 2; // CAD Z-up → Y-up
      mesh.updateMatrixWorld(true);

      const box = new THREE.Box3().setFromObject(mesh);
      const size = box.getSize(new THREE.Vector3());
      const center = box.getCenter(new THREE.Vector3());
      mesh.position.sub(center);
      mesh.updateMatrixWorld(true);

      const maxDim = Math.max(size.x, size.y, size.z);
      const fov = camera.fov * (Math.PI / 180);
      let dist = (maxDim / 2) / Math.tan(fov / 2);
      dist *= 1.8;

      camera.position.set(0, dist * 0.5, dist);
      camera.lookAt(0, 0, 0);
      camera.near = dist / 100;
      camera.far = dist * 10;
      camera.updateProjectionMatrix();

      controls.target.set(0, 0, 0);
      controls.update();
      controls.saveState();
    };

    // ── Load STL via fetch + parse (bypasses FileLoader issues) ─
    if (url) {
      fetch(url)
        .then(response => {
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          return response.arrayBuffer();
        })
        .then(arrayBuffer => {
          if (!active) return;

          const loader = new STLLoader();
          const geometry = loader.parse(arrayBuffer);

          const vertCount = geometry.attributes.position ? geometry.attributes.position.count : 0;
          if (vertCount === 0) {
            setError('STL file contains no geometry.');
            setIsLoading(false);
            return;
          }

          geometry.computeVertexNormals();

          const mesh = new THREE.Mesh(geometry, material);
          mesh.frustumCulled = false;
          scene.add(mesh);
          meshRef = mesh;

          fitToScreen(mesh);
          setIsLoading(false);
        })
        .catch(err => {
          if (!active) return;
          console.error('STL load error:', err);
          setError(`Failed to load STL: ${err.message}`);
          setIsLoading(false);
        });
    } else {
      // No URL — show placeholder torus knot
      const geo = new THREE.TorusKnotGeometry(20, 6, 100, 16);
      const mesh = new THREE.Mesh(geo, material);
      scene.add(mesh);
      meshRef = mesh;
      fitToScreen(mesh);
      setIsLoading(false);
    }

    // ── Animation loop ──────────────────────────────────────────
    let reqId;
    const animate = () => {
      reqId = requestAnimationFrame(animate);
      if (isRotatingRef.current && meshRef) {
        meshRef.rotation.z += 0.005;
      }
      controls.update();
      renderer.render(scene, camera);
    };
    animate();

    // ── Resize observer ─────────────────────────────────────────
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width: w, height: h } = entry.contentRect;
        if (w > 0 && h > 0) {
          renderer.setSize(w, h);
          camera.aspect = w / h;
          camera.updateProjectionMatrix();
        }
      }
    });
    ro.observe(container);

    // ── Cleanup ─────────────────────────────────────────────────
    return () => {
      active = false;
      ro.disconnect();
      cancelAnimationFrame(reqId);
      if (container && renderer.domElement && container.contains(renderer.domElement)) {
        container.removeChild(renderer.domElement);
      }
      renderer.dispose();
      scene.clear();
    };
  }, [url]);

  if (error) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', background: '#0f172a', color: '#f87171', borderRadius: '12px' }}>
        <div style={{ textAlign: 'center', padding: '24px' }}>
          <AlertCircle style={{ margin: '0 auto 8px' }} />
          <p style={{ fontSize: '13px', fontWeight: 500 }}>{error}</p>
        </div>
      </div>
    );
  }

  return (
    <div style={{ width: '100%', height: '100%', position: 'relative', borderRadius: '12px', overflow: 'hidden' }}>
      <div ref={mountRef} style={{ width: '100%', height: '100%' }} />

      {/* Filename badge */}
      <div style={{ position: 'absolute', top: 12, left: 16, zIndex: 10, background: 'rgba(0,0,0,0.6)', padding: '6px 14px', borderRadius: '20px', fontSize: '11px', fontWeight: 600, backdropFilter: 'blur(8px)', color: '#fff', border: '1px solid rgba(255,255,255,0.1)' }}>
        {filename || '3D Inspection'}
      </div>

      {/* Toolbar */}
      <div style={{ position: 'absolute', bottom: 16, left: '50%', transform: 'translateX(-50%)', zIndex: 10, display: 'flex', gap: '8px', background: 'rgba(15,23,42,0.8)', padding: '6px', borderRadius: '12px', backdropFilter: 'blur(12px)', border: '1px solid rgba(255,255,255,0.1)', boxShadow: '0 10px 25px rgba(0,0,0,0.3)' }}>
        <button 
          onClick={() => setIsRotating(!isRotating)} 
          style={{ background: 'transparent', border: 'none', color: '#fff', padding: '8px', cursor: 'pointer', borderRadius: '8px', display: 'flex' }}
          title={isRotating ? 'Pause' : 'Rotate'}
        >
          {isRotating ? <Pause size={18} /> : <Play size={18} />}
        </button>
        <button onClick={resetView} style={{ background: 'transparent', border: 'none', color: '#fff', padding: '8px', cursor: 'pointer', borderRadius: '8px', display: 'flex' }} title="Reset View">
          <RotateCcw size={18} />
        </button>
        <div style={{ width: '1px', background: 'rgba(255,255,255,0.1)', margin: '4px 0' }} />
        <button onClick={takeScreenshot} style={{ background: 'transparent', border: 'none', color: '#fff', padding: '8px', cursor: 'pointer', borderRadius: '8px', display: 'flex' }} title="Screenshot">
          <Camera size={18} />
        </button>
      </div>

      {isLoading && (
        <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(15,23,42,0.6)', backdropFilter: 'blur(4px)' }}>
          <div style={{ color: '#fff', fontSize: '12px', fontWeight: 500, textTransform: 'uppercase', letterSpacing: '2px', animation: 'pulse 1.5s ease-in-out infinite' }}>Loading Scan…</div>
        </div>
      )}
    </div>
  );
};

export default STLViewer;
