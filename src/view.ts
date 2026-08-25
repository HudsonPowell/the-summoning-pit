// One place that owns the low-res buffer, the renderer choice, and the
// nearest-neighbour upscale to the display canvas. GPU when available,
// CPU reference renderer otherwise; callers never care which.

import { PixelRenderer, Camera } from './render';
import { GpuRenderer } from './gpu';
import { Capsule } from './pose';

export class PixelView {
  mode: 'cpu' | 'gpu' = 'cpu';
  private display: HTMLCanvasElement;
  private dctx: CanvasRenderingContext2D;
  private W: number;
  private H: number;
  private cpuCanvas!: HTMLCanvasElement;
  private cpuCtx!: CanvasRenderingContext2D;
  private img!: ImageData;
  private cpu!: PixelRenderer;
  private gpu: GpuRenderer | null = null;

  constructor(display: HTMLCanvasElement, W: number, H: number) {
    this.display = display;
    this.dctx = display.getContext('2d')!;
    this.W = W;
    this.H = H;
    this.buildCpu();
  }

  private buildCpu(): void {
    this.cpuCanvas = document.createElement('canvas');
    this.cpuCanvas.width = this.W;
    this.cpuCanvas.height = this.H;
    this.cpuCtx = this.cpuCanvas.getContext('2d')!;
    this.img = this.cpuCtx.createImageData(this.W, this.H);
    this.cpu = new PixelRenderer(this.W, this.H);
  }

  async init(): Promise<void> {
    const gpu = await GpuRenderer.create(this.W, this.H);
    if (gpu) {
      this.gpu = gpu;
      this.mode = 'gpu';
    }
  }

  setSize(W: number, H: number): void {
    this.W = W;
    this.H = H;
    this.buildCpu();
    this.gpu?.resize(W, H);
  }

  get size(): { W: number; H: number } {
    return { W: this.W, H: this.H };
  }

  render(caps: Capsule[], cam: Camera, scroll: number): void {
    let src: HTMLCanvasElement;
    if (this.gpu) {
      this.gpu.render(caps, cam, scroll);
      src = this.gpu.canvas;
    } else {
      this.cpu.render(this.img.data, caps, cam, scroll);
      this.cpuCtx.putImageData(this.img, 0, 0);
      src = this.cpuCanvas;
    }
    this.dctx.imageSmoothingEnabled = false;
    this.dctx.drawImage(src, 0, 0, this.display.width, this.display.height);
  }
}
