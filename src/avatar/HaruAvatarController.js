/**
 * HaruAvatarController
 *
 * Live2D Cubism 3 controller using PIXI + pixi-live2d-display.
 * Replaces Three.js/GLB Avatar3DController.
 *
 * State machine:
 *   - idle:     loop through Idle group (index 0..2), randomized, no repeats
 *   - thinking: loop through Thinking motions, returns to idle on demand
 *   - talking:  idle body + PARAM_MOUTH_OPEN_Y lip-sync (TTS amplitude or fallback)
 *
 * API:
 *   - init(container, canvas)
 *   - setState('idle' | 'thinking' | 'talking', options?)
 *   - playExpression(name)
 *   - dispose()
 */

import * as PIXI from 'pixi.js';
import { Live2DModel } from 'pixi-live2d-display';
import 'pixi-live2d-display/cubism4';

console.log('[HaruAvatar] Module loaded');

const MODEL_PATH = 'assets/live2d/haru/haru.model3.json';

let tickerRegistered = false;
function registerLive2DTickerOnce() {
  if (tickerRegistered) return;
  tickerRegistered = true;
  if (Live2DModel.registerTicker && PIXI.Ticker) {
    Live2DModel.registerTicker(PIXI.Ticker);
    console.log('[HaruAvatar] Live2D ticker registered');
  }
}

const MOUTH_PARAM = 'PARAM_MOUTH_OPEN_Y';
const MOUTH_FORM_PARAM = 'PARAM_MOUTH_FORM';

const EXPRESSIONS = [
  'Normal', 'Smile', 'Sad', 'Angry', 'Surprised', 'Blushing', 'f01', 'f02'
];

const THINKING_MOTIONS = [
  { group: 'Flick', index: 1 },  // haru_m_03 — primary thinking motion
];

const THINKING_GAP_MS = 5000;

class HaruAvatarController {
  constructor() {
    this._canvas = null;
    this._app = null;
    this._model = null;
    this._currentExpression = 'Normal';
    this._initialized = false;
    this._resizeHandler = null;

    this._state = 'idle';
    this._loopRunId = 0;
    this._loopTimeout = null;
    this._loopRafId = null;

    this._lastIdleIndex = -1;
    this._thinkingIndex = 0;

    this._mouthAnalyser = null;
    this._mouthAudioCtx = null;
    this._mouthAudioSource = null;
    this._mouthFreqData = null;
    this._mouthSpeaking = false;
    this._mouthRafId = null;
    this._mouthTargetValue = 0;
    this._mouthCurrentValue = 0;
  }

  async init(container, canvas) {
    console.log('[HaruAvatar] init called');
    if (this._initialized) return;

    this._canvas = canvas || document.getElementById('live2d-canvas');
    if (!this._canvas) {
      console.error('[HaruAvatar] Canvas not found');
      return;
    }

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

    registerLive2DTickerOnce();

    try {
      console.log('[HaruAvatar] Loading model:', MODEL_PATH);
      this._model = await Live2DModel.from(MODEL_PATH, {
        autoInteract: false,
        version: 4
      });
      console.log('[HaruAvatar] Model loaded');

      this._model.anchor.set(0.5, 0.5);
      this._model.position.set(this._app.screen.width / 2, this._app.screen.height / 2);
      this._fitModelToCanvas();
      this._app.stage.addChild(this._model);

      const boundsAfter = this._model.getBounds();
      console.log('[HaruAvatar] Final bounds:', `x=${boundsAfter.x.toFixed(1)}, y=${boundsAfter.y.toFixed(1)}, w=${boundsAfter.width.toFixed(1)}, h=${boundsAfter.height.toFixed(1)}`);

      this._resizeHandler = () => this._handleResize(container);
      window.addEventListener('resize', this._resizeHandler);

      this._initialized = true;
      console.log('[HaruAvatar] Model ready');

      this.setState('idle');
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
    this._fitModelToCanvas();
  }

  _fitModelToCanvas() {
    if (!this._model || !this._app) return;

    const w = this._app.screen.width;
    const h = this._app.screen.height;
    const bounds = this._model.getLocalBounds();
    const modelWidth = bounds.width;
    const modelHeight = bounds.height;
    const marginRatio = 0.85;
    const availableWidth = w * marginRatio;
    const availableHeight = h * marginRatio;
    const scale = Math.min(availableWidth / modelWidth, availableHeight / modelHeight);
    this._model.scale.set(scale);
  }

  // ------------------------------------------------------------------
  // State machine
  // ------------------------------------------------------------------

  setState(state, options = {}) {
    if (!this._initialized || !this._model) return;
    if (state !== 'idle' && state !== 'thinking' && state !== 'talking') {
      console.warn('[HaruAvatar] Unknown state:', state);
      return;
    }
    if (this._state === state && !options.force) return;

    this._state = state;
    this._cancelLoops();
    this._stopMouth();

    console.log('[HaruAvatar] State:', state);

    if (state === 'idle') {
      this._startIdleLoop();
    } else if (state === 'thinking') {
      this._startThinkingLoop();
    } else if (state === 'talking') {
      this._startTalkingLoop(options.audioElement || null);
    }
  }

  getState() {
    return this._state;
  }

  _cancelLoops() {
    this._loopRunId += 1;
    if (this._loopTimeout) {
      clearTimeout(this._loopTimeout);
      this._loopTimeout = null;
    }
    if (this._loopRafId) {
      cancelAnimationFrame(this._loopRafId);
      this._loopRafId = null;
    }
  }

  // ------------------------------------------------------------------
  // Idle loop
  // ------------------------------------------------------------------

  _startIdleLoop() {
    const runId = this._loopRunId;
    console.log('[HaruAvatar] Idle loop started');
    this._playNextIdle();
    this._scheduleIdleNext(runId);
  }

  _scheduleIdleNext(runId) {
    if (runId !== this._loopRunId) return;
    if (this._state !== 'idle') return;
    if (this._loopTimeout) clearTimeout(this._loopTimeout);
    this._loopTimeout = setTimeout(() => {
      this._loopTimeout = null;
      if (this._state !== 'idle') return;
      this._playNextIdle();
      this._scheduleIdleNext(runId);
    }, 4500);
  }

  _playNextIdle() {
    const total = 3;
    if (total <= 0) return;
    let next = Math.floor(Math.random() * total);
    if (total > 1 && next === this._lastIdleIndex) {
      next = (next + 1) % total;
    }
    this._lastIdleIndex = next;
    this._playMotionByIndex('Idle', next, false);
  }

  // ------------------------------------------------------------------
  // Thinking loop
  // ------------------------------------------------------------------

  _startThinkingLoop() {
    const runId = this._loopRunId;
    this._thinkingIndex = 0;
    console.log('[HaruAvatar] Thinking loop started');
    this._playNextThinking(runId);
  }

  _scheduleThinkingNext(runId) {
    if (runId !== this._loopRunId) return;
    if (this._state !== 'thinking') return;
    if (this._loopTimeout) clearTimeout(this._loopTimeout);
    this._loopTimeout = setTimeout(() => {
      this._loopTimeout = null;
      if (this._state !== 'thinking') return;
      this._playNextThinking(runId);
    }, THINKING_GAP_MS);
  }

  _playNextThinking(runId) {
    const list = THINKING_MOTIONS;
    const motion = list[this._thinkingIndex % list.length];
    this._thinkingIndex += 1;
    this._playMotionByIndex(motion.group, motion.index, false);
    this._scheduleThinkingNext(runId);
  }

  // ------------------------------------------------------------------
  // Talking loop (idle body + mouth)
  // ------------------------------------------------------------------

  _startTalkingLoop(audioElement) {
    const runId = this._loopRunId;
    console.log('[HaruAvatar] Talking started');
    this._startMouth(audioElement);
    this._playNextIdle();
    this._scheduleIdleNext(runId);
  }

  // ------------------------------------------------------------------
  // Motion API: model.motion(group, index)
  // ------------------------------------------------------------------

  _playMotionByIndex(group, index, loop) {
    if (!this._model) return;
    if (!this._model.internalModel || !this._model.internalModel.motionManager) {
      console.warn('[HaruAvatar] motionManager not ready');
      return;
    }
    try {
      const motion = this._model.motion(group, index);
      if (motion) {
        if ('loop' in motion) motion.loop = !!loop;
        this._model.internalModel.motionManager.startMotion(group, index);
        console.log(`[HaruAvatar] Playing motion group=${group} index=${index} loop=${!!loop}`);
      } else {
        console.warn(`[HaruAvatar] motion not found: group=${group} index=${index}`);
      }
    } catch (err) {
      console.warn(`[HaruAvatar] motion failed: group=${group} index=${index}`, err);
    }
  }

  // ------------------------------------------------------------------
  // Expression API
  // ------------------------------------------------------------------

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

  // ------------------------------------------------------------------
  // Mouth / lipsync
  // ------------------------------------------------------------------

  _startMouth(audioElement) {
    this._stopMouth();
    this._mouthSpeaking = true;

    if (audioElement) {
      this._setupAudioAnalyser(audioElement);
    }

    const tick = () => {
      if (!this._mouthSpeaking) return;
      if (!this._model || !this._model.internalModel) return;

      let amplitude = 0;
      if (this._mouthAnalyser && this._mouthFreqData) {
        this._mouthAnalyser.getByteFrequencyData(this._mouthFreqData);
        let sum = 0;
        for (let i = 2; i < 20; i++) sum += this._mouthFreqData[i];
        amplitude = sum / 18 / 128;
        amplitude = Math.min(amplitude, 1.0);
        if (amplitude < 0.02) amplitude = 0;
      } else {
        const t = performance.now() / 1000;
        amplitude = (Math.sin(t * 8) * 0.5 + 0.5) * 0.6;
        const wobble = Math.sin(t * 14) * 0.2;
        amplitude = Math.max(0, Math.min(1, amplitude + wobble));
      }

      this._mouthTargetValue = amplitude;
      const core = this._model.internalModel.coreModel;
      try {
        if (core && core.setParameterValueById) {
          core.setParameterValueById(MOUTH_PARAM, amplitude);
          if (amplitude > 0.3) {
            core.setParameterValueById(MOUTH_FORM_PARAM, amplitude * 0.5);
          }
        }
      } catch (e) { /* ignore */ }

      this._mouthRafId = requestAnimationFrame(tick);
    };
    this._mouthRafId = requestAnimationFrame(tick);
    console.log('[HaruAvatar] Mouth animation started');
  }

  _setupAudioAnalyser(audioElement) {
    try {
      this._mouthAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
      this._mouthAnalyser = this._mouthAudioCtx.createAnalyser();
      this._mouthAnalyser.fftSize = 256;
      this._mouthAnalyser.smoothingTimeConstant = 0.3;
      this._mouthAudioSource = this._mouthAudioCtx.createMediaElementSource(audioElement);
      this._mouthAudioSource.connect(this._mouthAnalyser);
      this._mouthAnalyser.connect(this._mouthAudioCtx.destination);
      this._mouthFreqData = new Uint8Array(this._mouthAnalyser.frequencyBinCount);
    } catch (err) {
      console.warn('[HaruAvatar] audio analyser setup failed:', err);
      this._mouthAnalyser = null;
    }
  }

  _stopMouth() {
    this._mouthSpeaking = false;
    if (this._mouthRafId) {
      cancelAnimationFrame(this._mouthRafId);
      this._mouthRafId = null;
    }
    if (this._mouthAudioSource) {
      try { this._mouthAudioSource.disconnect(); } catch (e) {}
      this._mouthAudioSource = null;
    }
    if (this._mouthAnalyser) {
      try { this._mouthAnalyser.disconnect(); } catch (e) {}
      this._mouthAnalyser = null;
    }
    if (this._mouthAudioCtx) {
      this._mouthAudioCtx.close().catch(() => {});
      this._mouthAudioCtx = null;
    }
    this._mouthFreqData = null;

    if (this._model && this._model.internalModel && this._model.internalModel.coreModel) {
      try {
        this._model.internalModel.coreModel.setParameterValueById(MOUTH_PARAM, 0);
        this._model.internalModel.coreModel.setParameterValueById(MOUTH_FORM_PARAM, 0);
      } catch (e) {}
    }
  }

  // ------------------------------------------------------------------
  // Dispose
  // ------------------------------------------------------------------

  dispose() {
    this._cancelLoops();
    this._stopMouth();
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
