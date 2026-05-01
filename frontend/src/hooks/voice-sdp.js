/**
 * Munge an SDP description to apply Opus codec parameters.
 *
 * Injects or replaces `maxaveragebitrate` and `stereo` in the Opus
 * fmtp line so the encoder uses the configured values.
 *
 * @param {string} sdp — raw SDP string
 * @param {number} bitrate — Opus bitrate in bps (e.g. 32000)
 * @param {boolean} stereo — whether to enable stereo Opus
 * @returns {string} modified SDP
 */
export function mungeOpusSdp(sdp, bitrate, stereo) {
    const match = sdp.match(/a=rtpmap:(\d+) opus\/48000/);
    if (!match) return sdp;
    const payloadType = match[1];
    const fmtpPattern = new RegExp(`a=fmtp:${payloadType} [^\\r\\n]*`);
    const existingFmtp = sdp.match(fmtpPattern);

    if (existingFmtp) {
        let line = existingFmtp[0];
        if (/maxaveragebitrate=/.test(line)) {
            line = line.replace(/maxaveragebitrate=\d+/, `maxaveragebitrate=${bitrate}`);
        } else {
            line += `;maxaveragebitrate=${bitrate}`;
        }
        if (/stereo=/.test(line)) {
            line = line.replace(/stereo=\d/, `stereo=${stereo ? 1 : 0}`);
        } else {
            line += `;stereo=${stereo ? 1 : 0}`;
        }
        return sdp.replace(fmtpPattern, line);
    }

    const rtpmapPattern = new RegExp(`(a=rtpmap:${payloadType} opus/48000[^\\r\\n]*)`);
    return sdp.replace(
        rtpmapPattern,
        `$1\r\na=fmtp:${payloadType} maxaveragebitrate=${bitrate};stereo=${stereo ? 1 : 0}`,
    );
}
