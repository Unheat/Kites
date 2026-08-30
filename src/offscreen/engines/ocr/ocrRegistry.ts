export interface OcrModelRegistryEntry {
  name: string;
  description: string;
  detectionUrl: string;
  recognitionUrl: string;
  charactersDictionaryUrl: string;
  isAdvanced?: boolean;
}

const MODEL_BASE_URL = 'https://media.githubusercontent.com/media/PT-Perkasa-Pilar-Utama/ppu-paddle-ocr-models/main';
const DICT_BASE_URL = 'https://raw.githubusercontent.com/PT-Perkasa-Pilar-Utama/ppu-paddle-ocr-models/main';

export const ocrRegistry: Record<string, OcrModelRegistryEntry> = {
  'v6-small': {
    name: 'PaddleOCR v6 Small (Default)',
    description: 'Fast, balanced text detection and recognition. Best for most manga and web use.',
    detectionUrl: `${MODEL_BASE_URL}/detection/PP-OCRv6_small_det.onnx`,
    recognitionUrl: `${MODEL_BASE_URL}/recognition/PP-OCRv6_small_rec.onnx`,
    charactersDictionaryUrl: `${DICT_BASE_URL}/recognition/ppocrv6_dict.txt`,
    isAdvanced: false
  },
  'v6-medium': {
    name: 'PaddleOCR v6 Medium',
    description: 'Higher accuracy model with larger capacity for complex text layout.',
    detectionUrl: `${MODEL_BASE_URL}/detection/PP-OCRv6_medium_det.onnx`,
    recognitionUrl: `${MODEL_BASE_URL}/recognition/PP-OCRv6_medium_rec.onnx`,
    charactersDictionaryUrl: `${DICT_BASE_URL}/recognition/ppocrv6_dict.txt`,
    isAdvanced: false
  },
  'v6-tiny': {
    name: 'PaddleOCR v6 Tiny',
    description: 'Ultra-lightweight model for fastest inference speed on constrained hardware.',
    detectionUrl: `${MODEL_BASE_URL}/detection/PP-OCRv6_tiny_det.onnx`,
    recognitionUrl: `${MODEL_BASE_URL}/recognition/PP-OCRv6_tiny_rec.onnx`,
    charactersDictionaryUrl: `${DICT_BASE_URL}/recognition/ppocrv6_tiny_dict.txt`,
    isAdvanced: false
  },
  'v5-mobile': {
    name: 'PaddleOCR v5 Mobile',
    description: 'PaddleOCR v5 mobile model for general multilingual text.',
    detectionUrl: `${MODEL_BASE_URL}/detection/PP-OCRv5_mobile_det_infer.onnx`,
    recognitionUrl: `${MODEL_BASE_URL}/recognition/PP-OCRv5_mobile_rec_infer.onnx`,
    charactersDictionaryUrl: `${DICT_BASE_URL}/recognition/ppocrv5_dict.txt`,
    isAdvanced: true
  },
  'v5-server': {
    name: 'PaddleOCR v5 Server',
    description: 'High-precision server tier model from PaddleOCR v5 series.',
    detectionUrl: `${MODEL_BASE_URL}/detection/PP-OCRv5_server_det_infer.onnx`,
    recognitionUrl: `${MODEL_BASE_URL}/recognition/PP-OCRv5_server_rec_infer.onnx`,
    charactersDictionaryUrl: `${DICT_BASE_URL}/recognition/ppocrv5_dict.txt`,
    isAdvanced: true
  },
  'v5-en-mobile': {
    name: 'PaddleOCR v5 English Mobile',
    description: 'Optimized specifically for Latin and English text recognition.',
    detectionUrl: `${MODEL_BASE_URL}/detection/PP-OCRv5_mobile_det_infer.onnx`,
    recognitionUrl: `${MODEL_BASE_URL}/recognition/multi/en/v5/en_PP-OCRv5_mobile_rec_infer.onnx`,
    charactersDictionaryUrl: `${DICT_BASE_URL}/recognition/multi/en/v5/ppocrv5_en_dict.txt`,
    isAdvanced: true
  },
  'v4-mobile': {
    name: 'PaddleOCR v4 Mobile',
    description: 'Legacy PaddleOCR v4 lightweight model.',
    detectionUrl: `${MODEL_BASE_URL}/detection/PP-OCRv4_mobile_det_infer.onnx`,
    recognitionUrl: `${MODEL_BASE_URL}/recognition/PP-OCRv4_mobile_rec_infer.onnx`,
    charactersDictionaryUrl: `${DICT_BASE_URL}/recognition/ppocrv4_dict.txt`,
    isAdvanced: true
  },
  'v4-server': {
    name: 'PaddleOCR v4 Server',
    description: 'Legacy PaddleOCR v4 high accuracy server model.',
    detectionUrl: `${MODEL_BASE_URL}/detection/PP-OCRv4_server_det_infer.onnx`,
    recognitionUrl: `${MODEL_BASE_URL}/recognition/PP-OCRv4_server_rec_infer.onnx`,
    charactersDictionaryUrl: `${DICT_BASE_URL}/recognition/ppocrv4_dict.txt`,
    isAdvanced: true
  },
  'v3-mobile': {
    name: 'PaddleOCR v3 Mobile',
    description: 'Legacy PaddleOCR v3 lightweight mobile model.',
    detectionUrl: `${MODEL_BASE_URL}/detection/PP-OCRv5_mobile_det_infer.onnx`,
    recognitionUrl: `${MODEL_BASE_URL}/recognition/PP-OCRv3_mobile_rec_infer.onnx`,
    charactersDictionaryUrl: `${DICT_BASE_URL}/recognition/ppocrv3_dict.txt`,
    isAdvanced: true
  },
  'v3-japanese-mobile': {
    name: 'PaddleOCR v3 Japanese Mobile',
    description: 'Legacy model tuned for Japanese text.',
    detectionUrl: `${MODEL_BASE_URL}/detection/PP-OCRv5_mobile_det_infer.onnx`,
    recognitionUrl: `${MODEL_BASE_URL}/recognition/multi/japan/v3/japan_PP-OCRv3_mobile_rec_infer.onnx`,
    charactersDictionaryUrl: `${DICT_BASE_URL}/recognition/multi/japan/v3/japan_dict.txt`,
    isAdvanced: true
  }
};

/**
 * Resolves an OCR tier identifier to a canonical registry key.
 * Maps legacy identifiers (such as 'paddle-dbnet') to the default 'v6-small'.
 *
 * @param tier - Raw tier string from user settings or message.
 * @returns Canonical tier key in ocrRegistry.
 */
export function resolveOcrTier(tier?: string): string {
  if (!tier || tier === 'paddle-dbnet') return 'v6-small';
  if (ocrRegistry[tier]) return tier;
  return 'v6-small';
}
