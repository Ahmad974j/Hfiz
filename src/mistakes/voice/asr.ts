// Main-thread client for the speech-recognition worker.
import type { WorkerRequest, WorkerResponse } from './protocol';

import { DEFAULT_CONFIG } from '../../core/config';

/**
 * ONNX export of tarteel-ai/whisper-base-ar-quran (Apache-2.0, Tarteel AI),
 * 8-bit quantised for the browser (~105 MB). Changeable in Réglages.
 */
export const DEFAULT_MODEL = DEFAULT_CONFIG.voice.model;

export type ModelState =
  | { status: 'idle' }
  | { status: 'loading'; loaded: number; total: number }
  | { status: 'ready' }
  | { status: 'error'; message: string };

type Listener = (s: ModelState) => void;

class AsrClient {
  private worker: Worker | null = null;
  private model = DEFAULT_MODEL;
  private state: ModelState = { status: 'idle' };
  private listeners = new Set<Listener>();
  private pending = new Map<number, { resolve: (t: string) => void; reject: (e: Error) => void }>();
  private nextId = 1;
  private readyWaiters: { resolve: () => void; reject: (e: Error) => void }[] = [];

  getState() {
    return this.state;
  }
  subscribe(fn: Listener) {
    this.listeners.add(fn);
    return () => void this.listeners.delete(fn);
  }
  private set(s: ModelState) {
    this.state = s;
    for (const l of this.listeners) l(s);
  }

  private ensureWorker() {
    if (this.worker) return this.worker;
    const w = new Worker(new URL('./asr.worker.ts', import.meta.url), { type: 'module' });
    w.onmessage = (e: MessageEvent<WorkerResponse>) => {
      const m = e.data;
      if (m.type === 'progress') {
        if (this.state.status !== 'ready') this.set({ status: 'loading', loaded: m.loaded, total: m.total });
      } else if (m.type === 'ready') {
        this.set({ status: 'ready' });
        this.readyWaiters.splice(0).forEach((r) => r.resolve());
      } else if (m.type === 'result') {
        this.pending.get(m.id)?.resolve(m.text);
        this.pending.delete(m.id);
      } else if (m.type === 'error') {
        const err = new Error(m.message);
        if (m.id != null) {
          this.pending.get(m.id)?.reject(err);
          this.pending.delete(m.id);
        } else {
          this.set({ status: 'error', message: m.message });
          this.readyWaiters.splice(0).forEach((r) => r.reject(err));
        }
      }
    };
    w.onerror = (e) => {
      const err = new Error(e.message || 'Le module de reconnaissance a planté.');
      this.set({ status: 'error', message: err.message });
      this.readyWaiters.splice(0).forEach((r) => r.reject(err));
      this.pending.forEach((p) => p.reject(err));
      this.pending.clear();
      this.worker = null;
    };
    this.worker = w;
    return w;
  }

  /** Downloads (first time) and initialises the model. */
  load(model = this.model): Promise<void> {
    if (model !== this.model) {
      this.model = model;
      this.set({ status: 'idle' });
    }
    if (this.state.status === 'ready') return Promise.resolve();
    const p = new Promise<void>((resolve, reject) => this.readyWaiters.push({ resolve, reject }));
    if (this.state.status !== 'loading') {
      this.set({ status: 'loading', loaded: 0, total: 0 });
      this.post({ type: 'load', model });
    }
    return p;
  }

  async transcribe(audio: Float32Array): Promise<string> {
    await this.load();
    const id = this.nextId++;
    const p = new Promise<string>((resolve, reject) => this.pending.set(id, { resolve, reject }));
    this.ensureWorker().postMessage({ type: 'transcribe', id, model: this.model, audio } satisfies WorkerRequest, [audio.buffer]);
    return p;
  }

  private post(m: WorkerRequest) {
    this.ensureWorker().postMessage(m);
  }
}

export const asr = new AsrClient();

/** Is the model already in the browser cache? (best effort) */
export async function isModelCached(model: string): Promise<boolean> {
  try {
    if (!('caches' in self)) return false;
    const c = await caches.open('transformers-cache');
    const keys = await c.keys();
    return keys.some((k) => k.url.includes(model) && k.url.includes('.onnx'));
  } catch {
    return false;
  }
}
