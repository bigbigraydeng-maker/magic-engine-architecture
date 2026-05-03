/**
 * Unit tests for image-optimizer.ts
 * Covers: validateImageForPlatform, getOptimizedImageUrl, generateImageVariants,
 *         getPlatformSpecs, getImageOptimizationRecommendation,
 *         validateImageDimensions, estimateFileSize, needsResizing
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  validateImageForPlatform,
  getOptimizedImageUrl,
  generateImageVariants,
  getPlatformSpecs,
  getImageOptimizationRecommendation,
  validateImageDimensions,
  estimateFileSize,
  needsResizing,
} from './image-optimizer';

// ---------------------------------------------------------------------------
// validateImageForPlatform
// ---------------------------------------------------------------------------

describe('validateImageForPlatform', () => {
  describe('URL validation', () => {
    it('returns error for null/undefined URL', () => {
      const result = validateImageForPlatform(null as any, 'facebook');
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Invalid image URL');
    });

    it('returns error for empty string URL', () => {
      const result = validateImageForPlatform('', 'facebook');
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Invalid image URL');
    });

    it('returns error for non-string URL', () => {
      const result = validateImageForPlatform(123 as any, 'facebook');
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Invalid image URL');
    });

    it('returns error for malformed URL', () => {
      const result = validateImageForPlatform('not-a-url', 'facebook');
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Invalid URL format');
    });

    it('accepts valid http URL', () => {
      const result = validateImageForPlatform('http://example.com/image.jpg', 'facebook');
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('accepts valid https URL', () => {
      const result = validateImageForPlatform('https://cdn.example.com/photo.png', 'xiaohongshu');
      expect(result.valid).toBe(true);
    });
  });

  describe('format validation – facebook', () => {
    it('accepts jpg format', () => {
      const r = validateImageForPlatform('https://example.com/img.jpg', 'facebook');
      expect(r.valid).toBe(true);
      expect(r.warnings).toHaveLength(0);
    });

    it('accepts jpeg format', () => {
      const r = validateImageForPlatform('https://example.com/img.jpeg', 'facebook');
      expect(r.valid).toBe(true);
    });

    it('accepts png format', () => {
      const r = validateImageForPlatform('https://example.com/img.png', 'facebook');
      expect(r.valid).toBe(true);
    });

    it('accepts gif format', () => {
      const r = validateImageForPlatform('https://example.com/img.gif', 'facebook');
      expect(r.valid).toBe(true);
    });

    it('accepts webp format', () => {
      const r = validateImageForPlatform('https://example.com/img.webp', 'facebook');
      expect(r.valid).toBe(true);
    });

    it('warns for unsupported format (bmp)', () => {
      const r = validateImageForPlatform('https://example.com/img.bmp', 'facebook');
      expect(r.valid).toBe(true); // URL is valid – only a warning
      expect(r.warnings.length).toBeGreaterThan(0);
      expect(r.warnings[0]).toContain('bmp');
    });
  });

  describe('format validation – xiaohongshu', () => {
    it('accepts jpg, jpeg, png, webp', () => {
      for (const ext of ['jpg', 'jpeg', 'png', 'webp']) {
        const r = validateImageForPlatform(`https://example.com/img.${ext}`, 'xiaohongshu');
        expect(r.valid).toBe(true);
        expect(r.warnings).toHaveLength(0);
      }
    });

    it('warns for gif (not supported on xiaohongshu)', () => {
      const r = validateImageForPlatform('https://example.com/img.gif', 'xiaohongshu');
      expect(r.warnings.length).toBeGreaterThan(0);
    });
  });

  describe('URL without extension', () => {
    it('issues a warning when extension is missing', () => {
      const r = validateImageForPlatform('https://example.com/image', 'facebook');
      // undefined extension is not in the allowed list -> warning
      expect(r.warnings.length).toBeGreaterThan(0);
    });
  });
});

// ---------------------------------------------------------------------------
// getPlatformSpecs
// ---------------------------------------------------------------------------

describe('getPlatformSpecs', () => {
  it('returns correct specs for facebook', () => {
    const specs = getPlatformSpecs('facebook');
    expect(specs.recommendedWidth).toBe(1200);
    expect(specs.recommendedHeight).toBe(628);
    expect(specs.minWidth).toBe(600);
    expect(specs.minHeight).toBe(314);
    expect(specs.maxFileSize).toBe(4 * 1024 * 1024);
    expect(specs.format).toContain('jpg');
    expect(specs.format).toContain('gif');
  });

  it('returns correct specs for xiaohongshu', () => {
    const specs = getPlatformSpecs('xiaohongshu');
    expect(specs.recommendedWidth).toBe(1080);
    expect(specs.recommendedHeight).toBe(1440);
    expect(specs.minWidth).toBe(540);
    expect(specs.minHeight).toBe(720);
    expect(specs.maxFileSize).toBe(5 * 1024 * 1024);
    expect(specs.format).not.toContain('gif');
  });
});

// ---------------------------------------------------------------------------
// getOptimizedImageUrl
// ---------------------------------------------------------------------------

describe('getOptimizedImageUrl', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns the original URL unchanged for non-Cloudinary URLs', () => {
    const url = 'https://example.com/photo.jpg';
    const result = getOptimizedImageUrl(url, 'facebook');
    expect(result).toBe(url);
  });

  it('applies Cloudinary transformations when URL is from cloudinary.com', () => {
    const url = 'https://res.cloudinary.com/demo/image/upload/sample.jpg';
    const result = getOptimizedImageUrl(url, 'facebook');
    expect(result).toContain('/upload/');
    expect(result).toContain('w_1200');
    expect(result).toContain('h_628');
    expect(result).toContain('q_85');
    expect(result).toContain('f_auto');
    expect(result).toContain('c_fill');
  });

  it('uses platform recommended dimensions when no options provided – xiaohongshu', () => {
    const url = 'https://res.cloudinary.com/demo/image/upload/sample.jpg';
    const result = getOptimizedImageUrl(url, 'xiaohongshu');
    expect(result).toContain('w_1080');
    expect(result).toContain('h_1440');
  });

  it('respects custom width, height, quality options', () => {
    const url = 'https://res.cloudinary.com/demo/image/upload/sample.jpg';
    const result = getOptimizedImageUrl(url, 'facebook', {
      width: 800,
      height: 400,
      quality: 70,
      format: 'webp',
    });
    expect(result).toContain('w_800');
    expect(result).toContain('h_400');
    expect(result).toContain('q_70');
    expect(result).toContain('f_webp');
  });

  it('uses quality 85 as default', () => {
    const url = 'https://res.cloudinary.com/demo/image/upload/sample.jpg';
    const result = getOptimizedImageUrl(url, 'facebook');
    expect(result).toContain('q_85');
  });
});

// ---------------------------------------------------------------------------
// generateImageVariants
// ---------------------------------------------------------------------------

describe('generateImageVariants', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('generates variants for both platforms', () => {
    const url = 'https://example.com/image.jpg';
    const variants = generateImageVariants(url);
    expect(variants).toHaveProperty('facebook');
    expect(variants).toHaveProperty('xiaohongshu');
  });

  it('includes specs for each platform', () => {
    const url = 'https://example.com/image.jpg';
    const variants = generateImageVariants(url);
    expect(variants.facebook.specs.recommendedWidth).toBe(1200);
    expect(variants.xiaohongshu.specs.recommendedWidth).toBe(1080);
  });

  it('applies Cloudinary transformations in variants for cloudinary URLs', () => {
    const url = 'https://res.cloudinary.com/demo/image/upload/sample.jpg';
    const variants = generateImageVariants(url);
    expect(variants.facebook.url).toContain('w_1200');
    expect(variants.xiaohongshu.url).toContain('w_1080');
  });
});

// ---------------------------------------------------------------------------
// getImageOptimizationRecommendation
// ---------------------------------------------------------------------------

describe('getImageOptimizationRecommendation', () => {
  it('returns a non-empty string for facebook', () => {
    const rec = getImageOptimizationRecommendation('facebook');
    expect(typeof rec).toBe('string');
    expect(rec.length).toBeGreaterThan(0);
    expect(rec).toContain('1200');
    expect(rec).toContain('628');
    expect(rec).toContain('4.0MB');
  });

  it('returns a non-empty string for xiaohongshu', () => {
    const rec = getImageOptimizationRecommendation('xiaohongshu');
    expect(rec).toContain('1080');
    expect(rec).toContain('1440');
    expect(rec).toContain('5.0MB');
  });
});

// ---------------------------------------------------------------------------
// validateImageDimensions
// ---------------------------------------------------------------------------

describe('validateImageDimensions', () => {
  describe('facebook', () => {
    it('returns valid for dimensions meeting minimum', () => {
      const result = validateImageDimensions(1200, 628, 'facebook');
      expect(result.valid).toBe(true);
      expect(result.suggestion).toBe('');
    });

    it('returns invalid when width is below minimum', () => {
      const result = validateImageDimensions(400, 314, 'facebook');
      expect(result.valid).toBe(false);
      expect(result.suggestion).toContain('600');
    });

    it('returns invalid when height is below minimum', () => {
      const result = validateImageDimensions(600, 200, 'facebook');
      expect(result.valid).toBe(false);
      expect(result.suggestion).toContain('314');
    });

    it('returns valid with aspect ratio suggestion when dimensions ok but ratio differs', () => {
      // 1200x1200 meets minimums but ratio is 1:1 instead of 1.91:1
      const result = validateImageDimensions(1200, 1200, 'facebook');
      expect(result.valid).toBe(true);
      expect(result.suggestion).toContain('Recommended');
    });

    it('returns valid with empty suggestion for exact recommended dimensions', () => {
      const result = validateImageDimensions(1200, 628, 'facebook');
      expect(result.valid).toBe(true);
      expect(result.suggestion).toBe('');
    });
  });

  describe('xiaohongshu', () => {
    it('returns valid for recommended dimensions', () => {
      const result = validateImageDimensions(1080, 1440, 'xiaohongshu');
      expect(result.valid).toBe(true);
    });

    it('returns invalid when below minimum', () => {
      const result = validateImageDimensions(300, 400, 'xiaohongshu');
      expect(result.valid).toBe(false);
    });

    it('returns valid at exactly minimum dimensions', () => {
      const result = validateImageDimensions(540, 720, 'xiaohongshu');
      expect(result.valid).toBe(true);
    });
  });

  describe('edge cases', () => {
    it('handles 0x0 dimensions', () => {
      const result = validateImageDimensions(0, 0, 'facebook');
      expect(result.valid).toBe(false);
    });

    it('handles very large dimensions', () => {
      const result = validateImageDimensions(10000, 5236, 'facebook');
      expect(result.valid).toBe(true);
    });
  });
});

// ---------------------------------------------------------------------------
// estimateFileSize
// ---------------------------------------------------------------------------

describe('estimateFileSize', () => {
  it('returns a positive integer for valid inputs', () => {
    const size = estimateFileSize(1200, 628);
    expect(size).toBeGreaterThan(0);
    expect(Number.isInteger(size)).toBe(true);
  });

  it('increases with larger dimensions', () => {
    const small = estimateFileSize(600, 314);
    const large = estimateFileSize(1200, 628);
    expect(large).toBeGreaterThan(small);
  });

  it('increases with higher quality', () => {
    const low = estimateFileSize(1200, 628, 40);
    const high = estimateFileSize(1200, 628, 90);
    expect(high).toBeGreaterThan(low);
  });

  it('defaults quality to 85', () => {
    const withDefault = estimateFileSize(1200, 628);
    const explicit = estimateFileSize(1200, 628, 85);
    expect(withDefault).toBe(explicit);
  });

  it('returns 0 for zero-dimension images', () => {
    const size = estimateFileSize(0, 628);
    expect(size).toBe(0);
  });

  it('formula: pixels * (quality/100) * 0.2 rounded', () => {
    const width = 100;
    const height = 100;
    const quality = 50;
    const expected = Math.round(100 * 100 * (50 / 100) * 0.2);
    expect(estimateFileSize(width, height, quality)).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// needsResizing
// ---------------------------------------------------------------------------

describe('needsResizing', () => {
  describe('facebook (1200x628)', () => {
    it('returns false for exact recommended size', () => {
      expect(needsResizing(1200, 628, 'facebook')).toBe(false);
    });

    it('returns false when within 10% tolerance', () => {
      // 1200 ± 120 = 1080-1320 -> 1100 is within tolerance
      expect(needsResizing(1100, 620, 'facebook')).toBe(false);
    });

    it('returns true when width differs beyond tolerance', () => {
      expect(needsResizing(600, 628, 'facebook')).toBe(true);
    });

    it('returns true when height differs beyond tolerance', () => {
      expect(needsResizing(1200, 200, 'facebook')).toBe(true);
    });
  });

  describe('xiaohongshu (1080x1440)', () => {
    it('returns false for exact recommended size', () => {
      expect(needsResizing(1080, 1440, 'xiaohongshu')).toBe(false);
    });

    it('returns true for a very different size', () => {
      expect(needsResizing(400, 400, 'xiaohongshu')).toBe(true);
    });
  });

  describe('custom tolerance', () => {
    it('returns false with 50% tolerance even for large deviation', () => {
      // 600 vs 1200: 50% diff, within 50% tolerance
      expect(needsResizing(600, 628, 'facebook', 0.5)).toBe(false);
    });

    it('returns true with 0% tolerance for any deviation', () => {
      expect(needsResizing(1199, 628, 'facebook', 0)).toBe(true);
    });
  });
});
