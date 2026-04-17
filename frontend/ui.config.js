export const UI_CONFIG = {
  appName: '🔊 Microcord',
  voiceChannelName: 'Voice channel',

  screenshare: {
    width: 1920,
    height: 1080,
    frameRate: 60,
  },

  mediaTranscode: {
    enabled: true,
    maxImageInputBytes: 14 * 1024 * 1024,
    maxVideoInputBytes: 70 * 1024 * 1024,
    maxOutputBytes: 50 * 1024 * 1024,
    avifQuality: 60,
    h264Bitrate: 2_000_000,
  },
};
