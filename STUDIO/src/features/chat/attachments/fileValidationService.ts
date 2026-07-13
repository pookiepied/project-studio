/**
 * File Validation Service
 * Comprehensive file validation and security checks
 */

interface FileValidationResult {
  isValid: boolean;
  errors: string[];
  warnings: string[];
  sanitizedName?: string;
  detectedType?: string;
  isExecutable?: boolean;
  isSuspicious?: boolean;
}

interface FileValidationOptions {
  maxSize?: number;
  allowedTypes?: string[];
  allowedExtensions?: string[];
  checkContent?: boolean;
  sanitizeName?: boolean;
}

/**
 * Dangerous file extensions that should never be allowed
 */
const DANGEROUS_EXTENSIONS = [
  ".exe", ".bat", ".cmd", ".com", ".scr", ".pif", ".vbs", ".js", ".jar",
  ".app", ".deb", ".pkg", ".dmg", ".run", ".bin", ".sh", ".ps1", ".msi",
  ".dll", ".so", ".dylib", ".sys", ".drv", ".ocx", ".cpl", ".scf"
];

/**
 * Suspicious file patterns
 */
const SUSPICIOUS_PATTERNS = [
  /\.(php|asp|jsp|cgi)$/i,
  /\.(htaccess|htpasswd)$/i,
  /^\.env/i,
  /config\.(json|yaml|yml|ini|conf)$/i,
  /\.(key|pem|p12|pfx|crt|cer)$/i,
  /\.(sql|db|sqlite)$/i
];

/**
 * Known malicious file signatures (magic bytes)
 */
const MALICIOUS_SIGNATURES = [
  { signature: [0x4D, 0x5A], description: "Windows executable" },
  { signature: [0x7F, 0x45, 0x4C, 0x46], description: "Linux executable" },
  { signature: [0xCF, 0xFA, 0xED, 0xFE], description: "macOS executable" },
  { signature: [0xFE, 0xED, 0xFA, 0xCF], description: "macOS executable (big-endian)" },
  { signature: [0xCA, 0xFE, 0xBA, 0xBE], description: "Java class file" }
];

/**
 * Maximum file sizes by type (in bytes)
 */
const MAX_FILE_SIZES = {
  image: 20 * 1024 * 1024, // 20MB
  text: 1024 * 1024, // 1MB
  code: 1024 * 1024, // 1MB
  document: 5 * 1024 * 1024, // 5MB
  default: 1024 * 1024 // 1MB
};

/**
 * Allowed MIME types
 */
const ALLOWED_MIME_TYPES = [
  // Images
  "image/jpeg", "image/png", "image/gif", "image/webp", "image/bmp", "image/svg+xml",
  // Text
  "text/plain", "text/markdown", "text/csv", "text/html", "text/css",
  // Code
  "application/javascript", "application/json", "application/xml",
  "text/x-python", "text/x-java", "text/x-c", "text/x-cpp", "text/x-csharp",
  // Documents
  "application/pdf", "application/msword", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
];

class FileValidationService {
  /**
   * Validate a file comprehensively
   */
  async validateFile(file: File, options: FileValidationOptions = {}): Promise<FileValidationResult> {
    const result: FileValidationResult = {
      isValid: true,
      errors: [],
      warnings: []
    };

    try {
      // Basic validation
      this.validateBasicProperties(file, result, options);
      
      // Name validation and sanitization
      this.validateFileName(file, result, options);
      
      // Extension validation
      this.validateFileExtension(file, result, options);
      
      // MIME type validation
      this.validateMimeType(file, result, options);
      
      // Size validation
      this.validateFileSize(file, result, options);
      
      // Content validation (if enabled)
      if (options.checkContent !== false) {
        await this.validateFileContent(file, result);
      }
      
      // Security checks
      await this.performSecurityChecks(file, result);
      
      // Final validation
      result.isValid = result.errors.length === 0;
      
    } catch (error) {
      result.isValid = false;
      result.errors.push(`Validation failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }

    return result;
  }

  /**
   * Validate basic file properties
   */
  private validateBasicProperties(file: File, result: FileValidationResult, _options: FileValidationOptions): void {
    if (!file) {
      result.errors.push("No file provided");
      return;
    }

    if (!file.name || file.name.trim().length === 0) {
      result.errors.push("File name is required");
    }

    if (file.size === 0) {
      result.warnings.push("File appears to be empty");
    }
  }

  /**
   * Validate and sanitize file name
   */
  private validateFileName(file: File, result: FileValidationResult, options: FileValidationOptions): void {
    const originalName = file.name;
    
    // Check for dangerous characters
    const hasDangerousChars =
      /[<>:"/\\|?*]/.test(originalName) ||
      Array.from(originalName).some((char) => char.charCodeAt(0) <= 31);
    if (hasDangerousChars) {
      result.warnings.push("File name contains potentially dangerous characters");
    }
    
    // Check for reserved names (Windows)
    const reservedNames = /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(\.|$)/i;
    if (reservedNames.test(originalName)) {
      result.errors.push("File name uses a reserved system name");
    }
    
    // Check for hidden files
    if (originalName.startsWith('.') && originalName !== '.gitignore' && originalName !== '.env.example') {
      result.warnings.push("Hidden file detected");
    }
    
    // Check for very long names
    if (originalName.length > 255) {
      result.errors.push("File name is too long (max 255 characters)");
    }
    
    // Sanitize name if requested
    if (options.sanitizeName) {
      const sanitized = originalName
        .replace(/[<>:"/\\|?*]/g, '_')
        .split('')
        .map((char) => char.charCodeAt(0) <= 31 ? '_' : char)
        .join('')
        .replace(/\s+/g, '_')
        .replace(/_{2,}/g, '_')
        .trim();
      
      if (sanitized !== originalName) {
        result.sanitizedName = sanitized;
        result.warnings.push(`File name sanitized: "${originalName}" -> "${sanitized}"`);
      }
    }
  }

  /**
   * Validate file extension
   */
  private validateFileExtension(file: File, result: FileValidationResult, options: FileValidationOptions): void {
    const fileName = file.name.toLowerCase();
    const extension = this.getFileExtension(fileName);
    
    // Check for dangerous extensions
    if (DANGEROUS_EXTENSIONS.includes(extension)) {
      result.errors.push(`Dangerous file type: ${extension}`);
      result.isExecutable = true;
    }
    
    // Check for suspicious patterns
    if (SUSPICIOUS_PATTERNS.some(pattern => pattern.test(fileName))) {
      result.warnings.push("File type may contain sensitive information");
      result.isSuspicious = true;
    }
    
    // Check against allowed extensions
    if (options.allowedExtensions && options.allowedExtensions.length > 0) {
      if (!options.allowedExtensions.includes(extension)) {
        result.errors.push(`File type ${extension} is not allowed`);
      }
    }
    
    // Double extension check (e.g., file.txt.exe)
    const parts = fileName.split('.');
    if (parts.length > 2) {
      const secondLastExt = '.' + parts[parts.length - 2];
      if (DANGEROUS_EXTENSIONS.includes(secondLastExt)) {
        result.errors.push("File has suspicious double extension");
      }
    }
  }

  /**
   * Validate MIME type
   */
  private validateMimeType(file: File, result: FileValidationResult, options: FileValidationOptions): void {
    const mimeType = file.type;
    result.detectedType = mimeType;
    
    // Check if MIME type is provided
    if (!mimeType || mimeType === 'application/octet-stream') {
      result.warnings.push("File type could not be determined");
      return;
    }
    
    // Check against allowed types
    if (options.allowedTypes && options.allowedTypes.length > 0) {
      if (!options.allowedTypes.includes(mimeType)) {
        result.errors.push(`MIME type ${mimeType} is not allowed`);
      }
    } else {
      // Use default allowed types
      if (!ALLOWED_MIME_TYPES.includes(mimeType)) {
        result.warnings.push(`Uncommon MIME type: ${mimeType}`);
      }
    }
    
    // Check for MIME type spoofing
    const extension = this.getFileExtension(file.name);
    const expectedMimeTypes = this.getExpectedMimeTypes(extension);
    
    if (expectedMimeTypes.length > 0 && !expectedMimeTypes.includes(mimeType)) {
      result.warnings.push(`MIME type ${mimeType} doesn't match extension ${extension}`);
    }
  }

  /**
   * Validate file size
   */
  private validateFileSize(file: File, result: FileValidationResult, options: FileValidationOptions): void {
    const maxSize = options.maxSize || this.getMaxSizeForType(file.type);
    
    if (file.size > maxSize) {
      const maxSizeMB = (maxSize / (1024 * 1024)).toFixed(1);
      const fileSizeMB = (file.size / (1024 * 1024)).toFixed(1);
      result.errors.push(`File too large: ${fileSizeMB}MB (max: ${maxSizeMB}MB)`);
    }
    
    // Warn about very small files that might be suspicious
    if (file.size < 10 && !file.type.startsWith('text/')) {
      result.warnings.push("File is suspiciously small");
    }
  }

  /**
   * Validate file content
   */
  private async validateFileContent(file: File, result: FileValidationResult): Promise<void> {
    try {
      // Read first few bytes to check magic numbers
      const buffer = await this.readFileBytes(file, 0, 16);
      const bytes = new Uint8Array(buffer);
      
      // Check for malicious signatures
      for (const { signature, description } of MALICIOUS_SIGNATURES) {
        if (this.matchesSignature(bytes, signature)) {
          result.errors.push(`Detected ${description} - executable files not allowed`);
          result.isExecutable = true;
        }
      }
      
      // Check for embedded executables in images
      if (file.type.startsWith('image/')) {
        await this.validateImageContent(file, result);
      }
      
      // Check for text files with suspicious content
      if (file.type.startsWith('text/') || file.name.endsWith('.md') || file.name.endsWith('.txt')) {
        await this.validateTextContent(file, result);
      }
      
    } catch (error) {
      result.warnings.push("Could not validate file content");
    }
  }

  /**
   * Perform security checks
   */
  private async performSecurityChecks(file: File, result: FileValidationResult): Promise<void> {
    // Check for zip bombs (files that expand to huge sizes)
    if (file.type === 'application/zip' || file.name.endsWith('.zip')) {
      result.warnings.push("Compressed files require manual verification");
    }
    
    // Check for polyglot files (files that are valid in multiple formats)
    if (file.type.startsWith('image/') && file.size > 1024 * 1024) {
      const buffer = await this.readFileBytes(file, 0, 1024);
      const content = new TextDecoder('utf-8', { fatal: false }).decode(buffer);
      
      // Look for script tags or other suspicious content in images
      if (/<script|javascript:|data:/i.test(content)) {
        result.errors.push("Image file contains suspicious script content");
      }
    }
  }

  /**
   * Validate image content
   * Note: Some valid image files (e.g., V-roid character images) may not load in Image()
   * due to color space or metadata issues. We only validate PNG magic bytes to prevent
   * false rejections while maintaining security.
   */
  private async validateImageContent(file: File, result: FileValidationResult): Promise<void> {
    try {
      // Check PNG magic bytes first (more reliable than Image() loading)
      if (file.type === 'image/png' || file.name.toLowerCase().endsWith('.png')) {
        const buffer = await this.readFileBytes(file, 0, 8);
        const bytes = new Uint8Array(buffer);
        // PNG signature: 89 50 4E 47 0D 0A 1A 0A
        const pngSignature = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A];
        if (this.matchesSignature(bytes, pngSignature)) {
          // Valid PNG, skip Image() loading (may fail due to color space)
          return;
        }
      }

      // For other image types, try to load (with timeout to prevent hangs)
      const img = new Image();
      const url = URL.createObjectURL(file);
      let loaded = false;

      await Promise.race([
        new Promise<void>((resolve, reject) => {
          img.onload = () => {
            loaded = true;
            resolve();
          };
          img.onerror = () => reject(new Error("Image failed to load"));
          img.src = url;
        }),
        new Promise<void>((_, reject) =>
          setTimeout(() => reject(new Error("Image loading timeout")), 5000)
        )
      ]).catch((error) => {
        // Image load failed, but don't fail validation - it might still be valid
        result.warnings.push(`Could not verify image integrity: ${error.message}`);
      });

      if (loaded) {
        // Check for reasonable dimensions
        if (img.width > 10000 || img.height > 10000) {
          result.warnings.push("Image has very large dimensions");
        }

        if (img.width < 1 || img.height < 1) {
          result.errors.push("Invalid image dimensions");
        }
      }

      URL.revokeObjectURL(url);

    } catch (error) {
      // Don't fail on validation error - PNG magic bytes are already checked
      result.warnings.push("Could not fully validate image file, but file may still be usable");
    }
  }

  /**
   * Validate text content
   */
  private async validateTextContent(file: File, result: FileValidationResult): Promise<void> {
    try {
      const text = await file.text();
      
      // Check for binary content in text files
      const hasBinaryContent = Array.from(text).some((char) => {
        const code = char.charCodeAt(0);
        return code === 127 || (code <= 31 && code !== 9 && code !== 10 && code !== 11 && code !== 12 && code !== 13);
      });
      if (hasBinaryContent) {
        result.warnings.push("Text file contains binary data");
      }
      
      // Check for very long lines (potential attack)
      const lines = text.split('\n');
      const maxLineLength = Math.max(...lines.map(line => line.length));
      if (maxLineLength > 10000) {
        result.warnings.push("Text file contains very long lines");
      }
      
      // Check for suspicious patterns
      const suspiciousPatterns = [
        /<script/i,
        /javascript:/i,
        /data:.*base64/i,
        /eval\s*\(/i,
        /document\.write/i
      ];
      
      if (suspiciousPatterns.some(pattern => pattern.test(text))) {
        result.warnings.push("Text file contains potentially dangerous script content");
      }
      
    } catch (error) {
      result.warnings.push("Could not read text file content");
    }
  }

  /**
   * Helper methods
   */
  private getFileExtension(fileName: string): string {
    const lastDot = fileName.lastIndexOf('.');
    return lastDot === -1 ? '' : fileName.substring(lastDot).toLowerCase();
  }

  private getMaxSizeForType(mimeType: string): number {
    if (mimeType.startsWith('image/')) return MAX_FILE_SIZES.image;
    if (mimeType.startsWith('text/')) return MAX_FILE_SIZES.text;
    if (mimeType.includes('javascript') || mimeType.includes('json')) return MAX_FILE_SIZES.code;
    if (mimeType.includes('pdf') || mimeType.includes('document')) return MAX_FILE_SIZES.document;
    return MAX_FILE_SIZES.default;
  }

  private getExpectedMimeTypes(extension: string): string[] {
    const mimeMap: Record<string, string[]> = {
      '.jpg': ['image/jpeg'],
      '.jpeg': ['image/jpeg'],
      '.png': ['image/png'],
      '.gif': ['image/gif'],
      '.webp': ['image/webp'],
      '.txt': ['text/plain'],
      '.md': ['text/markdown', 'text/plain'],
      '.json': ['application/json'],
      '.js': ['application/javascript', 'text/javascript'],
      '.css': ['text/css'],
      '.html': ['text/html'],
      '.pdf': ['application/pdf']
    };
    
    return mimeMap[extension] || [];
  }

  private async readFileBytes(file: File, start: number, length: number): Promise<ArrayBuffer> {
    const slice = file.slice(start, start + length);
    return slice.arrayBuffer();
  }

  private matchesSignature(bytes: Uint8Array, signature: number[]): boolean {
    if (bytes.length < signature.length) return false;
    
    for (let i = 0; i < signature.length; i++) {
      if (bytes[i] !== signature[i]) return false;
    }
    
    return true;
  }
}

// Export singleton instance
export const fileValidationService = new FileValidationService();
