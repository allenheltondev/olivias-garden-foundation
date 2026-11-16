import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { CropArtwork, GardenScene } from './GardenArt';

describe('Garden artwork', () => {
  it('exposes a crop label only when one is requested', () => {
    const { rerender } = render(<CropArtwork iconKey="tomato" title="Tomato" />);
    expect(screen.getByRole('img', { name: 'Tomato' })).toHaveAttribute('src', '/images/botanical/crops/tomato.svg');
    rerender(<CropArtwork iconKey="tomato" />);
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });

  it('uses existing silhouettes for crops without an illustration', () => {
    render(<CropArtwork iconKey="asparagus" title="Asparagus" />);
    expect(screen.getByRole('img', { name: 'Asparagus' }).tagName.toLowerCase()).toBe('svg');
  });

  it('uses the botanical illustration for okra', () => {
    render(<CropArtwork iconKey="okra" title="Okra" />);
    expect(screen.getByRole('img', { name: 'Okra' })).toHaveAttribute('src', '/images/botanical/crops/okra.svg');
  });

  it('recovers from a failed image and tries the next crop independently', () => {
    const { rerender } = render(<CropArtwork iconKey="tomato" title="Tomato" />);
    fireEvent.error(screen.getByRole('img', { name: 'Tomato' }));
    expect(screen.getByRole('img', { name: 'Tomato' }).tagName.toLowerCase()).toBe('svg');
    rerender(<CropArtwork iconKey="carrot" title="Carrot" />);
    expect(screen.getByRole('img', { name: 'Carrot' })).toHaveAttribute('src', '/images/botanical/crops/carrot.svg');
  });

  it('keeps scenes decorative and removes a broken scene without hiding content', () => {
    const { container } = render(<><p>Add your first plant</p><GardenScene name="first-garden" /></>);
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    fireEvent.error(container.querySelector('img')!);
    expect(container.querySelector('img')).toBeNull();
    expect(screen.getByText('Add your first plant')).toBeInTheDocument();
  });
});
