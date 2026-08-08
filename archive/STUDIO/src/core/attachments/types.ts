export interface AttachmentLimits {
  maxAttachments: number;
  maxTokensForAttachments: number;
  maxFileSizeText: number;
  maxFileSizeImage: number;
  reservedTokensForOutput: number;
  availableTokensForInput: number;
}
