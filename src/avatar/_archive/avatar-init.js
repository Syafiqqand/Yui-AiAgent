/**
 * avatar-init.js
 *
 * ES module entry point for the 3D avatar system.
 * Runs as <script type="module"> in index.html.
 *
 * Responsibilities:
 * - Import Avatar3DController
 * - Find the avatar stage container and canvas
 * - Call avatar3d.init()
 * - Expose window.avatar3d so renderer.js (CommonJS-style) can call
 *   playIdle(), playThinking(), playTalking() without knowing Three.js
 */

import { avatar3d } from './Avatar3DController.js';

// Make the controller available globally so renderer.js can reach it.
window.avatar3d = avatar3d;

// Wait for the DOM to be ready before initializing.
function initAvatar() {
  const container = document.querySelector('.stage');
  const canvas = document.getElementById('avatar-canvas');

  if (!container) {
    console.error('[Avatar3D] Could not find .stage container.');
    return;
  }

  avatar3d.init(container, canvas).catch((err) => {
    console.error('[Avatar3D] Initialization error:', err);
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initAvatar);
} else {
  initAvatar();
}
