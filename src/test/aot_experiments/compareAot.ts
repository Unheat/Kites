import { loadImage, createCanvas } from 'canvas';

async function main() {
    const img1 = await loadImage('aot_pytorch_output.jpg');
    const img2 = await loadImage('aot_debug_mask.jpg');
    
    const canvas1 = createCanvas(img1.width, img1.height);
    const ctx1 = canvas1.getContext('2d');
    ctx1.drawImage(img1, 0, 0);
    const data1 = ctx1.getImageData(0, 0, img1.width, img1.height).data;
    
    const canvas2 = createCanvas(img2.width, img2.height);
    const ctx2 = canvas2.getContext('2d');
    ctx2.drawImage(img2, 0, 0);
    const data2 = ctx2.getImageData(0, 0, img2.width, img2.height).data;
    
    let mse = 0;
    for (let i = 0; i < data1.length; i += 4) {
        mse += Math.pow(data1[i] - data2[i], 2);
        mse += Math.pow(data1[i+1] - data2[i+1], 2);
        mse += Math.pow(data1[i+2] - data2[i+2], 2);
    }
    mse /= (img1.width * img1.height * 3);
    
    console.log(`[Compare] MSE between PyTorch and ONNX (JS): ${mse.toFixed(2)}`);
}

main().catch(console.error);
