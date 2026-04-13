import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AppShell } from '../AppShell';

describe('AppShell', () => {
  it('should render children', () => {
    render(
      <AppShell>
        <div>Test Content</div>
      </AppShell>
    );

    expect(screen.getByText('Test Content')).toBeInTheDocument();
  });

  it('should render AppHeader by default', () => {
    const { container } = render(
      <AppShell>
        <div>Test Content</div>
      </AppShell>
    );

    // Check for header element
    const header = container.querySelector('header');
    expect(header).toBeTruthy();
  });

  it('should not render AppHeader when showHeader is false', () => {
    const { container } = render(
      <AppShell showHeader={false}>
        <div>Test Content</div>
      </AppShell>
    );

    // Check that header is not present
    const header = container.querySelector('header');
    expect(header).not.toBeTruthy();
  });

  it('should render children in main element', () => {
    const { container } = render(
      <AppShell>
        <div data-testid="content">Test Content</div>
      </AppShell>
    );

    const main = container.querySelector('main');
    expect(main).toBeTruthy();
    expect(main?.querySelector('[data-testid="content"]')).toBeTruthy();
  });
});
