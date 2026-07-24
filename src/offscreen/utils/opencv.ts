import { createRequire } from 'module';

let cv: any = null;

/**
 * Initializes and returns the OpenCV instance.
 * Must be called and awaited before any synchronous OpenCV functions are used.
 */
export async function initOpenCV(): Promise<any> {
  if (cv && typeof cv.Mat === 'function') return cv;

  const isNode = typeof window === 'undefined';
  let cvModule: any;

  if (isNode) {
    const req = createRequire(import.meta.url);
    cvModule = req('@techstark/opencv-js');
  } else {
    cvModule = await import('@techstark/opencv-js');
  }

  const cvFactory = cvModule.default || cvModule;

  if (typeof cvFactory === 'function') {
    try {
      const resolved = await cvFactory();
      cv = (globalThis as any).cv || resolved || cvFactory;
    } catch (e) {
      cv = (globalThis as any).cv || cvFactory;
    }
  } else {
    cv = (globalThis as any).cv || cvFactory;
  }

  if (!cv || typeof cv.Mat !== 'function') {
    if (typeof (globalThis as any).cv !== 'undefined' && typeof (globalThis as any).cv.Mat === 'function') {
      cv = (globalThis as any).cv;
    }
  }

  // Remove or override .then property if present so async functions never treat cv as a Thenable
  if (cv && typeof cv === 'object' && 'then' in cv) {
    try {
      delete cv.then;
    } catch (e) {
      cv = Object.assign({}, cv);
      delete cv.then;
    }
  }

  return cv;
}

/**
 * Returns the initialized OpenCV instance.
 * Throws an error if initOpenCV() hasn't completed yet.
 */
export function getCv(): any {
  if (!cv || typeof cv.Mat !== 'function') {
    if (typeof (globalThis as any).cv !== 'undefined' && typeof (globalThis as any).cv.Mat === 'function') {
      cv = (globalThis as any).cv;
    }
  }
  return cv;
}
