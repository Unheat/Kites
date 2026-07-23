import os
import sys
import numpy as np
from PIL import Image

sys.path.append(os.path.join(os.path.dirname(__file__), 'docs/reference/manga-image-translator'))
from manga_translator.inpainting.inpainting_aot import AotInpainter
from manga_translator.config import InpainterConfig

async def main():
    img_path = 'src/test/test-img/image2.jpg'
    img = Image.open(img_path).convert('RGB')
    width, height = img.size
    
    mask_np = np.zeros((height, width), dtype=np.uint8)
    mask_np[100:400, 100:400] = 255
    
    img_np = np.array(img)
    
    print("Loading AOT model...")
    inpainter = AotInpainter()
    await inpainter.load('cpu')
    
    print("Inpainting...")
    config = InpainterConfig()
    result = await inpainter.inpaint(img_np, mask_np, config=config, inpainting_size=512)
    
    out_img = Image.fromarray(result)
    out_img.save('aot_pytorch_output.jpg')
    print("Saved aot_pytorch_output.jpg")

if __name__ == '__main__':
    import asyncio
    asyncio.run(main())
