import cvPromise from '@techstark/opencv-js';

async function run() {
    const cv = await cvPromise;
    console.log(typeof cv.Mat);
}
run();
