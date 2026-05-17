export { default as UI_CONFIG } from './runtime-config.js';
export { default as LIVE_MEDIA_CONFIG, initLiveMediaConfig } from './live-media-config.js';

export const API_BASE = '/api';
export const WS_URL = `${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/ws`;

export const TIMESTAMP_RECENT_THRESHOLD_MS = 60 * 1000;
export const TIMESTAMP_TODAY_THRESHOLD_MS = 24 * 60 * 60 * 1000;
export const HOUR_MS = 3600000;

export const USER_STORAGE_KEY = 'microcord_user';
export const TOKEN_STORAGE_KEY = 'microcord_token';
export const REFRESH_TOKEN_STORAGE_KEY = 'microcord_refresh_token';

export const AUDIO_INPUT_KEY = 'mc-audio-input';
export const AUDIO_OUTPUT_KEY = 'mc-audio-output';
export const VAD_SENSITIVITY_KEY = 'mc-vad-sensitivity';

export const APP_VERSION = '0.9.1';

export const CHAT_PAGE_SIZE = 30;

export const SOUND_ENTER_VOICE = '/sounds/EnterVoice.wav';
export const SOUND_EXIT_VOICE = '/sounds/ExitVoice.wav';

export const TICK_SOUNDS = [
  { id: 1, label: 'Tap', url: '/sounds/tick1.mp3' },
  { id: 2, label: 'Alert', url: '/sounds/tick2.mp3' },
  { id: 3, label: 'New', url: '/sounds/tick3.mp3' },
  { id: 4, label: 'Classic', url: '/sounds/tick4.wav' },
];

export const VOICE_STATE = Object.freeze({
  IDLE: 'idle',
  JOINING: 'joining',
  JOINED: 'joined',
  LEAVING: 'leaving',
});

export const WS_RECONNECT_DELAY_MS = 2000;

export const MIN_SIDEBAR_WIDTH = 180;
export const MAX_SIDEBAR_WIDTH = 480;
export const DEFAULT_SIDEBAR_WIDTH = 240;

export const MOBILE_BREAKPOINT = 768;

export const SCROLL_TOP_THRESHOLD = 40;
export const SCROLL_BOTTOM_TOLERANCE = 30;
export const EMPTY_CONTENT_HEIGHT = 8;

export const GROUP_THRESHOLD_MS = 60_000;

export const DEFAULT_VIDEO_RATIO = 0.5;
export const MIN_VIDEO_RATIO = 0.15;
export const MAX_VIDEO_RATIO = 0.85;

export const MAX_CHANNEL_NAME_LENGTH = 40;
export const MAX_MESSAGE_LENGTH = 4000;
export const MAX_IMAGE_BYTES = 50 * 1024 * 1024;
export const MAX_AVATAR_BYTES = 1 * 1024 * 1024;
export const AVATAR_ACCEPT = 'image/jpeg,image/png,image/avif';

export const VAD_RISING_DEBOUNCE_MS = 22;
export const VAD_FALLING_DEBOUNCE_MS = 180;

export const MAX_DISPLAY_NAME_LENGTH = 40;
export const MIN_PASSWORD_LENGTH = 6;
export const MAX_PASSPHRASE_LENGTH = 32;

export const NOTIFICATION_VOLUME = 0.7;
export const VOICE_EXIT_VOLUME = 0.55;
