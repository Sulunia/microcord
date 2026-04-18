import { UI_CONFIG } from '../ui.config.js';

export const APP_NAME = UI_CONFIG.appName;
export const VOICE_CHANNEL_NAME = UI_CONFIG.voiceChannelName;
export const TITLE_TAG = UI_CONFIG.titleTag ?? UI_CONFIG.appName;

export const API_BASE = '/api';
export const WS_URL = `${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/ws`;

export const TIMESTAMP_RECENT_THRESHOLD_MS = 60 * 1000;
export const TIMESTAMP_TODAY_THRESHOLD_MS = 24 * 60 * 60 * 1000;

export const USER_STORAGE_KEY = 'microcord_user';
export const TOKEN_STORAGE_KEY = 'microcord_token';

export const APP_VERSION = '0.3.0';
export const APP_TAGLINE = 'Microcord \u2014 a mini self-hostable chat app';

export const CHAT_PAGE_SIZE = 30;

export const TICK_SOUNDS = [
  { id: 1, label: 'Tap', url: '/sounds/tick1.mp3' },
  { id: 2, label: 'Alert', url: '/sounds/tick2.mp3' },
  { id: 3, label: 'New', url: '/sounds/tick3.mp3' },
  { id: 4, label: 'Classic', url: '/sounds/tick4.wav' },
];

export const SCREENSHARE_CONSTRAINTS = {
  video: {
    width: { ideal: UI_CONFIG.screenshare?.width ?? 1920 },
    height: { ideal: UI_CONFIG.screenshare?.height ?? 1080 },
    frameRate: { ideal: UI_CONFIG.screenshare?.frameRate ?? 30 },
  },
  audio: true,
};
