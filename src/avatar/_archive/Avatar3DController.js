/**
 * Avatar3DController
 *
 * Manages a Three.js 3D scene for the Yui avatar.
 * Loads separate GLB files for idle, thinking, and talking states.
 *
 * Transition strategy: CSS canvas opacity fade-out → switch model → fade-in.
 * This avoids ghosting (no two models visible simultaneously) and does not
 * touch material properties (so glasses / transparent parts stay correct).
 */

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
const AVATAR_CONFIG = {
  fov:     38,
  cameraZ: 3.2,    // distance — decrease to zoom in
  cameraY: 0.15,   // camera height above ground
  lookAtY: 0.9,    // model Y point the camera looks at (waist/chest)

  // Auto-scale target height in world units.
  targetHeight: 2.1,

  // Vertical offset applied after auto-fit. Negative = push model down.
  modelYOffset: -0.1,

  // Transition: total duration split into fade-out + fade-in.
  fadeDuration: 0.28, // seconds per half (out or in); total = 2× this

  // Asset paths relative to index.html (project root).
  models: {
    idle:     'assets/models/Yui Idle.glb',
    thinking: 'assets/models/Yui Thinking.glb',
    talking:  'assets/models/Yui Talking.glb',
  },
};

const STATES = { IDLE: 'idle', THINKING: 'thinking', TALKING: 'talking' };

// ---------------------------------------------------------------------------
// Avatar3DController
// ---------------------------------------------------------------------------
class Avatar3DController {
  constructor() {
    /** @type {HTMLCanvasElement|null} */
    this._canvas = null;
    /** @type {THREE.WebGLRenderer|null} */
    this._renderer = null;
    /** @type {THREE.Scene|null} */
    this._scene = null;
    /** @type {THREE.PerspectiveCamera|null} */
    this._camera = null;
    /** @type {number|null} */
    this._animFrameId = null;
    /** @type {THREE.Clock} */
    this._clock = new THREE.Clock();

    /**
     * Loaded model data, keyed by state name.
     * Each value: { mixer, action, scene }
     * @type {Map<string, {mixer: THREE.AnimationMixer, action: THREE.AnimationAction|null, scene: THREE.Object3D}>}
     */
    this._models = new Map();

    /** State name currently rendered (may be empty string during first load). */
    this._currentState = '';

    /** Mixer that the render loop should tick each frame. */
    this._activeMixer = null;

    /** Whether a CSS transition is currently animating. */
    this._transitioning = false;

    /** State queued while a transition is in progress. */
    this._pendingState = null;

    this._resizeObserver = null;
    this._initialized = false;
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  async init(container, canvas) {
    if (this._initialized) return;

    try {
      this._setupRenderer(container, canvas);
      this._setupScene();
      this._setupCamera();
      this._setupLights();
      this._startRenderLoop();
      this._observeResize(container);
      this._initialized = true;

      console.log('[Avatar3D] Scene ready. Loading models…');

      // Load idle first; others load in the background.
      await this._loadModel(STATES.IDLE);
      this._activateModel(this._models.get(STATES.IDLE));
      this._currentState = STATES.IDLE;

      document.dispatchEvent(new CustomEvent('avatar3d:ready'));

      this._loadModel(STATES.THINKING).catch((e) =>
        console.error('[Avatar3D] thinking load failed:', e)
      );
      this._loadModel(STATES.TALKING).catch((e) =>
        console.error('[Avatar3D] talking load failed:', e)
      );
    } catch (err) {
      console.error('[Avatar3D] Init failed:', err);
    }
  }

  playIdle()     { this._switchTo(STATES.IDLE); }
  playThinking() { this._switchTo(STATES.THINKING); }
  playTalking()  { this._switchTo(STATES.TALKING); }

  /** @param {'idle'|'thinking'|'talking'} stateName */
  playState(stateName) {
    if (!Object.values(STATES).includes(stateName)) {
      console.warn('[Avatar3D] Unknown state:', stateName);
      return;
    }
    this._switchTo(stateName);
  }

  dispose() {
    this._stopRenderLoop();

    if (this._resizeObserver) {
      this._resizeObserver.disconnect();
      this._resizeObserver = null;
    }

    for (const [, data] of this._models) {
      if (data.action) data.action.stop();
      if (data.scene) {
        this._scene?.remove(data.scene);
        data.scene.traverse((obj) => {
          obj.geometry?.dispose();
          const mats = obj.material
            ? (Array.isArray(obj.material) ? obj.material : [obj.material])
            : [];
          mats.forEach((m) => m.dispose());
        });
      }
    }
    this._models.clear();

    if (this._renderer) {
      this._renderer.dispose();
      this._renderer.domElement.remove();
      this._renderer = null;
    }

    this._scene = this._camera = this._activeMixer = null;
    this._initialized = false;
    console.log('[Avatar3D] Disposed.');
  }

  // -------------------------------------------------------------------------
  // Private — setup
  // -------------------------------------------------------------------------

  _setupRenderer(container, existingCanvas) {
    const canvas = existingCanvas
      || document.getElementById('avatar-canvas')
      || (() => {
          const c = document.createElement('canvas');
          c.id = 'avatar-canvas';
          container.appendChild(c);
          return c;
        })();

    this._canvas = canvas;

    // CSS transition for the fade effect — controlled via style.opacity.
    canvas.style.transition = `opacity ${AVATAR_CONFIG.fadeDuration}s ease-in-out`;
    canvas.style.opacity = '1';

    this._renderer = new THREE.WebGLRenderer({
      canvas,
      alpha:           true,
      antialias:       true,
      powerPreference: 'high-performance',
    });
    this._renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this._renderer.setClearColor(0x000000, 0); // transparent — background comes from CSS
    this._renderer.shadowMap.enabled = false;
    this._renderer.outputColorSpace   = THREE.SRGBColorSpace;

    const w = container.clientWidth  || 800;
    const h = container.clientHeight || 600;
    this._renderer.setSize(w, h, false);
  }

  _setupScene() {
    this._scene = new THREE.Scene();
  }

  _setupCamera() {
    const w = this._canvas?.clientWidth  || 800;
    const h = this._canvas?.clientHeight || 600;

    this._camera = new THREE.PerspectiveCamera(AVATAR_CONFIG.fov, w / h, 0.1, 100);
    this._camera.position.set(0, AVATAR_CONFIG.cameraY, AVATAR_CONFIG.cameraZ);
    this._camera.lookAt(0, AVATAR_CONFIG.lookAtY, 0);
  }

  _setupLights() {
    this._scene.add(new THREE.AmbientLight(0xffffff, 1.1));

    const key = new THREE.DirectionalLight(0xfff6e8, 2.4);
    key.position.set(2.5, 4, 3.5);
    this._scene.add(key);

    const fill = new THREE.DirectionalLight(0xdce8ff, 1.0);
    fill.position.set(-3, 1.5, 2);
    this._scene.add(fill);

    const rim = new THREE.DirectionalLight(0xffffff, 0.45);
    rim.position.set(0, 3, -3);
    this._scene.add(rim);
  }

  // -------------------------------------------------------------------------
  // Private — render loop
  // -------------------------------------------------------------------------

  _startRenderLoop() {
    const loop = () => {
      this._animFrameId = requestAnimationFrame(loop);
      const delta = this._clock.getDelta();

      if (this._activeMixer) {
        this._activeMixer.update(delta);
      }

      if (this._renderer && this._scene && this._camera) {
        this._renderer.render(this._scene, this._camera);
      }
    };
    loop();
  }

  _stopRenderLoop() {
    if (this._animFrameId !== null) {
      cancelAnimationFrame(this._animFrameId);
      this._animFrameId = null;
    }
  }

  _observeResize(container) {
    if (!window.ResizeObserver) return;
    this._resizeObserver = new ResizeObserver(() => this._handleResize(container));
    this._resizeObserver.observe(container);
  }

  _handleResize(container) {
    if (!this._renderer || !this._camera) return;
    const w = container.clientWidth;
    const h = container.clientHeight;
    if (!w || !h) return;
    this._renderer.setSize(w, h, false);
    this._camera.aspect = w / h;
    this._camera.updateProjectionMatrix();
  }

  // -------------------------------------------------------------------------
  // Private — model loading
  // -------------------------------------------------------------------------

  async _loadModel(stateName) {
    if (this._models.has(stateName)) return;

    const assetPath = AVATAR_CONFIG.models[stateName];
    if (!assetPath) {
      console.warn('[Avatar3D] No asset path for state:', stateName);
      return;
    }

    console.log(`[Avatar3D] Loading "${stateName}": ${assetPath}`);

    let gltf;
    try {
      gltf = await new GLTFLoader().loadAsync(assetPath);
    } catch (err) {
      console.error(`[Avatar3D] Failed to load "${stateName}":`, err);
      return;
    }

    const modelScene = gltf.scene;
    this._fitModel(modelScene);
    modelScene.visible = false;
    this._scene.add(modelScene);

    const mixer = new THREE.AnimationMixer(modelScene);
    const clips = gltf.animations || [];
    let action = null;

    if (clips.length > 0) {
      action = mixer.clipAction(clips[0]);
      action.setLoop(THREE.LoopRepeat, Infinity);
      action.clampWhenFinished = false;
    } else {
      console.warn(`[Avatar3D] "${stateName}" has no animation clips.`);
    }

    this._models.set(stateName, { mixer, action, scene: modelScene });
    console.log(`[Avatar3D] "${stateName}" ready. Clips: ${clips.length}`);

    // If this model was requested while it was still loading, activate it now.
    if (this._pendingState === stateName) {
      this._pendingState = null;
      this._switchTo(stateName);
    }
  }

  /** Auto-scale and center the model. */
  _fitModel(modelScene) {
    const box  = new THREE.Box3().setFromObject(modelScene);
    const size = new THREE.Vector3();
    box.getSize(size);

    const scale = size.y > 0 ? AVATAR_CONFIG.targetHeight / size.y : 1;
    modelScene.scale.setScalar(scale);

    // Recompute bounds after scaling.
    const scaledBox = new THREE.Box3().setFromObject(modelScene);
    const center    = new THREE.Vector3();
    scaledBox.getCenter(center);

    // Center horizontally, place feet at y=0, then apply Y offset.
    modelScene.position.x -= center.x;
    modelScene.position.y -= scaledBox.min.y;
    modelScene.position.y += AVATAR_CONFIG.modelYOffset;
    modelScene.position.z -= center.z;
  }

  // -------------------------------------------------------------------------
  // Private — model activation (no material changes)
  // -------------------------------------------------------------------------

  /**
   * Instantly activate a model: show it, start its animation, update the
   * active mixer. Hides the previous model if provided.
   */
  _activateModel(nextData, prevData = null) {
    // Deactivate previous.
    if (prevData) {
      if (prevData.action) prevData.action.stop();
      if (prevData.scene)  prevData.scene.visible = false;
    }

    if (!nextData) return;

    // Activate next.
    nextData.scene.visible = true;
    if (nextData.action) {
      nextData.action.reset();
      nextData.action.timeScale = 1;
      nextData.action.play();
    }

    // Hand off to the render loop.
    this._activeMixer = nextData.mixer;
  }

  // -------------------------------------------------------------------------
  // Private — CSS fade transition
  // -------------------------------------------------------------------------

  /**
   * Switch to a new state using a CSS fade-out → swap → fade-in on the canvas.
   * Only one model is ever visible at a time — no ghosting, no material changes.
   */
  _switchTo(stateName) {
    if (this._currentState === stateName) return;

    // If a transition is already running, just queue the request.
    // We'll pick it up when the current one finishes.
    if (this._transitioning) {
      this._pendingState = stateName;
      return;
    }

    const nextData = this._models.get(stateName);
    if (!nextData) {
      // Model not loaded yet — queue it and start loading.
      console.warn(`[Avatar3D] "${stateName}" not loaded yet, queueing.`);
      this._pendingState = stateName;
      this._loadModel(stateName); // fire and forget
      return;
    }

    const prevData    = this._models.get(this._currentState);
    const fadeDuration = AVATAR_CONFIG.fadeDuration * 1000; // ms

    this._transitioning  = true;
    this._currentState   = stateName;

    const canvas = this._canvas;
    if (!canvas) {
      // No canvas — switch instantly.
      this._activateModel(nextData, prevData);
      this._transitioning = false;
      return;
    }

    // --- Phase 1: fade OUT ---
    canvas.style.transition = `opacity ${AVATAR_CONFIG.fadeDuration}s ease-out`;
    canvas.style.opacity    = '0';

    setTimeout(() => {
      // --- Phase 2: swap the model (canvas is invisible) ---
      this._activateModel(nextData, prevData);

      // --- Phase 3: fade IN ---
      canvas.style.transition = `opacity ${AVATAR_CONFIG.fadeDuration}s ease-in`;
      canvas.style.opacity    = '1';

      setTimeout(() => {
        this._transitioning = false;
        console.log(`[Avatar3D] → ${stateName}`);

        // Process any state change that came in while we were busy.
        if (this._pendingState && this._pendingState !== this._currentState) {
          const queued = this._pendingState;
          this._pendingState = null;
          this._switchTo(queued);
        }
      }, fadeDuration + 30);
    }, fadeDuration + 10);
  }
}

export const avatar3d = new Avatar3DController();
export default Avatar3DController;
