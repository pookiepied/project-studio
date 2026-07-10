/**
 * Faster Whisper Model Metadata
 * Defines available models and their capabilities
 */

export interface FasterWhisperModel {
  id: string;
  name: string;
  displayName: string;
  supportsTranslation: boolean;
  size: 'tiny' | 'small' | 'medium' | 'large';
  estimatedSize: number; // in MB
  quantizationOverrides?: {
    cpu?: string[];
    cuda?: string[];
  };
  description: string;
  recommended?: boolean;
}

const FASTER_WHISPER_MODELS: FasterWhisperModel[] = [
  {
    id: 'tiny',
    name: 'tiny',
    displayName: 'Tiny (Multilingual)',
    supportsTranslation: true,
    size: 'tiny',
    estimatedSize: 75,
    description: 'Fastest, lowest accuracy. Good for quick transcriptions.',
  },
  {
    id: 'tiny.en',
    name: 'tiny.en',
    displayName: 'Tiny (English)',
    supportsTranslation: false,
    size: 'tiny',
    estimatedSize: 75,
    description: 'English-only version of Tiny model.',
  },
  {
    id: 'base',
    name: 'base',
    displayName: 'Base (Multilingual)',
    supportsTranslation: true,
    size: 'small',
    estimatedSize: 145,
    description: 'Good balance of speed and accuracy.',
  },
  {
    id: 'base.en',
    name: 'base.en',
    displayName: 'Base (English)',
    supportsTranslation: false,
    size: 'small',
    estimatedSize: 145,
    description: 'English-only version of Base model.',
  },
  {
    id: 'small',
    name: 'small',
    displayName: 'Small (Multilingual)',
    supportsTranslation: true,
    size: 'small',
    estimatedSize: 488,
    description: 'Better accuracy, still relatively fast.',
    recommended: true,
  },
  {
    id: 'small.en',
    name: 'small.en',
    displayName: 'Small (English)',
    supportsTranslation: false,
    size: 'small',
    estimatedSize: 488,
    description: 'English-only version of Small model.',
    recommended: true,
  },
  {
    id: 'medium',
    name: 'medium',
    displayName: 'Medium (Multilingual)',
    supportsTranslation: true,
    size: 'medium',
    estimatedSize: 1540,
    description: 'High accuracy, slower processing.',
  },
  {
    id: 'medium.en',
    name: 'medium.en',
    displayName: 'Medium (English)',
    supportsTranslation: false,
    size: 'medium',
    estimatedSize: 1540,
    description: 'English-only version of Medium model.',
  },
  {
    id: 'large-v3',
    name: 'large-v3',
    displayName: 'Large V3 (Multilingual)',
    supportsTranslation: true,
    size: 'large',
    estimatedSize: 3100,
    description: 'Highest accuracy, slowest processing.',
  },
  {
    id: 'large-v3-turbo',
    name: 'large-v3-turbo',
    displayName: 'Large V3 Turbo',
    supportsTranslation: false,
    size: 'large',
    estimatedSize: 1600,
    quantizationOverrides: {
      cpu: ['float32'],
      cuda: ['float16', 'bfloat16', 'float32'],
    },
    description: 'Faster version of Large V3 with similar accuracy.',
  },
  {
    id: 'distil-whisper-small.en',
    name: 'distil-whisper-small.en',
    displayName: 'Distil Small (English)',
    supportsTranslation: false,
    size: 'small',
    estimatedSize: 340,
    quantizationOverrides: {
      cpu: ['float32'],
      cuda: ['float16', 'bfloat16', 'float32'],
    },
    description: 'Distilled model - faster with good accuracy.',
  },
  {
    id: 'distil-whisper-medium.en',
    name: 'distil-whisper-medium.en',
    displayName: 'Distil Medium (English)',
    supportsTranslation: false,
    size: 'medium',
    estimatedSize: 800,
    quantizationOverrides: {
      cpu: ['float32'],
      cuda: ['float16', 'bfloat16', 'float32'],
    },
    description: 'Distilled model - faster with high accuracy.',
  },
  {
    id: 'distil-whisper-large-v3',
    name: 'distil-whisper-large-v3',
    displayName: 'Distil Large V3',
    supportsTranslation: false,
    size: 'large',
    estimatedSize: 1600,
    quantizationOverrides: {
      cpu: ['float32'],
      cuda: ['float16', 'bfloat16', 'float32'],
    },
    description: 'Distilled large model - best balance of speed and accuracy.',
    recommended: true,
  },
];

/**
 * Get model by ID
 */
export function getModelById(id: string): FasterWhisperModel | undefined {
  return FASTER_WHISPER_MODELS.find(m => m.id === id);
}

/**
 * Get recommended models for quick selection
 */
export function getRecommendedModels(): FasterWhisperModel[] {
  return FASTER_WHISPER_MODELS.filter(m => m.recommended);
}
