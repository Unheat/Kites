import * as ort from 'onnxruntime-node';

async function main() {
    const session = await ort.InferenceSession.create('src/test/models/aot/aotgan.onnx', { executionProviders: ['cpu'] });
    const floatImgData = new Float32Array(512 * 512 * 3).fill(0.5);
    const floatMaskData = new Float32Array(512 * 512 * 1).fill(1.0); // 1.0 everywhere

    const imageTensor = new ort.Tensor('float32', floatImgData, [1, 3, 512, 512]);
    const maskTensor = new ort.Tensor('float32', floatMaskData, [1, 1, 512, 512]);
    
    const feeds = { image: imageTensor, mask: maskTensor };
    const results = await session.run(feeds);
    
    const outName = session.outputNames[0];
    const outData = results[outName].data as Float32Array;

    console.log(`[AOT Output with Mask=1.0] First 10 values:`, Array.from(outData.slice(0, 10)));
}

main().catch(console.error);
