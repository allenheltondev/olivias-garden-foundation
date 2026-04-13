import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { BrandHeader } from '../BrandHeader';
import { brandConfig } from '../../../config/brand';

describe('BrandHeader', () => {
  it('should render logo and tagline by default', () => {
    render(<BrandHeader />);

    expect(screen.getByAltText('Good Roots Network logo')).toBeInTheDocument();
    expect(screen.getByText(brandConfig.name.full)).toBeInTheDocument();
    expect(screen.getByText(brandConfig.tagline)).toBeInTheDocument();
  });

  it('should hide tagline when showTagline is false', () => {
    render(<BrandHeader showTagline={false} />);

    expect(screen.getByText(brandConfig.name.full)).toBeInTheDocument();
    expect(screen.queryByText(brandConfig.tagline)).not.toBeInTheDocument();
  });

  it('should pass logoSize prop to Logo component', () => {
    const { container } = render(<BrandHeader logoSize="sm" />);

    const img = container.querySelector('img');
    expect(img?.className).toContain('h-8'); // sm size
  });

  it('should render tagline as text element', () => {
    render(<BrandHeader />);

    const tagline = screen.getByText(brandConfig.tagline);
    expect(tagline.tagName).toBe('P');
  });
});
