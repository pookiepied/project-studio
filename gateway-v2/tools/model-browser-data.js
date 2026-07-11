window.__MODEL_REGISTRY__ = {
  "version": "2026-07-11.curated.1",
  "generatedAt": "2026-07-11T00:00:00.000Z",
  "source": "studio-curated",
  "models": [
    {
      "id": "openai:gpt-5.6-sol",
      "provider": "openai",
      "providerModelId": "gpt-5.6-sol",
      "displayName": "GPT-5.6 Sol",
      "type": "multimodal",
      "capabilities": {
        "modalities": [
          "chat"
        ],
        "chat": {
          "streaming": true,
          "vision": true,
          "tools": true,
          "reasoning": {
            "supported": true,
            "efforts": [
              "none",
              "low",
              "medium",
              "high",
              "xhigh"
            ],
            "defaultEffort": "medium",
            "source": "official-docs",
            "confidence": "exact"
          },
          "jsonSchema": true,
          "promptCaching": true
        }
      },
      "pricing": {
        "inputPerMillionUsd": 5,
        "outputPerMillionUsd": 30,
        "source": "static",
        "note": "Verified from OpenAI API pricing and GPT-5.6 model docs. Cache write is 1.25x input; cache read is 90% discounted."
      },
      "contextWindow": 1050000,
      "maxTokens": 128000,
      "supportsVision": true,
      "supportsTools": true,
      "supportsStreaming": true,
      "supportsSystemPrompts": true,
      "inputTypes": [
        "text",
        "image"
      ],
      "outputTypes": [
        "text"
      ],
      "specialFeatures": [
        "reasoning"
      ],
      "registry": {
        "category": "text.chat",
        "status": "active",
        "developer": "OpenAI",
        "family": "gpt-5.6",
        "version": "gpt-5.6-sol",
        "supportedRegions": [],
        "endpoints": [
          "chat"
        ],
        "aliases": [
          "gpt-5.6-sol"
        ],
        "fallbackModelIds": [],
        "verificationLevel": "verifiedDocumentationOnly",
        "source": {
          "authority": "studio-curated",
          "checkedAt": "2026-07-11",
          "urls": [
            "https://developers.openai.com/api/docs/models",
            "https://platform.openai.com/docs/pricing"
          ]
        },
        "pricing": {
          "kind": "token",
          "status": "verified",
          "currency": "USD",
          "billingUnit": "one_million_tokens",
          "inputPerMillion": 5,
          "cachedInputPerMillion": 0.5,
          "cacheWritePerMillion": 6.25,
          "outputPerMillion": 30,
          "batchInputPerMillion": null,
          "batchOutputPerMillion": null,
          "reasoningTokens": "unknown",
          "sourceUrls": [
            "https://developers.openai.com/api/docs/models",
            "https://platform.openai.com/docs/pricing"
          ],
          "verifiedAt": "2026-07-11",
          "notes": "Verified from OpenAI API pricing and GPT-5.6 model docs. Cache write is 1.25x input; cache read is 90% discounted."
        },
        "reasoning": {
          "supported": true,
          "alwaysOn": false,
          "canDisable": true,
          "effortValues": [
            "none",
            "low",
            "medium",
            "high",
            "xhigh"
          ],
          "returnsReasoningContent": "unknown",
          "reasoningTokensVisible": "unknown",
          "reasoningTokensBillable": "unknown",
          "worksWithTools": "unknown",
          "worksWhileStreaming": "unknown",
          "requiresReasoningStateAfterTools": "unknown",
          "reducesOutputBudget": "unknown",
          "providerSpecificControls": [
            "reasoning_effort"
          ]
        },
        "freeAccess": {
          "isFree": false,
          "isPromotional": false
        }
      }
    },
    {
      "id": "openai:gpt-5.6-terra",
      "provider": "openai",
      "providerModelId": "gpt-5.6-terra",
      "displayName": "GPT-5.6 Terra",
      "type": "multimodal",
      "capabilities": {
        "modalities": [
          "chat"
        ],
        "chat": {
          "streaming": true,
          "vision": true,
          "tools": true,
          "reasoning": {
            "supported": true,
            "efforts": [
              "none",
              "low",
              "medium",
              "high",
              "xhigh"
            ],
            "defaultEffort": "medium",
            "source": "official-docs",
            "confidence": "exact"
          },
          "jsonSchema": true,
          "promptCaching": true
        }
      },
      "pricing": {
        "inputPerMillionUsd": 2.5,
        "outputPerMillionUsd": 15,
        "source": "static",
        "note": "Verified from OpenAI API pricing and GPT-5.6 model docs. Cache write is 1.25x input; cache read is 90% discounted."
      },
      "contextWindow": 1050000,
      "maxTokens": 128000,
      "supportsVision": true,
      "supportsTools": true,
      "supportsStreaming": true,
      "supportsSystemPrompts": true,
      "inputTypes": [
        "text",
        "image"
      ],
      "outputTypes": [
        "text"
      ],
      "specialFeatures": [
        "reasoning"
      ],
      "registry": {
        "category": "text.chat",
        "status": "active",
        "developer": "OpenAI",
        "family": "gpt-5.6",
        "version": "gpt-5.6-terra",
        "supportedRegions": [],
        "endpoints": [
          "chat"
        ],
        "aliases": [
          "gpt-5.6-terra"
        ],
        "fallbackModelIds": [],
        "verificationLevel": "verifiedDocumentationOnly",
        "source": {
          "authority": "studio-curated",
          "checkedAt": "2026-07-11",
          "urls": [
            "https://developers.openai.com/api/docs/models",
            "https://platform.openai.com/docs/pricing"
          ]
        },
        "pricing": {
          "kind": "token",
          "status": "verified",
          "currency": "USD",
          "billingUnit": "one_million_tokens",
          "inputPerMillion": 2.5,
          "cachedInputPerMillion": 0.25,
          "cacheWritePerMillion": 3.125,
          "outputPerMillion": 15,
          "batchInputPerMillion": null,
          "batchOutputPerMillion": null,
          "reasoningTokens": "unknown",
          "sourceUrls": [
            "https://developers.openai.com/api/docs/models",
            "https://platform.openai.com/docs/pricing"
          ],
          "verifiedAt": "2026-07-11",
          "notes": "Verified from OpenAI API pricing and GPT-5.6 model docs. Cache write is 1.25x input; cache read is 90% discounted."
        },
        "reasoning": {
          "supported": true,
          "alwaysOn": false,
          "canDisable": true,
          "effortValues": [
            "none",
            "low",
            "medium",
            "high",
            "xhigh"
          ],
          "returnsReasoningContent": "unknown",
          "reasoningTokensVisible": "unknown",
          "reasoningTokensBillable": "unknown",
          "worksWithTools": "unknown",
          "worksWhileStreaming": "unknown",
          "requiresReasoningStateAfterTools": "unknown",
          "reducesOutputBudget": "unknown",
          "providerSpecificControls": [
            "reasoning_effort"
          ]
        },
        "freeAccess": {
          "isFree": false,
          "isPromotional": false
        }
      }
    },
    {
      "id": "openai:gpt-5.6-luna",
      "provider": "openai",
      "providerModelId": "gpt-5.6-luna",
      "displayName": "GPT-5.6 Luna",
      "type": "multimodal",
      "capabilities": {
        "modalities": [
          "chat"
        ],
        "chat": {
          "streaming": true,
          "vision": true,
          "tools": true,
          "reasoning": {
            "supported": true,
            "efforts": [
              "none",
              "low",
              "medium",
              "high",
              "xhigh"
            ],
            "defaultEffort": "medium",
            "source": "official-docs",
            "confidence": "exact"
          },
          "jsonSchema": true,
          "promptCaching": true
        }
      },
      "pricing": {
        "inputPerMillionUsd": 1,
        "outputPerMillionUsd": 6,
        "source": "static",
        "note": "Verified from OpenAI API pricing and GPT-5.6 model docs. Cache write is 1.25x input; cache read is 90% discounted."
      },
      "contextWindow": 1050000,
      "maxTokens": 128000,
      "supportsVision": true,
      "supportsTools": true,
      "supportsStreaming": true,
      "supportsSystemPrompts": true,
      "inputTypes": [
        "text",
        "image"
      ],
      "outputTypes": [
        "text"
      ],
      "specialFeatures": [
        "reasoning"
      ],
      "registry": {
        "category": "text.chat",
        "status": "active",
        "developer": "OpenAI",
        "family": "gpt-5.6",
        "version": "gpt-5.6-luna",
        "supportedRegions": [],
        "endpoints": [
          "chat"
        ],
        "aliases": [
          "gpt-5.6-luna"
        ],
        "fallbackModelIds": [],
        "verificationLevel": "verifiedDocumentationOnly",
        "source": {
          "authority": "studio-curated",
          "checkedAt": "2026-07-11",
          "urls": [
            "https://developers.openai.com/api/docs/models",
            "https://platform.openai.com/docs/pricing"
          ]
        },
        "pricing": {
          "kind": "token",
          "status": "verified",
          "currency": "USD",
          "billingUnit": "one_million_tokens",
          "inputPerMillion": 1,
          "cachedInputPerMillion": 0.1,
          "cacheWritePerMillion": 1.25,
          "outputPerMillion": 6,
          "batchInputPerMillion": null,
          "batchOutputPerMillion": null,
          "reasoningTokens": "unknown",
          "sourceUrls": [
            "https://developers.openai.com/api/docs/models",
            "https://platform.openai.com/docs/pricing"
          ],
          "verifiedAt": "2026-07-11",
          "notes": "Verified from OpenAI API pricing and GPT-5.6 model docs. Cache write is 1.25x input; cache read is 90% discounted."
        },
        "reasoning": {
          "supported": true,
          "alwaysOn": false,
          "canDisable": true,
          "effortValues": [
            "none",
            "low",
            "medium",
            "high",
            "xhigh"
          ],
          "returnsReasoningContent": "unknown",
          "reasoningTokensVisible": "unknown",
          "reasoningTokensBillable": "unknown",
          "worksWithTools": "unknown",
          "worksWhileStreaming": "unknown",
          "requiresReasoningStateAfterTools": "unknown",
          "reducesOutputBudget": "unknown",
          "providerSpecificControls": [
            "reasoning_effort"
          ]
        },
        "freeAccess": {
          "isFree": false,
          "isPromotional": false
        }
      }
    },
    {
      "id": "openai:gpt-5.5",
      "provider": "openai",
      "providerModelId": "gpt-5.5",
      "displayName": "GPT-5.5",
      "type": "multimodal",
      "capabilities": {
        "modalities": [
          "chat"
        ],
        "chat": {
          "streaming": true,
          "vision": true,
          "tools": true,
          "reasoning": {
            "supported": true,
            "efforts": [
              "none",
              "low",
              "medium",
              "high",
              "xhigh"
            ],
            "defaultEffort": "medium",
            "source": "official-docs",
            "confidence": "exact"
          },
          "jsonSchema": true,
          "promptCaching": true
        }
      },
      "pricing": {
        "inputPerMillionUsd": 5,
        "outputPerMillionUsd": 22.5,
        "source": "static",
        "note": "Verified from OpenAI API pricing for the long-context GPT-5.5 tier used by this registry record."
      },
      "contextWindow": 1050000,
      "maxTokens": 128000,
      "supportsVision": true,
      "supportsTools": true,
      "supportsStreaming": true,
      "supportsSystemPrompts": true,
      "inputTypes": [
        "text",
        "image"
      ],
      "outputTypes": [
        "text"
      ],
      "specialFeatures": [
        "reasoning"
      ],
      "registry": {
        "category": "text.chat",
        "status": "active",
        "developer": "OpenAI",
        "family": "gpt-5.5",
        "version": "gpt-5.5",
        "supportedRegions": [],
        "endpoints": [
          "chat"
        ],
        "aliases": [
          "gpt-5.5"
        ],
        "fallbackModelIds": [],
        "verificationLevel": "verifiedDocumentationOnly",
        "source": {
          "authority": "studio-curated",
          "checkedAt": "2026-07-11",
          "urls": [
            "https://developers.openai.com/api/docs/models",
            "https://platform.openai.com/docs/pricing"
          ]
        },
        "pricing": {
          "kind": "token",
          "status": "verified",
          "currency": "USD",
          "billingUnit": "one_million_tokens",
          "inputPerMillion": 5,
          "cachedInputPerMillion": 0.5,
          "cacheWritePerMillion": null,
          "outputPerMillion": 22.5,
          "batchInputPerMillion": null,
          "batchOutputPerMillion": null,
          "reasoningTokens": "unknown",
          "sourceUrls": [
            "https://developers.openai.com/api/docs/models",
            "https://platform.openai.com/docs/pricing"
          ],
          "verifiedAt": "2026-07-11",
          "notes": "Verified from OpenAI API pricing for the long-context GPT-5.5 tier used by this registry record."
        },
        "reasoning": {
          "supported": true,
          "alwaysOn": false,
          "canDisable": true,
          "effortValues": [
            "none",
            "low",
            "medium",
            "high",
            "xhigh"
          ],
          "returnsReasoningContent": "unknown",
          "reasoningTokensVisible": "unknown",
          "reasoningTokensBillable": "unknown",
          "worksWithTools": "unknown",
          "worksWhileStreaming": "unknown",
          "requiresReasoningStateAfterTools": "unknown",
          "reducesOutputBudget": "unknown",
          "providerSpecificControls": [
            "reasoning_effort"
          ]
        },
        "freeAccess": {
          "isFree": false,
          "isPromotional": false
        }
      }
    },
    {
      "id": "openai:gpt-image-2",
      "provider": "openai",
      "providerModelId": "gpt-image-2",
      "displayName": "GPT Image 2",
      "type": "image",
      "capabilities": {
        "modalities": [
          "image.generate",
          "image.edit"
        ]
      },
      "pricing": {
        "inputPerMillionUsd": null,
        "outputPerMillionUsd": null,
        "source": "unknown",
        "note": "Verified from OpenAI API image generation pricing. Cost is token-metered by text/image input and image output, not a flat per-image price."
      },
      "inputTypes": [
        "text",
        "image"
      ],
      "outputTypes": [
        "image"
      ],
      "registry": {
        "category": "image.editing",
        "status": "active",
        "developer": "OpenAI",
        "family": "gpt-image",
        "version": "gpt-image-2",
        "supportedRegions": [],
        "endpoints": [
          "images.generations",
          "images.edits"
        ],
        "aliases": [
          "gpt-image-2"
        ],
        "fallbackModelIds": [],
        "verificationLevel": "verifiedDocumentationOnly",
        "source": {
          "authority": "studio-curated",
          "checkedAt": "2026-07-11",
          "urls": [
            "https://developers.openai.com/api/docs/models",
            "https://platform.openai.com/docs/pricing"
          ]
        },
        "pricing": {
          "kind": "image",
          "status": "verified",
          "currency": "USD",
          "billingUnit": "one_million_tokens",
          "price": null,
          "tiers": [
            {
              "name": "text_input",
              "unit": "one_million_tokens",
              "price": 5,
              "currency": "USD"
            },
            {
              "name": "text_cached_input",
              "unit": "one_million_tokens",
              "price": 1.25,
              "currency": "USD"
            },
            {
              "name": "image_input",
              "unit": "one_million_tokens",
              "price": 8,
              "currency": "USD"
            },
            {
              "name": "image_cached_input",
              "unit": "one_million_tokens",
              "price": 2,
              "currency": "USD"
            },
            {
              "name": "image_output",
              "unit": "one_million_tokens",
              "price": 30,
              "currency": "USD"
            }
          ],
          "dependsOn": [
            "resolution",
            "quality"
          ],
          "sourceUrls": [
            "https://developers.openai.com/api/docs/models",
            "https://platform.openai.com/docs/pricing"
          ],
          "verifiedAt": "2026-07-11",
          "notes": "Verified from OpenAI API image generation pricing. Cost is token-metered by text/image input and image output, not a flat per-image price."
        },
        "freeAccess": {
          "isFree": false,
          "isPromotional": false
        }
      }
    },
    {
      "id": "openai:gpt-4o-transcribe",
      "provider": "openai",
      "providerModelId": "gpt-4o-transcribe",
      "displayName": "GPT-4o Transcribe",
      "type": "audio",
      "capabilities": {
        "modalities": [
          "transcription"
        ]
      },
      "pricing": {
        "inputPerMillionUsd": null,
        "outputPerMillionUsd": null,
        "source": "unknown",
        "note": "Transcription pricing is duration based for most supported providers."
      },
      "inputTypes": [
        "audio"
      ],
      "outputTypes": [
        "text"
      ],
      "registry": {
        "category": "audio.transcription",
        "status": "active",
        "developer": "OpenAI",
        "family": "gpt-4o-transcribe",
        "version": "gpt-4o-transcribe",
        "supportedRegions": [],
        "endpoints": [
          "audio.transcriptions"
        ],
        "aliases": [
          "gpt-4o-transcribe"
        ],
        "fallbackModelIds": [],
        "verificationLevel": "verifiedDocumentationOnly",
        "source": {
          "authority": "studio-curated",
          "checkedAt": "2026-07-11",
          "urls": [
            "https://developers.openai.com/api/docs/models",
            "https://platform.openai.com/docs/pricing"
          ]
        },
        "pricing": {
          "kind": "audio",
          "status": "unknown",
          "currency": "USD",
          "billingUnit": "audio_minute",
          "price": null,
          "sourceUrls": [
            "https://developers.openai.com/api/docs/models",
            "https://platform.openai.com/docs/pricing"
          ],
          "verifiedAt": null,
          "notes": "Transcription pricing is duration based for most supported providers."
        },
        "freeAccess": {
          "isFree": false,
          "isPromotional": false
        }
      }
    },
    {
      "id": "openai:gpt-4o-mini-transcribe",
      "provider": "openai",
      "providerModelId": "gpt-4o-mini-transcribe",
      "displayName": "GPT-4o Mini Transcribe",
      "type": "audio",
      "capabilities": {
        "modalities": [
          "transcription"
        ]
      },
      "pricing": {
        "inputPerMillionUsd": null,
        "outputPerMillionUsd": null,
        "source": "unknown",
        "note": "Transcription pricing is duration based for most supported providers."
      },
      "inputTypes": [
        "audio"
      ],
      "outputTypes": [
        "text"
      ],
      "registry": {
        "category": "audio.transcription",
        "status": "active",
        "developer": "OpenAI",
        "family": "gpt-4o-transcribe",
        "version": "gpt-4o-mini-transcribe",
        "supportedRegions": [],
        "endpoints": [
          "audio.transcriptions"
        ],
        "aliases": [
          "gpt-4o-mini-transcribe"
        ],
        "fallbackModelIds": [],
        "verificationLevel": "verifiedDocumentationOnly",
        "source": {
          "authority": "studio-curated",
          "checkedAt": "2026-07-11",
          "urls": [
            "https://developers.openai.com/api/docs/models",
            "https://platform.openai.com/docs/pricing"
          ]
        },
        "pricing": {
          "kind": "audio",
          "status": "unknown",
          "currency": "USD",
          "billingUnit": "audio_minute",
          "price": null,
          "sourceUrls": [
            "https://developers.openai.com/api/docs/models",
            "https://platform.openai.com/docs/pricing"
          ],
          "verifiedAt": null,
          "notes": "Transcription pricing is duration based for most supported providers."
        },
        "freeAccess": {
          "isFree": false,
          "isPromotional": false
        }
      }
    },
    {
      "id": "openai:gpt-4o-mini-tts",
      "provider": "openai",
      "providerModelId": "gpt-4o-mini-tts",
      "displayName": "GPT-4o Mini TTS",
      "type": "tts",
      "capabilities": {
        "modalities": [
          "speech"
        ]
      },
      "pricing": {
        "inputPerMillionUsd": null,
        "outputPerMillionUsd": null,
        "source": "unknown",
        "note": "Speech pricing must preserve provider units such as character, credit, minute, or generation."
      },
      "inputTypes": [
        "text"
      ],
      "outputTypes": [
        "audio"
      ],
      "registry": {
        "category": "audio.speech",
        "status": "active",
        "developer": "OpenAI",
        "family": "gpt-4o-tts",
        "version": "gpt-4o-mini-tts",
        "supportedRegions": [],
        "endpoints": [
          "audio.speech"
        ],
        "aliases": [
          "gpt-4o-mini-tts"
        ],
        "fallbackModelIds": [],
        "verificationLevel": "verifiedDocumentationOnly",
        "source": {
          "authority": "studio-curated",
          "checkedAt": "2026-07-11",
          "urls": [
            "https://developers.openai.com/api/docs/models",
            "https://platform.openai.com/docs/pricing"
          ]
        },
        "pricing": {
          "kind": "audio",
          "status": "unknown",
          "currency": "USD",
          "billingUnit": "audio_minute",
          "price": null,
          "sourceUrls": [
            "https://developers.openai.com/api/docs/models",
            "https://platform.openai.com/docs/pricing"
          ],
          "verifiedAt": null,
          "notes": "Speech pricing must preserve provider units such as character, credit, minute, or generation."
        },
        "freeAccess": {
          "isFree": false,
          "isPromotional": false
        }
      }
    },
    {
      "id": "openai:text-embedding-3-small",
      "provider": "openai",
      "providerModelId": "text-embedding-3-small",
      "displayName": "Text Embedding 3 Small",
      "type": "embedding",
      "capabilities": {
        "modalities": [
          "embeddings"
        ]
      },
      "pricing": {
        "inputPerMillionUsd": 0.02,
        "outputPerMillionUsd": null,
        "source": "static",
        "note": "Verified from OpenAI embedding model pricing."
      },
      "inputTypes": [
        "text"
      ],
      "outputTypes": [
        "embedding"
      ],
      "registry": {
        "category": "embeddings",
        "status": "active",
        "developer": "OpenAI",
        "family": "text-embedding-3",
        "version": "text-embedding-3-small",
        "supportedRegions": [],
        "endpoints": [
          "embeddings"
        ],
        "aliases": [
          "text-embedding-3-small"
        ],
        "fallbackModelIds": [],
        "verificationLevel": "verifiedDocumentationOnly",
        "source": {
          "authority": "studio-curated",
          "checkedAt": "2026-07-11",
          "urls": [
            "https://developers.openai.com/api/docs/models",
            "https://platform.openai.com/docs/pricing"
          ]
        },
        "pricing": {
          "kind": "embedding",
          "status": "verified",
          "currency": "USD",
          "billingUnit": "one_million_tokens",
          "inputPerMillion": 0.02,
          "outputPerMillion": null,
          "sourceUrls": [
            "https://developers.openai.com/api/docs/models",
            "https://platform.openai.com/docs/pricing"
          ],
          "verifiedAt": "2026-07-11",
          "notes": "Verified from OpenAI embedding model pricing."
        },
        "freeAccess": {
          "isFree": false,
          "isPromotional": false
        }
      }
    },
    {
      "id": "openai:text-embedding-3-large",
      "provider": "openai",
      "providerModelId": "text-embedding-3-large",
      "displayName": "Text Embedding 3 Large",
      "type": "embedding",
      "capabilities": {
        "modalities": [
          "embeddings"
        ]
      },
      "pricing": {
        "inputPerMillionUsd": 0.13,
        "outputPerMillionUsd": null,
        "source": "static",
        "note": "Verified from OpenAI embedding model pricing."
      },
      "inputTypes": [
        "text"
      ],
      "outputTypes": [
        "embedding"
      ],
      "registry": {
        "category": "embeddings",
        "status": "active",
        "developer": "OpenAI",
        "family": "text-embedding-3",
        "version": "text-embedding-3-large",
        "supportedRegions": [],
        "endpoints": [
          "embeddings"
        ],
        "aliases": [
          "text-embedding-3-large"
        ],
        "fallbackModelIds": [],
        "verificationLevel": "verifiedDocumentationOnly",
        "source": {
          "authority": "studio-curated",
          "checkedAt": "2026-07-11",
          "urls": [
            "https://developers.openai.com/api/docs/models",
            "https://platform.openai.com/docs/pricing"
          ]
        },
        "pricing": {
          "kind": "embedding",
          "status": "verified",
          "currency": "USD",
          "billingUnit": "one_million_tokens",
          "inputPerMillion": 0.13,
          "outputPerMillion": null,
          "sourceUrls": [
            "https://developers.openai.com/api/docs/models",
            "https://platform.openai.com/docs/pricing"
          ],
          "verifiedAt": "2026-07-11",
          "notes": "Verified from OpenAI embedding model pricing."
        },
        "freeAccess": {
          "isFree": false,
          "isPromotional": false
        }
      }
    },
    {
      "id": "google:gemini-3.5-flash",
      "provider": "google",
      "providerModelId": "gemini-3.5-flash",
      "displayName": "Gemini 3.5 Flash",
      "type": "multimodal",
      "capabilities": {
        "modalities": [
          "chat"
        ],
        "chat": {
          "streaming": true,
          "vision": true,
          "tools": true,
          "reasoning": {
            "supported": true,
            "efforts": [
              "none",
              "minimal",
              "low",
              "medium",
              "high"
            ],
            "defaultEffort": "medium",
            "source": "official-docs",
            "confidence": "exact"
          },
          "jsonSchema": true,
          "promptCaching": false
        }
      },
      "pricing": {
        "inputPerMillionUsd": 1.5,
        "outputPerMillionUsd": 9,
        "source": "static",
        "note": "Verified from Gemini Developer API pricing. Output includes thinking tokens."
      },
      "contextWindow": 1048576,
      "maxTokens": 64000,
      "supportsVision": true,
      "supportsTools": true,
      "supportsStreaming": true,
      "supportsSystemPrompts": true,
      "inputTypes": [
        "text",
        "image",
        "audio",
        "video"
      ],
      "outputTypes": [
        "text"
      ],
      "specialFeatures": [
        "reasoning"
      ],
      "registry": {
        "category": "text.chat",
        "status": "active",
        "developer": "Google",
        "family": "gemini-3.5",
        "version": "gemini-3.5-flash",
        "supportedRegions": [],
        "endpoints": [
          "chat"
        ],
        "aliases": [
          "gemini-3.5-flash"
        ],
        "fallbackModelIds": [],
        "verificationLevel": "verifiedDocumentationOnly",
        "source": {
          "authority": "studio-curated",
          "checkedAt": "2026-07-11",
          "urls": [
            "https://ai.google.dev/gemini-api/docs/gemini-3",
            "https://ai.google.dev/gemini-api/docs/pricing"
          ]
        },
        "pricing": {
          "kind": "token",
          "status": "verified",
          "currency": "USD",
          "billingUnit": "one_million_tokens",
          "inputPerMillion": 1.5,
          "cachedInputPerMillion": 0.15,
          "cacheWritePerMillion": null,
          "outputPerMillion": 9,
          "batchInputPerMillion": null,
          "batchOutputPerMillion": null,
          "reasoningTokens": "unknown",
          "sourceUrls": [
            "https://ai.google.dev/gemini-api/docs/gemini-3",
            "https://ai.google.dev/gemini-api/docs/pricing"
          ],
          "verifiedAt": "2026-07-11",
          "notes": "Verified from Gemini Developer API pricing. Output includes thinking tokens."
        },
        "reasoning": {
          "supported": true,
          "alwaysOn": false,
          "canDisable": true,
          "effortValues": [
            "none",
            "minimal",
            "low",
            "medium",
            "high"
          ],
          "returnsReasoningContent": "unknown",
          "reasoningTokensVisible": "unknown",
          "reasoningTokensBillable": "unknown",
          "worksWithTools": "unknown",
          "worksWhileStreaming": "unknown",
          "requiresReasoningStateAfterTools": "unknown",
          "reducesOutputBudget": "unknown",
          "providerSpecificControls": [
            "thinkingConfig"
          ]
        },
        "freeAccess": {
          "isFree": false,
          "isPromotional": false
        }
      }
    },
    {
      "id": "google:gemini-3.1-pro-preview",
      "provider": "google",
      "providerModelId": "gemini-3.1-pro-preview",
      "displayName": "Gemini 3.1 Pro Preview",
      "type": "multimodal",
      "capabilities": {
        "modalities": [
          "chat"
        ],
        "chat": {
          "streaming": true,
          "vision": true,
          "tools": true,
          "reasoning": {
            "supported": true,
            "efforts": [
              "none",
              "minimal",
              "low",
              "medium",
              "high"
            ],
            "defaultEffort": "medium",
            "source": "official-docs",
            "confidence": "exact"
          },
          "jsonSchema": true,
          "promptCaching": false
        }
      },
      "pricing": {
        "inputPerMillionUsd": 2,
        "outputPerMillionUsd": 12,
        "source": "static",
        "note": "Verified from Gemini 3 developer guide. Listed base tier is under 200k tokens; long-context tiers are preserved separately."
      },
      "contextWindow": 1048576,
      "maxTokens": 64000,
      "supportsVision": true,
      "supportsTools": true,
      "supportsStreaming": true,
      "supportsSystemPrompts": true,
      "inputTypes": [
        "text",
        "image",
        "audio",
        "video"
      ],
      "outputTypes": [
        "text"
      ],
      "specialFeatures": [
        "reasoning"
      ],
      "registry": {
        "category": "text.chat",
        "status": "preview",
        "developer": "Google",
        "family": "gemini-3.1",
        "version": "gemini-3.1-pro-preview",
        "supportedRegions": [],
        "endpoints": [
          "chat"
        ],
        "aliases": [
          "gemini-3.1-pro-preview"
        ],
        "fallbackModelIds": [],
        "verificationLevel": "verifiedDocumentationOnly",
        "source": {
          "authority": "studio-curated",
          "checkedAt": "2026-07-11",
          "urls": [
            "https://ai.google.dev/gemini-api/docs/gemini-3",
            "https://ai.google.dev/gemini-api/docs/pricing"
          ]
        },
        "pricing": {
          "kind": "token",
          "status": "verified",
          "currency": "USD",
          "billingUnit": "one_million_tokens",
          "inputPerMillion": 2,
          "cachedInputPerMillion": 0.2,
          "cacheWritePerMillion": null,
          "outputPerMillion": 12,
          "batchInputPerMillion": null,
          "batchOutputPerMillion": null,
          "longContext": [
            {
              "name": "over_200k_tokens_input",
              "unit": "one_million_tokens",
              "price": 4,
              "currency": "USD",
              "appliesWhen": "input tokens > 200k"
            },
            {
              "name": "over_200k_tokens_output",
              "unit": "one_million_tokens",
              "price": 18,
              "currency": "USD",
              "appliesWhen": "input tokens > 200k"
            }
          ],
          "reasoningTokens": "unknown",
          "sourceUrls": [
            "https://ai.google.dev/gemini-api/docs/gemini-3",
            "https://ai.google.dev/gemini-api/docs/pricing"
          ],
          "verifiedAt": "2026-07-11",
          "notes": "Verified from Gemini 3 developer guide. Listed base tier is under 200k tokens; long-context tiers are preserved separately."
        },
        "reasoning": {
          "supported": true,
          "alwaysOn": false,
          "canDisable": true,
          "effortValues": [
            "none",
            "minimal",
            "low",
            "medium",
            "high"
          ],
          "returnsReasoningContent": "unknown",
          "reasoningTokensVisible": "unknown",
          "reasoningTokensBillable": "unknown",
          "worksWithTools": "unknown",
          "worksWhileStreaming": "unknown",
          "requiresReasoningStateAfterTools": "unknown",
          "reducesOutputBudget": "unknown",
          "providerSpecificControls": [
            "thinkingConfig"
          ]
        },
        "freeAccess": {
          "isFree": false,
          "isPromotional": false
        }
      }
    },
    {
      "id": "google:gemini-3.1-flash-lite",
      "provider": "google",
      "providerModelId": "gemini-3.1-flash-lite",
      "displayName": "Gemini 3.1 Flash-Lite",
      "type": "multimodal",
      "capabilities": {
        "modalities": [
          "chat"
        ],
        "chat": {
          "streaming": true,
          "vision": true,
          "tools": true,
          "reasoning": {
            "supported": true,
            "efforts": [
              "none",
              "minimal",
              "low",
              "medium",
              "high"
            ],
            "defaultEffort": "medium",
            "source": "official-docs",
            "confidence": "exact"
          },
          "jsonSchema": true,
          "promptCaching": false
        }
      },
      "pricing": {
        "inputPerMillionUsd": 0.25,
        "outputPerMillionUsd": 1.5,
        "source": "static",
        "note": "Verified from Gemini 3 developer guide. Audio input has a separate price not flattened into token text pricing."
      },
      "contextWindow": 1048576,
      "maxTokens": 64000,
      "supportsVision": true,
      "supportsTools": true,
      "supportsStreaming": true,
      "supportsSystemPrompts": true,
      "inputTypes": [
        "text",
        "image",
        "audio",
        "video"
      ],
      "outputTypes": [
        "text"
      ],
      "specialFeatures": [
        "reasoning"
      ],
      "registry": {
        "category": "text.chat",
        "status": "active",
        "developer": "Google",
        "family": "gemini-3.1",
        "version": "gemini-3.1-flash-lite",
        "supportedRegions": [],
        "endpoints": [
          "chat"
        ],
        "aliases": [
          "gemini-3.1-flash-lite"
        ],
        "fallbackModelIds": [],
        "verificationLevel": "verifiedDocumentationOnly",
        "source": {
          "authority": "studio-curated",
          "checkedAt": "2026-07-11",
          "urls": [
            "https://ai.google.dev/gemini-api/docs/gemini-3",
            "https://ai.google.dev/gemini-api/docs/pricing"
          ]
        },
        "pricing": {
          "kind": "token",
          "status": "verified",
          "currency": "USD",
          "billingUnit": "one_million_tokens",
          "inputPerMillion": 0.25,
          "cachedInputPerMillion": 0.025,
          "cacheWritePerMillion": null,
          "outputPerMillion": 1.5,
          "batchInputPerMillion": null,
          "batchOutputPerMillion": null,
          "reasoningTokens": "unknown",
          "sourceUrls": [
            "https://ai.google.dev/gemini-api/docs/gemini-3",
            "https://ai.google.dev/gemini-api/docs/pricing"
          ],
          "verifiedAt": "2026-07-11",
          "notes": "Verified from Gemini 3 developer guide. Audio input has a separate price not flattened into token text pricing."
        },
        "reasoning": {
          "supported": true,
          "alwaysOn": false,
          "canDisable": true,
          "effortValues": [
            "none",
            "minimal",
            "low",
            "medium",
            "high"
          ],
          "returnsReasoningContent": "unknown",
          "reasoningTokensVisible": "unknown",
          "reasoningTokensBillable": "unknown",
          "worksWithTools": "unknown",
          "worksWhileStreaming": "unknown",
          "requiresReasoningStateAfterTools": "unknown",
          "reducesOutputBudget": "unknown",
          "providerSpecificControls": [
            "thinkingConfig"
          ]
        },
        "freeAccess": {
          "isFree": false,
          "isPromotional": false
        }
      }
    },
    {
      "id": "google:gemini-2.5-flash",
      "provider": "google",
      "providerModelId": "gemini-2.5-flash",
      "displayName": "Gemini 2.5 Flash",
      "type": "multimodal",
      "capabilities": {
        "modalities": [
          "chat"
        ],
        "chat": {
          "streaming": true,
          "vision": true,
          "tools": true,
          "reasoning": {
            "supported": true,
            "efforts": [
              "none",
              "minimal",
              "low",
              "medium",
              "high"
            ],
            "defaultEffort": "medium",
            "source": "official-docs",
            "confidence": "exact"
          },
          "jsonSchema": true,
          "promptCaching": false
        }
      },
      "pricing": {
        "inputPerMillionUsd": 0.45,
        "outputPerMillionUsd": 2.7,
        "source": "static",
        "note": "Verified from Gemini Developer API pricing. Audio input has a separate price not flattened into token text pricing."
      },
      "contextWindow": 1048576,
      "maxTokens": 64000,
      "supportsVision": true,
      "supportsTools": true,
      "supportsStreaming": true,
      "supportsSystemPrompts": true,
      "inputTypes": [
        "text",
        "image",
        "audio",
        "video"
      ],
      "outputTypes": [
        "text"
      ],
      "specialFeatures": [
        "reasoning"
      ],
      "registry": {
        "category": "text.chat",
        "status": "active",
        "developer": "Google",
        "family": "gemini-2.5",
        "version": "gemini-2.5-flash",
        "supportedRegions": [],
        "endpoints": [
          "chat"
        ],
        "aliases": [
          "gemini-2.5-flash"
        ],
        "fallbackModelIds": [],
        "verificationLevel": "verifiedDocumentationOnly",
        "source": {
          "authority": "studio-curated",
          "checkedAt": "2026-07-11",
          "urls": [
            "https://ai.google.dev/gemini-api/docs/gemini-3",
            "https://ai.google.dev/gemini-api/docs/pricing"
          ]
        },
        "pricing": {
          "kind": "token",
          "status": "verified",
          "currency": "USD",
          "billingUnit": "one_million_tokens",
          "inputPerMillion": 0.45,
          "cachedInputPerMillion": 0.045,
          "cacheWritePerMillion": null,
          "outputPerMillion": 2.7,
          "batchInputPerMillion": null,
          "batchOutputPerMillion": null,
          "reasoningTokens": "unknown",
          "sourceUrls": [
            "https://ai.google.dev/gemini-api/docs/gemini-3",
            "https://ai.google.dev/gemini-api/docs/pricing"
          ],
          "verifiedAt": "2026-07-11",
          "notes": "Verified from Gemini Developer API pricing. Audio input has a separate price not flattened into token text pricing."
        },
        "reasoning": {
          "supported": true,
          "alwaysOn": false,
          "canDisable": true,
          "effortValues": [
            "none",
            "minimal",
            "low",
            "medium",
            "high"
          ],
          "returnsReasoningContent": "unknown",
          "reasoningTokensVisible": "unknown",
          "reasoningTokensBillable": "unknown",
          "worksWithTools": "unknown",
          "worksWhileStreaming": "unknown",
          "requiresReasoningStateAfterTools": "unknown",
          "reducesOutputBudget": "unknown",
          "providerSpecificControls": [
            "thinkingConfig"
          ]
        },
        "freeAccess": {
          "isFree": false,
          "isPromotional": false
        }
      }
    },
    {
      "id": "google:gemini-2.5-flash-lite",
      "provider": "google",
      "providerModelId": "gemini-2.5-flash-lite",
      "displayName": "Gemini 2.5 Flash-Lite",
      "type": "multimodal",
      "capabilities": {
        "modalities": [
          "chat"
        ],
        "chat": {
          "streaming": true,
          "vision": true,
          "tools": true,
          "reasoning": {
            "supported": true,
            "efforts": [
              "none",
              "minimal",
              "low",
              "medium",
              "high"
            ],
            "defaultEffort": "medium",
            "source": "official-docs",
            "confidence": "exact"
          },
          "jsonSchema": true,
          "promptCaching": false
        }
      },
      "pricing": {
        "inputPerMillionUsd": 0.1,
        "outputPerMillionUsd": 0.4,
        "source": "static",
        "note": "Verified from Gemini Developer API pricing. Audio input has a separate price not flattened into token text pricing."
      },
      "contextWindow": 1048576,
      "maxTokens": 64000,
      "supportsVision": true,
      "supportsTools": true,
      "supportsStreaming": true,
      "supportsSystemPrompts": true,
      "inputTypes": [
        "text",
        "image",
        "audio",
        "video"
      ],
      "outputTypes": [
        "text"
      ],
      "specialFeatures": [
        "reasoning"
      ],
      "registry": {
        "category": "text.chat",
        "status": "active",
        "developer": "Google",
        "family": "gemini-2.5",
        "version": "gemini-2.5-flash-lite",
        "supportedRegions": [],
        "endpoints": [
          "chat"
        ],
        "aliases": [
          "gemini-2.5-flash-lite"
        ],
        "fallbackModelIds": [],
        "verificationLevel": "verifiedDocumentationOnly",
        "source": {
          "authority": "studio-curated",
          "checkedAt": "2026-07-11",
          "urls": [
            "https://ai.google.dev/gemini-api/docs/gemini-3",
            "https://ai.google.dev/gemini-api/docs/pricing"
          ]
        },
        "pricing": {
          "kind": "token",
          "status": "verified",
          "currency": "USD",
          "billingUnit": "one_million_tokens",
          "inputPerMillion": 0.1,
          "cachedInputPerMillion": 0.01,
          "cacheWritePerMillion": null,
          "outputPerMillion": 0.4,
          "batchInputPerMillion": null,
          "batchOutputPerMillion": null,
          "reasoningTokens": "unknown",
          "sourceUrls": [
            "https://ai.google.dev/gemini-api/docs/gemini-3",
            "https://ai.google.dev/gemini-api/docs/pricing"
          ],
          "verifiedAt": "2026-07-11",
          "notes": "Verified from Gemini Developer API pricing. Audio input has a separate price not flattened into token text pricing."
        },
        "reasoning": {
          "supported": true,
          "alwaysOn": false,
          "canDisable": true,
          "effortValues": [
            "none",
            "minimal",
            "low",
            "medium",
            "high"
          ],
          "returnsReasoningContent": "unknown",
          "reasoningTokensVisible": "unknown",
          "reasoningTokensBillable": "unknown",
          "worksWithTools": "unknown",
          "worksWhileStreaming": "unknown",
          "requiresReasoningStateAfterTools": "unknown",
          "reducesOutputBudget": "unknown",
          "providerSpecificControls": [
            "thinkingConfig"
          ]
        },
        "freeAccess": {
          "isFree": false,
          "isPromotional": false
        }
      }
    },
    {
      "id": "anthropic:claude-haiku-4-5",
      "provider": "anthropic",
      "providerModelId": "claude-haiku-4-5",
      "displayName": "Claude Haiku 4.5",
      "type": "multimodal",
      "capabilities": {
        "modalities": [
          "chat"
        ],
        "chat": {
          "streaming": true,
          "vision": true,
          "tools": true,
          "reasoning": {
            "supported": true,
            "efforts": [
              "none",
              "low",
              "medium",
              "high"
            ],
            "defaultEffort": "medium",
            "source": "official-docs",
            "confidence": "exact"
          },
          "jsonSchema": false,
          "promptCaching": true
        }
      },
      "pricing": {
        "inputPerMillionUsd": 1,
        "outputPerMillionUsd": 5,
        "source": "static",
        "note": "Verified from Anthropic Claude pricing."
      },
      "contextWindow": 200000,
      "maxTokens": 64000,
      "supportsVision": true,
      "supportsTools": true,
      "supportsStreaming": true,
      "supportsSystemPrompts": true,
      "inputTypes": [
        "text",
        "image"
      ],
      "outputTypes": [
        "text"
      ],
      "specialFeatures": [
        "reasoning"
      ],
      "registry": {
        "category": "text.chat",
        "status": "active",
        "developer": "Anthropic",
        "family": "claude-haiku",
        "version": "claude-haiku-4-5",
        "supportedRegions": [],
        "endpoints": [
          "chat"
        ],
        "aliases": [
          "claude-haiku-4-5"
        ],
        "fallbackModelIds": [],
        "verificationLevel": "verifiedDocumentationOnly",
        "source": {
          "authority": "studio-curated",
          "checkedAt": "2026-07-11",
          "urls": [
            "https://platform.claude.com/docs/en/about-claude/models/overview",
            "https://platform.claude.com/docs/en/about-claude/pricing"
          ]
        },
        "pricing": {
          "kind": "token",
          "status": "verified",
          "currency": "USD",
          "billingUnit": "one_million_tokens",
          "inputPerMillion": 1,
          "cachedInputPerMillion": 0.1,
          "cacheWritePerMillion": 1.25,
          "outputPerMillion": 5,
          "batchInputPerMillion": null,
          "batchOutputPerMillion": null,
          "reasoningTokens": "unknown",
          "sourceUrls": [
            "https://platform.claude.com/docs/en/about-claude/models/overview",
            "https://platform.claude.com/docs/en/about-claude/pricing"
          ],
          "verifiedAt": "2026-07-11",
          "notes": "Verified from Anthropic Claude pricing."
        },
        "reasoning": {
          "supported": true,
          "alwaysOn": false,
          "canDisable": true,
          "effortValues": [
            "none",
            "low",
            "medium",
            "high"
          ],
          "returnsReasoningContent": "unknown",
          "reasoningTokensVisible": "unknown",
          "reasoningTokensBillable": "unknown",
          "worksWithTools": "unknown",
          "worksWhileStreaming": "unknown",
          "requiresReasoningStateAfterTools": "unknown",
          "reducesOutputBudget": "unknown",
          "providerSpecificControls": [
            "thinking"
          ]
        },
        "freeAccess": {
          "isFree": false,
          "isPromotional": false
        }
      }
    },
    {
      "id": "anthropic:claude-sonnet-4-6",
      "provider": "anthropic",
      "providerModelId": "claude-sonnet-4-6",
      "displayName": "Claude Sonnet 4.6",
      "type": "multimodal",
      "capabilities": {
        "modalities": [
          "chat"
        ],
        "chat": {
          "streaming": true,
          "vision": true,
          "tools": true,
          "reasoning": {
            "supported": true,
            "efforts": [
              "none",
              "low",
              "medium",
              "high",
              "xhigh"
            ],
            "defaultEffort": "medium",
            "source": "official-docs",
            "confidence": "exact"
          },
          "jsonSchema": false,
          "promptCaching": true
        }
      },
      "pricing": {
        "inputPerMillionUsd": 3,
        "outputPerMillionUsd": 15,
        "source": "static",
        "note": "Verified from Anthropic Claude pricing."
      },
      "contextWindow": 1000000,
      "maxTokens": 128000,
      "supportsVision": true,
      "supportsTools": true,
      "supportsStreaming": true,
      "supportsSystemPrompts": true,
      "inputTypes": [
        "text",
        "image"
      ],
      "outputTypes": [
        "text"
      ],
      "specialFeatures": [
        "reasoning"
      ],
      "registry": {
        "category": "text.chat",
        "status": "active",
        "developer": "Anthropic",
        "family": "claude-sonnet",
        "version": "claude-sonnet-4-6",
        "supportedRegions": [],
        "endpoints": [
          "chat"
        ],
        "aliases": [
          "claude-sonnet-4-6"
        ],
        "fallbackModelIds": [],
        "verificationLevel": "verifiedDocumentationOnly",
        "source": {
          "authority": "studio-curated",
          "checkedAt": "2026-07-11",
          "urls": [
            "https://platform.claude.com/docs/en/about-claude/models/overview",
            "https://platform.claude.com/docs/en/about-claude/pricing"
          ]
        },
        "pricing": {
          "kind": "token",
          "status": "verified",
          "currency": "USD",
          "billingUnit": "one_million_tokens",
          "inputPerMillion": 3,
          "cachedInputPerMillion": 0.3,
          "cacheWritePerMillion": 3.75,
          "outputPerMillion": 15,
          "batchInputPerMillion": null,
          "batchOutputPerMillion": null,
          "reasoningTokens": "unknown",
          "sourceUrls": [
            "https://platform.claude.com/docs/en/about-claude/models/overview",
            "https://platform.claude.com/docs/en/about-claude/pricing"
          ],
          "verifiedAt": "2026-07-11",
          "notes": "Verified from Anthropic Claude pricing."
        },
        "reasoning": {
          "supported": true,
          "alwaysOn": false,
          "canDisable": true,
          "effortValues": [
            "none",
            "low",
            "medium",
            "high",
            "xhigh"
          ],
          "returnsReasoningContent": "unknown",
          "reasoningTokensVisible": "unknown",
          "reasoningTokensBillable": "unknown",
          "worksWithTools": "unknown",
          "worksWhileStreaming": "unknown",
          "requiresReasoningStateAfterTools": "unknown",
          "reducesOutputBudget": "unknown",
          "providerSpecificControls": [
            "thinking"
          ]
        },
        "freeAccess": {
          "isFree": false,
          "isPromotional": false
        }
      }
    },
    {
      "id": "anthropic:claude-sonnet-5",
      "provider": "anthropic",
      "providerModelId": "claude-sonnet-5",
      "displayName": "Claude Sonnet 5",
      "type": "multimodal",
      "capabilities": {
        "modalities": [
          "chat"
        ],
        "chat": {
          "streaming": true,
          "vision": true,
          "tools": true,
          "reasoning": {
            "supported": true,
            "efforts": [
              "none",
              "low",
              "medium",
              "high",
              "xhigh"
            ],
            "defaultEffort": "medium",
            "source": "official-docs",
            "confidence": "exact"
          },
          "jsonSchema": false,
          "promptCaching": true
        }
      },
      "pricing": {
        "inputPerMillionUsd": 2,
        "outputPerMillionUsd": 10,
        "source": "static",
        "note": "Verified from Anthropic pricing. Current introductory pricing applies through 2026-08-31; standard pricing is preserved as dated tiers."
      },
      "contextWindow": 1000000,
      "maxTokens": 128000,
      "supportsVision": true,
      "supportsTools": true,
      "supportsStreaming": true,
      "supportsSystemPrompts": true,
      "inputTypes": [
        "text",
        "image"
      ],
      "outputTypes": [
        "text"
      ],
      "specialFeatures": [
        "reasoning"
      ],
      "registry": {
        "category": "text.chat",
        "status": "active",
        "developer": "Anthropic",
        "family": "claude-sonnet",
        "version": "claude-sonnet-5",
        "supportedRegions": [],
        "endpoints": [
          "chat"
        ],
        "aliases": [
          "claude-sonnet-5"
        ],
        "fallbackModelIds": [],
        "verificationLevel": "verifiedDocumentationOnly",
        "source": {
          "authority": "studio-curated",
          "checkedAt": "2026-07-11",
          "urls": [
            "https://platform.claude.com/docs/en/about-claude/models/overview",
            "https://platform.claude.com/docs/en/about-claude/pricing"
          ]
        },
        "pricing": {
          "kind": "token",
          "status": "verified",
          "currency": "USD",
          "billingUnit": "one_million_tokens",
          "inputPerMillion": 2,
          "cachedInputPerMillion": 0.2,
          "cacheWritePerMillion": 2.5,
          "outputPerMillion": 10,
          "batchInputPerMillion": null,
          "batchOutputPerMillion": null,
          "longContext": [
            {
              "name": "standard_after_2026_08_31_input",
              "unit": "one_million_tokens",
              "price": 3,
              "currency": "USD",
              "appliesWhen": "starting 2026-09-01"
            },
            {
              "name": "standard_after_2026_08_31_cache_write_5m",
              "unit": "one_million_tokens",
              "price": 3.75,
              "currency": "USD",
              "appliesWhen": "starting 2026-09-01"
            },
            {
              "name": "standard_after_2026_08_31_cache_read",
              "unit": "one_million_tokens",
              "price": 0.3,
              "currency": "USD",
              "appliesWhen": "starting 2026-09-01"
            },
            {
              "name": "standard_after_2026_08_31_output",
              "unit": "one_million_tokens",
              "price": 15,
              "currency": "USD",
              "appliesWhen": "starting 2026-09-01"
            }
          ],
          "reasoningTokens": "unknown",
          "sourceUrls": [
            "https://platform.claude.com/docs/en/about-claude/models/overview",
            "https://platform.claude.com/docs/en/about-claude/pricing"
          ],
          "verifiedAt": "2026-07-11",
          "notes": "Verified from Anthropic pricing. Current introductory pricing applies through 2026-08-31; standard pricing is preserved as dated tiers."
        },
        "reasoning": {
          "supported": true,
          "alwaysOn": false,
          "canDisable": true,
          "effortValues": [
            "none",
            "low",
            "medium",
            "high",
            "xhigh"
          ],
          "returnsReasoningContent": "unknown",
          "reasoningTokensVisible": "unknown",
          "reasoningTokensBillable": "unknown",
          "worksWithTools": "unknown",
          "worksWhileStreaming": "unknown",
          "requiresReasoningStateAfterTools": "unknown",
          "reducesOutputBudget": "unknown",
          "providerSpecificControls": [
            "thinking"
          ]
        },
        "freeAccess": {
          "isFree": false,
          "isPromotional": false
        }
      }
    },
    {
      "id": "anthropic:claude-opus-4-8",
      "provider": "anthropic",
      "providerModelId": "claude-opus-4-8",
      "displayName": "Claude Opus 4.8",
      "type": "multimodal",
      "capabilities": {
        "modalities": [
          "chat"
        ],
        "chat": {
          "streaming": true,
          "vision": true,
          "tools": true,
          "reasoning": {
            "supported": true,
            "efforts": [
              "none",
              "low",
              "medium",
              "high",
              "xhigh"
            ],
            "defaultEffort": "medium",
            "source": "official-docs",
            "confidence": "exact"
          },
          "jsonSchema": false,
          "promptCaching": true
        }
      },
      "pricing": {
        "inputPerMillionUsd": 5,
        "outputPerMillionUsd": 25,
        "source": "static",
        "note": "Verified from Anthropic Claude pricing."
      },
      "contextWindow": 1000000,
      "maxTokens": 128000,
      "supportsVision": true,
      "supportsTools": true,
      "supportsStreaming": true,
      "supportsSystemPrompts": true,
      "inputTypes": [
        "text",
        "image"
      ],
      "outputTypes": [
        "text"
      ],
      "specialFeatures": [
        "reasoning"
      ],
      "registry": {
        "category": "text.chat",
        "status": "active",
        "developer": "Anthropic",
        "family": "claude-opus",
        "version": "claude-opus-4-8",
        "supportedRegions": [],
        "endpoints": [
          "chat"
        ],
        "aliases": [
          "claude-opus-4-8"
        ],
        "fallbackModelIds": [],
        "verificationLevel": "verifiedDocumentationOnly",
        "source": {
          "authority": "studio-curated",
          "checkedAt": "2026-07-11",
          "urls": [
            "https://platform.claude.com/docs/en/about-claude/models/overview",
            "https://platform.claude.com/docs/en/about-claude/pricing"
          ]
        },
        "pricing": {
          "kind": "token",
          "status": "verified",
          "currency": "USD",
          "billingUnit": "one_million_tokens",
          "inputPerMillion": 5,
          "cachedInputPerMillion": 0.5,
          "cacheWritePerMillion": 6.25,
          "outputPerMillion": 25,
          "batchInputPerMillion": null,
          "batchOutputPerMillion": null,
          "reasoningTokens": "unknown",
          "sourceUrls": [
            "https://platform.claude.com/docs/en/about-claude/models/overview",
            "https://platform.claude.com/docs/en/about-claude/pricing"
          ],
          "verifiedAt": "2026-07-11",
          "notes": "Verified from Anthropic Claude pricing."
        },
        "reasoning": {
          "supported": true,
          "alwaysOn": false,
          "canDisable": true,
          "effortValues": [
            "none",
            "low",
            "medium",
            "high",
            "xhigh"
          ],
          "returnsReasoningContent": "unknown",
          "reasoningTokensVisible": "unknown",
          "reasoningTokensBillable": "unknown",
          "worksWithTools": "unknown",
          "worksWhileStreaming": "unknown",
          "requiresReasoningStateAfterTools": "unknown",
          "reducesOutputBudget": "unknown",
          "providerSpecificControls": [
            "thinking"
          ]
        },
        "freeAccess": {
          "isFree": false,
          "isPromotional": false
        }
      }
    },
    {
      "id": "anthropic:claude-fable-5",
      "provider": "anthropic",
      "providerModelId": "claude-fable-5",
      "displayName": "Claude Fable 5",
      "type": "multimodal",
      "capabilities": {
        "modalities": [
          "chat"
        ],
        "chat": {
          "streaming": true,
          "vision": true,
          "tools": true,
          "reasoning": {
            "supported": true,
            "efforts": [
              "none",
              "low",
              "medium",
              "high",
              "xhigh"
            ],
            "defaultEffort": "medium",
            "source": "official-docs",
            "confidence": "exact"
          },
          "jsonSchema": false,
          "promptCaching": true
        }
      },
      "pricing": {
        "inputPerMillionUsd": 10,
        "outputPerMillionUsd": 50,
        "source": "static",
        "note": "Verified from Anthropic Claude pricing."
      },
      "contextWindow": 1000000,
      "maxTokens": 128000,
      "supportsVision": true,
      "supportsTools": true,
      "supportsStreaming": true,
      "supportsSystemPrompts": true,
      "inputTypes": [
        "text",
        "image"
      ],
      "outputTypes": [
        "text"
      ],
      "specialFeatures": [
        "reasoning"
      ],
      "registry": {
        "category": "text.chat",
        "status": "active",
        "developer": "Anthropic",
        "family": "claude-fable",
        "version": "claude-fable-5",
        "supportedRegions": [],
        "endpoints": [
          "chat"
        ],
        "aliases": [
          "claude-fable-5"
        ],
        "fallbackModelIds": [],
        "verificationLevel": "verifiedDocumentationOnly",
        "source": {
          "authority": "studio-curated",
          "checkedAt": "2026-07-11",
          "urls": [
            "https://platform.claude.com/docs/en/about-claude/models/overview",
            "https://platform.claude.com/docs/en/about-claude/pricing"
          ]
        },
        "pricing": {
          "kind": "token",
          "status": "verified",
          "currency": "USD",
          "billingUnit": "one_million_tokens",
          "inputPerMillion": 10,
          "cachedInputPerMillion": 1,
          "cacheWritePerMillion": 12.5,
          "outputPerMillion": 50,
          "batchInputPerMillion": null,
          "batchOutputPerMillion": null,
          "reasoningTokens": "unknown",
          "sourceUrls": [
            "https://platform.claude.com/docs/en/about-claude/models/overview",
            "https://platform.claude.com/docs/en/about-claude/pricing"
          ],
          "verifiedAt": "2026-07-11",
          "notes": "Verified from Anthropic Claude pricing."
        },
        "reasoning": {
          "supported": true,
          "alwaysOn": false,
          "canDisable": true,
          "effortValues": [
            "none",
            "low",
            "medium",
            "high",
            "xhigh"
          ],
          "returnsReasoningContent": "unknown",
          "reasoningTokensVisible": "unknown",
          "reasoningTokensBillable": "unknown",
          "worksWithTools": "unknown",
          "worksWhileStreaming": "unknown",
          "requiresReasoningStateAfterTools": "unknown",
          "reducesOutputBudget": "unknown",
          "providerSpecificControls": [
            "thinking"
          ]
        },
        "freeAccess": {
          "isFree": false,
          "isPromotional": false
        }
      }
    },
    {
      "id": "xai:grok-4.5",
      "provider": "xai",
      "providerModelId": "grok-4.5",
      "displayName": "Grok 4.5",
      "type": "multimodal",
      "capabilities": {
        "modalities": [
          "chat"
        ],
        "chat": {
          "streaming": true,
          "vision": true,
          "tools": true,
          "reasoning": {
            "supported": true,
            "efforts": [
              "none",
              "low",
              "medium",
              "high"
            ],
            "defaultEffort": "medium",
            "source": "official-docs",
            "confidence": "exact"
          },
          "jsonSchema": true,
          "promptCaching": true
        }
      },
      "pricing": {
        "inputPerMillionUsd": 2,
        "outputPerMillionUsd": 6,
        "source": "static",
        "note": "Verified from xAI Grok 4.5 API model docs."
      },
      "contextWindow": 500000,
      "maxTokens": 128000,
      "supportsVision": true,
      "supportsTools": true,
      "supportsStreaming": true,
      "supportsSystemPrompts": true,
      "inputTypes": [
        "text",
        "image"
      ],
      "outputTypes": [
        "text"
      ],
      "specialFeatures": [
        "reasoning"
      ],
      "registry": {
        "category": "text.chat",
        "status": "active",
        "developer": "xAI",
        "family": "grok-4",
        "version": "grok-4.5",
        "supportedRegions": [],
        "endpoints": [
          "chat"
        ],
        "aliases": [
          "grok-4.5"
        ],
        "fallbackModelIds": [],
        "verificationLevel": "verifiedDocumentationOnly",
        "source": {
          "authority": "studio-curated",
          "checkedAt": "2026-07-11",
          "urls": [
            "https://docs.x.ai/developers/models",
            "https://docs.x.ai/developers/pricing"
          ]
        },
        "pricing": {
          "kind": "token",
          "status": "verified",
          "currency": "USD",
          "billingUnit": "one_million_tokens",
          "inputPerMillion": 2,
          "cachedInputPerMillion": 0.5,
          "cacheWritePerMillion": null,
          "outputPerMillion": 6,
          "batchInputPerMillion": null,
          "batchOutputPerMillion": null,
          "reasoningTokens": "unknown",
          "sourceUrls": [
            "https://docs.x.ai/developers/models",
            "https://docs.x.ai/developers/pricing"
          ],
          "verifiedAt": "2026-07-11",
          "notes": "Verified from xAI Grok 4.5 API model docs."
        },
        "reasoning": {
          "supported": true,
          "alwaysOn": false,
          "canDisable": true,
          "effortValues": [
            "none",
            "low",
            "medium",
            "high"
          ],
          "returnsReasoningContent": "unknown",
          "reasoningTokensVisible": "unknown",
          "reasoningTokensBillable": "unknown",
          "worksWithTools": "unknown",
          "worksWhileStreaming": "unknown",
          "requiresReasoningStateAfterTools": "unknown",
          "reducesOutputBudget": "unknown",
          "providerSpecificControls": [
            "reasoning_effort"
          ]
        },
        "freeAccess": {
          "isFree": false,
          "isPromotional": false
        }
      }
    },
    {
      "id": "xai:grok-4.3",
      "provider": "xai",
      "providerModelId": "grok-4.3",
      "displayName": "Grok 4.3",
      "type": "multimodal",
      "capabilities": {
        "modalities": [
          "chat"
        ],
        "chat": {
          "streaming": true,
          "vision": true,
          "tools": true,
          "reasoning": {
            "supported": true,
            "efforts": [
              "none",
              "low",
              "medium",
              "high"
            ],
            "defaultEffort": "medium",
            "source": "official-docs",
            "confidence": "exact"
          },
          "jsonSchema": true,
          "promptCaching": true
        }
      },
      "pricing": {
        "inputPerMillionUsd": null,
        "outputPerMillionUsd": null,
        "source": "unknown",
        "note": "N/A until this exact provider route is verified from official pricing or tested billing data."
      },
      "contextWindow": 1000000,
      "maxTokens": 128000,
      "supportsVision": true,
      "supportsTools": true,
      "supportsStreaming": true,
      "supportsSystemPrompts": true,
      "inputTypes": [
        "text",
        "image"
      ],
      "outputTypes": [
        "text"
      ],
      "specialFeatures": [
        "reasoning"
      ],
      "registry": {
        "category": "text.chat",
        "status": "active",
        "developer": "xAI",
        "family": "grok-4",
        "version": "grok-4.3",
        "supportedRegions": [],
        "endpoints": [
          "chat"
        ],
        "aliases": [
          "grok-4.3"
        ],
        "fallbackModelIds": [],
        "verificationLevel": "verifiedDocumentationOnly",
        "source": {
          "authority": "studio-curated",
          "checkedAt": "2026-07-11",
          "urls": [
            "https://docs.x.ai/developers/models",
            "https://docs.x.ai/developers/pricing"
          ]
        },
        "pricing": {
          "kind": "token",
          "status": "unknown",
          "currency": "USD",
          "billingUnit": "one_million_tokens",
          "inputPerMillion": null,
          "cachedInputPerMillion": null,
          "cacheWritePerMillion": null,
          "outputPerMillion": null,
          "batchInputPerMillion": null,
          "batchOutputPerMillion": null,
          "reasoningTokens": "unknown",
          "sourceUrls": [
            "https://docs.x.ai/developers/models",
            "https://docs.x.ai/developers/pricing"
          ],
          "verifiedAt": null,
          "notes": "N/A until this exact provider route is verified from official pricing or tested billing data."
        },
        "reasoning": {
          "supported": true,
          "alwaysOn": false,
          "canDisable": true,
          "effortValues": [
            "none",
            "low",
            "medium",
            "high"
          ],
          "returnsReasoningContent": "unknown",
          "reasoningTokensVisible": "unknown",
          "reasoningTokensBillable": "unknown",
          "worksWithTools": "unknown",
          "worksWhileStreaming": "unknown",
          "requiresReasoningStateAfterTools": "unknown",
          "reducesOutputBudget": "unknown",
          "providerSpecificControls": [
            "reasoning_effort"
          ]
        },
        "freeAccess": {
          "isFree": false,
          "isPromotional": false
        }
      }
    },
    {
      "id": "deepseek:deepseek-v4-pro",
      "provider": "deepseek",
      "providerModelId": "deepseek-v4-pro",
      "displayName": "DeepSeek V4 Pro",
      "type": "chat",
      "capabilities": {
        "modalities": [
          "chat"
        ],
        "chat": {
          "streaming": true,
          "vision": false,
          "tools": true,
          "reasoning": {
            "supported": true,
            "efforts": [
              "none",
              "low",
              "medium",
              "high",
              "xhigh"
            ],
            "defaultEffort": "medium",
            "source": "official-docs",
            "confidence": "exact"
          },
          "jsonSchema": true,
          "promptCaching": true
        }
      },
      "pricing": {
        "inputPerMillionUsd": 0.435,
        "outputPerMillionUsd": 0.87,
        "source": "static",
        "note": "Verified from DeepSeek Models & Pricing. inputPerMillion is cache-miss input; cachedInputPerMillion is cache-hit input."
      },
      "contextWindow": 1048576,
      "maxTokens": 384000,
      "supportsVision": false,
      "supportsTools": true,
      "supportsStreaming": true,
      "supportsSystemPrompts": true,
      "inputTypes": [
        "text"
      ],
      "outputTypes": [
        "text"
      ],
      "specialFeatures": [
        "reasoning"
      ],
      "registry": {
        "category": "text.chat",
        "status": "active",
        "developer": "DeepSeek",
        "family": "deepseek-v4",
        "version": "deepseek-v4-pro",
        "supportedRegions": [],
        "endpoints": [
          "chat"
        ],
        "aliases": [
          "deepseek-v4-pro"
        ],
        "fallbackModelIds": [],
        "verificationLevel": "verifiedDocumentationOnly",
        "source": {
          "authority": "studio-curated",
          "checkedAt": "2026-07-11",
          "urls": [
            "https://api-docs.deepseek.com/quick_start/pricing/"
          ]
        },
        "pricing": {
          "kind": "token",
          "status": "verified",
          "currency": "USD",
          "billingUnit": "one_million_tokens",
          "inputPerMillion": 0.435,
          "cachedInputPerMillion": 0.003625,
          "cacheWritePerMillion": null,
          "outputPerMillion": 0.87,
          "batchInputPerMillion": null,
          "batchOutputPerMillion": null,
          "reasoningTokens": "unknown",
          "sourceUrls": [
            "https://api-docs.deepseek.com/quick_start/pricing/"
          ],
          "verifiedAt": "2026-07-11",
          "notes": "Verified from DeepSeek Models & Pricing. inputPerMillion is cache-miss input; cachedInputPerMillion is cache-hit input."
        },
        "reasoning": {
          "supported": true,
          "alwaysOn": false,
          "canDisable": true,
          "effortValues": [
            "none",
            "low",
            "medium",
            "high",
            "xhigh"
          ],
          "returnsReasoningContent": "unknown",
          "reasoningTokensVisible": "unknown",
          "reasoningTokensBillable": "unknown",
          "worksWithTools": "unknown",
          "worksWhileStreaming": "unknown",
          "requiresReasoningStateAfterTools": "unknown",
          "reducesOutputBudget": "unknown",
          "providerSpecificControls": [
            "reasoning_effort"
          ]
        },
        "freeAccess": {
          "isFree": false,
          "isPromotional": false
        }
      }
    },
    {
      "id": "deepseek:deepseek-v4-flash",
      "provider": "deepseek",
      "providerModelId": "deepseek-v4-flash",
      "displayName": "DeepSeek V4 Flash",
      "type": "chat",
      "capabilities": {
        "modalities": [
          "chat"
        ],
        "chat": {
          "streaming": true,
          "vision": false,
          "tools": true,
          "reasoning": {
            "supported": true,
            "efforts": [
              "none",
              "low",
              "medium",
              "high",
              "xhigh"
            ],
            "defaultEffort": "medium",
            "source": "official-docs",
            "confidence": "exact"
          },
          "jsonSchema": true,
          "promptCaching": true
        }
      },
      "pricing": {
        "inputPerMillionUsd": 0.14,
        "outputPerMillionUsd": 0.28,
        "source": "static",
        "note": "Verified from DeepSeek Models & Pricing. inputPerMillion is cache-miss input; cachedInputPerMillion is cache-hit input."
      },
      "contextWindow": 1048576,
      "maxTokens": 384000,
      "supportsVision": false,
      "supportsTools": true,
      "supportsStreaming": true,
      "supportsSystemPrompts": true,
      "inputTypes": [
        "text"
      ],
      "outputTypes": [
        "text"
      ],
      "specialFeatures": [
        "reasoning"
      ],
      "registry": {
        "category": "text.chat",
        "status": "active",
        "developer": "DeepSeek",
        "family": "deepseek-v4",
        "version": "deepseek-v4-flash",
        "supportedRegions": [],
        "endpoints": [
          "chat"
        ],
        "aliases": [
          "deepseek-v4-flash"
        ],
        "fallbackModelIds": [],
        "verificationLevel": "verifiedDocumentationOnly",
        "source": {
          "authority": "studio-curated",
          "checkedAt": "2026-07-11",
          "urls": [
            "https://api-docs.deepseek.com/quick_start/pricing/"
          ]
        },
        "pricing": {
          "kind": "token",
          "status": "verified",
          "currency": "USD",
          "billingUnit": "one_million_tokens",
          "inputPerMillion": 0.14,
          "cachedInputPerMillion": 0.0028,
          "cacheWritePerMillion": null,
          "outputPerMillion": 0.28,
          "batchInputPerMillion": null,
          "batchOutputPerMillion": null,
          "reasoningTokens": "unknown",
          "sourceUrls": [
            "https://api-docs.deepseek.com/quick_start/pricing/"
          ],
          "verifiedAt": "2026-07-11",
          "notes": "Verified from DeepSeek Models & Pricing. inputPerMillion is cache-miss input; cachedInputPerMillion is cache-hit input."
        },
        "reasoning": {
          "supported": true,
          "alwaysOn": false,
          "canDisable": true,
          "effortValues": [
            "none",
            "low",
            "medium",
            "high",
            "xhigh"
          ],
          "returnsReasoningContent": "unknown",
          "reasoningTokensVisible": "unknown",
          "reasoningTokensBillable": "unknown",
          "worksWithTools": "unknown",
          "worksWhileStreaming": "unknown",
          "requiresReasoningStateAfterTools": "unknown",
          "reducesOutputBudget": "unknown",
          "providerSpecificControls": [
            "reasoning_effort"
          ]
        },
        "freeAccess": {
          "isFree": false,
          "isPromotional": false
        }
      }
    },
    {
      "id": "mistral:mistral-medium-3.5",
      "provider": "mistral",
      "providerModelId": "mistral-medium-3.5",
      "displayName": "Mistral Medium 3.5",
      "type": "multimodal",
      "capabilities": {
        "modalities": [
          "chat"
        ],
        "chat": {
          "streaming": true,
          "vision": true,
          "tools": true,
          "reasoning": {
            "supported": false,
            "efforts": [],
            "source": "unknown",
            "confidence": "unknown"
          },
          "jsonSchema": true,
          "promptCaching": false
        }
      },
      "pricing": {
        "inputPerMillionUsd": null,
        "outputPerMillionUsd": null,
        "source": "unknown",
        "note": "N/A until this exact provider route is verified from official pricing or tested billing data."
      },
      "contextWindow": 262144,
      "maxTokens": 64000,
      "supportsVision": true,
      "supportsTools": true,
      "supportsStreaming": true,
      "supportsSystemPrompts": true,
      "inputTypes": [
        "text",
        "image"
      ],
      "outputTypes": [
        "text"
      ],
      "registry": {
        "category": "text.chat",
        "status": "active",
        "developer": "Mistral AI",
        "family": "mistral-medium",
        "version": "mistral-medium-3.5",
        "supportedRegions": [],
        "endpoints": [
          "chat"
        ],
        "aliases": [
          "mistral-medium-3.5"
        ],
        "fallbackModelIds": [],
        "verificationLevel": "verifiedDocumentationOnly",
        "source": {
          "authority": "studio-curated",
          "checkedAt": "2026-07-11",
          "urls": [
            "https://docs.mistral.ai/getting-started/models/models_overview/"
          ]
        },
        "pricing": {
          "kind": "token",
          "status": "unknown",
          "currency": "USD",
          "billingUnit": "one_million_tokens",
          "inputPerMillion": null,
          "cachedInputPerMillion": null,
          "cacheWritePerMillion": null,
          "outputPerMillion": null,
          "batchInputPerMillion": null,
          "batchOutputPerMillion": null,
          "reasoningTokens": "unknown",
          "sourceUrls": [
            "https://docs.mistral.ai/getting-started/models/models_overview/"
          ],
          "verifiedAt": null,
          "notes": "N/A until this exact provider route is verified from official pricing or tested billing data."
        },
        "reasoning": {
          "supported": false,
          "alwaysOn": false,
          "canDisable": false,
          "effortValues": [],
          "returnsReasoningContent": "unknown",
          "reasoningTokensVisible": "unknown",
          "reasoningTokensBillable": false,
          "worksWithTools": "unknown",
          "worksWhileStreaming": "unknown",
          "requiresReasoningStateAfterTools": "unknown",
          "reducesOutputBudget": "unknown",
          "providerSpecificControls": []
        },
        "freeAccess": {
          "isFree": false,
          "isPromotional": false
        }
      }
    },
    {
      "id": "groq:openai/gpt-oss-20b",
      "provider": "groq",
      "providerModelId": "openai/gpt-oss-20b",
      "displayName": "GPT-OSS 20B",
      "type": "chat",
      "capabilities": {
        "modalities": [
          "chat"
        ],
        "chat": {
          "streaming": true,
          "vision": false,
          "tools": true,
          "reasoning": {
            "supported": true,
            "efforts": [
              "low",
              "medium",
              "high"
            ],
            "defaultEffort": "medium",
            "source": "official-docs",
            "confidence": "exact"
          },
          "jsonSchema": true,
          "promptCaching": false
        }
      },
      "pricing": {
        "inputPerMillionUsd": 0.075,
        "outputPerMillionUsd": 0.3,
        "source": "static",
        "note": "Verified from Groq supported models pricing."
      },
      "contextWindow": 131072,
      "maxTokens": 65536,
      "supportsVision": false,
      "supportsTools": true,
      "supportsStreaming": true,
      "supportsSystemPrompts": true,
      "inputTypes": [
        "text"
      ],
      "outputTypes": [
        "text"
      ],
      "specialFeatures": [
        "reasoning"
      ],
      "registry": {
        "category": "text.chat",
        "status": "active",
        "developer": "OpenAI",
        "family": "gpt-oss",
        "version": "openai/gpt-oss-20b",
        "supportedRegions": [],
        "endpoints": [
          "chat"
        ],
        "aliases": [
          "openai/gpt-oss-20b"
        ],
        "fallbackModelIds": [],
        "verificationLevel": "verifiedDocumentationOnly",
        "source": {
          "authority": "studio-curated",
          "checkedAt": "2026-07-11",
          "urls": [
            "https://console.groq.com/docs/models"
          ]
        },
        "pricing": {
          "kind": "token",
          "status": "verified",
          "currency": "USD",
          "billingUnit": "one_million_tokens",
          "inputPerMillion": 0.075,
          "cachedInputPerMillion": null,
          "cacheWritePerMillion": null,
          "outputPerMillion": 0.3,
          "batchInputPerMillion": null,
          "batchOutputPerMillion": null,
          "reasoningTokens": "unknown",
          "sourceUrls": [
            "https://console.groq.com/docs/models"
          ],
          "verifiedAt": "2026-07-11",
          "notes": "Verified from Groq supported models pricing."
        },
        "reasoning": {
          "supported": true,
          "alwaysOn": true,
          "canDisable": false,
          "effortValues": [
            "low",
            "medium",
            "high"
          ],
          "returnsReasoningContent": "unknown",
          "reasoningTokensVisible": "unknown",
          "reasoningTokensBillable": "unknown",
          "worksWithTools": "unknown",
          "worksWhileStreaming": "unknown",
          "requiresReasoningStateAfterTools": "unknown",
          "reducesOutputBudget": "unknown",
          "providerSpecificControls": [
            "reasoning_effort"
          ]
        },
        "freeAccess": {
          "isFree": false,
          "isPromotional": false
        }
      }
    },
    {
      "id": "groq:openai/gpt-oss-120b",
      "provider": "groq",
      "providerModelId": "openai/gpt-oss-120b",
      "displayName": "GPT-OSS 120B",
      "type": "chat",
      "capabilities": {
        "modalities": [
          "chat"
        ],
        "chat": {
          "streaming": true,
          "vision": false,
          "tools": true,
          "reasoning": {
            "supported": true,
            "efforts": [
              "low",
              "medium",
              "high"
            ],
            "defaultEffort": "medium",
            "source": "official-docs",
            "confidence": "exact"
          },
          "jsonSchema": true,
          "promptCaching": false
        }
      },
      "pricing": {
        "inputPerMillionUsd": 0.15,
        "outputPerMillionUsd": 0.6,
        "source": "static",
        "note": "Verified from Groq supported models pricing."
      },
      "contextWindow": 131072,
      "maxTokens": 65536,
      "supportsVision": false,
      "supportsTools": true,
      "supportsStreaming": true,
      "supportsSystemPrompts": true,
      "inputTypes": [
        "text"
      ],
      "outputTypes": [
        "text"
      ],
      "specialFeatures": [
        "reasoning"
      ],
      "registry": {
        "category": "text.chat",
        "status": "active",
        "developer": "OpenAI",
        "family": "gpt-oss",
        "version": "openai/gpt-oss-120b",
        "supportedRegions": [],
        "endpoints": [
          "chat"
        ],
        "aliases": [
          "openai/gpt-oss-120b"
        ],
        "fallbackModelIds": [],
        "verificationLevel": "verifiedDocumentationOnly",
        "source": {
          "authority": "studio-curated",
          "checkedAt": "2026-07-11",
          "urls": [
            "https://console.groq.com/docs/models"
          ]
        },
        "pricing": {
          "kind": "token",
          "status": "verified",
          "currency": "USD",
          "billingUnit": "one_million_tokens",
          "inputPerMillion": 0.15,
          "cachedInputPerMillion": null,
          "cacheWritePerMillion": null,
          "outputPerMillion": 0.6,
          "batchInputPerMillion": null,
          "batchOutputPerMillion": null,
          "reasoningTokens": "unknown",
          "sourceUrls": [
            "https://console.groq.com/docs/models"
          ],
          "verifiedAt": "2026-07-11",
          "notes": "Verified from Groq supported models pricing."
        },
        "reasoning": {
          "supported": true,
          "alwaysOn": true,
          "canDisable": false,
          "effortValues": [
            "low",
            "medium",
            "high"
          ],
          "returnsReasoningContent": "unknown",
          "reasoningTokensVisible": "unknown",
          "reasoningTokensBillable": "unknown",
          "worksWithTools": "unknown",
          "worksWhileStreaming": "unknown",
          "requiresReasoningStateAfterTools": "unknown",
          "reducesOutputBudget": "unknown",
          "providerSpecificControls": [
            "reasoning_effort"
          ]
        },
        "freeAccess": {
          "isFree": false,
          "isPromotional": false
        }
      }
    },
    {
      "id": "groq:qwen/qwen3-32b",
      "provider": "groq",
      "providerModelId": "qwen/qwen3-32b",
      "displayName": "Qwen3 32B",
      "type": "chat",
      "capabilities": {
        "modalities": [
          "chat"
        ],
        "chat": {
          "streaming": true,
          "vision": false,
          "tools": true,
          "reasoning": {
            "supported": true,
            "efforts": [
              "none",
              "low",
              "medium",
              "high"
            ],
            "defaultEffort": "medium",
            "source": "official-docs",
            "confidence": "exact"
          },
          "jsonSchema": false,
          "promptCaching": false
        }
      },
      "pricing": {
        "inputPerMillionUsd": 0.29,
        "outputPerMillionUsd": 0.59,
        "source": "static",
        "note": "Verified from Groq supported models pricing."
      },
      "contextWindow": 131072,
      "maxTokens": 40960,
      "supportsVision": false,
      "supportsTools": true,
      "supportsStreaming": true,
      "supportsSystemPrompts": true,
      "inputTypes": [
        "text"
      ],
      "outputTypes": [
        "text"
      ],
      "specialFeatures": [
        "reasoning"
      ],
      "registry": {
        "category": "text.chat",
        "status": "active",
        "developer": "Alibaba Qwen",
        "family": "qwen3",
        "version": "qwen/qwen3-32b",
        "supportedRegions": [],
        "endpoints": [
          "chat"
        ],
        "aliases": [
          "qwen/qwen3-32b"
        ],
        "fallbackModelIds": [],
        "verificationLevel": "verifiedDocumentationOnly",
        "source": {
          "authority": "studio-curated",
          "checkedAt": "2026-07-11",
          "urls": [
            "https://console.groq.com/docs/models"
          ]
        },
        "pricing": {
          "kind": "token",
          "status": "verified",
          "currency": "USD",
          "billingUnit": "one_million_tokens",
          "inputPerMillion": 0.29,
          "cachedInputPerMillion": null,
          "cacheWritePerMillion": null,
          "outputPerMillion": 0.59,
          "batchInputPerMillion": null,
          "batchOutputPerMillion": null,
          "reasoningTokens": "unknown",
          "sourceUrls": [
            "https://console.groq.com/docs/models"
          ],
          "verifiedAt": "2026-07-11",
          "notes": "Verified from Groq supported models pricing."
        },
        "reasoning": {
          "supported": true,
          "alwaysOn": false,
          "canDisable": true,
          "effortValues": [
            "none",
            "low",
            "medium",
            "high"
          ],
          "returnsReasoningContent": "unknown",
          "reasoningTokensVisible": "unknown",
          "reasoningTokensBillable": "unknown",
          "worksWithTools": "unknown",
          "worksWhileStreaming": "unknown",
          "requiresReasoningStateAfterTools": "unknown",
          "reducesOutputBudget": "unknown",
          "providerSpecificControls": [
            "reasoning_effort"
          ]
        },
        "freeAccess": {
          "isFree": false,
          "isPromotional": false
        }
      }
    },
    {
      "id": "groq:qwen/qwen3.6-27b",
      "provider": "groq",
      "providerModelId": "qwen/qwen3.6-27b",
      "displayName": "Qwen3.6 27B",
      "type": "multimodal",
      "capabilities": {
        "modalities": [
          "chat"
        ],
        "chat": {
          "streaming": true,
          "vision": true,
          "tools": true,
          "reasoning": {
            "supported": true,
            "efforts": [
              "none",
              "low",
              "medium",
              "high"
            ],
            "defaultEffort": "medium",
            "source": "official-docs",
            "confidence": "exact"
          },
          "jsonSchema": false,
          "promptCaching": false
        }
      },
      "pricing": {
        "inputPerMillionUsd": 0.6,
        "outputPerMillionUsd": 3,
        "source": "static",
        "note": "Verified from Groq supported models pricing."
      },
      "contextWindow": 131072,
      "maxTokens": 32768,
      "supportsVision": true,
      "supportsTools": true,
      "supportsStreaming": true,
      "supportsSystemPrompts": true,
      "inputTypes": [
        "text",
        "image"
      ],
      "outputTypes": [
        "text"
      ],
      "specialFeatures": [
        "reasoning"
      ],
      "registry": {
        "category": "text.chat",
        "status": "active",
        "developer": "Alibaba Qwen",
        "family": "qwen3.6",
        "version": "qwen/qwen3.6-27b",
        "supportedRegions": [],
        "endpoints": [
          "chat"
        ],
        "aliases": [
          "qwen/qwen3.6-27b"
        ],
        "fallbackModelIds": [],
        "verificationLevel": "verifiedDocumentationOnly",
        "source": {
          "authority": "studio-curated",
          "checkedAt": "2026-07-11",
          "urls": [
            "https://console.groq.com/docs/models"
          ]
        },
        "pricing": {
          "kind": "token",
          "status": "verified",
          "currency": "USD",
          "billingUnit": "one_million_tokens",
          "inputPerMillion": 0.6,
          "cachedInputPerMillion": null,
          "cacheWritePerMillion": null,
          "outputPerMillion": 3,
          "batchInputPerMillion": null,
          "batchOutputPerMillion": null,
          "reasoningTokens": "unknown",
          "sourceUrls": [
            "https://console.groq.com/docs/models"
          ],
          "verifiedAt": "2026-07-11",
          "notes": "Verified from Groq supported models pricing."
        },
        "reasoning": {
          "supported": true,
          "alwaysOn": false,
          "canDisable": true,
          "effortValues": [
            "none",
            "low",
            "medium",
            "high"
          ],
          "returnsReasoningContent": "unknown",
          "reasoningTokensVisible": "unknown",
          "reasoningTokensBillable": "unknown",
          "worksWithTools": "unknown",
          "worksWhileStreaming": "unknown",
          "requiresReasoningStateAfterTools": "unknown",
          "reducesOutputBudget": "unknown",
          "providerSpecificControls": [
            "reasoning_effort"
          ]
        },
        "freeAccess": {
          "isFree": false,
          "isPromotional": false
        }
      }
    },
    {
      "id": "groq:whisper-large-v3",
      "provider": "groq",
      "providerModelId": "whisper-large-v3",
      "displayName": "Whisper Large V3",
      "type": "audio",
      "capabilities": {
        "modalities": [
          "transcription"
        ]
      },
      "pricing": {
        "inputPerMillionUsd": null,
        "outputPerMillionUsd": null,
        "source": "unknown",
        "note": "Verified from Groq supported models pricing."
      },
      "inputTypes": [
        "audio"
      ],
      "outputTypes": [
        "text"
      ],
      "registry": {
        "category": "audio.transcription",
        "status": "active",
        "developer": "OpenAI",
        "family": "whisper",
        "version": "whisper-large-v3",
        "supportedRegions": [],
        "endpoints": [
          "audio.transcriptions"
        ],
        "aliases": [
          "whisper-large-v3"
        ],
        "fallbackModelIds": [],
        "verificationLevel": "verifiedDocumentationOnly",
        "source": {
          "authority": "studio-curated",
          "checkedAt": "2026-07-11",
          "urls": [
            "https://console.groq.com/docs/models"
          ]
        },
        "pricing": {
          "kind": "audio",
          "status": "verified",
          "currency": "USD",
          "billingUnit": "audio_hour",
          "price": 0.111,
          "sourceUrls": [
            "https://console.groq.com/docs/models"
          ],
          "verifiedAt": "2026-07-11",
          "notes": "Verified from Groq supported models pricing."
        },
        "freeAccess": {
          "isFree": false,
          "isPromotional": false
        }
      }
    },
    {
      "id": "groq:whisper-large-v3-turbo",
      "provider": "groq",
      "providerModelId": "whisper-large-v3-turbo",
      "displayName": "Whisper Large V3 Turbo",
      "type": "audio",
      "capabilities": {
        "modalities": [
          "transcription"
        ]
      },
      "pricing": {
        "inputPerMillionUsd": null,
        "outputPerMillionUsd": null,
        "source": "unknown",
        "note": "Verified from Groq supported models pricing."
      },
      "inputTypes": [
        "audio"
      ],
      "outputTypes": [
        "text"
      ],
      "registry": {
        "category": "audio.transcription",
        "status": "active",
        "developer": "OpenAI",
        "family": "whisper",
        "version": "whisper-large-v3-turbo",
        "supportedRegions": [],
        "endpoints": [
          "audio.transcriptions"
        ],
        "aliases": [
          "whisper-large-v3-turbo"
        ],
        "fallbackModelIds": [],
        "verificationLevel": "verifiedDocumentationOnly",
        "source": {
          "authority": "studio-curated",
          "checkedAt": "2026-07-11",
          "urls": [
            "https://console.groq.com/docs/models"
          ]
        },
        "pricing": {
          "kind": "audio",
          "status": "verified",
          "currency": "USD",
          "billingUnit": "audio_hour",
          "price": 0.04,
          "sourceUrls": [
            "https://console.groq.com/docs/models"
          ],
          "verifiedAt": "2026-07-11",
          "notes": "Verified from Groq supported models pricing."
        },
        "freeAccess": {
          "isFree": false,
          "isPromotional": false
        }
      }
    },
    {
      "id": "alibaba:qwen3.7-max",
      "provider": "alibaba",
      "providerModelId": "qwen3.7-max",
      "displayName": "Qwen3.7 Max",
      "type": "chat",
      "capabilities": {
        "modalities": [
          "chat"
        ],
        "chat": {
          "streaming": true,
          "vision": false,
          "tools": true,
          "reasoning": {
            "supported": false,
            "efforts": [],
            "source": "unknown",
            "confidence": "unknown"
          },
          "jsonSchema": true,
          "promptCaching": false
        }
      },
      "pricing": {
        "inputPerMillionUsd": null,
        "outputPerMillionUsd": null,
        "source": "unknown",
        "note": "N/A until this exact provider route is verified from official pricing or tested billing data."
      },
      "contextWindow": 1000000,
      "maxTokens": 128000,
      "supportsVision": false,
      "supportsTools": true,
      "supportsStreaming": true,
      "supportsSystemPrompts": true,
      "inputTypes": [
        "text"
      ],
      "outputTypes": [
        "text"
      ],
      "registry": {
        "category": "text.chat",
        "status": "active",
        "developer": "Alibaba Qwen",
        "family": "qwen3.7",
        "version": "qwen3.7-max",
        "supportedRegions": [],
        "endpoints": [
          "chat"
        ],
        "aliases": [
          "qwen3.7-max"
        ],
        "fallbackModelIds": [],
        "verificationLevel": "verifiedDocumentationOnly",
        "source": {
          "authority": "studio-curated",
          "checkedAt": "2026-07-11",
          "urls": [
            "https://www.alibabacloud.com/help/en/model-studio/models",
            "https://www.alibabacloud.com/help/en/model-studio/model-pricing"
          ]
        },
        "pricing": {
          "kind": "token",
          "status": "unknown",
          "currency": "USD",
          "billingUnit": "one_million_tokens",
          "inputPerMillion": null,
          "cachedInputPerMillion": null,
          "cacheWritePerMillion": null,
          "outputPerMillion": null,
          "batchInputPerMillion": null,
          "batchOutputPerMillion": null,
          "reasoningTokens": "unknown",
          "sourceUrls": [
            "https://www.alibabacloud.com/help/en/model-studio/models",
            "https://www.alibabacloud.com/help/en/model-studio/model-pricing"
          ],
          "verifiedAt": null,
          "notes": "N/A until this exact provider route is verified from official pricing or tested billing data."
        },
        "reasoning": {
          "supported": false,
          "alwaysOn": false,
          "canDisable": false,
          "effortValues": [],
          "returnsReasoningContent": "unknown",
          "reasoningTokensVisible": "unknown",
          "reasoningTokensBillable": false,
          "worksWithTools": "unknown",
          "worksWhileStreaming": "unknown",
          "requiresReasoningStateAfterTools": "unknown",
          "reducesOutputBudget": "unknown",
          "providerSpecificControls": []
        },
        "freeAccess": {
          "isFree": false,
          "isPromotional": false
        }
      }
    },
    {
      "id": "alibaba:qwen3.7-plus",
      "provider": "alibaba",
      "providerModelId": "qwen3.7-plus",
      "displayName": "Qwen3.7 Plus",
      "type": "multimodal",
      "capabilities": {
        "modalities": [
          "chat"
        ],
        "chat": {
          "streaming": true,
          "vision": true,
          "tools": true,
          "reasoning": {
            "supported": false,
            "efforts": [],
            "source": "unknown",
            "confidence": "unknown"
          },
          "jsonSchema": true,
          "promptCaching": false
        }
      },
      "pricing": {
        "inputPerMillionUsd": null,
        "outputPerMillionUsd": null,
        "source": "unknown",
        "note": "N/A until this exact provider route is verified from official pricing or tested billing data."
      },
      "contextWindow": 1000000,
      "maxTokens": 128000,
      "supportsVision": true,
      "supportsTools": true,
      "supportsStreaming": true,
      "supportsSystemPrompts": true,
      "inputTypes": [
        "text",
        "image"
      ],
      "outputTypes": [
        "text"
      ],
      "registry": {
        "category": "text.chat",
        "status": "active",
        "developer": "Alibaba Qwen",
        "family": "qwen3.7",
        "version": "qwen3.7-plus",
        "supportedRegions": [],
        "endpoints": [
          "chat"
        ],
        "aliases": [
          "qwen3.7-plus"
        ],
        "fallbackModelIds": [],
        "verificationLevel": "verifiedDocumentationOnly",
        "source": {
          "authority": "studio-curated",
          "checkedAt": "2026-07-11",
          "urls": [
            "https://www.alibabacloud.com/help/en/model-studio/models",
            "https://www.alibabacloud.com/help/en/model-studio/model-pricing"
          ]
        },
        "pricing": {
          "kind": "token",
          "status": "unknown",
          "currency": "USD",
          "billingUnit": "one_million_tokens",
          "inputPerMillion": null,
          "cachedInputPerMillion": null,
          "cacheWritePerMillion": null,
          "outputPerMillion": null,
          "batchInputPerMillion": null,
          "batchOutputPerMillion": null,
          "reasoningTokens": "unknown",
          "sourceUrls": [
            "https://www.alibabacloud.com/help/en/model-studio/models",
            "https://www.alibabacloud.com/help/en/model-studio/model-pricing"
          ],
          "verifiedAt": null,
          "notes": "N/A until this exact provider route is verified from official pricing or tested billing data."
        },
        "reasoning": {
          "supported": false,
          "alwaysOn": false,
          "canDisable": false,
          "effortValues": [],
          "returnsReasoningContent": "unknown",
          "reasoningTokensVisible": "unknown",
          "reasoningTokensBillable": false,
          "worksWithTools": "unknown",
          "worksWhileStreaming": "unknown",
          "requiresReasoningStateAfterTools": "unknown",
          "reducesOutputBudget": "unknown",
          "providerSpecificControls": []
        },
        "freeAccess": {
          "isFree": false,
          "isPromotional": false
        }
      }
    },
    {
      "id": "alibaba:qwen3.6-plus",
      "provider": "alibaba",
      "providerModelId": "qwen3.6-plus",
      "displayName": "Qwen3.6 Plus",
      "type": "multimodal",
      "capabilities": {
        "modalities": [
          "chat"
        ],
        "chat": {
          "streaming": true,
          "vision": true,
          "tools": true,
          "reasoning": {
            "supported": false,
            "efforts": [],
            "source": "unknown",
            "confidence": "unknown"
          },
          "jsonSchema": true,
          "promptCaching": false
        }
      },
      "pricing": {
        "inputPerMillionUsd": null,
        "outputPerMillionUsd": null,
        "source": "unknown",
        "note": "N/A until this exact provider route is verified from official pricing or tested billing data."
      },
      "contextWindow": 1000000,
      "maxTokens": 128000,
      "supportsVision": true,
      "supportsTools": true,
      "supportsStreaming": true,
      "supportsSystemPrompts": true,
      "inputTypes": [
        "text",
        "image"
      ],
      "outputTypes": [
        "text"
      ],
      "registry": {
        "category": "text.chat",
        "status": "active",
        "developer": "Alibaba Qwen",
        "family": "qwen3.6",
        "version": "qwen3.6-plus",
        "supportedRegions": [],
        "endpoints": [
          "chat"
        ],
        "aliases": [
          "qwen3.6-plus"
        ],
        "fallbackModelIds": [],
        "verificationLevel": "verifiedDocumentationOnly",
        "source": {
          "authority": "studio-curated",
          "checkedAt": "2026-07-11",
          "urls": [
            "https://www.alibabacloud.com/help/en/model-studio/models",
            "https://www.alibabacloud.com/help/en/model-studio/model-pricing"
          ]
        },
        "pricing": {
          "kind": "token",
          "status": "unknown",
          "currency": "USD",
          "billingUnit": "one_million_tokens",
          "inputPerMillion": null,
          "cachedInputPerMillion": null,
          "cacheWritePerMillion": null,
          "outputPerMillion": null,
          "batchInputPerMillion": null,
          "batchOutputPerMillion": null,
          "reasoningTokens": "unknown",
          "sourceUrls": [
            "https://www.alibabacloud.com/help/en/model-studio/models",
            "https://www.alibabacloud.com/help/en/model-studio/model-pricing"
          ],
          "verifiedAt": null,
          "notes": "N/A until this exact provider route is verified from official pricing or tested billing data."
        },
        "reasoning": {
          "supported": false,
          "alwaysOn": false,
          "canDisable": false,
          "effortValues": [],
          "returnsReasoningContent": "unknown",
          "reasoningTokensVisible": "unknown",
          "reasoningTokensBillable": false,
          "worksWithTools": "unknown",
          "worksWhileStreaming": "unknown",
          "requiresReasoningStateAfterTools": "unknown",
          "reducesOutputBudget": "unknown",
          "providerSpecificControls": []
        },
        "freeAccess": {
          "isFree": false,
          "isPromotional": false
        }
      }
    },
    {
      "id": "alibaba:qwen3.6-flash",
      "provider": "alibaba",
      "providerModelId": "qwen3.6-flash",
      "displayName": "Qwen3.6 Flash",
      "type": "multimodal",
      "capabilities": {
        "modalities": [
          "chat"
        ],
        "chat": {
          "streaming": true,
          "vision": true,
          "tools": true,
          "reasoning": {
            "supported": false,
            "efforts": [],
            "source": "unknown",
            "confidence": "unknown"
          },
          "jsonSchema": true,
          "promptCaching": false
        }
      },
      "pricing": {
        "inputPerMillionUsd": null,
        "outputPerMillionUsd": null,
        "source": "unknown",
        "note": "N/A until this exact provider route is verified from official pricing or tested billing data."
      },
      "contextWindow": 1000000,
      "maxTokens": 128000,
      "supportsVision": true,
      "supportsTools": true,
      "supportsStreaming": true,
      "supportsSystemPrompts": true,
      "inputTypes": [
        "text",
        "image"
      ],
      "outputTypes": [
        "text"
      ],
      "registry": {
        "category": "text.chat",
        "status": "active",
        "developer": "Alibaba Qwen",
        "family": "qwen3.6",
        "version": "qwen3.6-flash",
        "supportedRegions": [],
        "endpoints": [
          "chat"
        ],
        "aliases": [
          "qwen3.6-flash"
        ],
        "fallbackModelIds": [],
        "verificationLevel": "verifiedDocumentationOnly",
        "source": {
          "authority": "studio-curated",
          "checkedAt": "2026-07-11",
          "urls": [
            "https://www.alibabacloud.com/help/en/model-studio/models",
            "https://www.alibabacloud.com/help/en/model-studio/model-pricing"
          ]
        },
        "pricing": {
          "kind": "token",
          "status": "unknown",
          "currency": "USD",
          "billingUnit": "one_million_tokens",
          "inputPerMillion": null,
          "cachedInputPerMillion": null,
          "cacheWritePerMillion": null,
          "outputPerMillion": null,
          "batchInputPerMillion": null,
          "batchOutputPerMillion": null,
          "reasoningTokens": "unknown",
          "sourceUrls": [
            "https://www.alibabacloud.com/help/en/model-studio/models",
            "https://www.alibabacloud.com/help/en/model-studio/model-pricing"
          ],
          "verifiedAt": null,
          "notes": "N/A until this exact provider route is verified from official pricing or tested billing data."
        },
        "reasoning": {
          "supported": false,
          "alwaysOn": false,
          "canDisable": false,
          "effortValues": [],
          "returnsReasoningContent": "unknown",
          "reasoningTokensVisible": "unknown",
          "reasoningTokensBillable": false,
          "worksWithTools": "unknown",
          "worksWhileStreaming": "unknown",
          "requiresReasoningStateAfterTools": "unknown",
          "reducesOutputBudget": "unknown",
          "providerSpecificControls": []
        },
        "freeAccess": {
          "isFree": false,
          "isPromotional": false
        }
      }
    },
    {
      "id": "minimax:MiniMax-M3",
      "provider": "minimax",
      "providerModelId": "MiniMax-M3",
      "displayName": "MiniMax M3",
      "type": "multimodal",
      "capabilities": {
        "modalities": [
          "chat"
        ],
        "chat": {
          "streaming": true,
          "vision": true,
          "tools": true,
          "reasoning": {
            "supported": false,
            "efforts": [],
            "source": "unknown",
            "confidence": "unknown"
          },
          "jsonSchema": true,
          "promptCaching": false
        }
      },
      "pricing": {
        "inputPerMillionUsd": null,
        "outputPerMillionUsd": null,
        "source": "unknown",
        "note": "N/A until this exact provider route is verified from official pricing or tested billing data."
      },
      "contextWindow": 1048576,
      "maxTokens": 128000,
      "supportsVision": true,
      "supportsTools": true,
      "supportsStreaming": true,
      "supportsSystemPrompts": true,
      "inputTypes": [
        "text",
        "image"
      ],
      "outputTypes": [
        "text"
      ],
      "registry": {
        "category": "text.chat",
        "status": "active",
        "developer": "MiniMax",
        "family": "minimax-m3",
        "version": "MiniMax-M3",
        "supportedRegions": [],
        "endpoints": [
          "chat"
        ],
        "aliases": [
          "MiniMax-M3"
        ],
        "fallbackModelIds": [],
        "verificationLevel": "verifiedDocumentationOnly",
        "source": {
          "authority": "studio-curated",
          "checkedAt": "2026-07-11",
          "urls": [
            "https://platform.minimax.io/docs/guides/text-generation",
            "https://platform.minimax.io/docs/guides/pricing-paygo"
          ]
        },
        "pricing": {
          "kind": "token",
          "status": "unknown",
          "currency": "USD",
          "billingUnit": "one_million_tokens",
          "inputPerMillion": null,
          "cachedInputPerMillion": null,
          "cacheWritePerMillion": null,
          "outputPerMillion": null,
          "batchInputPerMillion": null,
          "batchOutputPerMillion": null,
          "reasoningTokens": "unknown",
          "sourceUrls": [
            "https://platform.minimax.io/docs/guides/text-generation",
            "https://platform.minimax.io/docs/guides/pricing-paygo"
          ],
          "verifiedAt": null,
          "notes": "N/A until this exact provider route is verified from official pricing or tested billing data."
        },
        "reasoning": {
          "supported": false,
          "alwaysOn": false,
          "canDisable": false,
          "effortValues": [],
          "returnsReasoningContent": "unknown",
          "reasoningTokensVisible": "unknown",
          "reasoningTokensBillable": false,
          "worksWithTools": "unknown",
          "worksWhileStreaming": "unknown",
          "requiresReasoningStateAfterTools": "unknown",
          "reducesOutputBudget": "unknown",
          "providerSpecificControls": []
        },
        "freeAccess": {
          "isFree": false,
          "isPromotional": false
        }
      }
    },
    {
      "id": "zai:glm-5.2",
      "provider": "zai",
      "providerModelId": "glm-5.2",
      "displayName": "GLM-5.2",
      "type": "chat",
      "capabilities": {
        "modalities": [
          "chat"
        ],
        "chat": {
          "streaming": true,
          "vision": false,
          "tools": true,
          "reasoning": {
            "supported": true,
            "efforts": [
              "low",
              "medium",
              "high"
            ],
            "defaultEffort": "medium",
            "source": "official-docs",
            "confidence": "exact"
          },
          "jsonSchema": true,
          "promptCaching": false
        }
      },
      "pricing": {
        "inputPerMillionUsd": null,
        "outputPerMillionUsd": null,
        "source": "unknown",
        "note": "N/A until this exact provider route is verified from official pricing or tested billing data."
      },
      "contextWindow": 1048576,
      "maxTokens": 128000,
      "supportsVision": false,
      "supportsTools": true,
      "supportsStreaming": true,
      "supportsSystemPrompts": true,
      "inputTypes": [
        "text"
      ],
      "outputTypes": [
        "text"
      ],
      "specialFeatures": [
        "reasoning"
      ],
      "registry": {
        "category": "text.chat",
        "status": "active",
        "developer": "Z.ai",
        "family": "glm-5",
        "version": "glm-5.2",
        "supportedRegions": [],
        "endpoints": [
          "chat"
        ],
        "aliases": [
          "glm-5.2"
        ],
        "fallbackModelIds": [],
        "verificationLevel": "verifiedDocumentationOnly",
        "source": {
          "authority": "studio-curated",
          "checkedAt": "2026-07-11",
          "urls": [
            "https://docs.z.ai/guides/llm/glm-5.2",
            "https://docs.z.ai/guides/overview/pricing"
          ]
        },
        "pricing": {
          "kind": "token",
          "status": "unknown",
          "currency": "USD",
          "billingUnit": "one_million_tokens",
          "inputPerMillion": null,
          "cachedInputPerMillion": null,
          "cacheWritePerMillion": null,
          "outputPerMillion": null,
          "batchInputPerMillion": null,
          "batchOutputPerMillion": null,
          "reasoningTokens": "unknown",
          "sourceUrls": [
            "https://docs.z.ai/guides/llm/glm-5.2",
            "https://docs.z.ai/guides/overview/pricing"
          ],
          "verifiedAt": null,
          "notes": "N/A until this exact provider route is verified from official pricing or tested billing data."
        },
        "reasoning": {
          "supported": true,
          "alwaysOn": true,
          "canDisable": false,
          "effortValues": [
            "low",
            "medium",
            "high"
          ],
          "returnsReasoningContent": "unknown",
          "reasoningTokensVisible": "unknown",
          "reasoningTokensBillable": "unknown",
          "worksWithTools": "unknown",
          "worksWhileStreaming": "unknown",
          "requiresReasoningStateAfterTools": "unknown",
          "reducesOutputBudget": "unknown",
          "providerSpecificControls": [
            "reasoning_effort"
          ]
        },
        "freeAccess": {
          "isFree": false,
          "isPromotional": false
        }
      }
    },
    {
      "id": "xiaomi:mimo-v2.5",
      "provider": "xiaomi",
      "providerModelId": "mimo-v2.5",
      "displayName": "MiMo V2.5",
      "type": "multimodal",
      "capabilities": {
        "modalities": [
          "chat"
        ],
        "chat": {
          "streaming": true,
          "vision": true,
          "tools": true,
          "reasoning": {
            "supported": false,
            "efforts": [],
            "source": "unknown",
            "confidence": "unknown"
          },
          "jsonSchema": true,
          "promptCaching": false
        }
      },
      "pricing": {
        "inputPerMillionUsd": null,
        "outputPerMillionUsd": null,
        "source": "unknown",
        "note": "N/A until this exact provider route is verified from official pricing or tested billing data."
      },
      "contextWindow": 1048576,
      "maxTokens": 128000,
      "supportsVision": true,
      "supportsTools": true,
      "supportsStreaming": true,
      "supportsSystemPrompts": true,
      "inputTypes": [
        "text",
        "image"
      ],
      "outputTypes": [
        "text"
      ],
      "registry": {
        "category": "text.chat",
        "status": "active",
        "developer": "Xiaomi",
        "family": "mimo-v2.5",
        "version": "mimo-v2.5",
        "supportedRegions": [],
        "endpoints": [
          "chat"
        ],
        "aliases": [
          "mimo-v2.5"
        ],
        "fallbackModelIds": [],
        "verificationLevel": "verifiedDocumentationOnly",
        "source": {
          "authority": "studio-curated",
          "checkedAt": "2026-07-11",
          "urls": [
            "https://mimo.mi.com/docs/en-US/quick-start/summary/model",
            "https://mimo.mi.com/docs/price/pay-as-you-go"
          ]
        },
        "pricing": {
          "kind": "token",
          "status": "unknown",
          "currency": "USD",
          "billingUnit": "one_million_tokens",
          "inputPerMillion": null,
          "cachedInputPerMillion": null,
          "cacheWritePerMillion": null,
          "outputPerMillion": null,
          "batchInputPerMillion": null,
          "batchOutputPerMillion": null,
          "reasoningTokens": "unknown",
          "sourceUrls": [
            "https://mimo.mi.com/docs/en-US/quick-start/summary/model",
            "https://mimo.mi.com/docs/price/pay-as-you-go"
          ],
          "verifiedAt": null,
          "notes": "N/A until this exact provider route is verified from official pricing or tested billing data."
        },
        "reasoning": {
          "supported": false,
          "alwaysOn": false,
          "canDisable": false,
          "effortValues": [],
          "returnsReasoningContent": "unknown",
          "reasoningTokensVisible": "unknown",
          "reasoningTokensBillable": false,
          "worksWithTools": "unknown",
          "worksWhileStreaming": "unknown",
          "requiresReasoningStateAfterTools": "unknown",
          "reducesOutputBudget": "unknown",
          "providerSpecificControls": []
        },
        "freeAccess": {
          "isFree": false,
          "isPromotional": false
        }
      }
    },
    {
      "id": "xiaomi:mimo-v2.5-pro",
      "provider": "xiaomi",
      "providerModelId": "mimo-v2.5-pro",
      "displayName": "MiMo V2.5 Pro",
      "type": "chat",
      "capabilities": {
        "modalities": [
          "chat"
        ],
        "chat": {
          "streaming": true,
          "vision": false,
          "tools": true,
          "reasoning": {
            "supported": false,
            "efforts": [],
            "source": "unknown",
            "confidence": "unknown"
          },
          "jsonSchema": true,
          "promptCaching": false
        }
      },
      "pricing": {
        "inputPerMillionUsd": null,
        "outputPerMillionUsd": null,
        "source": "unknown",
        "note": "N/A until this exact provider route is verified from official pricing or tested billing data."
      },
      "contextWindow": 1048576,
      "maxTokens": 128000,
      "supportsVision": false,
      "supportsTools": true,
      "supportsStreaming": true,
      "supportsSystemPrompts": true,
      "inputTypes": [
        "text"
      ],
      "outputTypes": [
        "text"
      ],
      "registry": {
        "category": "text.chat",
        "status": "active",
        "developer": "Xiaomi",
        "family": "mimo-v2.5",
        "version": "mimo-v2.5-pro",
        "supportedRegions": [],
        "endpoints": [
          "chat"
        ],
        "aliases": [
          "mimo-v2.5-pro"
        ],
        "fallbackModelIds": [],
        "verificationLevel": "verifiedDocumentationOnly",
        "source": {
          "authority": "studio-curated",
          "checkedAt": "2026-07-11",
          "urls": [
            "https://mimo.mi.com/docs/en-US/quick-start/summary/model",
            "https://mimo.mi.com/docs/price/pay-as-you-go"
          ]
        },
        "pricing": {
          "kind": "token",
          "status": "unknown",
          "currency": "USD",
          "billingUnit": "one_million_tokens",
          "inputPerMillion": null,
          "cachedInputPerMillion": null,
          "cacheWritePerMillion": null,
          "outputPerMillion": null,
          "batchInputPerMillion": null,
          "batchOutputPerMillion": null,
          "reasoningTokens": "unknown",
          "sourceUrls": [
            "https://mimo.mi.com/docs/en-US/quick-start/summary/model",
            "https://mimo.mi.com/docs/price/pay-as-you-go"
          ],
          "verifiedAt": null,
          "notes": "N/A until this exact provider route is verified from official pricing or tested billing data."
        },
        "reasoning": {
          "supported": false,
          "alwaysOn": false,
          "canDisable": false,
          "effortValues": [],
          "returnsReasoningContent": "unknown",
          "reasoningTokensVisible": "unknown",
          "reasoningTokensBillable": false,
          "worksWithTools": "unknown",
          "worksWhileStreaming": "unknown",
          "requiresReasoningStateAfterTools": "unknown",
          "reducesOutputBudget": "unknown",
          "providerSpecificControls": []
        },
        "freeAccess": {
          "isFree": false,
          "isPromotional": false
        }
      }
    },
    {
      "id": "fal:fal-ai/bytedance/seedream/v5/lite/text-to-image",
      "provider": "fal",
      "providerModelId": "fal-ai/bytedance/seedream/v5/lite/text-to-image",
      "displayName": "Seedream 5 Lite Text to Image",
      "type": "image",
      "capabilities": {
        "modalities": [
          "image.generate"
        ]
      },
      "pricing": {
        "inputPerMillionUsd": null,
        "outputPerMillionUsd": null,
        "source": "unknown",
        "note": "Image pricing must preserve native units such as image, megapixel, generation, prediction, or compute seconds."
      },
      "inputTypes": [
        "text"
      ],
      "outputTypes": [
        "image"
      ],
      "registry": {
        "category": "image.generation",
        "status": "active",
        "developer": "ByteDance",
        "family": "seedream",
        "version": "fal-ai/bytedance/seedream/v5/lite/text-to-image",
        "supportedRegions": [],
        "endpoints": [
          "images.generations"
        ],
        "aliases": [
          "fal-ai/bytedance/seedream/v5/lite/text-to-image"
        ],
        "fallbackModelIds": [],
        "verificationLevel": "verifiedDocumentationOnly",
        "source": {
          "authority": "studio-curated",
          "checkedAt": "2026-07-11",
          "urls": [
            "https://fal.ai/docs/platform-apis/v1/models/pricing",
            "https://fal.ai/models"
          ]
        },
        "pricing": {
          "kind": "image",
          "status": "provider_variable",
          "currency": "USD",
          "billingUnit": "image",
          "price": null,
          "dependsOn": [
            "resolution",
            "quality",
            "provider_route",
            "hardware"
          ],
          "sourceUrls": [
            "https://fal.ai/docs/platform-apis/v1/models/pricing",
            "https://fal.ai/models"
          ],
          "verifiedAt": null,
          "notes": "Image pricing must preserve native units such as image, megapixel, generation, prediction, or compute seconds."
        },
        "freeAccess": {
          "isFree": false,
          "isPromotional": false
        }
      }
    },
    {
      "id": "fal:fal-ai/bytedance/seedream/v5/lite/edit",
      "provider": "fal",
      "providerModelId": "fal-ai/bytedance/seedream/v5/lite/edit",
      "displayName": "Seedream 5 Lite Edit",
      "type": "image",
      "capabilities": {
        "modalities": [
          "image.generate",
          "image.edit"
        ]
      },
      "pricing": {
        "inputPerMillionUsd": null,
        "outputPerMillionUsd": null,
        "source": "unknown",
        "note": "Image pricing must preserve native units such as image, megapixel, generation, prediction, or compute seconds."
      },
      "inputTypes": [
        "text",
        "image"
      ],
      "outputTypes": [
        "image"
      ],
      "registry": {
        "category": "image.editing",
        "status": "active",
        "developer": "ByteDance",
        "family": "seedream",
        "version": "fal-ai/bytedance/seedream/v5/lite/edit",
        "supportedRegions": [],
        "endpoints": [
          "images.generations",
          "images.edits"
        ],
        "aliases": [
          "fal-ai/bytedance/seedream/v5/lite/edit"
        ],
        "fallbackModelIds": [],
        "verificationLevel": "verifiedDocumentationOnly",
        "source": {
          "authority": "studio-curated",
          "checkedAt": "2026-07-11",
          "urls": [
            "https://fal.ai/docs/platform-apis/v1/models/pricing",
            "https://fal.ai/models"
          ]
        },
        "pricing": {
          "kind": "image",
          "status": "provider_variable",
          "currency": "USD",
          "billingUnit": "image",
          "price": null,
          "dependsOn": [
            "resolution",
            "quality",
            "provider_route",
            "hardware"
          ],
          "sourceUrls": [
            "https://fal.ai/docs/platform-apis/v1/models/pricing",
            "https://fal.ai/models"
          ],
          "verifiedAt": null,
          "notes": "Image pricing must preserve native units such as image, megapixel, generation, prediction, or compute seconds."
        },
        "freeAccess": {
          "isFree": false,
          "isPromotional": false
        }
      }
    },
    {
      "id": "fal:bytedance/seedream/v5/pro/edit",
      "provider": "fal",
      "providerModelId": "bytedance/seedream/v5/pro/edit",
      "displayName": "Seedream 5 Pro Edit",
      "type": "image",
      "capabilities": {
        "modalities": [
          "image.generate",
          "image.edit"
        ]
      },
      "pricing": {
        "inputPerMillionUsd": null,
        "outputPerMillionUsd": null,
        "source": "unknown",
        "note": "Image pricing must preserve native units such as image, megapixel, generation, prediction, or compute seconds."
      },
      "inputTypes": [
        "text",
        "image"
      ],
      "outputTypes": [
        "image"
      ],
      "registry": {
        "category": "image.editing",
        "status": "active",
        "developer": "ByteDance",
        "family": "seedream",
        "version": "bytedance/seedream/v5/pro/edit",
        "supportedRegions": [],
        "endpoints": [
          "images.generations",
          "images.edits"
        ],
        "aliases": [
          "bytedance/seedream/v5/pro/edit"
        ],
        "fallbackModelIds": [],
        "verificationLevel": "verifiedDocumentationOnly",
        "source": {
          "authority": "studio-curated",
          "checkedAt": "2026-07-11",
          "urls": [
            "https://fal.ai/docs/platform-apis/v1/models/pricing",
            "https://fal.ai/models"
          ]
        },
        "pricing": {
          "kind": "image",
          "status": "provider_variable",
          "currency": "USD",
          "billingUnit": "image",
          "price": null,
          "dependsOn": [
            "resolution",
            "quality",
            "provider_route",
            "hardware"
          ],
          "sourceUrls": [
            "https://fal.ai/docs/platform-apis/v1/models/pricing",
            "https://fal.ai/models"
          ],
          "verifiedAt": null,
          "notes": "Image pricing must preserve native units such as image, megapixel, generation, prediction, or compute seconds."
        },
        "freeAccess": {
          "isFree": false,
          "isPromotional": false
        }
      }
    },
    {
      "id": "fal:fal-ai/flux-pro/kontext",
      "provider": "fal",
      "providerModelId": "fal-ai/flux-pro/kontext",
      "displayName": "FLUX.1 Kontext Pro",
      "type": "image",
      "capabilities": {
        "modalities": [
          "image.generate",
          "image.edit"
        ]
      },
      "pricing": {
        "inputPerMillionUsd": null,
        "outputPerMillionUsd": null,
        "source": "unknown",
        "note": "Image pricing must preserve native units such as image, megapixel, generation, prediction, or compute seconds."
      },
      "inputTypes": [
        "text",
        "image"
      ],
      "outputTypes": [
        "image"
      ],
      "registry": {
        "category": "image.editing",
        "status": "active",
        "developer": "Black Forest Labs",
        "family": "flux-kontext",
        "version": "fal-ai/flux-pro/kontext",
        "supportedRegions": [],
        "endpoints": [
          "images.generations",
          "images.edits"
        ],
        "aliases": [
          "fal-ai/flux-pro/kontext"
        ],
        "fallbackModelIds": [],
        "verificationLevel": "verifiedDocumentationOnly",
        "source": {
          "authority": "studio-curated",
          "checkedAt": "2026-07-11",
          "urls": [
            "https://fal.ai/docs/platform-apis/v1/models/pricing",
            "https://fal.ai/models"
          ]
        },
        "pricing": {
          "kind": "image",
          "status": "provider_variable",
          "currency": "USD",
          "billingUnit": "image",
          "price": null,
          "dependsOn": [
            "resolution",
            "quality",
            "provider_route",
            "hardware"
          ],
          "sourceUrls": [
            "https://fal.ai/docs/platform-apis/v1/models/pricing",
            "https://fal.ai/models"
          ],
          "verifiedAt": null,
          "notes": "Image pricing must preserve native units such as image, megapixel, generation, prediction, or compute seconds."
        },
        "freeAccess": {
          "isFree": false,
          "isPromotional": false
        }
      }
    },
    {
      "id": "fal:fal-ai/flux-pro/v1/fill",
      "provider": "fal",
      "providerModelId": "fal-ai/flux-pro/v1/fill",
      "displayName": "FLUX.1 Fill Pro",
      "type": "image",
      "capabilities": {
        "modalities": [
          "image.generate",
          "image.edit"
        ]
      },
      "pricing": {
        "inputPerMillionUsd": null,
        "outputPerMillionUsd": null,
        "source": "unknown",
        "note": "Image pricing must preserve native units such as image, megapixel, generation, prediction, or compute seconds."
      },
      "inputTypes": [
        "text",
        "image"
      ],
      "outputTypes": [
        "image"
      ],
      "registry": {
        "category": "image.editing",
        "status": "active",
        "developer": "Black Forest Labs",
        "family": "flux-fill",
        "version": "fal-ai/flux-pro/v1/fill",
        "supportedRegions": [],
        "endpoints": [
          "images.generations",
          "images.edits"
        ],
        "aliases": [
          "fal-ai/flux-pro/v1/fill"
        ],
        "fallbackModelIds": [],
        "verificationLevel": "verifiedDocumentationOnly",
        "source": {
          "authority": "studio-curated",
          "checkedAt": "2026-07-11",
          "urls": [
            "https://fal.ai/docs/platform-apis/v1/models/pricing",
            "https://fal.ai/models"
          ]
        },
        "pricing": {
          "kind": "image",
          "status": "provider_variable",
          "currency": "USD",
          "billingUnit": "image",
          "price": null,
          "dependsOn": [
            "resolution",
            "quality",
            "provider_route",
            "hardware"
          ],
          "sourceUrls": [
            "https://fal.ai/docs/platform-apis/v1/models/pricing",
            "https://fal.ai/models"
          ],
          "verifiedAt": null,
          "notes": "Image pricing must preserve native units such as image, megapixel, generation, prediction, or compute seconds."
        },
        "freeAccess": {
          "isFree": false,
          "isPromotional": false
        }
      }
    },
    {
      "id": "fal:fal-ai/veo3.1",
      "provider": "fal",
      "providerModelId": "fal-ai/veo3.1",
      "displayName": "Veo 3.1",
      "type": "video",
      "capabilities": {
        "modalities": [
          "video.generate"
        ]
      },
      "pricing": {
        "inputPerMillionUsd": null,
        "outputPerMillionUsd": null,
        "source": "unknown",
        "note": "Video pricing may depend on duration, resolution, frame rate, quality, route, and runtime hardware."
      },
      "inputTypes": [
        "text",
        "image"
      ],
      "outputTypes": [
        "video"
      ],
      "registry": {
        "category": "video.generation",
        "status": "active",
        "developer": "Google",
        "family": "veo",
        "version": "fal-ai/veo3.1",
        "supportedRegions": [],
        "endpoints": [
          "videos.generations"
        ],
        "aliases": [
          "fal-ai/veo3.1"
        ],
        "fallbackModelIds": [],
        "verificationLevel": "verifiedDocumentationOnly",
        "source": {
          "authority": "studio-curated",
          "checkedAt": "2026-07-11",
          "urls": [
            "https://fal.ai/docs/platform-apis/v1/models/pricing",
            "https://fal.ai/models"
          ]
        },
        "pricing": {
          "kind": "video",
          "status": "provider_variable",
          "currency": "USD",
          "billingUnit": "video_second",
          "price": null,
          "dependsOn": [
            "duration",
            "resolution",
            "fps",
            "quality",
            "provider_route",
            "hardware"
          ],
          "sourceUrls": [
            "https://fal.ai/docs/platform-apis/v1/models/pricing",
            "https://fal.ai/models"
          ],
          "verifiedAt": null,
          "notes": "Video pricing may depend on duration, resolution, frame rate, quality, route, and runtime hardware."
        },
        "freeAccess": {
          "isFree": false,
          "isPromotional": false
        }
      }
    },
    {
      "id": "fal:fal-ai/veo3.1/fast",
      "provider": "fal",
      "providerModelId": "fal-ai/veo3.1/fast",
      "displayName": "Veo 3.1 Fast",
      "type": "video",
      "capabilities": {
        "modalities": [
          "video.generate"
        ]
      },
      "pricing": {
        "inputPerMillionUsd": null,
        "outputPerMillionUsd": null,
        "source": "unknown",
        "note": "Video pricing may depend on duration, resolution, frame rate, quality, route, and runtime hardware."
      },
      "inputTypes": [
        "text",
        "image"
      ],
      "outputTypes": [
        "video"
      ],
      "registry": {
        "category": "video.generation",
        "status": "active",
        "developer": "Google",
        "family": "veo",
        "version": "fal-ai/veo3.1/fast",
        "supportedRegions": [],
        "endpoints": [
          "videos.generations"
        ],
        "aliases": [
          "fal-ai/veo3.1/fast"
        ],
        "fallbackModelIds": [],
        "verificationLevel": "verifiedDocumentationOnly",
        "source": {
          "authority": "studio-curated",
          "checkedAt": "2026-07-11",
          "urls": [
            "https://fal.ai/docs/platform-apis/v1/models/pricing",
            "https://fal.ai/models"
          ]
        },
        "pricing": {
          "kind": "video",
          "status": "provider_variable",
          "currency": "USD",
          "billingUnit": "video_second",
          "price": null,
          "dependsOn": [
            "duration",
            "resolution",
            "fps",
            "quality",
            "provider_route",
            "hardware"
          ],
          "sourceUrls": [
            "https://fal.ai/docs/platform-apis/v1/models/pricing",
            "https://fal.ai/models"
          ],
          "verifiedAt": null,
          "notes": "Video pricing may depend on duration, resolution, frame rate, quality, route, and runtime hardware."
        },
        "freeAccess": {
          "isFree": false,
          "isPromotional": false
        }
      }
    },
    {
      "id": "fal:fal-ai/veo3.1/lite",
      "provider": "fal",
      "providerModelId": "fal-ai/veo3.1/lite",
      "displayName": "Veo 3.1 Lite",
      "type": "video",
      "capabilities": {
        "modalities": [
          "video.generate"
        ]
      },
      "pricing": {
        "inputPerMillionUsd": null,
        "outputPerMillionUsd": null,
        "source": "unknown",
        "note": "Video pricing may depend on duration, resolution, frame rate, quality, route, and runtime hardware."
      },
      "inputTypes": [
        "text",
        "image"
      ],
      "outputTypes": [
        "video"
      ],
      "registry": {
        "category": "video.generation",
        "status": "active",
        "developer": "Google",
        "family": "veo",
        "version": "fal-ai/veo3.1/lite",
        "supportedRegions": [],
        "endpoints": [
          "videos.generations"
        ],
        "aliases": [
          "fal-ai/veo3.1/lite"
        ],
        "fallbackModelIds": [],
        "verificationLevel": "verifiedDocumentationOnly",
        "source": {
          "authority": "studio-curated",
          "checkedAt": "2026-07-11",
          "urls": [
            "https://fal.ai/docs/platform-apis/v1/models/pricing",
            "https://fal.ai/models"
          ]
        },
        "pricing": {
          "kind": "video",
          "status": "provider_variable",
          "currency": "USD",
          "billingUnit": "video_second",
          "price": null,
          "dependsOn": [
            "duration",
            "resolution",
            "fps",
            "quality",
            "provider_route",
            "hardware"
          ],
          "sourceUrls": [
            "https://fal.ai/docs/platform-apis/v1/models/pricing",
            "https://fal.ai/models"
          ],
          "verifiedAt": null,
          "notes": "Video pricing may depend on duration, resolution, frame rate, quality, route, and runtime hardware."
        },
        "freeAccess": {
          "isFree": false,
          "isPromotional": false
        }
      }
    },
    {
      "id": "fal:bytedance/seedance-2.0/image-to-video",
      "provider": "fal",
      "providerModelId": "bytedance/seedance-2.0/image-to-video",
      "displayName": "Seedance 2.0 Image to Video",
      "type": "video",
      "capabilities": {
        "modalities": [
          "video.generate"
        ]
      },
      "pricing": {
        "inputPerMillionUsd": null,
        "outputPerMillionUsd": null,
        "source": "unknown",
        "note": "Video pricing may depend on duration, resolution, frame rate, quality, route, and runtime hardware."
      },
      "inputTypes": [
        "text",
        "image"
      ],
      "outputTypes": [
        "video"
      ],
      "registry": {
        "category": "video.generation",
        "status": "active",
        "developer": "ByteDance",
        "family": "seedance",
        "version": "bytedance/seedance-2.0/image-to-video",
        "supportedRegions": [],
        "endpoints": [
          "videos.generations"
        ],
        "aliases": [
          "bytedance/seedance-2.0/image-to-video"
        ],
        "fallbackModelIds": [],
        "verificationLevel": "verifiedDocumentationOnly",
        "source": {
          "authority": "studio-curated",
          "checkedAt": "2026-07-11",
          "urls": [
            "https://fal.ai/docs/platform-apis/v1/models/pricing",
            "https://fal.ai/models"
          ]
        },
        "pricing": {
          "kind": "video",
          "status": "provider_variable",
          "currency": "USD",
          "billingUnit": "video_second",
          "price": null,
          "dependsOn": [
            "duration",
            "resolution",
            "fps",
            "quality",
            "provider_route",
            "hardware"
          ],
          "sourceUrls": [
            "https://fal.ai/docs/platform-apis/v1/models/pricing",
            "https://fal.ai/models"
          ],
          "verifiedAt": null,
          "notes": "Video pricing may depend on duration, resolution, frame rate, quality, route, and runtime hardware."
        },
        "freeAccess": {
          "isFree": false,
          "isPromotional": false
        }
      }
    },
    {
      "id": "fal:fal-ai/wan/v2.7/image-to-video",
      "provider": "fal",
      "providerModelId": "fal-ai/wan/v2.7/image-to-video",
      "displayName": "Wan 2.7 Image to Video",
      "type": "video",
      "capabilities": {
        "modalities": [
          "video.generate"
        ]
      },
      "pricing": {
        "inputPerMillionUsd": null,
        "outputPerMillionUsd": null,
        "source": "unknown",
        "note": "Video pricing may depend on duration, resolution, frame rate, quality, route, and runtime hardware."
      },
      "inputTypes": [
        "text",
        "image"
      ],
      "outputTypes": [
        "video"
      ],
      "registry": {
        "category": "video.generation",
        "status": "active",
        "developer": "Alibaba",
        "family": "wan",
        "version": "fal-ai/wan/v2.7/image-to-video",
        "supportedRegions": [],
        "endpoints": [
          "videos.generations"
        ],
        "aliases": [
          "fal-ai/wan/v2.7/image-to-video"
        ],
        "fallbackModelIds": [],
        "verificationLevel": "verifiedDocumentationOnly",
        "source": {
          "authority": "studio-curated",
          "checkedAt": "2026-07-11",
          "urls": [
            "https://fal.ai/docs/platform-apis/v1/models/pricing",
            "https://fal.ai/models"
          ]
        },
        "pricing": {
          "kind": "video",
          "status": "provider_variable",
          "currency": "USD",
          "billingUnit": "video_second",
          "price": null,
          "dependsOn": [
            "duration",
            "resolution",
            "fps",
            "quality",
            "provider_route",
            "hardware"
          ],
          "sourceUrls": [
            "https://fal.ai/docs/platform-apis/v1/models/pricing",
            "https://fal.ai/models"
          ],
          "verifiedAt": null,
          "notes": "Video pricing may depend on duration, resolution, frame rate, quality, route, and runtime hardware."
        },
        "freeAccess": {
          "isFree": false,
          "isPromotional": false
        }
      }
    },
    {
      "id": "replicate:bytedance/seedream-4.5",
      "provider": "replicate",
      "providerModelId": "bytedance/seedream-4.5",
      "displayName": "Seedream 4.5",
      "type": "image",
      "capabilities": {
        "modalities": [
          "image.generate",
          "image.edit"
        ]
      },
      "pricing": {
        "inputPerMillionUsd": null,
        "outputPerMillionUsd": null,
        "source": "unknown",
        "note": "Image pricing must preserve native units such as image, megapixel, generation, prediction, or compute seconds."
      },
      "inputTypes": [
        "text",
        "image"
      ],
      "outputTypes": [
        "image"
      ],
      "registry": {
        "category": "image.editing",
        "status": "active",
        "developer": "ByteDance",
        "family": "seedream",
        "version": "bytedance/seedream-4.5",
        "supportedRegions": [],
        "endpoints": [
          "images.generations",
          "images.edits"
        ],
        "aliases": [
          "bytedance/seedream-4.5"
        ],
        "fallbackModelIds": [],
        "verificationLevel": "verifiedDocumentationOnly",
        "source": {
          "authority": "studio-curated",
          "checkedAt": "2026-07-11",
          "urls": [
            "https://replicate.com/pricing",
            "https://replicate.com/docs/topics/models/official-models"
          ]
        },
        "pricing": {
          "kind": "image",
          "status": "provider_variable",
          "currency": "USD",
          "billingUnit": "prediction",
          "price": null,
          "dependsOn": [
            "resolution",
            "quality",
            "provider_route",
            "hardware"
          ],
          "sourceUrls": [
            "https://replicate.com/pricing",
            "https://replicate.com/docs/topics/models/official-models"
          ],
          "verifiedAt": null,
          "notes": "Image pricing must preserve native units such as image, megapixel, generation, prediction, or compute seconds."
        },
        "freeAccess": {
          "isFree": false,
          "isPromotional": false
        }
      }
    },
    {
      "id": "replicate:bytedance/seedream-4",
      "provider": "replicate",
      "providerModelId": "bytedance/seedream-4",
      "displayName": "Seedream 4",
      "type": "image",
      "capabilities": {
        "modalities": [
          "image.generate",
          "image.edit"
        ]
      },
      "pricing": {
        "inputPerMillionUsd": null,
        "outputPerMillionUsd": null,
        "source": "unknown",
        "note": "Image pricing must preserve native units such as image, megapixel, generation, prediction, or compute seconds."
      },
      "inputTypes": [
        "text",
        "image"
      ],
      "outputTypes": [
        "image"
      ],
      "registry": {
        "category": "image.editing",
        "status": "active",
        "developer": "ByteDance",
        "family": "seedream",
        "version": "bytedance/seedream-4",
        "supportedRegions": [],
        "endpoints": [
          "images.generations",
          "images.edits"
        ],
        "aliases": [
          "bytedance/seedream-4"
        ],
        "fallbackModelIds": [],
        "verificationLevel": "verifiedDocumentationOnly",
        "source": {
          "authority": "studio-curated",
          "checkedAt": "2026-07-11",
          "urls": [
            "https://replicate.com/pricing",
            "https://replicate.com/docs/topics/models/official-models"
          ]
        },
        "pricing": {
          "kind": "image",
          "status": "provider_variable",
          "currency": "USD",
          "billingUnit": "prediction",
          "price": null,
          "dependsOn": [
            "resolution",
            "quality",
            "provider_route",
            "hardware"
          ],
          "sourceUrls": [
            "https://replicate.com/pricing",
            "https://replicate.com/docs/topics/models/official-models"
          ],
          "verifiedAt": null,
          "notes": "Image pricing must preserve native units such as image, megapixel, generation, prediction, or compute seconds."
        },
        "freeAccess": {
          "isFree": false,
          "isPromotional": false
        }
      }
    },
    {
      "id": "replicate:black-forest-labs/flux-2-flex",
      "provider": "replicate",
      "providerModelId": "black-forest-labs/flux-2-flex",
      "displayName": "FLUX.2 Flex",
      "type": "image",
      "capabilities": {
        "modalities": [
          "image.generate",
          "image.edit"
        ]
      },
      "pricing": {
        "inputPerMillionUsd": null,
        "outputPerMillionUsd": null,
        "source": "unknown",
        "note": "Image pricing must preserve native units such as image, megapixel, generation, prediction, or compute seconds."
      },
      "inputTypes": [
        "text",
        "image"
      ],
      "outputTypes": [
        "image"
      ],
      "registry": {
        "category": "image.editing",
        "status": "active",
        "developer": "Black Forest Labs",
        "family": "flux",
        "version": "black-forest-labs/flux-2-flex",
        "supportedRegions": [],
        "endpoints": [
          "images.generations",
          "images.edits"
        ],
        "aliases": [
          "black-forest-labs/flux-2-flex"
        ],
        "fallbackModelIds": [],
        "verificationLevel": "verifiedDocumentationOnly",
        "source": {
          "authority": "studio-curated",
          "checkedAt": "2026-07-11",
          "urls": [
            "https://replicate.com/pricing",
            "https://replicate.com/docs/topics/models/official-models"
          ]
        },
        "pricing": {
          "kind": "image",
          "status": "provider_variable",
          "currency": "USD",
          "billingUnit": "prediction",
          "price": null,
          "dependsOn": [
            "resolution",
            "quality",
            "provider_route",
            "hardware"
          ],
          "sourceUrls": [
            "https://replicate.com/pricing",
            "https://replicate.com/docs/topics/models/official-models"
          ],
          "verifiedAt": null,
          "notes": "Image pricing must preserve native units such as image, megapixel, generation, prediction, or compute seconds."
        },
        "freeAccess": {
          "isFree": false,
          "isPromotional": false
        }
      }
    },
    {
      "id": "replicate:black-forest-labs/flux-kontext-pro",
      "provider": "replicate",
      "providerModelId": "black-forest-labs/flux-kontext-pro",
      "displayName": "FLUX Kontext Pro",
      "type": "image",
      "capabilities": {
        "modalities": [
          "image.generate",
          "image.edit"
        ]
      },
      "pricing": {
        "inputPerMillionUsd": null,
        "outputPerMillionUsd": null,
        "source": "unknown",
        "note": "Image pricing must preserve native units such as image, megapixel, generation, prediction, or compute seconds."
      },
      "inputTypes": [
        "text",
        "image"
      ],
      "outputTypes": [
        "image"
      ],
      "registry": {
        "category": "image.editing",
        "status": "active",
        "developer": "Black Forest Labs",
        "family": "flux-kontext",
        "version": "black-forest-labs/flux-kontext-pro",
        "supportedRegions": [],
        "endpoints": [
          "images.generations",
          "images.edits"
        ],
        "aliases": [
          "black-forest-labs/flux-kontext-pro"
        ],
        "fallbackModelIds": [],
        "verificationLevel": "verifiedDocumentationOnly",
        "source": {
          "authority": "studio-curated",
          "checkedAt": "2026-07-11",
          "urls": [
            "https://replicate.com/pricing",
            "https://replicate.com/docs/topics/models/official-models"
          ]
        },
        "pricing": {
          "kind": "image",
          "status": "provider_variable",
          "currency": "USD",
          "billingUnit": "prediction",
          "price": null,
          "dependsOn": [
            "resolution",
            "quality",
            "provider_route",
            "hardware"
          ],
          "sourceUrls": [
            "https://replicate.com/pricing",
            "https://replicate.com/docs/topics/models/official-models"
          ],
          "verifiedAt": null,
          "notes": "Image pricing must preserve native units such as image, megapixel, generation, prediction, or compute seconds."
        },
        "freeAccess": {
          "isFree": false,
          "isPromotional": false
        }
      }
    },
    {
      "id": "replicate:black-forest-labs/flux-kontext-max",
      "provider": "replicate",
      "providerModelId": "black-forest-labs/flux-kontext-max",
      "displayName": "FLUX Kontext Max",
      "type": "image",
      "capabilities": {
        "modalities": [
          "image.generate",
          "image.edit"
        ]
      },
      "pricing": {
        "inputPerMillionUsd": null,
        "outputPerMillionUsd": null,
        "source": "unknown",
        "note": "Image pricing must preserve native units such as image, megapixel, generation, prediction, or compute seconds."
      },
      "inputTypes": [
        "text",
        "image"
      ],
      "outputTypes": [
        "image"
      ],
      "registry": {
        "category": "image.editing",
        "status": "active",
        "developer": "Black Forest Labs",
        "family": "flux-kontext",
        "version": "black-forest-labs/flux-kontext-max",
        "supportedRegions": [],
        "endpoints": [
          "images.generations",
          "images.edits"
        ],
        "aliases": [
          "black-forest-labs/flux-kontext-max"
        ],
        "fallbackModelIds": [],
        "verificationLevel": "verifiedDocumentationOnly",
        "source": {
          "authority": "studio-curated",
          "checkedAt": "2026-07-11",
          "urls": [
            "https://replicate.com/pricing",
            "https://replicate.com/docs/topics/models/official-models"
          ]
        },
        "pricing": {
          "kind": "image",
          "status": "provider_variable",
          "currency": "USD",
          "billingUnit": "prediction",
          "price": null,
          "dependsOn": [
            "resolution",
            "quality",
            "provider_route",
            "hardware"
          ],
          "sourceUrls": [
            "https://replicate.com/pricing",
            "https://replicate.com/docs/topics/models/official-models"
          ],
          "verifiedAt": null,
          "notes": "Image pricing must preserve native units such as image, megapixel, generation, prediction, or compute seconds."
        },
        "freeAccess": {
          "isFree": false,
          "isPromotional": false
        }
      }
    },
    {
      "id": "replicate:google/veo-3.1-lite",
      "provider": "replicate",
      "providerModelId": "google/veo-3.1-lite",
      "displayName": "Veo 3.1 Lite",
      "type": "video",
      "capabilities": {
        "modalities": [
          "video.generate"
        ]
      },
      "pricing": {
        "inputPerMillionUsd": null,
        "outputPerMillionUsd": null,
        "source": "unknown",
        "note": "Video pricing may depend on duration, resolution, frame rate, quality, route, and runtime hardware."
      },
      "inputTypes": [
        "text",
        "image"
      ],
      "outputTypes": [
        "video"
      ],
      "registry": {
        "category": "video.generation",
        "status": "active",
        "developer": "Google",
        "family": "veo",
        "version": "google/veo-3.1-lite",
        "supportedRegions": [],
        "endpoints": [
          "videos.generations"
        ],
        "aliases": [
          "google/veo-3.1-lite"
        ],
        "fallbackModelIds": [],
        "verificationLevel": "verifiedDocumentationOnly",
        "source": {
          "authority": "studio-curated",
          "checkedAt": "2026-07-11",
          "urls": [
            "https://replicate.com/pricing",
            "https://replicate.com/docs/topics/models/official-models"
          ]
        },
        "pricing": {
          "kind": "video",
          "status": "provider_variable",
          "currency": "USD",
          "billingUnit": "prediction",
          "price": null,
          "dependsOn": [
            "duration",
            "resolution",
            "fps",
            "quality",
            "provider_route",
            "hardware"
          ],
          "sourceUrls": [
            "https://replicate.com/pricing",
            "https://replicate.com/docs/topics/models/official-models"
          ],
          "verifiedAt": null,
          "notes": "Video pricing may depend on duration, resolution, frame rate, quality, route, and runtime hardware."
        },
        "freeAccess": {
          "isFree": false,
          "isPromotional": false
        }
      }
    },
    {
      "id": "replicate:bytedance/seedance-2.0-fast",
      "provider": "replicate",
      "providerModelId": "bytedance/seedance-2.0-fast",
      "displayName": "Seedance 2.0 Fast",
      "type": "video",
      "capabilities": {
        "modalities": [
          "video.generate"
        ]
      },
      "pricing": {
        "inputPerMillionUsd": null,
        "outputPerMillionUsd": null,
        "source": "unknown",
        "note": "Video pricing may depend on duration, resolution, frame rate, quality, route, and runtime hardware."
      },
      "inputTypes": [
        "text",
        "image"
      ],
      "outputTypes": [
        "video"
      ],
      "registry": {
        "category": "video.generation",
        "status": "active",
        "developer": "ByteDance",
        "family": "seedance",
        "version": "bytedance/seedance-2.0-fast",
        "supportedRegions": [],
        "endpoints": [
          "videos.generations"
        ],
        "aliases": [
          "bytedance/seedance-2.0-fast"
        ],
        "fallbackModelIds": [],
        "verificationLevel": "verifiedDocumentationOnly",
        "source": {
          "authority": "studio-curated",
          "checkedAt": "2026-07-11",
          "urls": [
            "https://replicate.com/pricing",
            "https://replicate.com/docs/topics/models/official-models"
          ]
        },
        "pricing": {
          "kind": "video",
          "status": "provider_variable",
          "currency": "USD",
          "billingUnit": "prediction",
          "price": null,
          "dependsOn": [
            "duration",
            "resolution",
            "fps",
            "quality",
            "provider_route",
            "hardware"
          ],
          "sourceUrls": [
            "https://replicate.com/pricing",
            "https://replicate.com/docs/topics/models/official-models"
          ],
          "verifiedAt": null,
          "notes": "Video pricing may depend on duration, resolution, frame rate, quality, route, and runtime hardware."
        },
        "freeAccess": {
          "isFree": false,
          "isPromotional": false
        }
      }
    },
    {
      "id": "replicate:bytedance/seedance-2.0",
      "provider": "replicate",
      "providerModelId": "bytedance/seedance-2.0",
      "displayName": "Seedance 2.0",
      "type": "video",
      "capabilities": {
        "modalities": [
          "video.generate"
        ]
      },
      "pricing": {
        "inputPerMillionUsd": null,
        "outputPerMillionUsd": null,
        "source": "unknown",
        "note": "Video pricing may depend on duration, resolution, frame rate, quality, route, and runtime hardware."
      },
      "inputTypes": [
        "text",
        "image"
      ],
      "outputTypes": [
        "video"
      ],
      "registry": {
        "category": "video.generation",
        "status": "active",
        "developer": "ByteDance",
        "family": "seedance",
        "version": "bytedance/seedance-2.0",
        "supportedRegions": [],
        "endpoints": [
          "videos.generations"
        ],
        "aliases": [
          "bytedance/seedance-2.0"
        ],
        "fallbackModelIds": [],
        "verificationLevel": "verifiedDocumentationOnly",
        "source": {
          "authority": "studio-curated",
          "checkedAt": "2026-07-11",
          "urls": [
            "https://replicate.com/pricing",
            "https://replicate.com/docs/topics/models/official-models"
          ]
        },
        "pricing": {
          "kind": "video",
          "status": "provider_variable",
          "currency": "USD",
          "billingUnit": "prediction",
          "price": null,
          "dependsOn": [
            "duration",
            "resolution",
            "fps",
            "quality",
            "provider_route",
            "hardware"
          ],
          "sourceUrls": [
            "https://replicate.com/pricing",
            "https://replicate.com/docs/topics/models/official-models"
          ],
          "verifiedAt": null,
          "notes": "Video pricing may depend on duration, resolution, frame rate, quality, route, and runtime hardware."
        },
        "freeAccess": {
          "isFree": false,
          "isPromotional": false
        }
      }
    },
    {
      "id": "replicate:kwaivgi/kling-v3-video",
      "provider": "replicate",
      "providerModelId": "kwaivgi/kling-v3-video",
      "displayName": "Kling v3 Video",
      "type": "video",
      "capabilities": {
        "modalities": [
          "video.generate"
        ]
      },
      "pricing": {
        "inputPerMillionUsd": null,
        "outputPerMillionUsd": null,
        "source": "unknown",
        "note": "Video pricing may depend on duration, resolution, frame rate, quality, route, and runtime hardware."
      },
      "inputTypes": [
        "text",
        "image"
      ],
      "outputTypes": [
        "video"
      ],
      "registry": {
        "category": "video.generation",
        "status": "active",
        "developer": "Kuaishou",
        "family": "kling",
        "version": "kwaivgi/kling-v3-video",
        "supportedRegions": [],
        "endpoints": [
          "videos.generations"
        ],
        "aliases": [
          "kwaivgi/kling-v3-video"
        ],
        "fallbackModelIds": [],
        "verificationLevel": "verifiedDocumentationOnly",
        "source": {
          "authority": "studio-curated",
          "checkedAt": "2026-07-11",
          "urls": [
            "https://replicate.com/pricing",
            "https://replicate.com/docs/topics/models/official-models"
          ]
        },
        "pricing": {
          "kind": "video",
          "status": "provider_variable",
          "currency": "USD",
          "billingUnit": "prediction",
          "price": null,
          "dependsOn": [
            "duration",
            "resolution",
            "fps",
            "quality",
            "provider_route",
            "hardware"
          ],
          "sourceUrls": [
            "https://replicate.com/pricing",
            "https://replicate.com/docs/topics/models/official-models"
          ],
          "verifiedAt": null,
          "notes": "Video pricing may depend on duration, resolution, frame rate, quality, route, and runtime hardware."
        },
        "freeAccess": {
          "isFree": false,
          "isPromotional": false
        }
      }
    },
    {
      "id": "elevenlabs:eleven_v3",
      "provider": "elevenlabs",
      "providerModelId": "eleven_v3",
      "displayName": "Eleven v3",
      "type": "tts",
      "capabilities": {
        "modalities": [
          "speech"
        ]
      },
      "pricing": {
        "inputPerMillionUsd": null,
        "outputPerMillionUsd": null,
        "source": "unknown",
        "note": "Speech pricing must preserve provider units such as character, credit, minute, or generation."
      },
      "inputTypes": [
        "text"
      ],
      "outputTypes": [
        "audio"
      ],
      "registry": {
        "category": "audio.speech",
        "status": "active",
        "developer": "ElevenLabs",
        "family": "eleven",
        "version": "eleven_v3",
        "supportedRegions": [],
        "endpoints": [
          "audio.speech"
        ],
        "aliases": [
          "eleven_v3"
        ],
        "fallbackModelIds": [],
        "verificationLevel": "verifiedDocumentationOnly",
        "source": {
          "authority": "studio-curated",
          "checkedAt": "2026-07-11",
          "urls": [
            "https://elevenlabs.io/docs/overview/models",
            "https://elevenlabs.io/pricing/api"
          ]
        },
        "pricing": {
          "kind": "audio",
          "status": "unknown",
          "currency": "USD",
          "billingUnit": "character",
          "price": null,
          "sourceUrls": [
            "https://elevenlabs.io/docs/overview/models",
            "https://elevenlabs.io/pricing/api"
          ],
          "verifiedAt": null,
          "notes": "Speech pricing must preserve provider units such as character, credit, minute, or generation."
        },
        "freeAccess": {
          "isFree": false,
          "isPromotional": false
        }
      }
    },
    {
      "id": "elevenlabs:eleven_multilingual_v2",
      "provider": "elevenlabs",
      "providerModelId": "eleven_multilingual_v2",
      "displayName": "Eleven Multilingual v2",
      "type": "tts",
      "capabilities": {
        "modalities": [
          "speech"
        ]
      },
      "pricing": {
        "inputPerMillionUsd": null,
        "outputPerMillionUsd": null,
        "source": "unknown",
        "note": "Speech pricing must preserve provider units such as character, credit, minute, or generation."
      },
      "inputTypes": [
        "text"
      ],
      "outputTypes": [
        "audio"
      ],
      "registry": {
        "category": "audio.speech",
        "status": "active",
        "developer": "ElevenLabs",
        "family": "eleven",
        "version": "eleven_multilingual_v2",
        "supportedRegions": [],
        "endpoints": [
          "audio.speech"
        ],
        "aliases": [
          "eleven_multilingual_v2"
        ],
        "fallbackModelIds": [],
        "verificationLevel": "verifiedDocumentationOnly",
        "source": {
          "authority": "studio-curated",
          "checkedAt": "2026-07-11",
          "urls": [
            "https://elevenlabs.io/docs/overview/models",
            "https://elevenlabs.io/pricing/api"
          ]
        },
        "pricing": {
          "kind": "audio",
          "status": "unknown",
          "currency": "USD",
          "billingUnit": "character",
          "price": null,
          "sourceUrls": [
            "https://elevenlabs.io/docs/overview/models",
            "https://elevenlabs.io/pricing/api"
          ],
          "verifiedAt": null,
          "notes": "Speech pricing must preserve provider units such as character, credit, minute, or generation."
        },
        "freeAccess": {
          "isFree": false,
          "isPromotional": false
        }
      }
    },
    {
      "id": "elevenlabs:eleven_flash_v2_5",
      "provider": "elevenlabs",
      "providerModelId": "eleven_flash_v2_5",
      "displayName": "Eleven Flash v2.5",
      "type": "tts",
      "capabilities": {
        "modalities": [
          "speech"
        ]
      },
      "pricing": {
        "inputPerMillionUsd": null,
        "outputPerMillionUsd": null,
        "source": "unknown",
        "note": "Speech pricing must preserve provider units such as character, credit, minute, or generation."
      },
      "inputTypes": [
        "text"
      ],
      "outputTypes": [
        "audio"
      ],
      "registry": {
        "category": "audio.speech",
        "status": "active",
        "developer": "ElevenLabs",
        "family": "eleven-flash",
        "version": "eleven_flash_v2_5",
        "supportedRegions": [],
        "endpoints": [
          "audio.speech"
        ],
        "aliases": [
          "eleven_flash_v2_5"
        ],
        "fallbackModelIds": [],
        "verificationLevel": "verifiedDocumentationOnly",
        "source": {
          "authority": "studio-curated",
          "checkedAt": "2026-07-11",
          "urls": [
            "https://elevenlabs.io/docs/overview/models",
            "https://elevenlabs.io/pricing/api"
          ]
        },
        "pricing": {
          "kind": "audio",
          "status": "unknown",
          "currency": "USD",
          "billingUnit": "character",
          "price": null,
          "sourceUrls": [
            "https://elevenlabs.io/docs/overview/models",
            "https://elevenlabs.io/pricing/api"
          ],
          "verifiedAt": null,
          "notes": "Speech pricing must preserve provider units such as character, credit, minute, or generation."
        },
        "freeAccess": {
          "isFree": false,
          "isPromotional": false
        }
      }
    },
    {
      "id": "elevenlabs:eleven_flash_v2",
      "provider": "elevenlabs",
      "providerModelId": "eleven_flash_v2",
      "displayName": "Eleven Flash v2",
      "type": "tts",
      "capabilities": {
        "modalities": [
          "speech"
        ]
      },
      "pricing": {
        "inputPerMillionUsd": null,
        "outputPerMillionUsd": null,
        "source": "unknown",
        "note": "Speech pricing must preserve provider units such as character, credit, minute, or generation."
      },
      "inputTypes": [
        "text"
      ],
      "outputTypes": [
        "audio"
      ],
      "registry": {
        "category": "audio.speech",
        "status": "active",
        "developer": "ElevenLabs",
        "family": "eleven-flash",
        "version": "eleven_flash_v2",
        "supportedRegions": [],
        "endpoints": [
          "audio.speech"
        ],
        "aliases": [
          "eleven_flash_v2"
        ],
        "fallbackModelIds": [],
        "verificationLevel": "verifiedDocumentationOnly",
        "source": {
          "authority": "studio-curated",
          "checkedAt": "2026-07-11",
          "urls": [
            "https://elevenlabs.io/docs/overview/models",
            "https://elevenlabs.io/pricing/api"
          ]
        },
        "pricing": {
          "kind": "audio",
          "status": "unknown",
          "currency": "USD",
          "billingUnit": "character",
          "price": null,
          "sourceUrls": [
            "https://elevenlabs.io/docs/overview/models",
            "https://elevenlabs.io/pricing/api"
          ],
          "verifiedAt": null,
          "notes": "Speech pricing must preserve provider units such as character, credit, minute, or generation."
        },
        "freeAccess": {
          "isFree": false,
          "isPromotional": false
        }
      }
    },
    {
      "id": "elevenlabs:scribe_v2",
      "provider": "elevenlabs",
      "providerModelId": "scribe_v2",
      "displayName": "Scribe v2",
      "type": "audio",
      "capabilities": {
        "modalities": [
          "transcription"
        ]
      },
      "pricing": {
        "inputPerMillionUsd": null,
        "outputPerMillionUsd": null,
        "source": "unknown",
        "note": "Transcription pricing is duration based for most supported providers."
      },
      "inputTypes": [
        "audio"
      ],
      "outputTypes": [
        "text"
      ],
      "registry": {
        "category": "audio.transcription",
        "status": "active",
        "developer": "ElevenLabs",
        "family": "scribe",
        "version": "scribe_v2",
        "supportedRegions": [],
        "endpoints": [
          "audio.transcriptions"
        ],
        "aliases": [
          "scribe_v2"
        ],
        "fallbackModelIds": [],
        "verificationLevel": "verifiedDocumentationOnly",
        "source": {
          "authority": "studio-curated",
          "checkedAt": "2026-07-11",
          "urls": [
            "https://elevenlabs.io/docs/overview/models",
            "https://elevenlabs.io/pricing/api"
          ]
        },
        "pricing": {
          "kind": "audio",
          "status": "unknown",
          "currency": "USD",
          "billingUnit": "audio_minute",
          "price": null,
          "sourceUrls": [
            "https://elevenlabs.io/docs/overview/models",
            "https://elevenlabs.io/pricing/api"
          ],
          "verifiedAt": null,
          "notes": "Transcription pricing is duration based for most supported providers."
        },
        "freeAccess": {
          "isFree": false,
          "isPromotional": false
        }
      }
    },
    {
      "id": "elevenlabs:scribe_v2_realtime",
      "provider": "elevenlabs",
      "providerModelId": "scribe_v2_realtime",
      "displayName": "Scribe v2 Realtime",
      "type": "audio",
      "capabilities": {
        "modalities": [
          "transcription"
        ]
      },
      "pricing": {
        "inputPerMillionUsd": null,
        "outputPerMillionUsd": null,
        "source": "unknown",
        "note": "Transcription pricing is duration based for most supported providers."
      },
      "inputTypes": [
        "audio"
      ],
      "outputTypes": [
        "text"
      ],
      "registry": {
        "category": "audio.transcription",
        "status": "active",
        "developer": "ElevenLabs",
        "family": "scribe",
        "version": "scribe_v2_realtime",
        "supportedRegions": [],
        "endpoints": [
          "audio.transcriptions"
        ],
        "aliases": [
          "scribe_v2_realtime"
        ],
        "fallbackModelIds": [],
        "verificationLevel": "verifiedDocumentationOnly",
        "source": {
          "authority": "studio-curated",
          "checkedAt": "2026-07-11",
          "urls": [
            "https://elevenlabs.io/docs/overview/models",
            "https://elevenlabs.io/pricing/api"
          ]
        },
        "pricing": {
          "kind": "audio",
          "status": "unknown",
          "currency": "USD",
          "billingUnit": "audio_minute",
          "price": null,
          "sourceUrls": [
            "https://elevenlabs.io/docs/overview/models",
            "https://elevenlabs.io/pricing/api"
          ],
          "verifiedAt": null,
          "notes": "Transcription pricing is duration based for most supported providers."
        },
        "freeAccess": {
          "isFree": false,
          "isPromotional": false
        }
      }
    },
    {
      "id": "openrouter:openai/gpt-5.6-sol",
      "provider": "openrouter",
      "providerModelId": "openai/gpt-5.6-sol",
      "displayName": "OpenAI GPT-5.6 Sol",
      "type": "multimodal",
      "capabilities": {
        "modalities": [
          "chat"
        ],
        "chat": {
          "streaming": true,
          "vision": true,
          "tools": true,
          "reasoning": {
            "supported": true,
            "efforts": [
              "low",
              "medium",
              "high"
            ],
            "defaultEffort": "medium",
            "source": "static-reviewed",
            "confidence": "exact"
          },
          "jsonSchema": true,
          "promptCaching": false
        }
      },
      "pricing": {
        "inputPerMillionUsd": 5,
        "outputPerMillionUsd": 30,
        "source": "static",
        "note": "Verified from live OpenRouter /api/v1/models. Do not copy to direct provider pricing."
      },
      "contextWindow": 1050000,
      "maxTokens": 128000,
      "supportsVision": true,
      "supportsTools": true,
      "supportsStreaming": true,
      "supportsSystemPrompts": true,
      "inputTypes": [
        "text",
        "image"
      ],
      "outputTypes": [
        "text"
      ],
      "specialFeatures": [
        "reasoning"
      ],
      "registry": {
        "category": "text.chat",
        "status": "active",
        "developer": "OpenAI",
        "family": "gpt-5.6",
        "version": "openai/gpt-5.6-sol",
        "supportedRegions": [],
        "endpoints": [
          "chat"
        ],
        "aliases": [
          "openai/gpt-5.6-sol"
        ],
        "fallbackModelIds": [],
        "verificationLevel": "verifiedDocumentationOnly",
        "source": {
          "authority": "studio-curated",
          "checkedAt": "2026-07-11",
          "urls": [
            "https://openrouter.ai/api/v1/models",
            "https://openrouter.ai/docs/api/api-reference/models/list-all-models-and-their-properties"
          ]
        },
        "pricing": {
          "kind": "token",
          "status": "verified",
          "currency": "USD",
          "billingUnit": "one_million_tokens",
          "inputPerMillion": 5,
          "cachedInputPerMillion": 0.5,
          "cacheWritePerMillion": 6.25,
          "outputPerMillion": 30,
          "batchInputPerMillion": null,
          "batchOutputPerMillion": null,
          "reasoningTokens": "unknown",
          "sourceUrls": [
            "https://openrouter.ai/api/v1/models",
            "https://openrouter.ai/docs/api/api-reference/models/list-all-models-and-their-properties"
          ],
          "verifiedAt": "2026-07-11",
          "notes": "Verified from live OpenRouter /api/v1/models. Do not copy to direct provider pricing."
        },
        "reasoning": {
          "supported": true,
          "alwaysOn": true,
          "canDisable": false,
          "effortValues": [
            "low",
            "medium",
            "high"
          ],
          "returnsReasoningContent": "unknown",
          "reasoningTokensVisible": "unknown",
          "reasoningTokensBillable": "unknown",
          "worksWithTools": "unknown",
          "worksWhileStreaming": "unknown",
          "requiresReasoningStateAfterTools": "unknown",
          "reducesOutputBudget": "unknown",
          "providerSpecificControls": [
            "reasoning_effort"
          ]
        },
        "freeAccess": {
          "isFree": false,
          "isPromotional": false
        }
      }
    },
    {
      "id": "openrouter:openai/gpt-5.6-sol-pro",
      "provider": "openrouter",
      "providerModelId": "openai/gpt-5.6-sol-pro",
      "displayName": "OpenAI GPT-5.6 Sol Pro",
      "type": "multimodal",
      "capabilities": {
        "modalities": [
          "chat"
        ],
        "chat": {
          "streaming": true,
          "vision": true,
          "tools": true,
          "reasoning": {
            "supported": true,
            "efforts": [
              "low",
              "medium",
              "high"
            ],
            "defaultEffort": "medium",
            "source": "static-reviewed",
            "confidence": "exact"
          },
          "jsonSchema": true,
          "promptCaching": false
        }
      },
      "pricing": {
        "inputPerMillionUsd": 5,
        "outputPerMillionUsd": 30,
        "source": "static",
        "note": "Verified from live OpenRouter /api/v1/models. Do not copy to direct provider pricing."
      },
      "contextWindow": 1050000,
      "maxTokens": 128000,
      "supportsVision": true,
      "supportsTools": true,
      "supportsStreaming": true,
      "supportsSystemPrompts": true,
      "inputTypes": [
        "text",
        "image"
      ],
      "outputTypes": [
        "text"
      ],
      "specialFeatures": [
        "reasoning"
      ],
      "registry": {
        "category": "text.chat",
        "status": "active",
        "developer": "OpenAI",
        "family": "gpt-5.6",
        "version": "openai/gpt-5.6-sol-pro",
        "supportedRegions": [],
        "endpoints": [
          "chat"
        ],
        "aliases": [
          "openai/gpt-5.6-sol-pro"
        ],
        "fallbackModelIds": [],
        "verificationLevel": "verifiedDocumentationOnly",
        "source": {
          "authority": "studio-curated",
          "checkedAt": "2026-07-11",
          "urls": [
            "https://openrouter.ai/api/v1/models",
            "https://openrouter.ai/docs/api/api-reference/models/list-all-models-and-their-properties"
          ]
        },
        "pricing": {
          "kind": "token",
          "status": "verified",
          "currency": "USD",
          "billingUnit": "one_million_tokens",
          "inputPerMillion": 5,
          "cachedInputPerMillion": 0.5,
          "cacheWritePerMillion": 6.25,
          "outputPerMillion": 30,
          "batchInputPerMillion": null,
          "batchOutputPerMillion": null,
          "reasoningTokens": "unknown",
          "sourceUrls": [
            "https://openrouter.ai/api/v1/models",
            "https://openrouter.ai/docs/api/api-reference/models/list-all-models-and-their-properties"
          ],
          "verifiedAt": "2026-07-11",
          "notes": "Verified from live OpenRouter /api/v1/models. Do not copy to direct provider pricing."
        },
        "reasoning": {
          "supported": true,
          "alwaysOn": true,
          "canDisable": false,
          "effortValues": [
            "low",
            "medium",
            "high"
          ],
          "returnsReasoningContent": "unknown",
          "reasoningTokensVisible": "unknown",
          "reasoningTokensBillable": "unknown",
          "worksWithTools": "unknown",
          "worksWhileStreaming": "unknown",
          "requiresReasoningStateAfterTools": "unknown",
          "reducesOutputBudget": "unknown",
          "providerSpecificControls": [
            "reasoning_effort"
          ]
        },
        "freeAccess": {
          "isFree": false,
          "isPromotional": false
        }
      }
    },
    {
      "id": "openrouter:openai/gpt-5.6-terra",
      "provider": "openrouter",
      "providerModelId": "openai/gpt-5.6-terra",
      "displayName": "OpenAI GPT-5.6 Terra",
      "type": "multimodal",
      "capabilities": {
        "modalities": [
          "chat"
        ],
        "chat": {
          "streaming": true,
          "vision": true,
          "tools": true,
          "reasoning": {
            "supported": true,
            "efforts": [
              "low",
              "medium",
              "high"
            ],
            "defaultEffort": "medium",
            "source": "static-reviewed",
            "confidence": "exact"
          },
          "jsonSchema": true,
          "promptCaching": false
        }
      },
      "pricing": {
        "inputPerMillionUsd": 2.5,
        "outputPerMillionUsd": 15,
        "source": "static",
        "note": "Verified from live OpenRouter /api/v1/models. Do not copy to direct provider pricing."
      },
      "contextWindow": 1050000,
      "maxTokens": 128000,
      "supportsVision": true,
      "supportsTools": true,
      "supportsStreaming": true,
      "supportsSystemPrompts": true,
      "inputTypes": [
        "text",
        "image"
      ],
      "outputTypes": [
        "text"
      ],
      "specialFeatures": [
        "reasoning"
      ],
      "registry": {
        "category": "text.chat",
        "status": "active",
        "developer": "OpenAI",
        "family": "gpt-5.6",
        "version": "openai/gpt-5.6-terra",
        "supportedRegions": [],
        "endpoints": [
          "chat"
        ],
        "aliases": [
          "openai/gpt-5.6-terra"
        ],
        "fallbackModelIds": [],
        "verificationLevel": "verifiedDocumentationOnly",
        "source": {
          "authority": "studio-curated",
          "checkedAt": "2026-07-11",
          "urls": [
            "https://openrouter.ai/api/v1/models",
            "https://openrouter.ai/docs/api/api-reference/models/list-all-models-and-their-properties"
          ]
        },
        "pricing": {
          "kind": "token",
          "status": "verified",
          "currency": "USD",
          "billingUnit": "one_million_tokens",
          "inputPerMillion": 2.5,
          "cachedInputPerMillion": 0.25,
          "cacheWritePerMillion": 3.125,
          "outputPerMillion": 15,
          "batchInputPerMillion": null,
          "batchOutputPerMillion": null,
          "reasoningTokens": "unknown",
          "sourceUrls": [
            "https://openrouter.ai/api/v1/models",
            "https://openrouter.ai/docs/api/api-reference/models/list-all-models-and-their-properties"
          ],
          "verifiedAt": "2026-07-11",
          "notes": "Verified from live OpenRouter /api/v1/models. Do not copy to direct provider pricing."
        },
        "reasoning": {
          "supported": true,
          "alwaysOn": true,
          "canDisable": false,
          "effortValues": [
            "low",
            "medium",
            "high"
          ],
          "returnsReasoningContent": "unknown",
          "reasoningTokensVisible": "unknown",
          "reasoningTokensBillable": "unknown",
          "worksWithTools": "unknown",
          "worksWhileStreaming": "unknown",
          "requiresReasoningStateAfterTools": "unknown",
          "reducesOutputBudget": "unknown",
          "providerSpecificControls": [
            "reasoning_effort"
          ]
        },
        "freeAccess": {
          "isFree": false,
          "isPromotional": false
        }
      }
    },
    {
      "id": "openrouter:openai/gpt-5.6-terra-pro",
      "provider": "openrouter",
      "providerModelId": "openai/gpt-5.6-terra-pro",
      "displayName": "OpenAI GPT-5.6 Terra Pro",
      "type": "multimodal",
      "capabilities": {
        "modalities": [
          "chat"
        ],
        "chat": {
          "streaming": true,
          "vision": true,
          "tools": true,
          "reasoning": {
            "supported": true,
            "efforts": [
              "low",
              "medium",
              "high"
            ],
            "defaultEffort": "medium",
            "source": "static-reviewed",
            "confidence": "exact"
          },
          "jsonSchema": true,
          "promptCaching": false
        }
      },
      "pricing": {
        "inputPerMillionUsd": 2.5,
        "outputPerMillionUsd": 15,
        "source": "static",
        "note": "Verified from live OpenRouter /api/v1/models. Do not copy to direct provider pricing."
      },
      "contextWindow": 1050000,
      "maxTokens": 128000,
      "supportsVision": true,
      "supportsTools": true,
      "supportsStreaming": true,
      "supportsSystemPrompts": true,
      "inputTypes": [
        "text",
        "image"
      ],
      "outputTypes": [
        "text"
      ],
      "specialFeatures": [
        "reasoning"
      ],
      "registry": {
        "category": "text.chat",
        "status": "active",
        "developer": "OpenAI",
        "family": "gpt-5.6",
        "version": "openai/gpt-5.6-terra-pro",
        "supportedRegions": [],
        "endpoints": [
          "chat"
        ],
        "aliases": [
          "openai/gpt-5.6-terra-pro"
        ],
        "fallbackModelIds": [],
        "verificationLevel": "verifiedDocumentationOnly",
        "source": {
          "authority": "studio-curated",
          "checkedAt": "2026-07-11",
          "urls": [
            "https://openrouter.ai/api/v1/models",
            "https://openrouter.ai/docs/api/api-reference/models/list-all-models-and-their-properties"
          ]
        },
        "pricing": {
          "kind": "token",
          "status": "verified",
          "currency": "USD",
          "billingUnit": "one_million_tokens",
          "inputPerMillion": 2.5,
          "cachedInputPerMillion": 0.25,
          "cacheWritePerMillion": 3.125,
          "outputPerMillion": 15,
          "batchInputPerMillion": null,
          "batchOutputPerMillion": null,
          "reasoningTokens": "unknown",
          "sourceUrls": [
            "https://openrouter.ai/api/v1/models",
            "https://openrouter.ai/docs/api/api-reference/models/list-all-models-and-their-properties"
          ],
          "verifiedAt": "2026-07-11",
          "notes": "Verified from live OpenRouter /api/v1/models. Do not copy to direct provider pricing."
        },
        "reasoning": {
          "supported": true,
          "alwaysOn": true,
          "canDisable": false,
          "effortValues": [
            "low",
            "medium",
            "high"
          ],
          "returnsReasoningContent": "unknown",
          "reasoningTokensVisible": "unknown",
          "reasoningTokensBillable": "unknown",
          "worksWithTools": "unknown",
          "worksWhileStreaming": "unknown",
          "requiresReasoningStateAfterTools": "unknown",
          "reducesOutputBudget": "unknown",
          "providerSpecificControls": [
            "reasoning_effort"
          ]
        },
        "freeAccess": {
          "isFree": false,
          "isPromotional": false
        }
      }
    },
    {
      "id": "openrouter:openai/gpt-5.6-luna",
      "provider": "openrouter",
      "providerModelId": "openai/gpt-5.6-luna",
      "displayName": "OpenAI GPT-5.6 Luna",
      "type": "multimodal",
      "capabilities": {
        "modalities": [
          "chat"
        ],
        "chat": {
          "streaming": true,
          "vision": true,
          "tools": true,
          "reasoning": {
            "supported": true,
            "efforts": [
              "low",
              "medium",
              "high"
            ],
            "defaultEffort": "medium",
            "source": "static-reviewed",
            "confidence": "exact"
          },
          "jsonSchema": true,
          "promptCaching": false
        }
      },
      "pricing": {
        "inputPerMillionUsd": 1,
        "outputPerMillionUsd": 6,
        "source": "static",
        "note": "Verified from live OpenRouter /api/v1/models. Do not copy to direct provider pricing."
      },
      "contextWindow": 1050000,
      "maxTokens": 128000,
      "supportsVision": true,
      "supportsTools": true,
      "supportsStreaming": true,
      "supportsSystemPrompts": true,
      "inputTypes": [
        "text",
        "image"
      ],
      "outputTypes": [
        "text"
      ],
      "specialFeatures": [
        "reasoning"
      ],
      "registry": {
        "category": "text.chat",
        "status": "active",
        "developer": "OpenAI",
        "family": "gpt-5.6",
        "version": "openai/gpt-5.6-luna",
        "supportedRegions": [],
        "endpoints": [
          "chat"
        ],
        "aliases": [
          "openai/gpt-5.6-luna"
        ],
        "fallbackModelIds": [],
        "verificationLevel": "verifiedDocumentationOnly",
        "source": {
          "authority": "studio-curated",
          "checkedAt": "2026-07-11",
          "urls": [
            "https://openrouter.ai/api/v1/models",
            "https://openrouter.ai/docs/api/api-reference/models/list-all-models-and-their-properties"
          ]
        },
        "pricing": {
          "kind": "token",
          "status": "verified",
          "currency": "USD",
          "billingUnit": "one_million_tokens",
          "inputPerMillion": 1,
          "cachedInputPerMillion": 0.1,
          "cacheWritePerMillion": 1.25,
          "outputPerMillion": 6,
          "batchInputPerMillion": null,
          "batchOutputPerMillion": null,
          "reasoningTokens": "unknown",
          "sourceUrls": [
            "https://openrouter.ai/api/v1/models",
            "https://openrouter.ai/docs/api/api-reference/models/list-all-models-and-their-properties"
          ],
          "verifiedAt": "2026-07-11",
          "notes": "Verified from live OpenRouter /api/v1/models. Do not copy to direct provider pricing."
        },
        "reasoning": {
          "supported": true,
          "alwaysOn": true,
          "canDisable": false,
          "effortValues": [
            "low",
            "medium",
            "high"
          ],
          "returnsReasoningContent": "unknown",
          "reasoningTokensVisible": "unknown",
          "reasoningTokensBillable": "unknown",
          "worksWithTools": "unknown",
          "worksWhileStreaming": "unknown",
          "requiresReasoningStateAfterTools": "unknown",
          "reducesOutputBudget": "unknown",
          "providerSpecificControls": [
            "reasoning_effort"
          ]
        },
        "freeAccess": {
          "isFree": false,
          "isPromotional": false
        }
      }
    },
    {
      "id": "openrouter:openai/gpt-5.6-luna-pro",
      "provider": "openrouter",
      "providerModelId": "openai/gpt-5.6-luna-pro",
      "displayName": "OpenAI GPT-5.6 Luna Pro",
      "type": "multimodal",
      "capabilities": {
        "modalities": [
          "chat"
        ],
        "chat": {
          "streaming": true,
          "vision": true,
          "tools": true,
          "reasoning": {
            "supported": true,
            "efforts": [
              "low",
              "medium",
              "high"
            ],
            "defaultEffort": "medium",
            "source": "static-reviewed",
            "confidence": "exact"
          },
          "jsonSchema": true,
          "promptCaching": false
        }
      },
      "pricing": {
        "inputPerMillionUsd": 1,
        "outputPerMillionUsd": 6,
        "source": "static",
        "note": "Verified from live OpenRouter /api/v1/models. Do not copy to direct provider pricing."
      },
      "contextWindow": 1050000,
      "maxTokens": 128000,
      "supportsVision": true,
      "supportsTools": true,
      "supportsStreaming": true,
      "supportsSystemPrompts": true,
      "inputTypes": [
        "text",
        "image"
      ],
      "outputTypes": [
        "text"
      ],
      "specialFeatures": [
        "reasoning"
      ],
      "registry": {
        "category": "text.chat",
        "status": "active",
        "developer": "OpenAI",
        "family": "gpt-5.6",
        "version": "openai/gpt-5.6-luna-pro",
        "supportedRegions": [],
        "endpoints": [
          "chat"
        ],
        "aliases": [
          "openai/gpt-5.6-luna-pro"
        ],
        "fallbackModelIds": [],
        "verificationLevel": "verifiedDocumentationOnly",
        "source": {
          "authority": "studio-curated",
          "checkedAt": "2026-07-11",
          "urls": [
            "https://openrouter.ai/api/v1/models",
            "https://openrouter.ai/docs/api/api-reference/models/list-all-models-and-their-properties"
          ]
        },
        "pricing": {
          "kind": "token",
          "status": "verified",
          "currency": "USD",
          "billingUnit": "one_million_tokens",
          "inputPerMillion": 1,
          "cachedInputPerMillion": 0.1,
          "cacheWritePerMillion": 1.25,
          "outputPerMillion": 6,
          "batchInputPerMillion": null,
          "batchOutputPerMillion": null,
          "reasoningTokens": "unknown",
          "sourceUrls": [
            "https://openrouter.ai/api/v1/models",
            "https://openrouter.ai/docs/api/api-reference/models/list-all-models-and-their-properties"
          ],
          "verifiedAt": "2026-07-11",
          "notes": "Verified from live OpenRouter /api/v1/models. Do not copy to direct provider pricing."
        },
        "reasoning": {
          "supported": true,
          "alwaysOn": true,
          "canDisable": false,
          "effortValues": [
            "low",
            "medium",
            "high"
          ],
          "returnsReasoningContent": "unknown",
          "reasoningTokensVisible": "unknown",
          "reasoningTokensBillable": "unknown",
          "worksWithTools": "unknown",
          "worksWhileStreaming": "unknown",
          "requiresReasoningStateAfterTools": "unknown",
          "reducesOutputBudget": "unknown",
          "providerSpecificControls": [
            "reasoning_effort"
          ]
        },
        "freeAccess": {
          "isFree": false,
          "isPromotional": false
        }
      }
    },
    {
      "id": "openrouter:openai/gpt-5.5",
      "provider": "openrouter",
      "providerModelId": "openai/gpt-5.5",
      "displayName": "OpenAI GPT-5.5",
      "type": "multimodal",
      "capabilities": {
        "modalities": [
          "chat"
        ],
        "chat": {
          "streaming": true,
          "vision": true,
          "tools": true,
          "reasoning": {
            "supported": true,
            "efforts": [
              "low",
              "medium",
              "high"
            ],
            "defaultEffort": "medium",
            "source": "static-reviewed",
            "confidence": "exact"
          },
          "jsonSchema": true,
          "promptCaching": false
        }
      },
      "pricing": {
        "inputPerMillionUsd": 5,
        "outputPerMillionUsd": 30,
        "source": "static",
        "note": "Verified from live OpenRouter /api/v1/models. Do not copy to direct provider pricing."
      },
      "contextWindow": 1050000,
      "maxTokens": 128000,
      "supportsVision": true,
      "supportsTools": true,
      "supportsStreaming": true,
      "supportsSystemPrompts": true,
      "inputTypes": [
        "text",
        "image"
      ],
      "outputTypes": [
        "text"
      ],
      "specialFeatures": [
        "reasoning"
      ],
      "registry": {
        "category": "text.chat",
        "status": "active",
        "developer": "OpenAI",
        "family": "gpt-5.5",
        "version": "openai/gpt-5.5",
        "supportedRegions": [],
        "endpoints": [
          "chat"
        ],
        "aliases": [
          "openai/gpt-5.5"
        ],
        "fallbackModelIds": [],
        "verificationLevel": "verifiedDocumentationOnly",
        "source": {
          "authority": "studio-curated",
          "checkedAt": "2026-07-11",
          "urls": [
            "https://openrouter.ai/api/v1/models",
            "https://openrouter.ai/docs/api/api-reference/models/list-all-models-and-their-properties"
          ]
        },
        "pricing": {
          "kind": "token",
          "status": "verified",
          "currency": "USD",
          "billingUnit": "one_million_tokens",
          "inputPerMillion": 5,
          "cachedInputPerMillion": 0.5,
          "cacheWritePerMillion": null,
          "outputPerMillion": 30,
          "batchInputPerMillion": null,
          "batchOutputPerMillion": null,
          "reasoningTokens": "unknown",
          "sourceUrls": [
            "https://openrouter.ai/api/v1/models",
            "https://openrouter.ai/docs/api/api-reference/models/list-all-models-and-their-properties"
          ],
          "verifiedAt": "2026-07-11",
          "notes": "Verified from live OpenRouter /api/v1/models. Do not copy to direct provider pricing."
        },
        "reasoning": {
          "supported": true,
          "alwaysOn": true,
          "canDisable": false,
          "effortValues": [
            "low",
            "medium",
            "high"
          ],
          "returnsReasoningContent": "unknown",
          "reasoningTokensVisible": "unknown",
          "reasoningTokensBillable": "unknown",
          "worksWithTools": "unknown",
          "worksWhileStreaming": "unknown",
          "requiresReasoningStateAfterTools": "unknown",
          "reducesOutputBudget": "unknown",
          "providerSpecificControls": [
            "reasoning_effort"
          ]
        },
        "freeAccess": {
          "isFree": false,
          "isPromotional": false
        }
      }
    },
    {
      "id": "openrouter:openai/gpt-5.5-pro",
      "provider": "openrouter",
      "providerModelId": "openai/gpt-5.5-pro",
      "displayName": "OpenAI GPT-5.5 Pro",
      "type": "multimodal",
      "capabilities": {
        "modalities": [
          "chat"
        ],
        "chat": {
          "streaming": true,
          "vision": true,
          "tools": true,
          "reasoning": {
            "supported": true,
            "efforts": [
              "low",
              "medium",
              "high"
            ],
            "defaultEffort": "medium",
            "source": "static-reviewed",
            "confidence": "exact"
          },
          "jsonSchema": true,
          "promptCaching": false
        }
      },
      "pricing": {
        "inputPerMillionUsd": 30,
        "outputPerMillionUsd": 180,
        "source": "static",
        "note": "Verified from live OpenRouter /api/v1/models. Do not copy to direct provider pricing."
      },
      "contextWindow": 1050000,
      "maxTokens": 128000,
      "supportsVision": true,
      "supportsTools": true,
      "supportsStreaming": true,
      "supportsSystemPrompts": true,
      "inputTypes": [
        "text",
        "image"
      ],
      "outputTypes": [
        "text"
      ],
      "specialFeatures": [
        "reasoning"
      ],
      "registry": {
        "category": "text.chat",
        "status": "active",
        "developer": "OpenAI",
        "family": "gpt-5.5",
        "version": "openai/gpt-5.5-pro",
        "supportedRegions": [],
        "endpoints": [
          "chat"
        ],
        "aliases": [
          "openai/gpt-5.5-pro"
        ],
        "fallbackModelIds": [],
        "verificationLevel": "verifiedDocumentationOnly",
        "source": {
          "authority": "studio-curated",
          "checkedAt": "2026-07-11",
          "urls": [
            "https://openrouter.ai/api/v1/models",
            "https://openrouter.ai/docs/api/api-reference/models/list-all-models-and-their-properties"
          ]
        },
        "pricing": {
          "kind": "token",
          "status": "verified",
          "currency": "USD",
          "billingUnit": "one_million_tokens",
          "inputPerMillion": 30,
          "cachedInputPerMillion": null,
          "cacheWritePerMillion": null,
          "outputPerMillion": 180,
          "batchInputPerMillion": null,
          "batchOutputPerMillion": null,
          "reasoningTokens": "unknown",
          "sourceUrls": [
            "https://openrouter.ai/api/v1/models",
            "https://openrouter.ai/docs/api/api-reference/models/list-all-models-and-their-properties"
          ],
          "verifiedAt": "2026-07-11",
          "notes": "Verified from live OpenRouter /api/v1/models. Do not copy to direct provider pricing."
        },
        "reasoning": {
          "supported": true,
          "alwaysOn": true,
          "canDisable": false,
          "effortValues": [
            "low",
            "medium",
            "high"
          ],
          "returnsReasoningContent": "unknown",
          "reasoningTokensVisible": "unknown",
          "reasoningTokensBillable": "unknown",
          "worksWithTools": "unknown",
          "worksWhileStreaming": "unknown",
          "requiresReasoningStateAfterTools": "unknown",
          "reducesOutputBudget": "unknown",
          "providerSpecificControls": [
            "reasoning_effort"
          ]
        },
        "freeAccess": {
          "isFree": false,
          "isPromotional": false
        }
      }
    },
    {
      "id": "openrouter:openai/gpt-5.4",
      "provider": "openrouter",
      "providerModelId": "openai/gpt-5.4",
      "displayName": "OpenAI GPT-5.4",
      "type": "multimodal",
      "capabilities": {
        "modalities": [
          "chat"
        ],
        "chat": {
          "streaming": true,
          "vision": true,
          "tools": true,
          "reasoning": {
            "supported": true,
            "efforts": [
              "low",
              "medium",
              "high"
            ],
            "defaultEffort": "medium",
            "source": "static-reviewed",
            "confidence": "exact"
          },
          "jsonSchema": true,
          "promptCaching": false
        }
      },
      "pricing": {
        "inputPerMillionUsd": 2.5,
        "outputPerMillionUsd": 15,
        "source": "static",
        "note": "Verified from live OpenRouter /api/v1/models. Do not copy to direct provider pricing."
      },
      "contextWindow": 1050000,
      "maxTokens": 128000,
      "supportsVision": true,
      "supportsTools": true,
      "supportsStreaming": true,
      "supportsSystemPrompts": true,
      "inputTypes": [
        "text",
        "image"
      ],
      "outputTypes": [
        "text"
      ],
      "specialFeatures": [
        "reasoning"
      ],
      "registry": {
        "category": "text.chat",
        "status": "active",
        "developer": "OpenAI",
        "family": "gpt-5.4",
        "version": "openai/gpt-5.4",
        "supportedRegions": [],
        "endpoints": [
          "chat"
        ],
        "aliases": [
          "openai/gpt-5.4"
        ],
        "fallbackModelIds": [],
        "verificationLevel": "verifiedDocumentationOnly",
        "source": {
          "authority": "studio-curated",
          "checkedAt": "2026-07-11",
          "urls": [
            "https://openrouter.ai/api/v1/models",
            "https://openrouter.ai/docs/api/api-reference/models/list-all-models-and-their-properties"
          ]
        },
        "pricing": {
          "kind": "token",
          "status": "verified",
          "currency": "USD",
          "billingUnit": "one_million_tokens",
          "inputPerMillion": 2.5,
          "cachedInputPerMillion": 0.25,
          "cacheWritePerMillion": null,
          "outputPerMillion": 15,
          "batchInputPerMillion": null,
          "batchOutputPerMillion": null,
          "reasoningTokens": "unknown",
          "sourceUrls": [
            "https://openrouter.ai/api/v1/models",
            "https://openrouter.ai/docs/api/api-reference/models/list-all-models-and-their-properties"
          ],
          "verifiedAt": "2026-07-11",
          "notes": "Verified from live OpenRouter /api/v1/models. Do not copy to direct provider pricing."
        },
        "reasoning": {
          "supported": true,
          "alwaysOn": true,
          "canDisable": false,
          "effortValues": [
            "low",
            "medium",
            "high"
          ],
          "returnsReasoningContent": "unknown",
          "reasoningTokensVisible": "unknown",
          "reasoningTokensBillable": "unknown",
          "worksWithTools": "unknown",
          "worksWhileStreaming": "unknown",
          "requiresReasoningStateAfterTools": "unknown",
          "reducesOutputBudget": "unknown",
          "providerSpecificControls": [
            "reasoning_effort"
          ]
        },
        "freeAccess": {
          "isFree": false,
          "isPromotional": false
        }
      }
    },
    {
      "id": "openrouter:openai/gpt-5.4-pro",
      "provider": "openrouter",
      "providerModelId": "openai/gpt-5.4-pro",
      "displayName": "OpenAI GPT-5.4 Pro",
      "type": "multimodal",
      "capabilities": {
        "modalities": [
          "chat"
        ],
        "chat": {
          "streaming": true,
          "vision": true,
          "tools": true,
          "reasoning": {
            "supported": true,
            "efforts": [
              "low",
              "medium",
              "high"
            ],
            "defaultEffort": "medium",
            "source": "static-reviewed",
            "confidence": "exact"
          },
          "jsonSchema": true,
          "promptCaching": false
        }
      },
      "pricing": {
        "inputPerMillionUsd": 30,
        "outputPerMillionUsd": 180,
        "source": "static",
        "note": "Verified from live OpenRouter /api/v1/models. Do not copy to direct provider pricing."
      },
      "contextWindow": 1050000,
      "maxTokens": 128000,
      "supportsVision": true,
      "supportsTools": true,
      "supportsStreaming": true,
      "supportsSystemPrompts": true,
      "inputTypes": [
        "text",
        "image"
      ],
      "outputTypes": [
        "text"
      ],
      "specialFeatures": [
        "reasoning"
      ],
      "registry": {
        "category": "text.chat",
        "status": "active",
        "developer": "OpenAI",
        "family": "gpt-5.4",
        "version": "openai/gpt-5.4-pro",
        "supportedRegions": [],
        "endpoints": [
          "chat"
        ],
        "aliases": [
          "openai/gpt-5.4-pro"
        ],
        "fallbackModelIds": [],
        "verificationLevel": "verifiedDocumentationOnly",
        "source": {
          "authority": "studio-curated",
          "checkedAt": "2026-07-11",
          "urls": [
            "https://openrouter.ai/api/v1/models",
            "https://openrouter.ai/docs/api/api-reference/models/list-all-models-and-their-properties"
          ]
        },
        "pricing": {
          "kind": "token",
          "status": "verified",
          "currency": "USD",
          "billingUnit": "one_million_tokens",
          "inputPerMillion": 30,
          "cachedInputPerMillion": null,
          "cacheWritePerMillion": null,
          "outputPerMillion": 180,
          "batchInputPerMillion": null,
          "batchOutputPerMillion": null,
          "reasoningTokens": "unknown",
          "sourceUrls": [
            "https://openrouter.ai/api/v1/models",
            "https://openrouter.ai/docs/api/api-reference/models/list-all-models-and-their-properties"
          ],
          "verifiedAt": "2026-07-11",
          "notes": "Verified from live OpenRouter /api/v1/models. Do not copy to direct provider pricing."
        },
        "reasoning": {
          "supported": true,
          "alwaysOn": true,
          "canDisable": false,
          "effortValues": [
            "low",
            "medium",
            "high"
          ],
          "returnsReasoningContent": "unknown",
          "reasoningTokensVisible": "unknown",
          "reasoningTokensBillable": "unknown",
          "worksWithTools": "unknown",
          "worksWhileStreaming": "unknown",
          "requiresReasoningStateAfterTools": "unknown",
          "reducesOutputBudget": "unknown",
          "providerSpecificControls": [
            "reasoning_effort"
          ]
        },
        "freeAccess": {
          "isFree": false,
          "isPromotional": false
        }
      }
    },
    {
      "id": "openrouter:openai/gpt-5.4-mini",
      "provider": "openrouter",
      "providerModelId": "openai/gpt-5.4-mini",
      "displayName": "OpenAI GPT-5.4 Mini",
      "type": "multimodal",
      "capabilities": {
        "modalities": [
          "chat"
        ],
        "chat": {
          "streaming": true,
          "vision": true,
          "tools": true,
          "reasoning": {
            "supported": true,
            "efforts": [
              "low",
              "medium",
              "high"
            ],
            "defaultEffort": "medium",
            "source": "static-reviewed",
            "confidence": "exact"
          },
          "jsonSchema": true,
          "promptCaching": false
        }
      },
      "pricing": {
        "inputPerMillionUsd": 0.75,
        "outputPerMillionUsd": 4.5,
        "source": "static",
        "note": "Verified from live OpenRouter /api/v1/models. Do not copy to direct provider pricing."
      },
      "contextWindow": 400000,
      "maxTokens": 128000,
      "supportsVision": true,
      "supportsTools": true,
      "supportsStreaming": true,
      "supportsSystemPrompts": true,
      "inputTypes": [
        "text",
        "image"
      ],
      "outputTypes": [
        "text"
      ],
      "specialFeatures": [
        "reasoning"
      ],
      "registry": {
        "category": "text.chat",
        "status": "active",
        "developer": "OpenAI",
        "family": "gpt-5.4",
        "version": "openai/gpt-5.4-mini",
        "supportedRegions": [],
        "endpoints": [
          "chat"
        ],
        "aliases": [
          "openai/gpt-5.4-mini"
        ],
        "fallbackModelIds": [],
        "verificationLevel": "verifiedDocumentationOnly",
        "source": {
          "authority": "studio-curated",
          "checkedAt": "2026-07-11",
          "urls": [
            "https://openrouter.ai/api/v1/models",
            "https://openrouter.ai/docs/api/api-reference/models/list-all-models-and-their-properties"
          ]
        },
        "pricing": {
          "kind": "token",
          "status": "verified",
          "currency": "USD",
          "billingUnit": "one_million_tokens",
          "inputPerMillion": 0.75,
          "cachedInputPerMillion": 0.075,
          "cacheWritePerMillion": null,
          "outputPerMillion": 4.5,
          "batchInputPerMillion": null,
          "batchOutputPerMillion": null,
          "reasoningTokens": "unknown",
          "sourceUrls": [
            "https://openrouter.ai/api/v1/models",
            "https://openrouter.ai/docs/api/api-reference/models/list-all-models-and-their-properties"
          ],
          "verifiedAt": "2026-07-11",
          "notes": "Verified from live OpenRouter /api/v1/models. Do not copy to direct provider pricing."
        },
        "reasoning": {
          "supported": true,
          "alwaysOn": true,
          "canDisable": false,
          "effortValues": [
            "low",
            "medium",
            "high"
          ],
          "returnsReasoningContent": "unknown",
          "reasoningTokensVisible": "unknown",
          "reasoningTokensBillable": "unknown",
          "worksWithTools": "unknown",
          "worksWhileStreaming": "unknown",
          "requiresReasoningStateAfterTools": "unknown",
          "reducesOutputBudget": "unknown",
          "providerSpecificControls": [
            "reasoning_effort"
          ]
        },
        "freeAccess": {
          "isFree": false,
          "isPromotional": false
        }
      }
    },
    {
      "id": "openrouter:openai/gpt-5.4-nano",
      "provider": "openrouter",
      "providerModelId": "openai/gpt-5.4-nano",
      "displayName": "OpenAI GPT-5.4 Nano",
      "type": "multimodal",
      "capabilities": {
        "modalities": [
          "chat"
        ],
        "chat": {
          "streaming": true,
          "vision": true,
          "tools": true,
          "reasoning": {
            "supported": true,
            "efforts": [
              "low",
              "medium",
              "high"
            ],
            "defaultEffort": "medium",
            "source": "static-reviewed",
            "confidence": "exact"
          },
          "jsonSchema": true,
          "promptCaching": false
        }
      },
      "pricing": {
        "inputPerMillionUsd": 0.2,
        "outputPerMillionUsd": 1.25,
        "source": "static",
        "note": "Verified from live OpenRouter /api/v1/models. Do not copy to direct provider pricing."
      },
      "contextWindow": 400000,
      "maxTokens": 128000,
      "supportsVision": true,
      "supportsTools": true,
      "supportsStreaming": true,
      "supportsSystemPrompts": true,
      "inputTypes": [
        "text",
        "image"
      ],
      "outputTypes": [
        "text"
      ],
      "specialFeatures": [
        "reasoning"
      ],
      "registry": {
        "category": "text.chat",
        "status": "active",
        "developer": "OpenAI",
        "family": "gpt-5.4",
        "version": "openai/gpt-5.4-nano",
        "supportedRegions": [],
        "endpoints": [
          "chat"
        ],
        "aliases": [
          "openai/gpt-5.4-nano"
        ],
        "fallbackModelIds": [],
        "verificationLevel": "verifiedDocumentationOnly",
        "source": {
          "authority": "studio-curated",
          "checkedAt": "2026-07-11",
          "urls": [
            "https://openrouter.ai/api/v1/models",
            "https://openrouter.ai/docs/api/api-reference/models/list-all-models-and-their-properties"
          ]
        },
        "pricing": {
          "kind": "token",
          "status": "verified",
          "currency": "USD",
          "billingUnit": "one_million_tokens",
          "inputPerMillion": 0.2,
          "cachedInputPerMillion": 0.02,
          "cacheWritePerMillion": null,
          "outputPerMillion": 1.25,
          "batchInputPerMillion": null,
          "batchOutputPerMillion": null,
          "reasoningTokens": "unknown",
          "sourceUrls": [
            "https://openrouter.ai/api/v1/models",
            "https://openrouter.ai/docs/api/api-reference/models/list-all-models-and-their-properties"
          ],
          "verifiedAt": "2026-07-11",
          "notes": "Verified from live OpenRouter /api/v1/models. Do not copy to direct provider pricing."
        },
        "reasoning": {
          "supported": true,
          "alwaysOn": true,
          "canDisable": false,
          "effortValues": [
            "low",
            "medium",
            "high"
          ],
          "returnsReasoningContent": "unknown",
          "reasoningTokensVisible": "unknown",
          "reasoningTokensBillable": "unknown",
          "worksWithTools": "unknown",
          "worksWhileStreaming": "unknown",
          "requiresReasoningStateAfterTools": "unknown",
          "reducesOutputBudget": "unknown",
          "providerSpecificControls": [
            "reasoning_effort"
          ]
        },
        "freeAccess": {
          "isFree": false,
          "isPromotional": false
        }
      }
    },
    {
      "id": "openrouter:qwen/qwen3.7-plus",
      "provider": "openrouter",
      "providerModelId": "qwen/qwen3.7-plus",
      "displayName": "Qwen3.7 Plus",
      "type": "multimodal",
      "capabilities": {
        "modalities": [
          "chat"
        ],
        "chat": {
          "streaming": true,
          "vision": true,
          "tools": true,
          "reasoning": {
            "supported": true,
            "efforts": [
              "low",
              "medium",
              "high"
            ],
            "defaultEffort": "medium",
            "source": "static-reviewed",
            "confidence": "exact"
          },
          "jsonSchema": true,
          "promptCaching": false
        }
      },
      "pricing": {
        "inputPerMillionUsd": 0.32,
        "outputPerMillionUsd": 1.28,
        "source": "static",
        "note": "Verified from live OpenRouter /api/v1/models. Do not copy to direct provider pricing."
      },
      "contextWindow": 1000000,
      "maxTokens": 128000,
      "supportsVision": true,
      "supportsTools": true,
      "supportsStreaming": true,
      "supportsSystemPrompts": true,
      "inputTypes": [
        "text",
        "image"
      ],
      "outputTypes": [
        "text"
      ],
      "specialFeatures": [
        "reasoning"
      ],
      "registry": {
        "category": "text.chat",
        "status": "active",
        "developer": "Alibaba Qwen",
        "family": "qwen3.7",
        "version": "qwen/qwen3.7-plus",
        "supportedRegions": [],
        "endpoints": [
          "chat"
        ],
        "aliases": [
          "qwen/qwen3.7-plus"
        ],
        "fallbackModelIds": [],
        "verificationLevel": "verifiedDocumentationOnly",
        "source": {
          "authority": "studio-curated",
          "checkedAt": "2026-07-11",
          "urls": [
            "https://openrouter.ai/api/v1/models",
            "https://openrouter.ai/docs/api/api-reference/models/list-all-models-and-their-properties"
          ]
        },
        "pricing": {
          "kind": "token",
          "status": "verified",
          "currency": "USD",
          "billingUnit": "one_million_tokens",
          "inputPerMillion": 0.32,
          "cachedInputPerMillion": 0.064,
          "cacheWritePerMillion": 0.4,
          "outputPerMillion": 1.28,
          "batchInputPerMillion": null,
          "batchOutputPerMillion": null,
          "reasoningTokens": "unknown",
          "sourceUrls": [
            "https://openrouter.ai/api/v1/models",
            "https://openrouter.ai/docs/api/api-reference/models/list-all-models-and-their-properties"
          ],
          "verifiedAt": "2026-07-11",
          "notes": "Verified from live OpenRouter /api/v1/models. Do not copy to direct provider pricing."
        },
        "reasoning": {
          "supported": true,
          "alwaysOn": true,
          "canDisable": false,
          "effortValues": [
            "low",
            "medium",
            "high"
          ],
          "returnsReasoningContent": "unknown",
          "reasoningTokensVisible": "unknown",
          "reasoningTokensBillable": "unknown",
          "worksWithTools": "unknown",
          "worksWhileStreaming": "unknown",
          "requiresReasoningStateAfterTools": "unknown",
          "reducesOutputBudget": "unknown",
          "providerSpecificControls": [
            "reasoning_effort"
          ]
        },
        "freeAccess": {
          "isFree": false,
          "isPromotional": false
        }
      }
    },
    {
      "id": "openrouter:qwen/qwen3.7-max",
      "provider": "openrouter",
      "providerModelId": "qwen/qwen3.7-max",
      "displayName": "Qwen3.7 Max",
      "type": "chat",
      "capabilities": {
        "modalities": [
          "chat"
        ],
        "chat": {
          "streaming": true,
          "vision": false,
          "tools": true,
          "reasoning": {
            "supported": true,
            "efforts": [
              "low",
              "medium",
              "high"
            ],
            "defaultEffort": "medium",
            "source": "static-reviewed",
            "confidence": "exact"
          },
          "jsonSchema": true,
          "promptCaching": false
        }
      },
      "pricing": {
        "inputPerMillionUsd": 1.25,
        "outputPerMillionUsd": 3.75,
        "source": "static",
        "note": "Verified from live OpenRouter /api/v1/models. Do not copy to direct provider pricing."
      },
      "contextWindow": 1000000,
      "maxTokens": 128000,
      "supportsVision": false,
      "supportsTools": true,
      "supportsStreaming": true,
      "supportsSystemPrompts": true,
      "inputTypes": [
        "text"
      ],
      "outputTypes": [
        "text"
      ],
      "specialFeatures": [
        "reasoning"
      ],
      "registry": {
        "category": "text.chat",
        "status": "active",
        "developer": "Alibaba Qwen",
        "family": "qwen3.7",
        "version": "qwen/qwen3.7-max",
        "supportedRegions": [],
        "endpoints": [
          "chat"
        ],
        "aliases": [
          "qwen/qwen3.7-max"
        ],
        "fallbackModelIds": [],
        "verificationLevel": "verifiedDocumentationOnly",
        "source": {
          "authority": "studio-curated",
          "checkedAt": "2026-07-11",
          "urls": [
            "https://openrouter.ai/api/v1/models",
            "https://openrouter.ai/docs/api/api-reference/models/list-all-models-and-their-properties"
          ]
        },
        "pricing": {
          "kind": "token",
          "status": "verified",
          "currency": "USD",
          "billingUnit": "one_million_tokens",
          "inputPerMillion": 1.25,
          "cachedInputPerMillion": 0.25,
          "cacheWritePerMillion": 1.5625,
          "outputPerMillion": 3.75,
          "batchInputPerMillion": null,
          "batchOutputPerMillion": null,
          "reasoningTokens": "unknown",
          "sourceUrls": [
            "https://openrouter.ai/api/v1/models",
            "https://openrouter.ai/docs/api/api-reference/models/list-all-models-and-their-properties"
          ],
          "verifiedAt": "2026-07-11",
          "notes": "Verified from live OpenRouter /api/v1/models. Do not copy to direct provider pricing."
        },
        "reasoning": {
          "supported": true,
          "alwaysOn": true,
          "canDisable": false,
          "effortValues": [
            "low",
            "medium",
            "high"
          ],
          "returnsReasoningContent": "unknown",
          "reasoningTokensVisible": "unknown",
          "reasoningTokensBillable": "unknown",
          "worksWithTools": "unknown",
          "worksWhileStreaming": "unknown",
          "requiresReasoningStateAfterTools": "unknown",
          "reducesOutputBudget": "unknown",
          "providerSpecificControls": [
            "reasoning_effort"
          ]
        },
        "freeAccess": {
          "isFree": false,
          "isPromotional": false
        }
      }
    },
    {
      "id": "openrouter:qwen/qwen3.6-flash",
      "provider": "openrouter",
      "providerModelId": "qwen/qwen3.6-flash",
      "displayName": "Qwen3.6 Flash",
      "type": "multimodal",
      "capabilities": {
        "modalities": [
          "chat"
        ],
        "chat": {
          "streaming": true,
          "vision": true,
          "tools": true,
          "reasoning": {
            "supported": true,
            "efforts": [
              "low",
              "medium",
              "high"
            ],
            "defaultEffort": "medium",
            "source": "static-reviewed",
            "confidence": "exact"
          },
          "jsonSchema": true,
          "promptCaching": false
        }
      },
      "pricing": {
        "inputPerMillionUsd": 0.1875,
        "outputPerMillionUsd": 1.125,
        "source": "static",
        "note": "Verified from live OpenRouter /api/v1/models. Do not copy to direct provider pricing."
      },
      "contextWindow": 1000000,
      "maxTokens": 128000,
      "supportsVision": true,
      "supportsTools": true,
      "supportsStreaming": true,
      "supportsSystemPrompts": true,
      "inputTypes": [
        "text",
        "image"
      ],
      "outputTypes": [
        "text"
      ],
      "specialFeatures": [
        "reasoning"
      ],
      "registry": {
        "category": "text.chat",
        "status": "active",
        "developer": "Alibaba Qwen",
        "family": "qwen3.6",
        "version": "qwen/qwen3.6-flash",
        "supportedRegions": [],
        "endpoints": [
          "chat"
        ],
        "aliases": [
          "qwen/qwen3.6-flash"
        ],
        "fallbackModelIds": [],
        "verificationLevel": "verifiedDocumentationOnly",
        "source": {
          "authority": "studio-curated",
          "checkedAt": "2026-07-11",
          "urls": [
            "https://openrouter.ai/api/v1/models",
            "https://openrouter.ai/docs/api/api-reference/models/list-all-models-and-their-properties"
          ]
        },
        "pricing": {
          "kind": "token",
          "status": "verified",
          "currency": "USD",
          "billingUnit": "one_million_tokens",
          "inputPerMillion": 0.1875,
          "cachedInputPerMillion": null,
          "cacheWritePerMillion": 0.234375,
          "outputPerMillion": 1.125,
          "batchInputPerMillion": null,
          "batchOutputPerMillion": null,
          "reasoningTokens": "unknown",
          "sourceUrls": [
            "https://openrouter.ai/api/v1/models",
            "https://openrouter.ai/docs/api/api-reference/models/list-all-models-and-their-properties"
          ],
          "verifiedAt": "2026-07-11",
          "notes": "Verified from live OpenRouter /api/v1/models. Do not copy to direct provider pricing."
        },
        "reasoning": {
          "supported": true,
          "alwaysOn": true,
          "canDisable": false,
          "effortValues": [
            "low",
            "medium",
            "high"
          ],
          "returnsReasoningContent": "unknown",
          "reasoningTokensVisible": "unknown",
          "reasoningTokensBillable": "unknown",
          "worksWithTools": "unknown",
          "worksWhileStreaming": "unknown",
          "requiresReasoningStateAfterTools": "unknown",
          "reducesOutputBudget": "unknown",
          "providerSpecificControls": [
            "reasoning_effort"
          ]
        },
        "freeAccess": {
          "isFree": false,
          "isPromotional": false
        }
      }
    },
    {
      "id": "openrouter:anthropic/claude-haiku-4.5",
      "provider": "openrouter",
      "providerModelId": "anthropic/claude-haiku-4.5",
      "displayName": "Claude Haiku 4.5",
      "type": "multimodal",
      "capabilities": {
        "modalities": [
          "chat"
        ],
        "chat": {
          "streaming": true,
          "vision": true,
          "tools": true,
          "reasoning": {
            "supported": true,
            "efforts": [
              "low",
              "medium",
              "high"
            ],
            "defaultEffort": "medium",
            "source": "static-reviewed",
            "confidence": "exact"
          },
          "jsonSchema": true,
          "promptCaching": false
        }
      },
      "pricing": {
        "inputPerMillionUsd": 1,
        "outputPerMillionUsd": 5,
        "source": "static",
        "note": "Verified from live OpenRouter /api/v1/models. Do not copy to direct provider pricing."
      },
      "contextWindow": 200000,
      "maxTokens": 128000,
      "supportsVision": true,
      "supportsTools": true,
      "supportsStreaming": true,
      "supportsSystemPrompts": true,
      "inputTypes": [
        "text",
        "image"
      ],
      "outputTypes": [
        "text"
      ],
      "specialFeatures": [
        "reasoning"
      ],
      "registry": {
        "category": "text.chat",
        "status": "active",
        "developer": "Anthropic",
        "family": "claude-haiku",
        "version": "anthropic/claude-haiku-4.5",
        "supportedRegions": [],
        "endpoints": [
          "chat"
        ],
        "aliases": [
          "anthropic/claude-haiku-4.5"
        ],
        "fallbackModelIds": [],
        "verificationLevel": "verifiedDocumentationOnly",
        "source": {
          "authority": "studio-curated",
          "checkedAt": "2026-07-11",
          "urls": [
            "https://openrouter.ai/api/v1/models",
            "https://openrouter.ai/docs/api/api-reference/models/list-all-models-and-their-properties"
          ]
        },
        "pricing": {
          "kind": "token",
          "status": "verified",
          "currency": "USD",
          "billingUnit": "one_million_tokens",
          "inputPerMillion": 1,
          "cachedInputPerMillion": 0.1,
          "cacheWritePerMillion": 1.25,
          "outputPerMillion": 5,
          "batchInputPerMillion": null,
          "batchOutputPerMillion": null,
          "reasoningTokens": "unknown",
          "sourceUrls": [
            "https://openrouter.ai/api/v1/models",
            "https://openrouter.ai/docs/api/api-reference/models/list-all-models-and-their-properties"
          ],
          "verifiedAt": "2026-07-11",
          "notes": "Verified from live OpenRouter /api/v1/models. Do not copy to direct provider pricing."
        },
        "reasoning": {
          "supported": true,
          "alwaysOn": true,
          "canDisable": false,
          "effortValues": [
            "low",
            "medium",
            "high"
          ],
          "returnsReasoningContent": "unknown",
          "reasoningTokensVisible": "unknown",
          "reasoningTokensBillable": "unknown",
          "worksWithTools": "unknown",
          "worksWhileStreaming": "unknown",
          "requiresReasoningStateAfterTools": "unknown",
          "reducesOutputBudget": "unknown",
          "providerSpecificControls": [
            "reasoning_effort"
          ]
        },
        "freeAccess": {
          "isFree": false,
          "isPromotional": false
        }
      }
    },
    {
      "id": "openrouter:anthropic/claude-sonnet-4.6",
      "provider": "openrouter",
      "providerModelId": "anthropic/claude-sonnet-4.6",
      "displayName": "Claude Sonnet 4.6",
      "type": "multimodal",
      "capabilities": {
        "modalities": [
          "chat"
        ],
        "chat": {
          "streaming": true,
          "vision": true,
          "tools": true,
          "reasoning": {
            "supported": true,
            "efforts": [
              "low",
              "medium",
              "high"
            ],
            "defaultEffort": "medium",
            "source": "static-reviewed",
            "confidence": "exact"
          },
          "jsonSchema": true,
          "promptCaching": false
        }
      },
      "pricing": {
        "inputPerMillionUsd": 3,
        "outputPerMillionUsd": 15,
        "source": "static",
        "note": "Verified from live OpenRouter /api/v1/models. Do not copy to direct provider pricing."
      },
      "contextWindow": 1000000,
      "maxTokens": 128000,
      "supportsVision": true,
      "supportsTools": true,
      "supportsStreaming": true,
      "supportsSystemPrompts": true,
      "inputTypes": [
        "text",
        "image"
      ],
      "outputTypes": [
        "text"
      ],
      "specialFeatures": [
        "reasoning"
      ],
      "registry": {
        "category": "text.chat",
        "status": "active",
        "developer": "Anthropic",
        "family": "claude-sonnet",
        "version": "anthropic/claude-sonnet-4.6",
        "supportedRegions": [],
        "endpoints": [
          "chat"
        ],
        "aliases": [
          "anthropic/claude-sonnet-4.6"
        ],
        "fallbackModelIds": [],
        "verificationLevel": "verifiedDocumentationOnly",
        "source": {
          "authority": "studio-curated",
          "checkedAt": "2026-07-11",
          "urls": [
            "https://openrouter.ai/api/v1/models",
            "https://openrouter.ai/docs/api/api-reference/models/list-all-models-and-their-properties"
          ]
        },
        "pricing": {
          "kind": "token",
          "status": "verified",
          "currency": "USD",
          "billingUnit": "one_million_tokens",
          "inputPerMillion": 3,
          "cachedInputPerMillion": 0.3,
          "cacheWritePerMillion": 3.75,
          "outputPerMillion": 15,
          "batchInputPerMillion": null,
          "batchOutputPerMillion": null,
          "reasoningTokens": "unknown",
          "sourceUrls": [
            "https://openrouter.ai/api/v1/models",
            "https://openrouter.ai/docs/api/api-reference/models/list-all-models-and-their-properties"
          ],
          "verifiedAt": "2026-07-11",
          "notes": "Verified from live OpenRouter /api/v1/models. Do not copy to direct provider pricing."
        },
        "reasoning": {
          "supported": true,
          "alwaysOn": true,
          "canDisable": false,
          "effortValues": [
            "low",
            "medium",
            "high"
          ],
          "returnsReasoningContent": "unknown",
          "reasoningTokensVisible": "unknown",
          "reasoningTokensBillable": "unknown",
          "worksWithTools": "unknown",
          "worksWhileStreaming": "unknown",
          "requiresReasoningStateAfterTools": "unknown",
          "reducesOutputBudget": "unknown",
          "providerSpecificControls": [
            "reasoning_effort"
          ]
        },
        "freeAccess": {
          "isFree": false,
          "isPromotional": false
        }
      }
    },
    {
      "id": "openrouter:anthropic/claude-sonnet-5",
      "provider": "openrouter",
      "providerModelId": "anthropic/claude-sonnet-5",
      "displayName": "Claude Sonnet 5",
      "type": "multimodal",
      "capabilities": {
        "modalities": [
          "chat"
        ],
        "chat": {
          "streaming": true,
          "vision": true,
          "tools": true,
          "reasoning": {
            "supported": true,
            "efforts": [
              "low",
              "medium",
              "high"
            ],
            "defaultEffort": "medium",
            "source": "static-reviewed",
            "confidence": "exact"
          },
          "jsonSchema": true,
          "promptCaching": false
        }
      },
      "pricing": {
        "inputPerMillionUsd": 2,
        "outputPerMillionUsd": 10,
        "source": "static",
        "note": "Verified from live OpenRouter /api/v1/models. Do not copy to direct provider pricing."
      },
      "contextWindow": 1000000,
      "maxTokens": 128000,
      "supportsVision": true,
      "supportsTools": true,
      "supportsStreaming": true,
      "supportsSystemPrompts": true,
      "inputTypes": [
        "text",
        "image"
      ],
      "outputTypes": [
        "text"
      ],
      "specialFeatures": [
        "reasoning"
      ],
      "registry": {
        "category": "text.chat",
        "status": "active",
        "developer": "Anthropic",
        "family": "claude-sonnet",
        "version": "anthropic/claude-sonnet-5",
        "supportedRegions": [],
        "endpoints": [
          "chat"
        ],
        "aliases": [
          "anthropic/claude-sonnet-5"
        ],
        "fallbackModelIds": [],
        "verificationLevel": "verifiedDocumentationOnly",
        "source": {
          "authority": "studio-curated",
          "checkedAt": "2026-07-11",
          "urls": [
            "https://openrouter.ai/api/v1/models",
            "https://openrouter.ai/docs/api/api-reference/models/list-all-models-and-their-properties"
          ]
        },
        "pricing": {
          "kind": "token",
          "status": "verified",
          "currency": "USD",
          "billingUnit": "one_million_tokens",
          "inputPerMillion": 2,
          "cachedInputPerMillion": 0.2,
          "cacheWritePerMillion": 2.5,
          "outputPerMillion": 10,
          "batchInputPerMillion": null,
          "batchOutputPerMillion": null,
          "reasoningTokens": "unknown",
          "sourceUrls": [
            "https://openrouter.ai/api/v1/models",
            "https://openrouter.ai/docs/api/api-reference/models/list-all-models-and-their-properties"
          ],
          "verifiedAt": "2026-07-11",
          "notes": "Verified from live OpenRouter /api/v1/models. Do not copy to direct provider pricing."
        },
        "reasoning": {
          "supported": true,
          "alwaysOn": true,
          "canDisable": false,
          "effortValues": [
            "low",
            "medium",
            "high"
          ],
          "returnsReasoningContent": "unknown",
          "reasoningTokensVisible": "unknown",
          "reasoningTokensBillable": "unknown",
          "worksWithTools": "unknown",
          "worksWhileStreaming": "unknown",
          "requiresReasoningStateAfterTools": "unknown",
          "reducesOutputBudget": "unknown",
          "providerSpecificControls": [
            "reasoning_effort"
          ]
        },
        "freeAccess": {
          "isFree": false,
          "isPromotional": false
        }
      }
    },
    {
      "id": "openrouter:anthropic/claude-opus-4.8",
      "provider": "openrouter",
      "providerModelId": "anthropic/claude-opus-4.8",
      "displayName": "Claude Opus 4.8",
      "type": "multimodal",
      "capabilities": {
        "modalities": [
          "chat"
        ],
        "chat": {
          "streaming": true,
          "vision": true,
          "tools": true,
          "reasoning": {
            "supported": true,
            "efforts": [
              "low",
              "medium",
              "high"
            ],
            "defaultEffort": "medium",
            "source": "static-reviewed",
            "confidence": "exact"
          },
          "jsonSchema": true,
          "promptCaching": false
        }
      },
      "pricing": {
        "inputPerMillionUsd": 5,
        "outputPerMillionUsd": 25,
        "source": "static",
        "note": "Verified from live OpenRouter /api/v1/models. Do not copy to direct provider pricing."
      },
      "contextWindow": 1000000,
      "maxTokens": 128000,
      "supportsVision": true,
      "supportsTools": true,
      "supportsStreaming": true,
      "supportsSystemPrompts": true,
      "inputTypes": [
        "text",
        "image"
      ],
      "outputTypes": [
        "text"
      ],
      "specialFeatures": [
        "reasoning"
      ],
      "registry": {
        "category": "text.chat",
        "status": "active",
        "developer": "Anthropic",
        "family": "claude-opus",
        "version": "anthropic/claude-opus-4.8",
        "supportedRegions": [],
        "endpoints": [
          "chat"
        ],
        "aliases": [
          "anthropic/claude-opus-4.8"
        ],
        "fallbackModelIds": [],
        "verificationLevel": "verifiedDocumentationOnly",
        "source": {
          "authority": "studio-curated",
          "checkedAt": "2026-07-11",
          "urls": [
            "https://openrouter.ai/api/v1/models",
            "https://openrouter.ai/docs/api/api-reference/models/list-all-models-and-their-properties"
          ]
        },
        "pricing": {
          "kind": "token",
          "status": "verified",
          "currency": "USD",
          "billingUnit": "one_million_tokens",
          "inputPerMillion": 5,
          "cachedInputPerMillion": 0.5,
          "cacheWritePerMillion": 6.25,
          "outputPerMillion": 25,
          "batchInputPerMillion": null,
          "batchOutputPerMillion": null,
          "reasoningTokens": "unknown",
          "sourceUrls": [
            "https://openrouter.ai/api/v1/models",
            "https://openrouter.ai/docs/api/api-reference/models/list-all-models-and-their-properties"
          ],
          "verifiedAt": "2026-07-11",
          "notes": "Verified from live OpenRouter /api/v1/models. Do not copy to direct provider pricing."
        },
        "reasoning": {
          "supported": true,
          "alwaysOn": true,
          "canDisable": false,
          "effortValues": [
            "low",
            "medium",
            "high"
          ],
          "returnsReasoningContent": "unknown",
          "reasoningTokensVisible": "unknown",
          "reasoningTokensBillable": "unknown",
          "worksWithTools": "unknown",
          "worksWhileStreaming": "unknown",
          "requiresReasoningStateAfterTools": "unknown",
          "reducesOutputBudget": "unknown",
          "providerSpecificControls": [
            "reasoning_effort"
          ]
        },
        "freeAccess": {
          "isFree": false,
          "isPromotional": false
        }
      }
    },
    {
      "id": "openrouter:anthropic/claude-opus-4.8-fast",
      "provider": "openrouter",
      "providerModelId": "anthropic/claude-opus-4.8-fast",
      "displayName": "Claude Opus 4.8 Fast",
      "type": "multimodal",
      "capabilities": {
        "modalities": [
          "chat"
        ],
        "chat": {
          "streaming": true,
          "vision": true,
          "tools": true,
          "reasoning": {
            "supported": true,
            "efforts": [
              "low",
              "medium",
              "high"
            ],
            "defaultEffort": "medium",
            "source": "static-reviewed",
            "confidence": "exact"
          },
          "jsonSchema": true,
          "promptCaching": false
        }
      },
      "pricing": {
        "inputPerMillionUsd": 10,
        "outputPerMillionUsd": 50,
        "source": "static",
        "note": "Verified from live OpenRouter /api/v1/models. Do not copy to direct provider pricing."
      },
      "contextWindow": 1000000,
      "maxTokens": 128000,
      "supportsVision": true,
      "supportsTools": true,
      "supportsStreaming": true,
      "supportsSystemPrompts": true,
      "inputTypes": [
        "text",
        "image"
      ],
      "outputTypes": [
        "text"
      ],
      "specialFeatures": [
        "reasoning"
      ],
      "registry": {
        "category": "text.chat",
        "status": "active",
        "developer": "Anthropic",
        "family": "claude-opus",
        "version": "anthropic/claude-opus-4.8-fast",
        "supportedRegions": [],
        "endpoints": [
          "chat"
        ],
        "aliases": [
          "anthropic/claude-opus-4.8-fast"
        ],
        "fallbackModelIds": [],
        "verificationLevel": "verifiedDocumentationOnly",
        "source": {
          "authority": "studio-curated",
          "checkedAt": "2026-07-11",
          "urls": [
            "https://openrouter.ai/api/v1/models",
            "https://openrouter.ai/docs/api/api-reference/models/list-all-models-and-their-properties"
          ]
        },
        "pricing": {
          "kind": "token",
          "status": "verified",
          "currency": "USD",
          "billingUnit": "one_million_tokens",
          "inputPerMillion": 10,
          "cachedInputPerMillion": 1,
          "cacheWritePerMillion": 12.5,
          "outputPerMillion": 50,
          "batchInputPerMillion": null,
          "batchOutputPerMillion": null,
          "reasoningTokens": "unknown",
          "sourceUrls": [
            "https://openrouter.ai/api/v1/models",
            "https://openrouter.ai/docs/api/api-reference/models/list-all-models-and-their-properties"
          ],
          "verifiedAt": "2026-07-11",
          "notes": "Verified from live OpenRouter /api/v1/models. Do not copy to direct provider pricing."
        },
        "reasoning": {
          "supported": true,
          "alwaysOn": true,
          "canDisable": false,
          "effortValues": [
            "low",
            "medium",
            "high"
          ],
          "returnsReasoningContent": "unknown",
          "reasoningTokensVisible": "unknown",
          "reasoningTokensBillable": "unknown",
          "worksWithTools": "unknown",
          "worksWhileStreaming": "unknown",
          "requiresReasoningStateAfterTools": "unknown",
          "reducesOutputBudget": "unknown",
          "providerSpecificControls": [
            "reasoning_effort"
          ]
        },
        "freeAccess": {
          "isFree": false,
          "isPromotional": false
        }
      }
    },
    {
      "id": "openrouter:anthropic/claude-fable-5",
      "provider": "openrouter",
      "providerModelId": "anthropic/claude-fable-5",
      "displayName": "Claude Fable 5",
      "type": "multimodal",
      "capabilities": {
        "modalities": [
          "chat"
        ],
        "chat": {
          "streaming": true,
          "vision": true,
          "tools": true,
          "reasoning": {
            "supported": true,
            "efforts": [
              "low",
              "medium",
              "high"
            ],
            "defaultEffort": "medium",
            "source": "static-reviewed",
            "confidence": "exact"
          },
          "jsonSchema": true,
          "promptCaching": false
        }
      },
      "pricing": {
        "inputPerMillionUsd": 10,
        "outputPerMillionUsd": 50,
        "source": "static",
        "note": "Verified from live OpenRouter /api/v1/models. Do not copy to direct provider pricing."
      },
      "contextWindow": 1000000,
      "maxTokens": 128000,
      "supportsVision": true,
      "supportsTools": true,
      "supportsStreaming": true,
      "supportsSystemPrompts": true,
      "inputTypes": [
        "text",
        "image"
      ],
      "outputTypes": [
        "text"
      ],
      "specialFeatures": [
        "reasoning"
      ],
      "registry": {
        "category": "text.chat",
        "status": "active",
        "developer": "Anthropic",
        "family": "claude-fable",
        "version": "anthropic/claude-fable-5",
        "supportedRegions": [],
        "endpoints": [
          "chat"
        ],
        "aliases": [
          "anthropic/claude-fable-5"
        ],
        "fallbackModelIds": [],
        "verificationLevel": "verifiedDocumentationOnly",
        "source": {
          "authority": "studio-curated",
          "checkedAt": "2026-07-11",
          "urls": [
            "https://openrouter.ai/api/v1/models",
            "https://openrouter.ai/docs/api/api-reference/models/list-all-models-and-their-properties"
          ]
        },
        "pricing": {
          "kind": "token",
          "status": "verified",
          "currency": "USD",
          "billingUnit": "one_million_tokens",
          "inputPerMillion": 10,
          "cachedInputPerMillion": 1,
          "cacheWritePerMillion": 12.5,
          "outputPerMillion": 50,
          "batchInputPerMillion": null,
          "batchOutputPerMillion": null,
          "reasoningTokens": "unknown",
          "sourceUrls": [
            "https://openrouter.ai/api/v1/models",
            "https://openrouter.ai/docs/api/api-reference/models/list-all-models-and-their-properties"
          ],
          "verifiedAt": "2026-07-11",
          "notes": "Verified from live OpenRouter /api/v1/models. Do not copy to direct provider pricing."
        },
        "reasoning": {
          "supported": true,
          "alwaysOn": true,
          "canDisable": false,
          "effortValues": [
            "low",
            "medium",
            "high"
          ],
          "returnsReasoningContent": "unknown",
          "reasoningTokensVisible": "unknown",
          "reasoningTokensBillable": "unknown",
          "worksWithTools": "unknown",
          "worksWhileStreaming": "unknown",
          "requiresReasoningStateAfterTools": "unknown",
          "reducesOutputBudget": "unknown",
          "providerSpecificControls": [
            "reasoning_effort"
          ]
        },
        "freeAccess": {
          "isFree": false,
          "isPromotional": false
        }
      }
    },
    {
      "id": "openrouter:deepseek/deepseek-v4-pro",
      "provider": "openrouter",
      "providerModelId": "deepseek/deepseek-v4-pro",
      "displayName": "DeepSeek V4 Pro",
      "type": "chat",
      "capabilities": {
        "modalities": [
          "chat"
        ],
        "chat": {
          "streaming": true,
          "vision": false,
          "tools": true,
          "reasoning": {
            "supported": true,
            "efforts": [
              "low",
              "medium",
              "high"
            ],
            "defaultEffort": "medium",
            "source": "static-reviewed",
            "confidence": "exact"
          },
          "jsonSchema": true,
          "promptCaching": false
        }
      },
      "pricing": {
        "inputPerMillionUsd": 0.435,
        "outputPerMillionUsd": 0.87,
        "source": "static",
        "note": "Verified from live OpenRouter /api/v1/models. Do not copy to direct provider pricing."
      },
      "contextWindow": 1048576,
      "maxTokens": 128000,
      "supportsVision": false,
      "supportsTools": true,
      "supportsStreaming": true,
      "supportsSystemPrompts": true,
      "inputTypes": [
        "text"
      ],
      "outputTypes": [
        "text"
      ],
      "specialFeatures": [
        "reasoning"
      ],
      "registry": {
        "category": "text.chat",
        "status": "active",
        "developer": "DeepSeek",
        "family": "deepseek-v4",
        "version": "deepseek/deepseek-v4-pro",
        "supportedRegions": [],
        "endpoints": [
          "chat"
        ],
        "aliases": [
          "deepseek/deepseek-v4-pro"
        ],
        "fallbackModelIds": [],
        "verificationLevel": "verifiedDocumentationOnly",
        "source": {
          "authority": "studio-curated",
          "checkedAt": "2026-07-11",
          "urls": [
            "https://openrouter.ai/api/v1/models",
            "https://openrouter.ai/docs/api/api-reference/models/list-all-models-and-their-properties"
          ]
        },
        "pricing": {
          "kind": "token",
          "status": "verified",
          "currency": "USD",
          "billingUnit": "one_million_tokens",
          "inputPerMillion": 0.435,
          "cachedInputPerMillion": 0.003625,
          "cacheWritePerMillion": null,
          "outputPerMillion": 0.87,
          "batchInputPerMillion": null,
          "batchOutputPerMillion": null,
          "reasoningTokens": "unknown",
          "sourceUrls": [
            "https://openrouter.ai/api/v1/models",
            "https://openrouter.ai/docs/api/api-reference/models/list-all-models-and-their-properties"
          ],
          "verifiedAt": "2026-07-11",
          "notes": "Verified from live OpenRouter /api/v1/models. Do not copy to direct provider pricing."
        },
        "reasoning": {
          "supported": true,
          "alwaysOn": true,
          "canDisable": false,
          "effortValues": [
            "low",
            "medium",
            "high"
          ],
          "returnsReasoningContent": "unknown",
          "reasoningTokensVisible": "unknown",
          "reasoningTokensBillable": "unknown",
          "worksWithTools": "unknown",
          "worksWhileStreaming": "unknown",
          "requiresReasoningStateAfterTools": "unknown",
          "reducesOutputBudget": "unknown",
          "providerSpecificControls": [
            "reasoning_effort"
          ]
        },
        "freeAccess": {
          "isFree": false,
          "isPromotional": false
        }
      }
    },
    {
      "id": "openrouter:deepseek/deepseek-v4-flash",
      "provider": "openrouter",
      "providerModelId": "deepseek/deepseek-v4-flash",
      "displayName": "DeepSeek V4 Flash",
      "type": "chat",
      "capabilities": {
        "modalities": [
          "chat"
        ],
        "chat": {
          "streaming": true,
          "vision": false,
          "tools": true,
          "reasoning": {
            "supported": true,
            "efforts": [
              "low",
              "medium",
              "high"
            ],
            "defaultEffort": "medium",
            "source": "static-reviewed",
            "confidence": "exact"
          },
          "jsonSchema": true,
          "promptCaching": false
        }
      },
      "pricing": {
        "inputPerMillionUsd": 0.077,
        "outputPerMillionUsd": 0.154,
        "source": "static",
        "note": "Verified from live OpenRouter /api/v1/models. Do not copy to direct provider pricing."
      },
      "contextWindow": 1048576,
      "maxTokens": 128000,
      "supportsVision": false,
      "supportsTools": true,
      "supportsStreaming": true,
      "supportsSystemPrompts": true,
      "inputTypes": [
        "text"
      ],
      "outputTypes": [
        "text"
      ],
      "specialFeatures": [
        "reasoning"
      ],
      "registry": {
        "category": "text.chat",
        "status": "active",
        "developer": "DeepSeek",
        "family": "deepseek-v4",
        "version": "deepseek/deepseek-v4-flash",
        "supportedRegions": [],
        "endpoints": [
          "chat"
        ],
        "aliases": [
          "deepseek/deepseek-v4-flash"
        ],
        "fallbackModelIds": [],
        "verificationLevel": "verifiedDocumentationOnly",
        "source": {
          "authority": "studio-curated",
          "checkedAt": "2026-07-11",
          "urls": [
            "https://openrouter.ai/api/v1/models",
            "https://openrouter.ai/docs/api/api-reference/models/list-all-models-and-their-properties"
          ]
        },
        "pricing": {
          "kind": "token",
          "status": "verified",
          "currency": "USD",
          "billingUnit": "one_million_tokens",
          "inputPerMillion": 0.077,
          "cachedInputPerMillion": 0.0154,
          "cacheWritePerMillion": null,
          "outputPerMillion": 0.154,
          "batchInputPerMillion": null,
          "batchOutputPerMillion": null,
          "reasoningTokens": "unknown",
          "sourceUrls": [
            "https://openrouter.ai/api/v1/models",
            "https://openrouter.ai/docs/api/api-reference/models/list-all-models-and-their-properties"
          ],
          "verifiedAt": "2026-07-11",
          "notes": "Verified from live OpenRouter /api/v1/models. Do not copy to direct provider pricing."
        },
        "reasoning": {
          "supported": true,
          "alwaysOn": true,
          "canDisable": false,
          "effortValues": [
            "low",
            "medium",
            "high"
          ],
          "returnsReasoningContent": "unknown",
          "reasoningTokensVisible": "unknown",
          "reasoningTokensBillable": "unknown",
          "worksWithTools": "unknown",
          "worksWhileStreaming": "unknown",
          "requiresReasoningStateAfterTools": "unknown",
          "reducesOutputBudget": "unknown",
          "providerSpecificControls": [
            "reasoning_effort"
          ]
        },
        "freeAccess": {
          "isFree": false,
          "isPromotional": false
        }
      }
    },
    {
      "id": "openrouter:google/gemini-3.5-flash",
      "provider": "openrouter",
      "providerModelId": "google/gemini-3.5-flash",
      "displayName": "Gemini 3.5 Flash",
      "type": "multimodal",
      "capabilities": {
        "modalities": [
          "chat"
        ],
        "chat": {
          "streaming": true,
          "vision": true,
          "tools": true,
          "reasoning": {
            "supported": true,
            "efforts": [
              "low",
              "medium",
              "high"
            ],
            "defaultEffort": "medium",
            "source": "static-reviewed",
            "confidence": "exact"
          },
          "jsonSchema": true,
          "promptCaching": false
        }
      },
      "pricing": {
        "inputPerMillionUsd": 1.5,
        "outputPerMillionUsd": 9,
        "source": "static",
        "note": "Verified from live OpenRouter /api/v1/models. Do not copy to direct provider pricing."
      },
      "contextWindow": 1048576,
      "maxTokens": 128000,
      "supportsVision": true,
      "supportsTools": true,
      "supportsStreaming": true,
      "supportsSystemPrompts": true,
      "inputTypes": [
        "text",
        "image"
      ],
      "outputTypes": [
        "text"
      ],
      "specialFeatures": [
        "reasoning"
      ],
      "registry": {
        "category": "text.chat",
        "status": "active",
        "developer": "Google",
        "family": "gemini-3.5",
        "version": "google/gemini-3.5-flash",
        "supportedRegions": [],
        "endpoints": [
          "chat"
        ],
        "aliases": [
          "google/gemini-3.5-flash"
        ],
        "fallbackModelIds": [],
        "verificationLevel": "verifiedDocumentationOnly",
        "source": {
          "authority": "studio-curated",
          "checkedAt": "2026-07-11",
          "urls": [
            "https://openrouter.ai/api/v1/models",
            "https://openrouter.ai/docs/api/api-reference/models/list-all-models-and-their-properties"
          ]
        },
        "pricing": {
          "kind": "token",
          "status": "verified",
          "currency": "USD",
          "billingUnit": "one_million_tokens",
          "inputPerMillion": 1.5,
          "cachedInputPerMillion": 0.15,
          "cacheWritePerMillion": 0.08333333333333334,
          "outputPerMillion": 9,
          "batchInputPerMillion": null,
          "batchOutputPerMillion": null,
          "reasoningTokens": "unknown",
          "sourceUrls": [
            "https://openrouter.ai/api/v1/models",
            "https://openrouter.ai/docs/api/api-reference/models/list-all-models-and-their-properties"
          ],
          "verifiedAt": "2026-07-11",
          "notes": "Verified from live OpenRouter /api/v1/models. Do not copy to direct provider pricing."
        },
        "reasoning": {
          "supported": true,
          "alwaysOn": true,
          "canDisable": false,
          "effortValues": [
            "low",
            "medium",
            "high"
          ],
          "returnsReasoningContent": "unknown",
          "reasoningTokensVisible": "unknown",
          "reasoningTokensBillable": "unknown",
          "worksWithTools": "unknown",
          "worksWhileStreaming": "unknown",
          "requiresReasoningStateAfterTools": "unknown",
          "reducesOutputBudget": "unknown",
          "providerSpecificControls": [
            "reasoning_effort"
          ]
        },
        "freeAccess": {
          "isFree": false,
          "isPromotional": false
        }
      }
    },
    {
      "id": "openrouter:google/gemini-3.1-pro-preview",
      "provider": "openrouter",
      "providerModelId": "google/gemini-3.1-pro-preview",
      "displayName": "Gemini 3.1 Pro Preview",
      "type": "multimodal",
      "capabilities": {
        "modalities": [
          "chat"
        ],
        "chat": {
          "streaming": true,
          "vision": true,
          "tools": true,
          "reasoning": {
            "supported": true,
            "efforts": [
              "low",
              "medium",
              "high"
            ],
            "defaultEffort": "medium",
            "source": "static-reviewed",
            "confidence": "exact"
          },
          "jsonSchema": true,
          "promptCaching": false
        }
      },
      "pricing": {
        "inputPerMillionUsd": 2,
        "outputPerMillionUsd": 12,
        "source": "static",
        "note": "Verified from live OpenRouter /api/v1/models. Do not copy to direct provider pricing."
      },
      "contextWindow": 1048576,
      "maxTokens": 128000,
      "supportsVision": true,
      "supportsTools": true,
      "supportsStreaming": true,
      "supportsSystemPrompts": true,
      "inputTypes": [
        "text",
        "image"
      ],
      "outputTypes": [
        "text"
      ],
      "specialFeatures": [
        "reasoning"
      ],
      "registry": {
        "category": "text.chat",
        "status": "active",
        "developer": "Google",
        "family": "gemini-3.1",
        "version": "google/gemini-3.1-pro-preview",
        "supportedRegions": [],
        "endpoints": [
          "chat"
        ],
        "aliases": [
          "google/gemini-3.1-pro-preview"
        ],
        "fallbackModelIds": [],
        "verificationLevel": "verifiedDocumentationOnly",
        "source": {
          "authority": "studio-curated",
          "checkedAt": "2026-07-11",
          "urls": [
            "https://openrouter.ai/api/v1/models",
            "https://openrouter.ai/docs/api/api-reference/models/list-all-models-and-their-properties"
          ]
        },
        "pricing": {
          "kind": "token",
          "status": "verified",
          "currency": "USD",
          "billingUnit": "one_million_tokens",
          "inputPerMillion": 2,
          "cachedInputPerMillion": 0.2,
          "cacheWritePerMillion": 0.375,
          "outputPerMillion": 12,
          "batchInputPerMillion": null,
          "batchOutputPerMillion": null,
          "reasoningTokens": "unknown",
          "sourceUrls": [
            "https://openrouter.ai/api/v1/models",
            "https://openrouter.ai/docs/api/api-reference/models/list-all-models-and-their-properties"
          ],
          "verifiedAt": "2026-07-11",
          "notes": "Verified from live OpenRouter /api/v1/models. Do not copy to direct provider pricing."
        },
        "reasoning": {
          "supported": true,
          "alwaysOn": true,
          "canDisable": false,
          "effortValues": [
            "low",
            "medium",
            "high"
          ],
          "returnsReasoningContent": "unknown",
          "reasoningTokensVisible": "unknown",
          "reasoningTokensBillable": "unknown",
          "worksWithTools": "unknown",
          "worksWhileStreaming": "unknown",
          "requiresReasoningStateAfterTools": "unknown",
          "reducesOutputBudget": "unknown",
          "providerSpecificControls": [
            "reasoning_effort"
          ]
        },
        "freeAccess": {
          "isFree": false,
          "isPromotional": false
        }
      }
    },
    {
      "id": "openrouter:google/gemini-3.1-flash-lite",
      "provider": "openrouter",
      "providerModelId": "google/gemini-3.1-flash-lite",
      "displayName": "Gemini 3.1 Flash Lite",
      "type": "multimodal",
      "capabilities": {
        "modalities": [
          "chat"
        ],
        "chat": {
          "streaming": true,
          "vision": true,
          "tools": true,
          "reasoning": {
            "supported": true,
            "efforts": [
              "low",
              "medium",
              "high"
            ],
            "defaultEffort": "medium",
            "source": "static-reviewed",
            "confidence": "exact"
          },
          "jsonSchema": true,
          "promptCaching": false
        }
      },
      "pricing": {
        "inputPerMillionUsd": 0.25,
        "outputPerMillionUsd": 1.5,
        "source": "static",
        "note": "Verified from live OpenRouter /api/v1/models. Do not copy to direct provider pricing."
      },
      "contextWindow": 1048576,
      "maxTokens": 128000,
      "supportsVision": true,
      "supportsTools": true,
      "supportsStreaming": true,
      "supportsSystemPrompts": true,
      "inputTypes": [
        "text",
        "image"
      ],
      "outputTypes": [
        "text"
      ],
      "specialFeatures": [
        "reasoning"
      ],
      "registry": {
        "category": "text.chat",
        "status": "active",
        "developer": "Google",
        "family": "gemini-3.1",
        "version": "google/gemini-3.1-flash-lite",
        "supportedRegions": [],
        "endpoints": [
          "chat"
        ],
        "aliases": [
          "google/gemini-3.1-flash-lite"
        ],
        "fallbackModelIds": [],
        "verificationLevel": "verifiedDocumentationOnly",
        "source": {
          "authority": "studio-curated",
          "checkedAt": "2026-07-11",
          "urls": [
            "https://openrouter.ai/api/v1/models",
            "https://openrouter.ai/docs/api/api-reference/models/list-all-models-and-their-properties"
          ]
        },
        "pricing": {
          "kind": "token",
          "status": "verified",
          "currency": "USD",
          "billingUnit": "one_million_tokens",
          "inputPerMillion": 0.25,
          "cachedInputPerMillion": 0.025,
          "cacheWritePerMillion": 0.08333333333333334,
          "outputPerMillion": 1.5,
          "batchInputPerMillion": null,
          "batchOutputPerMillion": null,
          "reasoningTokens": "unknown",
          "sourceUrls": [
            "https://openrouter.ai/api/v1/models",
            "https://openrouter.ai/docs/api/api-reference/models/list-all-models-and-their-properties"
          ],
          "verifiedAt": "2026-07-11",
          "notes": "Verified from live OpenRouter /api/v1/models. Do not copy to direct provider pricing."
        },
        "reasoning": {
          "supported": true,
          "alwaysOn": true,
          "canDisable": false,
          "effortValues": [
            "low",
            "medium",
            "high"
          ],
          "returnsReasoningContent": "unknown",
          "reasoningTokensVisible": "unknown",
          "reasoningTokensBillable": "unknown",
          "worksWithTools": "unknown",
          "worksWhileStreaming": "unknown",
          "requiresReasoningStateAfterTools": "unknown",
          "reducesOutputBudget": "unknown",
          "providerSpecificControls": [
            "reasoning_effort"
          ]
        },
        "freeAccess": {
          "isFree": false,
          "isPromotional": false
        }
      }
    },
    {
      "id": "openrouter:minimax/minimax-m3",
      "provider": "openrouter",
      "providerModelId": "minimax/minimax-m3",
      "displayName": "MiniMax M3",
      "type": "multimodal",
      "capabilities": {
        "modalities": [
          "chat"
        ],
        "chat": {
          "streaming": true,
          "vision": true,
          "tools": true,
          "reasoning": {
            "supported": true,
            "efforts": [
              "low",
              "medium",
              "high"
            ],
            "defaultEffort": "medium",
            "source": "static-reviewed",
            "confidence": "exact"
          },
          "jsonSchema": true,
          "promptCaching": false
        }
      },
      "pricing": {
        "inputPerMillionUsd": 0.3,
        "outputPerMillionUsd": 1.2,
        "source": "static",
        "note": "Verified from live OpenRouter /api/v1/models. Do not copy to direct provider pricing."
      },
      "contextWindow": 1048576,
      "maxTokens": 128000,
      "supportsVision": true,
      "supportsTools": true,
      "supportsStreaming": true,
      "supportsSystemPrompts": true,
      "inputTypes": [
        "text",
        "image"
      ],
      "outputTypes": [
        "text"
      ],
      "specialFeatures": [
        "reasoning"
      ],
      "registry": {
        "category": "text.chat",
        "status": "active",
        "developer": "MiniMax",
        "family": "minimax-m3",
        "version": "minimax/minimax-m3",
        "supportedRegions": [],
        "endpoints": [
          "chat"
        ],
        "aliases": [
          "minimax/minimax-m3"
        ],
        "fallbackModelIds": [],
        "verificationLevel": "verifiedDocumentationOnly",
        "source": {
          "authority": "studio-curated",
          "checkedAt": "2026-07-11",
          "urls": [
            "https://openrouter.ai/api/v1/models",
            "https://openrouter.ai/docs/api/api-reference/models/list-all-models-and-their-properties"
          ]
        },
        "pricing": {
          "kind": "token",
          "status": "verified",
          "currency": "USD",
          "billingUnit": "one_million_tokens",
          "inputPerMillion": 0.3,
          "cachedInputPerMillion": 0.06,
          "cacheWritePerMillion": null,
          "outputPerMillion": 1.2,
          "batchInputPerMillion": null,
          "batchOutputPerMillion": null,
          "reasoningTokens": "unknown",
          "sourceUrls": [
            "https://openrouter.ai/api/v1/models",
            "https://openrouter.ai/docs/api/api-reference/models/list-all-models-and-their-properties"
          ],
          "verifiedAt": "2026-07-11",
          "notes": "Verified from live OpenRouter /api/v1/models. Do not copy to direct provider pricing."
        },
        "reasoning": {
          "supported": true,
          "alwaysOn": true,
          "canDisable": false,
          "effortValues": [
            "low",
            "medium",
            "high"
          ],
          "returnsReasoningContent": "unknown",
          "reasoningTokensVisible": "unknown",
          "reasoningTokensBillable": "unknown",
          "worksWithTools": "unknown",
          "worksWhileStreaming": "unknown",
          "requiresReasoningStateAfterTools": "unknown",
          "reducesOutputBudget": "unknown",
          "providerSpecificControls": [
            "reasoning_effort"
          ]
        },
        "freeAccess": {
          "isFree": false,
          "isPromotional": false
        }
      }
    },
    {
      "id": "openrouter:moonshotai/kimi-k2.6",
      "provider": "openrouter",
      "providerModelId": "moonshotai/kimi-k2.6",
      "displayName": "Kimi K2.6",
      "type": "multimodal",
      "capabilities": {
        "modalities": [
          "chat"
        ],
        "chat": {
          "streaming": true,
          "vision": true,
          "tools": true,
          "reasoning": {
            "supported": true,
            "efforts": [
              "low",
              "medium",
              "high"
            ],
            "defaultEffort": "medium",
            "source": "static-reviewed",
            "confidence": "exact"
          },
          "jsonSchema": true,
          "promptCaching": false
        }
      },
      "pricing": {
        "inputPerMillionUsd": 0.66,
        "outputPerMillionUsd": 3.41,
        "source": "static",
        "note": "Verified from live OpenRouter /api/v1/models. Do not copy to direct provider pricing."
      },
      "contextWindow": 262144,
      "maxTokens": 128000,
      "supportsVision": true,
      "supportsTools": true,
      "supportsStreaming": true,
      "supportsSystemPrompts": true,
      "inputTypes": [
        "text",
        "image"
      ],
      "outputTypes": [
        "text"
      ],
      "specialFeatures": [
        "reasoning"
      ],
      "registry": {
        "category": "text.chat",
        "status": "active",
        "developer": "Moonshot AI",
        "family": "kimi-k2",
        "version": "moonshotai/kimi-k2.6",
        "supportedRegions": [],
        "endpoints": [
          "chat"
        ],
        "aliases": [
          "moonshotai/kimi-k2.6"
        ],
        "fallbackModelIds": [],
        "verificationLevel": "verifiedDocumentationOnly",
        "source": {
          "authority": "studio-curated",
          "checkedAt": "2026-07-11",
          "urls": [
            "https://openrouter.ai/api/v1/models",
            "https://openrouter.ai/docs/api/api-reference/models/list-all-models-and-their-properties"
          ]
        },
        "pricing": {
          "kind": "token",
          "status": "verified",
          "currency": "USD",
          "billingUnit": "one_million_tokens",
          "inputPerMillion": 0.66,
          "cachedInputPerMillion": 0.15,
          "cacheWritePerMillion": null,
          "outputPerMillion": 3.41,
          "batchInputPerMillion": null,
          "batchOutputPerMillion": null,
          "reasoningTokens": "unknown",
          "sourceUrls": [
            "https://openrouter.ai/api/v1/models",
            "https://openrouter.ai/docs/api/api-reference/models/list-all-models-and-their-properties"
          ],
          "verifiedAt": "2026-07-11",
          "notes": "Verified from live OpenRouter /api/v1/models. Do not copy to direct provider pricing."
        },
        "reasoning": {
          "supported": true,
          "alwaysOn": true,
          "canDisable": false,
          "effortValues": [
            "low",
            "medium",
            "high"
          ],
          "returnsReasoningContent": "unknown",
          "reasoningTokensVisible": "unknown",
          "reasoningTokensBillable": "unknown",
          "worksWithTools": "unknown",
          "worksWhileStreaming": "unknown",
          "requiresReasoningStateAfterTools": "unknown",
          "reducesOutputBudget": "unknown",
          "providerSpecificControls": [
            "reasoning_effort"
          ]
        },
        "freeAccess": {
          "isFree": false,
          "isPromotional": false
        }
      }
    },
    {
      "id": "openrouter:moonshotai/kimi-k2.7-code",
      "provider": "openrouter",
      "providerModelId": "moonshotai/kimi-k2.7-code",
      "displayName": "Kimi K2.7 Code",
      "type": "multimodal",
      "capabilities": {
        "modalities": [
          "chat"
        ],
        "chat": {
          "streaming": true,
          "vision": true,
          "tools": true,
          "reasoning": {
            "supported": true,
            "efforts": [
              "low",
              "medium",
              "high"
            ],
            "defaultEffort": "medium",
            "source": "static-reviewed",
            "confidence": "exact"
          },
          "jsonSchema": true,
          "promptCaching": false
        }
      },
      "pricing": {
        "inputPerMillionUsd": 0.72,
        "outputPerMillionUsd": 3.5,
        "source": "static",
        "note": "Verified from live OpenRouter /api/v1/models. Do not copy to direct provider pricing."
      },
      "contextWindow": 262144,
      "maxTokens": 128000,
      "supportsVision": true,
      "supportsTools": true,
      "supportsStreaming": true,
      "supportsSystemPrompts": true,
      "inputTypes": [
        "text",
        "image"
      ],
      "outputTypes": [
        "text"
      ],
      "specialFeatures": [
        "reasoning"
      ],
      "registry": {
        "category": "text.chat",
        "status": "active",
        "developer": "Moonshot AI",
        "family": "kimi-k2",
        "version": "moonshotai/kimi-k2.7-code",
        "supportedRegions": [],
        "endpoints": [
          "chat"
        ],
        "aliases": [
          "moonshotai/kimi-k2.7-code"
        ],
        "fallbackModelIds": [],
        "verificationLevel": "verifiedDocumentationOnly",
        "source": {
          "authority": "studio-curated",
          "checkedAt": "2026-07-11",
          "urls": [
            "https://openrouter.ai/api/v1/models",
            "https://openrouter.ai/docs/api/api-reference/models/list-all-models-and-their-properties"
          ]
        },
        "pricing": {
          "kind": "token",
          "status": "verified",
          "currency": "USD",
          "billingUnit": "one_million_tokens",
          "inputPerMillion": 0.72,
          "cachedInputPerMillion": 0.15,
          "cacheWritePerMillion": null,
          "outputPerMillion": 3.5,
          "batchInputPerMillion": null,
          "batchOutputPerMillion": null,
          "reasoningTokens": "unknown",
          "sourceUrls": [
            "https://openrouter.ai/api/v1/models",
            "https://openrouter.ai/docs/api/api-reference/models/list-all-models-and-their-properties"
          ],
          "verifiedAt": "2026-07-11",
          "notes": "Verified from live OpenRouter /api/v1/models. Do not copy to direct provider pricing."
        },
        "reasoning": {
          "supported": true,
          "alwaysOn": true,
          "canDisable": false,
          "effortValues": [
            "low",
            "medium",
            "high"
          ],
          "returnsReasoningContent": "unknown",
          "reasoningTokensVisible": "unknown",
          "reasoningTokensBillable": "unknown",
          "worksWithTools": "unknown",
          "worksWhileStreaming": "unknown",
          "requiresReasoningStateAfterTools": "unknown",
          "reducesOutputBudget": "unknown",
          "providerSpecificControls": [
            "reasoning_effort"
          ]
        },
        "freeAccess": {
          "isFree": false,
          "isPromotional": false
        }
      }
    },
    {
      "id": "openrouter:poolside/laguna-xs-2.1",
      "provider": "openrouter",
      "providerModelId": "poolside/laguna-xs-2.1",
      "displayName": "Laguna XS 2.1",
      "type": "chat",
      "capabilities": {
        "modalities": [
          "chat"
        ],
        "chat": {
          "streaming": true,
          "vision": false,
          "tools": true,
          "reasoning": {
            "supported": true,
            "efforts": [
              "low",
              "medium",
              "high"
            ],
            "defaultEffort": "medium",
            "source": "static-reviewed",
            "confidence": "exact"
          },
          "jsonSchema": true,
          "promptCaching": false
        }
      },
      "pricing": {
        "inputPerMillionUsd": 0.06,
        "outputPerMillionUsd": 0.12,
        "source": "static",
        "note": "Verified from live OpenRouter /api/v1/models. Do not copy to direct provider pricing."
      },
      "contextWindow": 262144,
      "maxTokens": 128000,
      "supportsVision": false,
      "supportsTools": true,
      "supportsStreaming": true,
      "supportsSystemPrompts": true,
      "inputTypes": [
        "text"
      ],
      "outputTypes": [
        "text"
      ],
      "specialFeatures": [
        "reasoning"
      ],
      "registry": {
        "category": "text.chat",
        "status": "active",
        "developer": "Poolside",
        "family": "laguna",
        "version": "poolside/laguna-xs-2.1",
        "supportedRegions": [],
        "endpoints": [
          "chat"
        ],
        "aliases": [
          "poolside/laguna-xs-2.1"
        ],
        "fallbackModelIds": [],
        "verificationLevel": "verifiedDocumentationOnly",
        "source": {
          "authority": "studio-curated",
          "checkedAt": "2026-07-11",
          "urls": [
            "https://openrouter.ai/api/v1/models",
            "https://openrouter.ai/docs/api/api-reference/models/list-all-models-and-their-properties"
          ]
        },
        "pricing": {
          "kind": "token",
          "status": "verified",
          "currency": "USD",
          "billingUnit": "one_million_tokens",
          "inputPerMillion": 0.06,
          "cachedInputPerMillion": 0.03,
          "cacheWritePerMillion": null,
          "outputPerMillion": 0.12,
          "batchInputPerMillion": null,
          "batchOutputPerMillion": null,
          "reasoningTokens": "unknown",
          "sourceUrls": [
            "https://openrouter.ai/api/v1/models",
            "https://openrouter.ai/docs/api/api-reference/models/list-all-models-and-their-properties"
          ],
          "verifiedAt": "2026-07-11",
          "notes": "Verified from live OpenRouter /api/v1/models. Do not copy to direct provider pricing."
        },
        "reasoning": {
          "supported": true,
          "alwaysOn": true,
          "canDisable": false,
          "effortValues": [
            "low",
            "medium",
            "high"
          ],
          "returnsReasoningContent": "unknown",
          "reasoningTokensVisible": "unknown",
          "reasoningTokensBillable": "unknown",
          "worksWithTools": "unknown",
          "worksWhileStreaming": "unknown",
          "requiresReasoningStateAfterTools": "unknown",
          "reducesOutputBudget": "unknown",
          "providerSpecificControls": [
            "reasoning_effort"
          ]
        },
        "freeAccess": {
          "isFree": false,
          "isPromotional": false
        }
      }
    },
    {
      "id": "openrouter:poolside/laguna-xs-2.1:free",
      "provider": "openrouter",
      "providerModelId": "poolside/laguna-xs-2.1:free",
      "displayName": "Laguna XS 2.1 Free",
      "type": "chat",
      "capabilities": {
        "modalities": [
          "chat"
        ],
        "chat": {
          "streaming": true,
          "vision": false,
          "tools": true,
          "reasoning": {
            "supported": true,
            "efforts": [
              "low",
              "medium",
              "high"
            ],
            "defaultEffort": "medium",
            "source": "static-reviewed",
            "confidence": "exact"
          },
          "jsonSchema": true,
          "promptCaching": false
        }
      },
      "pricing": {
        "inputPerMillionUsd": 0,
        "outputPerMillionUsd": 0,
        "source": "static",
        "note": "Verified from live OpenRouter /api/v1/models. Do not copy to direct provider pricing."
      },
      "contextWindow": 262144,
      "maxTokens": 128000,
      "supportsVision": false,
      "supportsTools": true,
      "supportsStreaming": true,
      "supportsSystemPrompts": true,
      "inputTypes": [
        "text"
      ],
      "outputTypes": [
        "text"
      ],
      "specialFeatures": [
        "reasoning"
      ],
      "registry": {
        "category": "text.chat",
        "status": "active",
        "developer": "Poolside",
        "family": "laguna",
        "version": "poolside/laguna-xs-2.1:free",
        "supportedRegions": [],
        "endpoints": [
          "chat"
        ],
        "aliases": [
          "poolside/laguna-xs-2.1:free"
        ],
        "fallbackModelIds": [],
        "verificationLevel": "verifiedDocumentationOnly",
        "source": {
          "authority": "studio-curated",
          "checkedAt": "2026-07-11",
          "urls": [
            "https://openrouter.ai/api/v1/models",
            "https://openrouter.ai/docs/api/api-reference/models/list-all-models-and-their-properties"
          ]
        },
        "pricing": {
          "kind": "token",
          "status": "verified",
          "currency": "USD",
          "billingUnit": "one_million_tokens",
          "inputPerMillion": 0,
          "cachedInputPerMillion": null,
          "cacheWritePerMillion": null,
          "outputPerMillion": 0,
          "batchInputPerMillion": null,
          "batchOutputPerMillion": null,
          "reasoningTokens": "unknown",
          "sourceUrls": [
            "https://openrouter.ai/api/v1/models",
            "https://openrouter.ai/docs/api/api-reference/models/list-all-models-and-their-properties"
          ],
          "verifiedAt": "2026-07-11",
          "notes": "Verified from live OpenRouter /api/v1/models. Do not copy to direct provider pricing."
        },
        "reasoning": {
          "supported": true,
          "alwaysOn": true,
          "canDisable": false,
          "effortValues": [
            "low",
            "medium",
            "high"
          ],
          "returnsReasoningContent": "unknown",
          "reasoningTokensVisible": "unknown",
          "reasoningTokensBillable": "unknown",
          "worksWithTools": "unknown",
          "worksWhileStreaming": "unknown",
          "requiresReasoningStateAfterTools": "unknown",
          "reducesOutputBudget": "unknown",
          "providerSpecificControls": [
            "reasoning_effort"
          ]
        },
        "freeAccess": {
          "isFree": true,
          "freeType": "separate_route",
          "isPromotional": false
        }
      }
    },
    {
      "id": "openrouter:poolside/laguna-m.1",
      "provider": "openrouter",
      "providerModelId": "poolside/laguna-m.1",
      "displayName": "Laguna M.1",
      "type": "chat",
      "capabilities": {
        "modalities": [
          "chat"
        ],
        "chat": {
          "streaming": true,
          "vision": false,
          "tools": true,
          "reasoning": {
            "supported": true,
            "efforts": [
              "low",
              "medium",
              "high"
            ],
            "defaultEffort": "medium",
            "source": "static-reviewed",
            "confidence": "exact"
          },
          "jsonSchema": true,
          "promptCaching": false
        }
      },
      "pricing": {
        "inputPerMillionUsd": 0.2,
        "outputPerMillionUsd": 0.4,
        "source": "static",
        "note": "Verified from live OpenRouter /api/v1/models. Do not copy to direct provider pricing."
      },
      "contextWindow": 262144,
      "maxTokens": 128000,
      "supportsVision": false,
      "supportsTools": true,
      "supportsStreaming": true,
      "supportsSystemPrompts": true,
      "inputTypes": [
        "text"
      ],
      "outputTypes": [
        "text"
      ],
      "specialFeatures": [
        "reasoning"
      ],
      "registry": {
        "category": "text.chat",
        "status": "active",
        "developer": "Poolside",
        "family": "laguna",
        "version": "poolside/laguna-m.1",
        "supportedRegions": [],
        "endpoints": [
          "chat"
        ],
        "aliases": [
          "poolside/laguna-m.1"
        ],
        "fallbackModelIds": [],
        "verificationLevel": "verifiedDocumentationOnly",
        "source": {
          "authority": "studio-curated",
          "checkedAt": "2026-07-11",
          "urls": [
            "https://openrouter.ai/api/v1/models",
            "https://openrouter.ai/docs/api/api-reference/models/list-all-models-and-their-properties"
          ]
        },
        "pricing": {
          "kind": "token",
          "status": "verified",
          "currency": "USD",
          "billingUnit": "one_million_tokens",
          "inputPerMillion": 0.2,
          "cachedInputPerMillion": 0.1,
          "cacheWritePerMillion": null,
          "outputPerMillion": 0.4,
          "batchInputPerMillion": null,
          "batchOutputPerMillion": null,
          "reasoningTokens": "unknown",
          "sourceUrls": [
            "https://openrouter.ai/api/v1/models",
            "https://openrouter.ai/docs/api/api-reference/models/list-all-models-and-their-properties"
          ],
          "verifiedAt": "2026-07-11",
          "notes": "Verified from live OpenRouter /api/v1/models. Do not copy to direct provider pricing."
        },
        "reasoning": {
          "supported": true,
          "alwaysOn": true,
          "canDisable": false,
          "effortValues": [
            "low",
            "medium",
            "high"
          ],
          "returnsReasoningContent": "unknown",
          "reasoningTokensVisible": "unknown",
          "reasoningTokensBillable": "unknown",
          "worksWithTools": "unknown",
          "worksWhileStreaming": "unknown",
          "requiresReasoningStateAfterTools": "unknown",
          "reducesOutputBudget": "unknown",
          "providerSpecificControls": [
            "reasoning_effort"
          ]
        },
        "freeAccess": {
          "isFree": false,
          "isPromotional": false
        }
      }
    },
    {
      "id": "openrouter:poolside/laguna-m.1:free",
      "provider": "openrouter",
      "providerModelId": "poolside/laguna-m.1:free",
      "displayName": "Laguna M.1 Free",
      "type": "chat",
      "capabilities": {
        "modalities": [
          "chat"
        ],
        "chat": {
          "streaming": true,
          "vision": false,
          "tools": true,
          "reasoning": {
            "supported": true,
            "efforts": [
              "low",
              "medium",
              "high"
            ],
            "defaultEffort": "medium",
            "source": "static-reviewed",
            "confidence": "exact"
          },
          "jsonSchema": true,
          "promptCaching": false
        }
      },
      "pricing": {
        "inputPerMillionUsd": 0,
        "outputPerMillionUsd": 0,
        "source": "static",
        "note": "Verified from live OpenRouter /api/v1/models. Do not copy to direct provider pricing."
      },
      "contextWindow": 262144,
      "maxTokens": 128000,
      "supportsVision": false,
      "supportsTools": true,
      "supportsStreaming": true,
      "supportsSystemPrompts": true,
      "inputTypes": [
        "text"
      ],
      "outputTypes": [
        "text"
      ],
      "specialFeatures": [
        "reasoning"
      ],
      "registry": {
        "category": "text.chat",
        "status": "active",
        "developer": "Poolside",
        "family": "laguna",
        "version": "poolside/laguna-m.1:free",
        "supportedRegions": [],
        "endpoints": [
          "chat"
        ],
        "aliases": [
          "poolside/laguna-m.1:free"
        ],
        "fallbackModelIds": [],
        "verificationLevel": "verifiedDocumentationOnly",
        "source": {
          "authority": "studio-curated",
          "checkedAt": "2026-07-11",
          "urls": [
            "https://openrouter.ai/api/v1/models",
            "https://openrouter.ai/docs/api/api-reference/models/list-all-models-and-their-properties"
          ]
        },
        "pricing": {
          "kind": "token",
          "status": "verified",
          "currency": "USD",
          "billingUnit": "one_million_tokens",
          "inputPerMillion": 0,
          "cachedInputPerMillion": null,
          "cacheWritePerMillion": null,
          "outputPerMillion": 0,
          "batchInputPerMillion": null,
          "batchOutputPerMillion": null,
          "reasoningTokens": "unknown",
          "sourceUrls": [
            "https://openrouter.ai/api/v1/models",
            "https://openrouter.ai/docs/api/api-reference/models/list-all-models-and-their-properties"
          ],
          "verifiedAt": "2026-07-11",
          "notes": "Verified from live OpenRouter /api/v1/models. Do not copy to direct provider pricing."
        },
        "reasoning": {
          "supported": true,
          "alwaysOn": true,
          "canDisable": false,
          "effortValues": [
            "low",
            "medium",
            "high"
          ],
          "returnsReasoningContent": "unknown",
          "reasoningTokensVisible": "unknown",
          "reasoningTokensBillable": "unknown",
          "worksWithTools": "unknown",
          "worksWhileStreaming": "unknown",
          "requiresReasoningStateAfterTools": "unknown",
          "reducesOutputBudget": "unknown",
          "providerSpecificControls": [
            "reasoning_effort"
          ]
        },
        "freeAccess": {
          "isFree": true,
          "freeType": "separate_route",
          "isPromotional": false
        }
      }
    },
    {
      "id": "openrouter:x-ai/grok-4.5",
      "provider": "openrouter",
      "providerModelId": "x-ai/grok-4.5",
      "displayName": "Grok 4.5",
      "type": "multimodal",
      "capabilities": {
        "modalities": [
          "chat"
        ],
        "chat": {
          "streaming": true,
          "vision": true,
          "tools": true,
          "reasoning": {
            "supported": true,
            "efforts": [
              "low",
              "medium",
              "high"
            ],
            "defaultEffort": "medium",
            "source": "static-reviewed",
            "confidence": "exact"
          },
          "jsonSchema": true,
          "promptCaching": false
        }
      },
      "pricing": {
        "inputPerMillionUsd": 2,
        "outputPerMillionUsd": 6,
        "source": "static",
        "note": "Verified from live OpenRouter /api/v1/models. Do not copy to direct provider pricing."
      },
      "contextWindow": 500000,
      "maxTokens": 128000,
      "supportsVision": true,
      "supportsTools": true,
      "supportsStreaming": true,
      "supportsSystemPrompts": true,
      "inputTypes": [
        "text",
        "image"
      ],
      "outputTypes": [
        "text"
      ],
      "specialFeatures": [
        "reasoning"
      ],
      "registry": {
        "category": "text.chat",
        "status": "active",
        "developer": "xAI",
        "family": "grok-4",
        "version": "x-ai/grok-4.5",
        "supportedRegions": [],
        "endpoints": [
          "chat"
        ],
        "aliases": [
          "x-ai/grok-4.5"
        ],
        "fallbackModelIds": [],
        "verificationLevel": "verifiedDocumentationOnly",
        "source": {
          "authority": "studio-curated",
          "checkedAt": "2026-07-11",
          "urls": [
            "https://openrouter.ai/api/v1/models",
            "https://openrouter.ai/docs/api/api-reference/models/list-all-models-and-their-properties"
          ]
        },
        "pricing": {
          "kind": "token",
          "status": "verified",
          "currency": "USD",
          "billingUnit": "one_million_tokens",
          "inputPerMillion": 2,
          "cachedInputPerMillion": 0.5,
          "cacheWritePerMillion": null,
          "outputPerMillion": 6,
          "batchInputPerMillion": null,
          "batchOutputPerMillion": null,
          "reasoningTokens": "unknown",
          "sourceUrls": [
            "https://openrouter.ai/api/v1/models",
            "https://openrouter.ai/docs/api/api-reference/models/list-all-models-and-their-properties"
          ],
          "verifiedAt": "2026-07-11",
          "notes": "Verified from live OpenRouter /api/v1/models. Do not copy to direct provider pricing."
        },
        "reasoning": {
          "supported": true,
          "alwaysOn": true,
          "canDisable": false,
          "effortValues": [
            "low",
            "medium",
            "high"
          ],
          "returnsReasoningContent": "unknown",
          "reasoningTokensVisible": "unknown",
          "reasoningTokensBillable": "unknown",
          "worksWithTools": "unknown",
          "worksWhileStreaming": "unknown",
          "requiresReasoningStateAfterTools": "unknown",
          "reducesOutputBudget": "unknown",
          "providerSpecificControls": [
            "reasoning_effort"
          ]
        },
        "freeAccess": {
          "isFree": false,
          "isPromotional": false
        }
      }
    },
    {
      "id": "openrouter:x-ai/grok-4.3",
      "provider": "openrouter",
      "providerModelId": "x-ai/grok-4.3",
      "displayName": "Grok 4.3",
      "type": "multimodal",
      "capabilities": {
        "modalities": [
          "chat"
        ],
        "chat": {
          "streaming": true,
          "vision": true,
          "tools": true,
          "reasoning": {
            "supported": true,
            "efforts": [
              "low",
              "medium",
              "high"
            ],
            "defaultEffort": "medium",
            "source": "static-reviewed",
            "confidence": "exact"
          },
          "jsonSchema": true,
          "promptCaching": false
        }
      },
      "pricing": {
        "inputPerMillionUsd": 1.25,
        "outputPerMillionUsd": 2.5,
        "source": "static",
        "note": "Verified from live OpenRouter /api/v1/models. Do not copy to direct provider pricing."
      },
      "contextWindow": 1000000,
      "maxTokens": 128000,
      "supportsVision": true,
      "supportsTools": true,
      "supportsStreaming": true,
      "supportsSystemPrompts": true,
      "inputTypes": [
        "text",
        "image"
      ],
      "outputTypes": [
        "text"
      ],
      "specialFeatures": [
        "reasoning"
      ],
      "registry": {
        "category": "text.chat",
        "status": "active",
        "developer": "xAI",
        "family": "grok-4",
        "version": "x-ai/grok-4.3",
        "supportedRegions": [],
        "endpoints": [
          "chat"
        ],
        "aliases": [
          "x-ai/grok-4.3"
        ],
        "fallbackModelIds": [],
        "verificationLevel": "verifiedDocumentationOnly",
        "source": {
          "authority": "studio-curated",
          "checkedAt": "2026-07-11",
          "urls": [
            "https://openrouter.ai/api/v1/models",
            "https://openrouter.ai/docs/api/api-reference/models/list-all-models-and-their-properties"
          ]
        },
        "pricing": {
          "kind": "token",
          "status": "verified",
          "currency": "USD",
          "billingUnit": "one_million_tokens",
          "inputPerMillion": 1.25,
          "cachedInputPerMillion": 0.2,
          "cacheWritePerMillion": null,
          "outputPerMillion": 2.5,
          "batchInputPerMillion": null,
          "batchOutputPerMillion": null,
          "reasoningTokens": "unknown",
          "sourceUrls": [
            "https://openrouter.ai/api/v1/models",
            "https://openrouter.ai/docs/api/api-reference/models/list-all-models-and-their-properties"
          ],
          "verifiedAt": "2026-07-11",
          "notes": "Verified from live OpenRouter /api/v1/models. Do not copy to direct provider pricing."
        },
        "reasoning": {
          "supported": true,
          "alwaysOn": true,
          "canDisable": false,
          "effortValues": [
            "low",
            "medium",
            "high"
          ],
          "returnsReasoningContent": "unknown",
          "reasoningTokensVisible": "unknown",
          "reasoningTokensBillable": "unknown",
          "worksWithTools": "unknown",
          "worksWhileStreaming": "unknown",
          "requiresReasoningStateAfterTools": "unknown",
          "reducesOutputBudget": "unknown",
          "providerSpecificControls": [
            "reasoning_effort"
          ]
        },
        "freeAccess": {
          "isFree": false,
          "isPromotional": false
        }
      }
    },
    {
      "id": "openrouter:xiaomi/mimo-v2.5",
      "provider": "openrouter",
      "providerModelId": "xiaomi/mimo-v2.5",
      "displayName": "MiMo V2.5",
      "type": "multimodal",
      "capabilities": {
        "modalities": [
          "chat"
        ],
        "chat": {
          "streaming": true,
          "vision": true,
          "tools": true,
          "reasoning": {
            "supported": true,
            "efforts": [
              "low",
              "medium",
              "high"
            ],
            "defaultEffort": "medium",
            "source": "static-reviewed",
            "confidence": "exact"
          },
          "jsonSchema": true,
          "promptCaching": false
        }
      },
      "pricing": {
        "inputPerMillionUsd": 0.105,
        "outputPerMillionUsd": 0.28,
        "source": "static",
        "note": "Verified from live OpenRouter /api/v1/models. Do not copy to direct provider pricing."
      },
      "contextWindow": 1048576,
      "maxTokens": 128000,
      "supportsVision": true,
      "supportsTools": true,
      "supportsStreaming": true,
      "supportsSystemPrompts": true,
      "inputTypes": [
        "text",
        "image"
      ],
      "outputTypes": [
        "text"
      ],
      "specialFeatures": [
        "reasoning"
      ],
      "registry": {
        "category": "text.chat",
        "status": "active",
        "developer": "Xiaomi",
        "family": "mimo-v2.5",
        "version": "xiaomi/mimo-v2.5",
        "supportedRegions": [],
        "endpoints": [
          "chat"
        ],
        "aliases": [
          "xiaomi/mimo-v2.5"
        ],
        "fallbackModelIds": [],
        "verificationLevel": "verifiedDocumentationOnly",
        "source": {
          "authority": "studio-curated",
          "checkedAt": "2026-07-11",
          "urls": [
            "https://openrouter.ai/api/v1/models",
            "https://openrouter.ai/docs/api/api-reference/models/list-all-models-and-their-properties"
          ]
        },
        "pricing": {
          "kind": "token",
          "status": "verified",
          "currency": "USD",
          "billingUnit": "one_million_tokens",
          "inputPerMillion": 0.105,
          "cachedInputPerMillion": 0.028,
          "cacheWritePerMillion": null,
          "outputPerMillion": 0.28,
          "batchInputPerMillion": null,
          "batchOutputPerMillion": null,
          "reasoningTokens": "unknown",
          "sourceUrls": [
            "https://openrouter.ai/api/v1/models",
            "https://openrouter.ai/docs/api/api-reference/models/list-all-models-and-their-properties"
          ],
          "verifiedAt": "2026-07-11",
          "notes": "Verified from live OpenRouter /api/v1/models. Do not copy to direct provider pricing."
        },
        "reasoning": {
          "supported": true,
          "alwaysOn": true,
          "canDisable": false,
          "effortValues": [
            "low",
            "medium",
            "high"
          ],
          "returnsReasoningContent": "unknown",
          "reasoningTokensVisible": "unknown",
          "reasoningTokensBillable": "unknown",
          "worksWithTools": "unknown",
          "worksWhileStreaming": "unknown",
          "requiresReasoningStateAfterTools": "unknown",
          "reducesOutputBudget": "unknown",
          "providerSpecificControls": [
            "reasoning_effort"
          ]
        },
        "freeAccess": {
          "isFree": false,
          "isPromotional": false
        }
      }
    },
    {
      "id": "openrouter:xiaomi/mimo-v2.5-pro",
      "provider": "openrouter",
      "providerModelId": "xiaomi/mimo-v2.5-pro",
      "displayName": "MiMo V2.5 Pro",
      "type": "chat",
      "capabilities": {
        "modalities": [
          "chat"
        ],
        "chat": {
          "streaming": true,
          "vision": false,
          "tools": true,
          "reasoning": {
            "supported": true,
            "efforts": [
              "low",
              "medium",
              "high"
            ],
            "defaultEffort": "medium",
            "source": "static-reviewed",
            "confidence": "exact"
          },
          "jsonSchema": true,
          "promptCaching": false
        }
      },
      "pricing": {
        "inputPerMillionUsd": 0.435,
        "outputPerMillionUsd": 0.87,
        "source": "static",
        "note": "Verified from live OpenRouter /api/v1/models. Do not copy to direct provider pricing."
      },
      "contextWindow": 1048576,
      "maxTokens": 128000,
      "supportsVision": false,
      "supportsTools": true,
      "supportsStreaming": true,
      "supportsSystemPrompts": true,
      "inputTypes": [
        "text"
      ],
      "outputTypes": [
        "text"
      ],
      "specialFeatures": [
        "reasoning"
      ],
      "registry": {
        "category": "text.chat",
        "status": "active",
        "developer": "Xiaomi",
        "family": "mimo-v2.5",
        "version": "xiaomi/mimo-v2.5-pro",
        "supportedRegions": [],
        "endpoints": [
          "chat"
        ],
        "aliases": [
          "xiaomi/mimo-v2.5-pro"
        ],
        "fallbackModelIds": [],
        "verificationLevel": "verifiedDocumentationOnly",
        "source": {
          "authority": "studio-curated",
          "checkedAt": "2026-07-11",
          "urls": [
            "https://openrouter.ai/api/v1/models",
            "https://openrouter.ai/docs/api/api-reference/models/list-all-models-and-their-properties"
          ]
        },
        "pricing": {
          "kind": "token",
          "status": "verified",
          "currency": "USD",
          "billingUnit": "one_million_tokens",
          "inputPerMillion": 0.435,
          "cachedInputPerMillion": 0.0036,
          "cacheWritePerMillion": null,
          "outputPerMillion": 0.87,
          "batchInputPerMillion": null,
          "batchOutputPerMillion": null,
          "reasoningTokens": "unknown",
          "sourceUrls": [
            "https://openrouter.ai/api/v1/models",
            "https://openrouter.ai/docs/api/api-reference/models/list-all-models-and-their-properties"
          ],
          "verifiedAt": "2026-07-11",
          "notes": "Verified from live OpenRouter /api/v1/models. Do not copy to direct provider pricing."
        },
        "reasoning": {
          "supported": true,
          "alwaysOn": true,
          "canDisable": false,
          "effortValues": [
            "low",
            "medium",
            "high"
          ],
          "returnsReasoningContent": "unknown",
          "reasoningTokensVisible": "unknown",
          "reasoningTokensBillable": "unknown",
          "worksWithTools": "unknown",
          "worksWhileStreaming": "unknown",
          "requiresReasoningStateAfterTools": "unknown",
          "reducesOutputBudget": "unknown",
          "providerSpecificControls": [
            "reasoning_effort"
          ]
        },
        "freeAccess": {
          "isFree": false,
          "isPromotional": false
        }
      }
    },
    {
      "id": "openrouter:z-ai/glm-5.2",
      "provider": "openrouter",
      "providerModelId": "z-ai/glm-5.2",
      "displayName": "GLM 5.2",
      "type": "chat",
      "capabilities": {
        "modalities": [
          "chat"
        ],
        "chat": {
          "streaming": true,
          "vision": false,
          "tools": true,
          "reasoning": {
            "supported": true,
            "efforts": [
              "low",
              "medium",
              "high"
            ],
            "defaultEffort": "medium",
            "source": "static-reviewed",
            "confidence": "exact"
          },
          "jsonSchema": true,
          "promptCaching": false
        }
      },
      "pricing": {
        "inputPerMillionUsd": 0.35,
        "outputPerMillionUsd": 1.1,
        "source": "static",
        "note": "Verified from live OpenRouter /api/v1/models. Do not copy to direct provider pricing."
      },
      "contextWindow": 1048576,
      "maxTokens": 128000,
      "supportsVision": false,
      "supportsTools": true,
      "supportsStreaming": true,
      "supportsSystemPrompts": true,
      "inputTypes": [
        "text"
      ],
      "outputTypes": [
        "text"
      ],
      "specialFeatures": [
        "reasoning"
      ],
      "registry": {
        "category": "text.chat",
        "status": "active",
        "developer": "Z.ai",
        "family": "glm-5",
        "version": "z-ai/glm-5.2",
        "supportedRegions": [],
        "endpoints": [
          "chat"
        ],
        "aliases": [
          "z-ai/glm-5.2"
        ],
        "fallbackModelIds": [],
        "verificationLevel": "verifiedDocumentationOnly",
        "source": {
          "authority": "studio-curated",
          "checkedAt": "2026-07-11",
          "urls": [
            "https://openrouter.ai/api/v1/models",
            "https://openrouter.ai/docs/api/api-reference/models/list-all-models-and-their-properties"
          ]
        },
        "pricing": {
          "kind": "token",
          "status": "verified",
          "currency": "USD",
          "billingUnit": "one_million_tokens",
          "inputPerMillion": 0.35,
          "cachedInputPerMillion": 0.065,
          "cacheWritePerMillion": null,
          "outputPerMillion": 1.1,
          "batchInputPerMillion": null,
          "batchOutputPerMillion": null,
          "reasoningTokens": "unknown",
          "sourceUrls": [
            "https://openrouter.ai/api/v1/models",
            "https://openrouter.ai/docs/api/api-reference/models/list-all-models-and-their-properties"
          ],
          "verifiedAt": "2026-07-11",
          "notes": "Verified from live OpenRouter /api/v1/models. Do not copy to direct provider pricing."
        },
        "reasoning": {
          "supported": true,
          "alwaysOn": true,
          "canDisable": false,
          "effortValues": [
            "low",
            "medium",
            "high"
          ],
          "returnsReasoningContent": "unknown",
          "reasoningTokensVisible": "unknown",
          "reasoningTokensBillable": "unknown",
          "worksWithTools": "unknown",
          "worksWhileStreaming": "unknown",
          "requiresReasoningStateAfterTools": "unknown",
          "reducesOutputBudget": "unknown",
          "providerSpecificControls": [
            "reasoning_effort"
          ]
        },
        "freeAccess": {
          "isFree": false,
          "isPromotional": false
        }
      }
    }
  ],
  "providers": [
    {
      "provider": "alibaba",
      "status": "active",
      "modelCount": 4,
      "categories": [
        "text.chat"
      ]
    },
    {
      "provider": "anthropic",
      "status": "active",
      "modelCount": 5,
      "categories": [
        "text.chat"
      ]
    },
    {
      "provider": "deepseek",
      "status": "active",
      "modelCount": 2,
      "categories": [
        "text.chat"
      ]
    },
    {
      "provider": "elevenlabs",
      "status": "active",
      "modelCount": 6,
      "categories": [
        "audio.speech",
        "audio.transcription"
      ]
    },
    {
      "provider": "fal",
      "status": "active",
      "modelCount": 10,
      "categories": [
        "image.editing",
        "image.generation",
        "video.generation"
      ]
    },
    {
      "provider": "google",
      "status": "active",
      "modelCount": 5,
      "categories": [
        "text.chat"
      ]
    },
    {
      "provider": "groq",
      "status": "active",
      "modelCount": 6,
      "categories": [
        "audio.transcription",
        "text.chat"
      ]
    },
    {
      "provider": "minimax",
      "status": "active",
      "modelCount": 1,
      "categories": [
        "text.chat"
      ]
    },
    {
      "provider": "mistral",
      "status": "active",
      "modelCount": 1,
      "categories": [
        "text.chat"
      ]
    },
    {
      "provider": "openai",
      "status": "active",
      "modelCount": 10,
      "categories": [
        "audio.speech",
        "audio.transcription",
        "embeddings",
        "image.editing",
        "text.chat"
      ]
    },
    {
      "provider": "openrouter",
      "status": "active",
      "modelCount": 38,
      "categories": [
        "text.chat"
      ]
    },
    {
      "provider": "replicate",
      "status": "active",
      "modelCount": 9,
      "categories": [
        "image.editing",
        "video.generation"
      ]
    },
    {
      "provider": "xai",
      "status": "active",
      "modelCount": 2,
      "categories": [
        "text.chat"
      ]
    },
    {
      "provider": "xiaomi",
      "status": "active",
      "modelCount": 2,
      "categories": [
        "text.chat"
      ]
    },
    {
      "provider": "zai",
      "status": "active",
      "modelCount": 1,
      "categories": [
        "text.chat"
      ]
    }
  ]
};
