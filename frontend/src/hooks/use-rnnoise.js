/**
 * RNNoise denoising — routes the mic stream through
 * AudioContext → AudioWorkletNode(rnnoise) → MediaStreamDestination.
 *
 * The returned stream replaces the raw mic stream in `streamRef`; the
 * original mic tracks are owned by this wrapper and stopped on dispose.
 */
export async function createRnnoiseStream(micStream) {
    const audioContext = new AudioContext({ sampleRate: 48000 });
    try {
        await audioContext.audioWorklet.addModule('/worklets/rnnoise-processor.js');
    } catch (err) {
        await audioContext.close();
        throw err;
    }
    const source = audioContext.createMediaStreamSource(micStream);
    const worklet = new AudioWorkletNode(audioContext, 'rnnoise-processor');
    const destination = audioContext.createMediaStreamDestination();
    source.connect(worklet).connect(destination);
    return {
        stream: destination.stream,
        dispose() {
            source.disconnect();
            worklet.disconnect();
            destination.disconnect();
            micStream.getTracks().forEach((track) => track.stop());
            audioContext.close();
        },
    };
}
