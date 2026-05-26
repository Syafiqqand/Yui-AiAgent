/**
 * musicController.js
 * Automates YouTube Music using Playwright.
 *
 * Responsibilities:
 * - Launch a controlled Chromium/Chrome instance with a persistent profile.
 * - Persistent profiles are saved in app userData to maintain user logins.
 * - Click the first matching result on search commands to automate play.
 * - Bypasses local DRM and local Electron constraints cleanly.
 */

const { app } = require("electron");
const { chromium } = require("playwright");
const path = require("path");

const SESSION_PROFILE_NAME = "ytmusic-profile";

/** @type {import('playwright').BrowserContext | null} */
let browserContext = null;

/** @type {import('playwright').Page | null} */
let mainPage = null;

/**
 * Get the path for the persistent Playwright browser profile.
 */
function getProfileDirectory() {
  return path.join(app.getPath("userData"), SESSION_PROFILE_NAME);
}

/**
 * Safely ensure that a browser context and page are open and ready.
 * Handles fallback from system Chrome to bundled Chromium.
 */
async function ensureBrowserOpen() {
  // If context and page exist and are active, just reuse them
  if (browserContext && mainPage && !mainPage.isClosed()) {
    try {
      // Bring window to front if possible
      await mainPage.bringToFront().catch(() => {});
      return { context: browserContext, page: mainPage };
    } catch (_err) {
      // Something went wrong, recreate context
      await cleanupBrowser();
    }
  }

  const profileDir = getProfileDirectory();
  console.log(`[YouTube Music Automation] Launching context at: ${profileDir}`);

  // Try launching system Chrome first, fallback to bundled Chromium
  try {
    browserContext = await chromium.launchPersistentContext(profileDir, {
      headless: false,
      channel: "chrome",
      viewport: null,
      args: ["--start-maximized", "--app=https://music.youtube.com"], // Opens in standard app-like frame
    });
  } catch (error) {
    console.warn("[YouTube Music Automation] Failed to launch with Chrome channel, falling back to bundled Chromium:", error);
    try {
      browserContext = await chromium.launchPersistentContext(profileDir, {
        headless: false,
        viewport: null,
        args: ["--start-maximized"],
      });
    } catch (fallbackError) {
      console.error("[YouTube Music Automation] Critical browser launch failure:", fallbackError);
      throw fallbackError;
    }
  }

  // Handle sudden context closure
  browserContext.on("close", () => {
    browserContext = null;
    mainPage = null;
    console.log("[YouTube Music Automation] Browser context closed.");
  });

  // Get or open the main page
  const pages = browserContext.pages();
  if (pages.length > 0) {
    mainPage = pages[0];
  } else {
    mainPage = await browserContext.newPage();
  }

  return { context: browserContext, page: mainPage };
}

/**
 * Open YouTube Music homepage.
 */
async function openYouTubeMusic() {
  try {
    const { page } = await ensureBrowserOpen();
    const currentUrl = page.url();

    // Navigate to homepage if not already there
    if (!currentUrl.includes("music.youtube.com")) {
      await page.goto("https://music.youtube.com");
    } else {
      await page.bringToFront();
    }
  } catch (error) {
    console.error("[YouTube Music Automation] Failed to open YouTube Music homepage:", error);
  }
}

/**
 * Search and automatically attempt to play the first result.
 * Returns true if play command was successful, false if it fell back to manual.
 */
async function playYouTubeMusic(query) {
  const safeQuery = String(query || "").trim();
  if (!safeQuery) {
    await openYouTubeMusic();
    return true;
  }

  try {
    const { page } = await ensureBrowserOpen();
    const searchUrl = `https://music.youtube.com/search?q=${encodeURIComponent(safeQuery)}`;

    console.log(`[YouTube Music Automation] Navigating search for: "${safeQuery}"`);
    await page.goto(searchUrl);

    // Wait for search result items to load
    const listItemSelector = "ytmusic-responsive-list-item-renderer";
    console.log("[YouTube Music Automation] Waiting for search results to render...");
    
    try {
      await page.waitForSelector(listItemSelector, { timeout: 8000 });
    } catch (timeoutErr) {
      console.warn("[YouTube Music Automation] Search results timeout. User may need to click manually.", timeoutErr);
      return false; // Fallback to manual click warning
    }

    // Get the first matching song/result
    const firstResult = page.locator(listItemSelector).first();
    if (!firstResult) {
      console.warn("[YouTube Music Automation] No results found on page.");
      return false;
    }

    // Click play buttons or the first item
    try {
      // 1. Let's see if there is an overlay play button inside the first result
      const playButton = firstResult.locator(".play-button, ytmusic-play-button-renderer").first();
      if (await playButton.isVisible()) {
        console.log("[YouTube Music Automation] Found overlay play button, attempting click...");
        await playButton.click({ timeout: 3000 });
        return true;
      }
    } catch (playBtnErr) {
      console.log("[YouTube Music Automation] Play button click failed, trying alternate strategies...", playBtnErr);
    }

    // 2. Click the text link/title of the song directly
    try {
      const titleLink = firstResult.locator("a[href*='watch?v=']").first();
      if (await titleLink.isVisible()) {
        console.log("[YouTube Music Automation] Found title link, attempting click...");
        await titleLink.click({ timeout: 3000 });
        return true;
      }
    } catch (titleLinkErr) {
      console.log("[YouTube Music Automation] Title link click failed, trying row click...", titleLinkErr);
    }

    // 3. Fallback: double click the row element itself
    console.log("[YouTube Music Automation] Attempting row double-click...");
    await firstResult.click({ clickCount: 2, timeout: 3000 });
    return true;

  } catch (error) {
    console.error("[YouTube Music Automation] Auto-play click error:", error);
    return false;
  }
}

/**
 * Safely close and cleanup browser context.
 */
async function cleanupBrowser() {
  try {
    if (browserContext) {
      await browserContext.close();
    }
  } catch (_e) {
    // Ignore cleanup errors
  } finally {
    browserContext = null;
    mainPage = null;
  }
}

module.exports = {
  openExternal: openYouTubeMusic, // Map legacy name to maintain window handler logic cleanly
  searchExternal: playYouTubeMusic, // Map play/search externally
  openYouTubeMusic,
  playYouTubeMusic,
  cleanupBrowser,
};
