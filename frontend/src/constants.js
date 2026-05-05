export { default as UI_CONFIG } from './runtime-config.js';
export { default as LIVE_MEDIA_CONFIG, initLiveMediaConfig } from './live-media-config.js';

export const API_BASE = '/api';
export const WS_URL = `${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/ws`;

export const TIMESTAMP_RECENT_THRESHOLD_MS = 60 * 1000;
export const TIMESTAMP_TODAY_THRESHOLD_MS = 24 * 60 * 60 * 1000;

export const USER_STORAGE_KEY = 'microcord_user';
export const TOKEN_STORAGE_KEY = 'microcord_token';
export const REFRESH_TOKEN_STORAGE_KEY = 'microcord_refresh_token';

export const AUDIO_INPUT_KEY = 'mc-audio-input';
export const AUDIO_OUTPUT_KEY = 'mc-audio-output';
export const VAD_SENSITIVITY_KEY = 'mc-vad-sensitivity';

export const APP_VERSION = '0.8.6';

export const CHAT_PAGE_SIZE = 30;

export const SOUND_ENTER_VOICE = '/sounds/EnterVoice.wav';
export const SOUND_EXIT_VOICE = '/sounds/ExitVoice.wav';

export const TICK_SOUNDS = [
  { id: 1, label: 'Tap', url: '/sounds/tick1.mp3' },
  { id: 2, label: 'Alert', url: '/sounds/tick2.mp3' },
  { id: 3, label: 'New', url: '/sounds/tick3.mp3' },
  { id: 4, label: 'Classic', url: '/sounds/tick4.wav' },
];
