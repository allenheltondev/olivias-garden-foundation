import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { FormField } from './FormField';

describe('FormField', () => {
  it('renders label and children', () => {
    render(
      <FormField label="Test Field">
        <input type="text" />
      </FormField>
    );

    expect(screen.getByText('Test Field')).toBeInTheDocument();
    expect(screen.getByRole('textbox')).toBeInTheDocument();
  });

  it('displays required indicator when required is true', () => {
    render(
      <FormField label="Required Field" required>
        <input type="text" />
      </FormField>
    );

    const requiredIndicator = screen.getByText('*');
    expect(requiredIndicator).toBeInTheDocument();
    expect(requiredIndicator).toHaveAttribute('aria-label', 'required');
  });

  it('does not display required indicator when required is false', () => {
    render(
      <FormField label="Optional Field" required={false}>
        <input type="text" />
      </FormField>
    );

    expect(screen.queryByText('*')).not.toBeInTheDocument();
  });

  it('displays error message when error prop is provided', () => {
    render(
      <FormField label="Field with Error" error="This field is invalid">
        <input type="text" />
      </FormField>
    );

    const errorMessage = screen.getByRole('alert');
    expect(errorMessage).toBeInTheDocument();
    expect(errorMessage).toHaveTextContent('This field is invalid');
  });

  it('does not display error message when error prop is not provided', () => {
    render(
      <FormField label="Field without Error">
        <input type="text" />
      </FormField>
    );

    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('associates label with input using htmlFor', () => {
    render(
      <FormField label="Associated Field" htmlFor="test-input">
        <input type="text" id="test-input" />
      </FormField>
    );

    const label = screen.getByText('Associated Field');
    expect(label).toHaveAttribute('for', 'test-input');
  });

  it('adds aria-invalid to child when error is present', () => {
    render(
      <FormField label="Field" error="Error message" htmlFor="test-input">
        <input type="text" id="test-input" />
      </FormField>
    );

    const input = screen.getByRole('textbox');
    expect(input).toHaveAttribute('aria-invalid', 'true');
  });

  it('adds aria-describedby to child when error is present', () => {
    render(
      <FormField label="Field" error="Error message" htmlFor="test-input">
        <input type="text" id="test-input" />
      </FormField>
    );

    const input = screen.getByRole('textbox');
    expect(input).toHaveAttribute('aria-describedby', 'test-input-error');
  });

  it('adds aria-required to child when required is true', () => {
    render(
      <FormField label="Field" required htmlFor="test-input">
        <input type="text" id="test-input" />
      </FormField>
    );

    const input = screen.getByRole('textbox');
    expect(input).toHaveAttribute('aria-required', 'true');
  });

  it('applies custom className', () => {
    const { container } = render(
      <FormField label="Field" className="custom-class">
        <input type="text" />
      </FormField>
    );

    const wrapper = container.firstChild as HTMLElement;
    expect(wrapper).toHaveClass('custom-class');
  });

  it('renders error icon with error message', () => {
    render(
      <FormField label="Field" error="Error message">
        <input type="text" />
      </FormField>
    );

    const errorContainer = screen.getByRole('alert');
    const svg = errorContainer.querySelector('svg');
    expect(svg).toBeInTheDocument();
    expect(svg).toHaveAttribute('aria-hidden', 'true');
  });

  it('handles multiple children', () => {
    render(
      <FormField label="Field">
        <input type="text" placeholder="First" />
        <input type="text" placeholder="Second" />
      </FormField>
    );

    expect(screen.getByPlaceholderText('First')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Second')).toBeInTheDocument();
  });

  it('preserves existing props on children', () => {
    render(
      <FormField label="Field" htmlFor="test-input">
        <input
          type="text"
          id="test-input"
          placeholder="Test"
          className="custom-input"
        />
      </FormField>
    );

    const input = screen.getByRole('textbox');
    expect(input).toHaveAttribute('placeholder', 'Test');
    expect(input).toHaveClass('custom-input');
  });

  it('uses consistent spacing between label, input, and error', () => {
    const { container } = render(
      <FormField label="Field" error="Error message">
        <input type="text" />
      </FormField>
    );

    const wrapper = container.firstChild as HTMLElement;
    expect(wrapper).toHaveClass('flex', 'flex-col', 'gap-1');
  });
});
