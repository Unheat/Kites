import * as ort from 'onnxruntime-node';

async function main() {
    const session = await ort.InferenceSession.create('src/test/models/aot/aotgan.onnx', { executionProviders: ['cpu'] });
    console.log(`[AOT Input] Input names:`, session.inputNames);
}

main().catch(console.error);
