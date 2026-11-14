// Microphone recording and audio decoding to 16 kHz mono Float32 (what Whisper expects).

export const SAMPLE_RATE = 16000;

export function micSupported() {
  return typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia && typeof MediaRecorder !== 'undefined';
}

export interface Recording {
  stop(): Promise<Blob>;
  cancel(): void;
  /** 0..1 input level, for a meter. */
  level(): number;
}

export async function startRecording(): Promise<Recording> {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
  });
  const rec = new MediaRecorder(stream);
  const chunks: Blob[] = [];
  rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  rec.start();

  const ctx = new AudioContext();
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 512;
  ctx.createMediaStreamSource(stream).connect(analyser);
  const buf = new Uint8Array(analyser.fftSize);

  const cleanup = () => {
    stream.getTracks().forEach((t) => t.stop());
    ctx.close().catch(() => {});
  };

  return {
    stop: () =>
      new Promise<Blob>((resolve) => {
        rec.onstop = () => {
          cleanup();
          resolve(new Blob(chunks, { type: rec.mimeType || 'audio/webm' }));
        };
        rec.stop();
      }),
    cancel: () => {
      rec.onstop = null;
      if (rec.state !== 'inactive') rec.stop();
      cleanup();
    },
    level: () => {
      analyser.getByteTimeDomainData(buf);
      let sum = 0;
      for (const v of buf) sum += ((v - 128) / 128) ** 2;
      return Math.min(1, Math.sqrt(sum / buf.length) * 4);
    },
  };
}

/** Decodes any browser-supported audio (recording or imported file) to 16 kHz mono. */
export async function decodeTo16k(blob: Blob): Promise<Float32Array> {
  const bytes = await blob.arrayBuffer();
  const tmp = new AudioContext();
  let decoded: AudioBuffer;
  try {
    decoded = await tmp.decodeAudioData(bytes);
  } finally {
    tmp.close().catch(() => {});
  }
  const length = Math.max(1, Math.ceil(decoded.duration * SAMPLE_RATE));
  const off = new OfflineAudioContext(1, length, SAMPLE_RATE);
  const src = off.createBufferSource();
  src.buffer = decoded; // multi-channel is down-mixed to mono by the 1-channel destination
  src.connect(off.destination);
  src.start();
  const out = await off.startRendering();
  return out.getChannelData(0).slice();
}
