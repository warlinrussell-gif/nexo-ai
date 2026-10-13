// Stub mínimo de Electron para probar el backend con Node puro.
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
const base = process.env.NEXO_TEST_DIR || path.join(os.tmpdir(), 'nexo-test');
export const app = {
  getPath: (n) => path.join(base, n), isPackaged: false, getAppPath: () => process.cwd(), getVersion: () => '1.0.0',
  setName() { }, on() { }, whenReady: () => Promise.resolve(), relaunch() { }, exit() { }
};
export const safeStorage = { isEncryptionAvailable: () => false, encryptString: (s) => Buffer.from(s), decryptString: (b) => b.toString() };
export class BrowserWindow extends EventEmitter { constructor() { super(); this.webContents = { setUserAgent() { }, setAudioMuted() { }, executeJavaScript: async () => ({ text: '' }) }; } loadURL() { return Promise.resolve(); } destroy() { } }
export class WebContentsView { constructor() { throw new Error('WebContentsView no disponible en pruebas'); } }
export const shell = { openPath: async () => '', openExternal: async () => { }, trashItem: async () => { }, showItemInFolder() { } };
export const clipboard = { readText: () => 'texto de prueba', writeText() { }, readImage: () => ({ isEmpty: () => true }) };
export class Notification { constructor() { } show() { } }
export const screen = { getPrimaryDisplay: () => ({ id: 1, size: { width: 1920, height: 1080 }, scaleFactor: 1, bounds: { x: 0, y: 0 } }), getAllDisplays: () => [screen.getPrimaryDisplay()] };
export const desktopCapturer = { getSources: async () => [] };
export const nativeTheme = {};
export default { app, safeStorage, BrowserWindow, WebContentsView, shell, clipboard, Notification, screen, desktopCapturer, nativeTheme };
