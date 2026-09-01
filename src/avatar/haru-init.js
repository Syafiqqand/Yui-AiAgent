/**
 * haru-init.js
 *
 * ES module entry point for the Live2D avatar system.
 * Runs as <script type="module"> in index.html.
 *
 * Responsibilities:
 * - Import HaruAvatarController
 * - Find the avatar stage container and canvas
 * - Call haruAvatar.init()
 * - Expose window.haruAvatar so renderer.js (CommonJS-style) can call
 *   playIdle(), playThinking(), playTalking() without knowing PIXI/Live2D
 */

import { haruAvatar } from './HaruAvatarController.js';

// Make the controller available globally so renderer.js can reach it.
window.haruAvatar = haruAvatar;

// Wait for the DOM to be ready before initializing.
function initHaruAvatar() {
  console.log('[HaruAvatar] initHaruAvatar called');
  const container = document.querySelector('.stage');
  const canvas = document.getElementById('live2d-canvas');

  if (!container) {
    console.error('[HaruAvatar] Could not find .stage container.');
    return;
  }
  if (!canvas) {
    console.error('[HaruAvatar] Could not find #live2d-canvas.');
    return;
  }

  haruAvatar.init(container, canvas).catch((err) => {
    console.error('[HaruAvatar] Initialization error:', err);
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initHaruAvatar);
} else {
  initHaruAvatar();
}