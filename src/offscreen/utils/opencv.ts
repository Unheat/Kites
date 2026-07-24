import * as cvNamespace from '@techstark/opencv-js';

// The loaded opencv module
let cv: any = null;

/**
 * Initializes and returns the OpenCV instance.
 * Must be called and awaited before any synchronous OpenCV functions are used.
 */
export async function initOpenCV(): Promise<any> {
  if (cv) return cv;
  
  let target = (cvNamespace as any).default || cvNamespace;
  
  try {
    // If target itself is a function (e.g. cv()), call it
    if (typeof target === 'function') {
      cv = await target();
    } 
    // If target is a Promise, we must avoid awaiting the module namespace directly.
    else if (target && typeof target.then === 'function') {
      // In Vitest, cvNamespace might be a Module Namespace object that exposed 'then'.
      // We extract the real promise (usually the default export) and await it.
      const realPromise = (cvNamespace as any).default;
      if (realPromise && typeof realPromise.then === 'function' && realPromise !== cvNamespace) {
        cv = await realPromise;
      } else {
        // Fallback: manually bind the then function to avoid "incompatible receiver"
        cv = await new Promise((resolve, reject) => {
          target.then.call(target, resolve).catch(reject);
        });
      }
    } else {
      cv = target;
    }
  } catch (e) {
    console.error('Failed to init OpenCV:', e);
    throw e;
  }
  
  return cv;
}

/**
 * Returns the initialized OpenCV instance.
 * Throws an error if initOpenCV() hasn't completed yet.
 */
export function getCv(): any {
  if (!cv) {
    throw new Error('OpenCV has not been initialized. Call initOpenCV() first.');
  }
  return cv;
}
