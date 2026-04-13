import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render } from '@testing-library/react';
import { PlantLoader } from '../PlantLoader';

describe('PlantLoader', () => {
  let matchMediaMock: typeof window.matchMedia;

  beforeEach(() => {
    // Mock matchMedia
    matchMediaMock = vi.fn((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
    })) as unknown as typeof window.matchMedia;
    window.matchMedia = matchMediaMock;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should render animation with correct stages', () => {
    const { container } = render(<PlantLoader />);

    // Check for SVG element
    const svg = container.querySelector('svg');
    expect(svg).toBeTruthy();

    // Check for all lifecycle stages
    const seedStage = container.querySelector('.stage-1');
    const seedlingStage = container.querySelector('.stage-2');
    const growthStage = container.querySelector('.stage-3');
    const flowerStage = container.querySelector('.stage-4');

    expect(seedStage).toBeTruthy();
    expect(seedlingStage).toBeTruthy();
    expect(growthStage).toBeTruthy();
    expect(flowerStage).toBeTruthy();
  });

  it('should use infinite iteration', () => {
    const { container } = render(<PlantLoader />);

    const svg = container.querySelector('svg');
    const style = svg?.getAttribute('style');

    expect(style).toContain('infinite');
  });

  it('should use theme colors', () => {
    const { container } = render(<PlantLoader />);

    // Check for green color (primary)
    const greenElements = container.querySelectorAll('[fill="#3F7D3A"], [stroke="#3F7D3A"]');
    expect(greenElements.length).toBeGreaterThan(0);

    // Check for golden yellow color in petal gradients
    const yellowElements = container.querySelectorAll('stop[stop-color="#F4C430"]');
    expect(yellowElements.length).toBeGreaterThan(0);
  });

  it('should show static icon when prefers-reduced-motion is enabled', () => {
    // Mock reduced motion preference
    window.matchMedia = vi.fn((query: string) => ({
      matches: query === '(prefers-reduced-motion: reduce)',
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
    })) as unknown as typeof window.matchMedia;

    const { container } = render(<PlantLoader />);

    // Should not have animation stage groups
    const seedStage = container.querySelector('.stage-1');
    expect(seedStage).not.toBeTruthy();

    // Should still have SVG
    const svg = container.querySelector('svg');
    expect(svg).toBeTruthy();
  });

  it('should apply size prop correctly', () => {
    const { container: smContainer } = render(<PlantLoader size="sm" />);
    const { container: mdContainer } = render(<PlantLoader size="md" />);
    const { container: lgContainer } = render(<PlantLoader size="lg" />);

    expect(smContainer.querySelector('.w-16')).toBeTruthy();
    expect(mdContainer.querySelector('.w-24')).toBeTruthy();
    expect(lgContainer.querySelector('.w-32')).toBeTruthy();
  });

  it('should apply speed prop to animation duration', () => {
    const { container: slowContainer } = render(<PlantLoader speed="slow" />);
    const { container: normalContainer } = render(<PlantLoader speed="normal" />);
    const { container: fastContainer } = render(<PlantLoader speed="fast" />);

    const slowSvg = slowContainer.querySelector('svg');
    const normalSvg = normalContainer.querySelector('svg');
    const fastSvg = fastContainer.querySelector('svg');

    expect(slowSvg?.getAttribute('style')).toContain('3s');
    expect(normalSvg?.getAttribute('style')).toContain('2s');
    expect(fastSvg?.getAttribute('style')).toContain('1.5s');
  });
});
