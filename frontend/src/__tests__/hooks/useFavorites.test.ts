/// <reference types="vitest/globals" />
import { renderHook, act } from '@testing-library/preact';
import { CLASS_FAVORITES_KEY, EVENT_FAVORITES_KEY, useFavorites } from '@/hooks/useFavorites';

describe('useFavorites', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('starts with empty favorites', () => {
    const { result } = renderHook(() => useFavorites());
    expect(result.current.favoriteCount).toBe(0);
    expect(result.current.isFavorite('any-id')).toBe(false);
  });

  it('toggles a favorite on', () => {
    const { result } = renderHook(() => useFavorites());
    act(() => { result.current.toggleFavorite('event-1'); });
    expect(result.current.isFavorite('event-1')).toBe(true);
    expect(result.current.favoriteCount).toBe(1);
  });

  it('toggles a favorite off', () => {
    const { result } = renderHook(() => useFavorites());
    act(() => { result.current.toggleFavorite('event-1'); });
    act(() => { result.current.toggleFavorite('event-1'); });
    expect(result.current.isFavorite('event-1')).toBe(false);
    expect(result.current.favoriteCount).toBe(0);
  });

  it('handles multiple favorites', () => {
    const { result } = renderHook(() => useFavorites());
    act(() => { result.current.toggleFavorite('event-1'); });
    act(() => { result.current.toggleFavorite('event-2'); });
    act(() => { result.current.toggleFavorite('event-3'); });
    expect(result.current.favoriteCount).toBe(3);
    expect(result.current.isFavorite('event-1')).toBe(true);
    expect(result.current.isFavorite('event-2')).toBe(true);
    expect(result.current.isFavorite('event-3')).toBe(true);
  });

  it('persists to localStorage', () => {
    const { result } = renderHook(() => useFavorites());
    act(() => { result.current.toggleFavorite('event-1'); });
    const stored = JSON.parse(localStorage.getItem('chq-calendar-favorites') || '{}');
    expect(stored.eventIds).toContain('event-1');
    expect(stored.lastSaved).toBeDefined();
  });

  it('restores from localStorage on mount', () => {
    localStorage.setItem('chq-calendar-favorites', JSON.stringify({
      eventIds: ['event-a', 'event-b'],
      lastSaved: Date.now(),
    }));
    const { result } = renderHook(() => useFavorites());
    expect(result.current.isFavorite('event-a')).toBe(true);
    expect(result.current.isFavorite('event-b')).toBe(true);
    expect(result.current.favoriteCount).toBe(2);
  });

  it('ignores expired localStorage data', () => {
    const thirtyOneDaysAgo = Date.now() - 31 * 24 * 60 * 60 * 1000;
    localStorage.setItem('chq-calendar-favorites', JSON.stringify({
      eventIds: ['old-event'],
      lastSaved: thirtyOneDaysAgo,
    }));
    const { result } = renderHook(() => useFavorites());
    expect(result.current.favoriteCount).toBe(0);
  });
});

describe('useFavorites — events and classes are separate stores', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('keeps a starred class out of the calendar\'s store and count', () => {
    const events = renderHook(() => useFavorites());
    const classes = renderHook(() => useFavorites(CLASS_FAVORITES_KEY));

    act(() => { classes.result.current.toggleFavorite('class:CHQ.EVN1:week8'); });

    // The calendar's badge counts its own set, so a class must not raise it.
    expect(classes.result.current.favoriteCount).toBe(1);
    expect(events.result.current.favoriteCount).toBe(0);

    const stored = JSON.parse(localStorage.getItem(CLASS_FAVORITES_KEY) ?? '{}');
    expect(stored.eventIds).toEqual(['class:CHQ.EVN1:week8']);
  });

  it('drops class ids the calendar picked up while the stores were shared', () => {
    localStorage.setItem(EVENT_FAVORITES_KEY, JSON.stringify({
      eventIds: ['event-1', 'class:CHQ.EVN1:week8', 'event-2'],
      lastSaved: Date.now(),
    }));

    const { result } = renderHook(() => useFavorites());
    expect([...result.current.favoriteIds].sort()).toEqual(['event-1', 'event-2']);
  });

  it('adopts those class ids rather than losing the stars', () => {
    localStorage.setItem(EVENT_FAVORITES_KEY, JSON.stringify({
      eventIds: ['event-1', 'class:CHQ.EVN1:week8'],
      lastSaved: Date.now(),
    }));

    const { result } = renderHook(() => useFavorites(CLASS_FAVORITES_KEY));
    expect([...result.current.favoriteIds]).toEqual(['class:CHQ.EVN1:week8']);
  });

  it('leaves an established classes store alone', () => {
    localStorage.setItem(EVENT_FAVORITES_KEY, JSON.stringify({
      eventIds: ['class:CHQ.EVN9:week2'], lastSaved: Date.now(),
    }));
    localStorage.setItem(CLASS_FAVORITES_KEY, JSON.stringify({
      eventIds: ['class:CHQ.EVN1:week8'], lastSaved: Date.now(),
    }));

    const { result } = renderHook(() => useFavorites(CLASS_FAVORITES_KEY));
    // Adoption is a one-time heal for an empty store, not a merge.
    expect([...result.current.favoriteIds]).toEqual(['class:CHQ.EVN1:week8']);
  });
});
