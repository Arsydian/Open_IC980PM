// @vitest-environment jsdom
/**
 * @file tests/errorBoundary.test.tsx
 * @description Render errors are contained (`src/components/ErrorBoundary.tsx`, `src/App.tsx`).
 */

import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ErrorBoundary } from '../src/components/ErrorBoundary';
import { App } from '../src/App';

// A view that always fails to render, standing in for any crashing screen.
vi.mock('../src/components/BootLogoStudio', () => ({
  BootLogoStudio: () => {
    throw new Error('boot logo exploded');
  },
}));

const WAIT_MS = 15_000;

beforeEach(() => {
  // React logs caught render errors; keep the test output readable.
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('ErrorBoundary', () => {
  it('shows the error instead of unmounting, and "Try again" re-renders the children', () => {
    let shouldThrow = true;
    const Flaky = () => {
      if (shouldThrow) throw new Error('bad data');
      return <p>recovered</p>;
    };
    render(
      <ErrorBoundary title="Oops">
        <Flaky />
      </ErrorBoundary>
    );

    expect(screen.getByRole('alert').textContent).toContain('bad data');
    shouldThrow = false;
    fireEvent.click(screen.getByRole('button', { name: /Try again/ }));
    expect(screen.getByText('recovered')).toBeTruthy();
  });
});

describe('App', () => {
  it('keeps the header and navigation working when one view crashes', { timeout: 30_000 }, async () => {
    render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: /Boot Logo Studio/ }, { timeout: WAIT_MS }));

    const alert = screen.getByRole('alert');
    expect(alert.textContent).toContain('This view hit an error and was closed');
    expect(alert.textContent).toContain('boot logo exploded');
    expect(screen.getByRole('button', { name: /Open File/ })).toBeTruthy();

    // Switching views clears the error.
    fireEvent.click(screen.getByRole('button', { name: /Channels \(1–500\)/ }));
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
