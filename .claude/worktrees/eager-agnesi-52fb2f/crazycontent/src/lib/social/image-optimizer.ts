/**
 * Image Optimizer for Social Media Platforms
 * Handles image optimization, resizing, and format conversion
 */

export type Platform = 'facebook' | 'xiaohongshu';

/**
 * Platform-specific image specifications
 */
const PLATFORM_SPECS: Record<
  Platform,
  {
    recommendedWidth: number;
    recommendedHeight: number;
    minWidth: number;
    minHeight: number;
    aspectRatio: string;
    maxFileSize: number; // in bytes
    format: string[];
  }
> = {
  facebook: {
    recommendedWidth: 1200,
    recommendedHeight: 628,
    minWidth: 600,
    minHeight: 314,
    aspectRatio: '1.91:1',
    maxFileSize: 4 * 1024 * 1024, // 4MB
    format: ['jpg', 'jpeg', 'png', 'gif', 'webp'],
  },
  xiaohongshu: {
    recommendedWidth: 1080,
    recommendedHeight: 1440,
    minWidth: 540,
    minHeight: 720,
    aspectRatio: '3:4',
    maxFileSize: 5 * 1024 * 1024, // 5MB
    format: ['jpg', 'jpeg', 'png', 'webp'],
  },
};

/**
 * Validate image for platform
 */
export function validateImageForPlatform(
  url: string,
  platform: Platform
): {
  valid: boolean;
  errors: string[];
  warnings: string[];
} {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Check URL format
  if (!url || typeof url !== 'string') {
    errors.push('Invalid image URL');
    return { valid: false, errors, warnings };
  }

  try {
    new URL(url);
  } catch {
    errors.push('Invalid URL format');
    return { valid: false, errors, warnings };
  }

  // Check file extension
  const urlObj = new URL(url);
  const pathname = urlObj.pathname.toLowerCase();
  const extension = pathname.split('.').pop();
  const specs = PLATFORM_SPECS[platform];

  if (!extension || !specs.format.includes(extension)) {
    warnings.push(
      `Image format .${extension} may not be optimal for ${platform}. Recommended: ${specs.format.join(', ')}`
    );
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

/**
 * Get optimized image URL with CDN parameters
 */
export function getOptimizedImageUrl(
  url: string,
  platform: Platform,
  options?: {
    width?: number;
    height?: number;
    quality?: number;
    format?: string;
  }
): string {
  const specs = PLATFORM_SPECS[platform];
  const width = options?.width || specs.recommendedWidth;
  const height = options?.height || specs.recommendedHeight;
  const quality = options?.quality || 85;
  const format = options?.format || 'auto';

  // If URL is from a CDN that supports image transformation (e.g., Cloudinary, Imgix)
  // we would apply transformations here
  // For now, return original URL with recommendation comment
  console.log(
    `[Image] Optimal size for ${platform}: ${width}x${height} (${quality}% quality)`
  );

  // Example for Cloudinary (if used)
  if (url.includes('cloudinary.com')) {
    const parts = url.split('/upload/');
    if (parts.length === 2) {
      const transformations = [
        `w_${width}`,
        `h_${height}`,
        `c_fill`, // crop to fill
        `q_${quality}`,
        `f_${format}`,
      ];
      return `${parts[0]}/upload/${transformations.join(',')}/${parts[1]}`;
    }
  }

  return url;
}

/**
 * Generate image variants for multiple platforms
 */
export function generateImageVariants(
  originalUrl: string
): Record<Platform, { url: string; specs: any }> {
  return {
    facebook: {
      url: getOptimizedImageUrl(originalUrl, 'facebook'),
      specs: PLATFORM_SPECS.facebook,
    },
    xiaohongshu: {
      url: getOptimizedImageUrl(originalUrl, 'xiaohongshu'),
      specs: PLATFORM_SPECS.xiaohongshu,
    },
  };
}

/**
 * Get platform specs for reference
 */
export function getPlatformSpecs(platform: Platform): (typeof PLATFORM_SPECS)[Platform] {
  return PLATFORM_SPECS[platform];
}

/**
 * Create a recommendation for image optimization
 */
export function getImageOptimizationRecommendation(
  platform: Platform
): string {
  const specs = PLATFORM_SPECS[platform];

  return `
📸 ${platform.toUpperCase()} 图片建议

推荐尺寸: ${specs.recommendedWidth}×${specs.recommendedHeight}
宽高比: ${specs.aspectRatio}
最小尺寸: ${specs.minWidth}×${specs.minHeight}
最大文件大小: ${(specs.maxFileSize / (1024 * 1024)).toFixed(1)}MB
支持格式: ${specs.format.join(', ').toUpperCase()}

💡 建议:
1. 使用推荐尺寸获得最佳显示效果
2. 压缩图片确保文件大小 < ${(specs.maxFileSize / (1024 * 1024)).toFixed(1)}MB
3. 使用 WebP 格式可获得更小的文件大小
4. 避免过度压缩导致质量下降
  `;
}

/**
 * Validate image dimensions
 */
export function validateImageDimensions(
  width: number,
  height: number,
  platform: Platform
): {
  valid: boolean;
  suggestion: string;
} {
  const specs = PLATFORM_SPECS[platform];
  const currentAspectRatio = (width / height).toFixed(2);
  const targetAspectRatio = (
    specs.recommendedWidth / specs.recommendedHeight
  ).toFixed(2);

  const valid = width >= specs.minWidth && height >= specs.minHeight;

  let suggestion = '';
  if (!valid) {
    suggestion = `Image too small. Minimum: ${specs.minWidth}×${specs.minHeight}`;
  } else if (currentAspectRatio !== targetAspectRatio) {
    suggestion = `Current ratio: ${currentAspectRatio}. Recommended: ${targetAspectRatio}`;
  }

  return { valid, suggestion };
}

/**
 * Estimate file size based on dimensions and quality
 */
export function estimateFileSize(
  width: number,
  height: number,
  quality: number = 85
): number {
  // Rough estimation: pixels * quality factor * compression ratio
  const pixels = width * height;
  const qualityFactor = quality / 100;
  const compressionRatio = 0.2; // JPEG/WebP typically compress to ~20% of raw size

  // Estimated size in bytes
  return Math.round(pixels * qualityFactor * compressionRatio);
}

/**
 * Check if image needs resizing for platform
 */
export function needsResizing(
  width: number,
  height: number,
  platform: Platform,
  tolerance: number = 0.1 // 10% tolerance
): boolean {
  const specs = PLATFORM_SPECS[platform];
  const targetWidth = specs.recommendedWidth;
  const targetHeight = specs.recommendedHeight;

  const widthDiff = Math.abs(width - targetWidth) / targetWidth;
  const heightDiff = Math.abs(height - targetHeight) / targetHeight;

  return widthDiff > tolerance || heightDiff > tolerance;
}
