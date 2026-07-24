import cvInit from '@techstark/opencv-js';
console.log(typeof cvInit);
cvInit().then(cv => {
    console.log(typeof cv.Mat);
}).catch(console.error);
