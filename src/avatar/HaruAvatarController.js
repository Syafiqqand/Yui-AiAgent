/**
 * HaruAvatarController
 *
 * Live2D Cubism 3 controller using PIXI + pixi-live2d-display.
 * Replaces Three.js/GLB Avatar3DController.
 *
 * API matches old Avatar3DController for renderer.js compatibility:
 *   - init(container, canvas)
 *   - playIdle()
 *   - playThinking()
 *   - playTalking()
 *   - playExpression(name)
 *   - dispose()
 */

import * as PIXI from 'pixi.js';
import { Live2DModel } from 'pixi-live2d-display';

// Import Cubism 4 runtime — required by pixi-live2d-display
import 'pixi-live2d-display/cubism4';

console.log('[HaruAvatar] Module loaded');

const MODEL_PATH = 'assets/live2d/haru/haru.model3.json';

const MOTIONS = {
  idle: ['haru_idle_01', 'haru_idle_02', 'haru_idle_03'],
  thinking: ['haru_m_01', 'haru_m_02'],
  talking: ['haru_m_03'],
  pose1: 'haru_m_04',
  pose2: 'haru_m_05',
  pose3: 'haru_m_06',
};

const EXPRESSIONS = [
  'Normal', 'Smile', 'Sad', 'Angry', 'Surprised', 'Blushing', 'f01', 'f02'
];

class HaruAvatarController {
  constructor() {
    /** @type {HTMLCanvasElement|null} */
    this._canvas = null;
    /** @type {PIXI.Application|null} */
    this._app = null;
    /** @type {Live2DModel|null} */
    this._model = null;
    /** @type {string} */
    this._currentMotion = '';
    /** @type {number|null} */
    this._motionTimer = null;
    /** @type {AudioElement|null} */
    this._audioElement = null;
    /** @type {AudioContext|null} */
    this._audioCtx = null;
    /** @type {AnalyserNode|null} */
    this._analyser = null;
    /** @type {Uint8Array|null} */
    this._frequencyData = null;
    /** @type {boolean} */
    this._isSpeaking = false;
    /** @type {number|null} */
    this._visemeFrameId = null;
    /** @type {string} */
    this._currentExpression = 'Normal';
    /** @type {boolean} */
    this._initialized = false;
    /** @type {number} */
    this._thinkingMotionIndex = 0;
  }

  async init(container, canvas) {
    console.log('[HaruAvatar] init called');
    if (this._initialized) return;

    this._canvas = canvas || document.getElementById('live2d-canvas');
    if (!this._canvas) {
      console.error('[HaruAvatar] Canvas not found');
      return;
    }

    // Wait for next frame so CSS layout is computed and container has non-zero dimensions
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));

    const w = container.clientWidth || 800;
    const h = container.clientHeight || 600;
    console.log('[HaruAvatar] Container size:', w, 'x', h);

    this._app = new PIXI.Application({
      view: this._canvas,
      width: w,
      height: h,
      backgroundAlpha: 0,
      resolution: window.devicePixelRatio || 1,
      autoDensity: true,
      powerPreference: 'high-performance',
    });

    this._app.renderer.backgroundColor = 0x000000;
    this._app.renderer.backgroundAlpha = 0;

    try {
      console.log('[HaruAvatar] Loading model:', MODEL_PATH);
      this._model = await Live2DModel.from(MODEL_PATH, { autoInteract: false });
      console.log('[HaruAvatar] Model loaded:', this._model);
      this._model.anchor.set(0.5, 0.5);
      this._model.position.set(this._app.screen.width / 2, this._app.screen.height / 2);
      this._model.scale.set(0.35);
      this._app.stage.addChild(this._model);
      console.log('[HaruAvatar] Model added to stage, stage children:', this._app.stage.children.length);

      this._model.on('hit', (hitAreas) => {
        console.log('[HaruAvatar] Hit areas:', hitAreas);
      });

      this._resizeHandler = () => this._handleResize(container);
      window.addEventListener('resize', this._resizeHandler);
      this._handleResize(container);

      this._initialized = true;
      console.log('[HaruAvatar] Model ready');

      this.playIdle();
      document.dispatchEvent(new CustomEvent('avatar3d:ready'));
    } catch (err) {
      console.error('[HaruAvatar] Init failed:', err);
    }
  }

  _handleResize(container) {
    if (!this._app || !this._model) return;
    const w = container.clientWidth;
    const h = container.clientHeight;
    this._app.renderer.resize(w, h);
    this._model.position.set(w / 2, h / 2);
  }

  playIdle() {
    if (!this._model) return;
    this._stopMotionTimer();
    const motions = MOTIONS.idle;
    const pick = motions[Math.floor(Math.random() * motions.length)];
    this._playMotion(pick, true);
    this._currentMotion = 'idle';
  }

  playThinking() {
    if (!this._model) return;
    this._stopMotionTimer();
    const motions = MOTIONS.thinking;
    const pick = motions[this._thinkingMotionIndex % motions.length];
    this._thinkingMotionIndex++;
    this._playMotion(pick, true);
    this._currentMotion = 'thinking';
  }

  playTalking(audioElement = null) {
    if (!this._model) return;
    this._stopMotionTimer();
    this._playMotion(MOTIONS.talking[0], true);
    this._currentMotion = 'talking';

    if (audioElement) {
      this._startViseme(audioElement);
    }
  }

  stopTalking() {
    this._stopViseme();
    this.playIdle();
  }

  playExpression(name) {
    if (!this._model || !EXPRESSIONS.includes(name)) {
      console.warn('[HaruAvatar] Unknown expression:', name);
      return;
    }
    try {
      this._model.expression(name);
      this._currentExpression = name;
      console.log('[HaruAvatar] Expression:', name);
    } catch (err) {
      console.warn('[HaruAvatar] Expression failed:', name, err);
    }
  }

  resetExpression() {
    if (this._currentExpression !== 'Normal') {
      this.playExpression('Normal');
    }
  }

  _playMotion(motionName, loop = false) {
    if (!this._model) return;
    try {
      const motion = this._model.motion(motionName);
      if (motion) {
        motion.loop = loop;
        this._model.internalModel.motionManager.startMotion(motionName);
        console.log('[HaruAvatar] Motion:', motionName, 'loop:', loop);
      }
    } catch (err) {
      console.warn('[HaruAvatar] Motion failed:', motionName, err);
    }
  }

  _stopMotionTimer() {
    if (this._motionTimer) {
      clearTimeout(this._motionTimer);
      this._motionTimer = null;
    }
  }

  _startViseme(audioElement) {
    this._stopViseme();

    this._audioElement = audioElement;
    try {
      this._audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      this._analyser = this._audioCtx.createAnalyser();
      this._analyser.fftSize = 256;
      this._analyser.smoothingTimeConstant = 0.3;

      const source = this._audioCtx.createMediaElementSource(this._audioElement);
      source.connect(this._analyser);
      this._analyser.connect(this._audioCtx.destination);

      this._frequencyData = new Uint8Array(this._analyser.frequencyBinCount);
      this._isSpeaking = true;

      const mouthParam = 'ParamMouthOpenY';
      const formParam = 'ParamMouthForm';

      const updateViseme = () => {
        if (!this._isSpeaking || !this._analyser || !this._model) return;

        this._analyser.getByteFrequencyData(this._frequencyData);
        let sum = 0;
        for (let i = 2; i < 20; i++) {
          sum += this._frequencyData[i];
        }
        const avg = sum / 18;
        const mouthValue = Math.min(avg / 128, 1.0);

        try {
          this._model.internalModel.coreModel.setParameterValueById(mouthParam, mouthValue);
          if (mouthValue > 0.3) {
            this._model.internalModel.coreModel.setParameterValueById(formParam, mouthValue * 0.5);
          }
        } catch (e) { }

        this._visemeFrameId = requestAnimationFrame(updateViseme);
      };

      updateViseme();
      console.log('[HaruAvatar] Viseme started');
    } catch (err) {
      console.warn('[HaruAvatar] Viseme init failed:', err);
    }
  }

  _stopViseme() {
    this._isSpeaking = false;
    if (this._visemeFrameId) {
      cancelAnimationFrame(this._visemeFrameId);
      this._visemeFrameId = null;
    }
    if (this._analyser) {
      this._analyser.disconnect();
      this._analyser = null;
    }
    if (this._audioCtx) {
      this._audioCtx.close().catch(() => {});
      this._audioCtx = null;
    }
    this._audioElement = null;
    this._frequencyData = null;
    console.log('[HaruAvatar] Viseme stopped');
  }

  dispose() {
    this._stopViseme();
    this._stopMotionTimer();

    if (this._resizeHandler) {
      window.removeEventListener('resize', this._resizeHandler);
      this._resizeHandler = null;
    }

    if (this._model) {
      this._model.destroy();
      this._model = null;
    }

    if (this._app) {
      this._app.destroy(true, { children: true, texture: true, baseTexture: true });
      this._app = null;
    }

    this._canvas = null;
    this._initialized = false;
    console.log('[HaruAvatar] Disposed');
  }
}

export const haruAvatar = new HaruAvatarController();
export default HaruAvatarController;