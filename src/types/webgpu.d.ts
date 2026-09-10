/// <reference types="@webgpu/types" />

// Ensure Navigator and WorkerNavigator ambient types include WebGPU in all TS contexts
declare global {
  interface Navigator {
    readonly gpu?: GPU;
  }
  interface WorkerNavigator {
    readonly gpu?: GPU;
  }
}

export {};
