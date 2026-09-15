import createRNNWasmModuleSync from './rnnoise-sync.js'; // vendored same-origin copy — DEFAULT export, no bundler resolution in public/

const FRAME_SAMPLES = 480; // rnnoise @ 48kHz (measured: one process_frame call writes exactly 480 samples)
const START_THRESHOLD = FRAME_SAMPLES + 128; // one processed frame + one quantum buffered before emission starts
const SENTINEL = 12345.0;

// Pure pipeline logic, exported for the node rehearsal (non-worklet contexts only).
export function makeDenoisePipeline(processFrame) {
    const pending = new Float32Array(FRAME_SAMPLES);
    let pendingLength = 0;
    const fifo = new Float32Array(FRAME_SAMPLES * 3); // three frames: pre-push depth can reach 512, and 512 + 480 > 960
    let fifoDepth = 0;
    let started = false;
    let overflowed = false;
    return {
        process(input, output) {
            let taken = 0;
            while (taken < input.length) {
                const chunk = Math.min(FRAME_SAMPLES - pendingLength, input.length - taken);
                pending.set(input.subarray(taken, taken + chunk), pendingLength);
                pendingLength += chunk;
                taken += chunk;
                if (pendingLength === FRAME_SAMPLES) {
                    if (fifoDepth + FRAME_SAMPLES > fifo.length) overflowed = true;
                    processFrame(pending, fifo, fifoDepth);
                    fifoDepth += FRAME_SAMPLES;
                    pendingLength = 0;
                }
            }
            if (!started && fifoDepth >= START_THRESHOLD) started = true;

            const available = started ? Math.min(output.length, fifoDepth) : 0;
            output.set(fifo.subarray(0, available));
            if (available < output.length) output.fill(0, available); // warmup silence: first ~7 quanta only
            fifo.copyWithin(0, available, fifoDepth);
            fifoDepth -= available;
        },
        get warmupDone() { return started; },
        get overflowed() { return overflowed; },
    };
}

const IS_WORKLET = typeof registerProcessor === 'function';
const Base = IS_WORKLET ? AudioWorkletProcessor : class {};

class RnnoiseProcessor extends Base {
    constructor() {
        super();
        this.wasm = null;
        this.state = 0;
        this.inPtr = 0;
        this.outPtr = 0;
        this.pipeline = null;
        this.bypass = false;
        this.ready = false;
        this.init().catch((err) => {
            console.error('rnnoise init failed, bypassing:', err);
            this.bypass = true;
        });
    }

    async init() {
        this.wasm = await createRNNWasmModuleSync();
        if (sampleRate !== 48000) {
            console.warn(`rnnoise: sample rate ${sampleRate} != 48000, bypassing`);
            this.bypass = true;
            return;
        }
        this.state = this.wasm._rnnoise_create();
        this.inPtr = this.wasm._malloc(FRAME_SAMPLES * 4);
        this.outPtr = this.wasm._malloc(FRAME_SAMPLES * 4 * 2); // margin: sentinel probe must be safe even if the frame size ever drifts upward
        this.inView = new Float32Array(this.wasm.HEAPF32.buffer, this.inPtr, FRAME_SAMPLES);
        this.checkView = new Float32Array(this.wasm.HEAPF32.buffer, this.outPtr, FRAME_SAMPLES * 2);
        // frame-size self-check (no API for it): sentinel-fill, process one silent frame, count leading writes
        this.checkView.fill(SENTINEL);
        this.inView.fill(0);
        this.wasm._rnnoise_process_frame(this.state, this.outPtr, this.inPtr); // (state, OUT, IN)
        let written = 0;
        while (written < FRAME_SAMPLES * 2 && this.checkView[written] !== SENTINEL) written++;
        if (written !== FRAME_SAMPLES) {
            console.warn(`rnnoise: frame size drift (${written} != ${FRAME_SAMPLES}), bypassing`);
            this.bypass = true;
            return;
        }
        this.outView = new Float32Array(this.wasm.HEAPF32.buffer, this.outPtr, FRAME_SAMPLES);
        this.pipeline = makeDenoisePipeline((input, fifo, depth) => {
            this.inView.set(input);
            this.wasm._rnnoise_process_frame(this.state, this.outPtr, this.inPtr); // (state, OUT, IN)
            fifo.set(this.outView, depth);
        });
        this.ready = true;
    }

    process(inputs, outputs) {
        const input = inputs[0]?.[0];
        const output = outputs[0]?.[0];
        if (!output) return true;
        if (!input || this.bypass === true) {
            if (input) output.set(input);
            return true;
        }
        if (!this.ready) { // still initializing: pass through
            output.set(input);
            return true;
        }
        this.pipeline.process(input, output);
        return true;
    }
}

if (IS_WORKLET) registerProcessor('rnnoise-processor', RnnoiseProcessor);
