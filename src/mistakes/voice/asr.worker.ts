// Web worker: runs the Tarteel Whisper model (ONNX, via transformers.js) off the main thread.
// Everything happens on the device; the model files are downloaded once from Hugging Face
// and kept in the browser cache.
import { env, pipeline, type AutomaticSpeechRecognitionPipeline } from '@huggingface/transformers';
import type { WorkerRequest, WorkerResponse } from './protocol';

env.allowLocalModels = false;
env.useBrowserCache = true;

let asr: Promise<AutomaticSpeechRecognitionPipeline> | null = null;
let loadedModel = '';

const post = (m: WorkerResponse) => (self as unknown as Worker).postMessage(m);

function load(model: string) {
  if (asr && loadedModel === model) return asr;
  loadedModel = model;
  const files = new Map<string, { loaded: number; total: number }>();
  asr = pipeline('automatic-speech-recognition', model, {
    // 8-bit weights (~105 MB). WASM: the 8-bit model gives wrong output on WebGPU.
    dtype: 'q8',
    device: 'wasm',
    progress_callback: (p: any) => {
      if (p.status === 'progress' && p.file) {
        files.set(p.file, { loaded: p.loaded ?? 0, total: p.total ?? 0 });
        let loaded = 0;
        let total = 0;
        for (const f of files.values()) {
          loaded += f.loaded;
          total += f.total;
        }
        post({ type: 'progress', loaded, total });
      }
    },
  }) as Promise<AutomaticSpeechRecognitionPipeline>;
  asr.catch(() => {
    asr = null;
  });
  return asr;
}

self.onmessage = async (e: MessageEvent<WorkerRequest>) => {
  const msg = e.data;
  try {
    if (msg.type === 'load') {
      await load(msg.model);
      post({ type: 'ready' });
    } else if (msg.type === 'transcribe') {
      const p = await load(msg.model);
      const seconds = msg.audio.length / 16000;
      // The fine-tuned model already outputs Arabic transcription: no language/task option.
      const out = (await p(msg.audio, seconds > 28 ? { chunk_length_s: 28, stride_length_s: 4 } : {})) as { text: string };
      post({ type: 'result', id: msg.id, text: out.text ?? '' });
    }
  } catch (err) {
    post({ type: 'error', id: msg.type === 'transcribe' ? msg.id : undefined, message: (err as Error)?.message ?? String(err) });
  }
};
