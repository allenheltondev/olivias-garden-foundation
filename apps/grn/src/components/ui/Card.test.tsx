import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Card } from './Card';

describe('Card', () => {
  it('renders children correctly', () => {
    render(<Card>Test content</Card>);
    expect(screen.getByText('Test content')).toBeInTheDocument();
  });

  it('applies default elevation and padding', () => {
    const { container } = render(<Card>Content</Card>);
    const card = container.firstChild as HTMLElement;
    expect(card).toHaveClass('shadow-base');
  });

  it('applies custom elevation', () => {
    const { container } = render(<Card elevation="lg">Content</Card>);
    const card = container.firstChild as HTMLElement;
    expect(card).toHaveClass('shadow-lg');
  });

  it('applies interactive styles when interactive prop is true', () => {
    const { container } = render(<Card interactive>Content</Card>);
    const card = container.firstChild as HTMLElement;
    expect(card).toHaveClass('hover:shadow-lg');
    expect(card).toHaveClass('cursor-pointer');
  });

  it('does not apply interactive styles by default', () => {
    const { container } = render(<Card>Content</Card>);
    const card = container.firstChild as HTMLElement;
    expect(card).not.toHaveClass('cursor-pointer');
  });

  it('applies custom className', () => {
    const { container } = render(<Card className="custom-class">Content</Card>);
    const card = container.firstChild as HTMLElement;
    expect(card).toHaveClass('custom-class');
  });

  it('forwards ref correctly', () => {
    const ref = React.createRef<HTMLDivElement>();
    render(<Card ref={ref}>Content</Card>);
    expect(ref.current).toBeInstanceOf(HTMLDivElement);
  });

  it('applies gradient background', () => {
    const { container } = render(<Card>Content</Card>);
    const card = container.firstChild as HTMLElement;
    expect(card).toHaveClass('bg-gradient-to-br');
    expect(card).toHaveClass('from-white');
    expect(card).toHaveClass('to-neutral-50');
  });

  it('applies rounded corners', () => {
    const { container } = render(<Card>Content</Card>);
    const card = container.firstChild as HTMLElement;
    expect(card).toHaveClass('rounded-lg');
  });

  it('supports all elevation levels', () => {
    const elevations: Array<'sm' | 'base' | 'md' | 'lg'> = ['sm', 'base', 'md', 'lg'];

    elevations.forEach((elevation) => {
      const { container } = render(<Card elevation={elevation}>Content</Card>);
      const card = container.firstChild as HTMLElement;
      expect(card).toHaveClass(`shadow-${elevation}`);
    });
  });
});
