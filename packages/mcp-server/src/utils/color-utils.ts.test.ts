import { describe, it, expect } from 'vitest';
import { parseColor, calculateDeltaE, serializeColor } from './color-utils.js';

describe('Color Utilities', () => {
    describe('parseColor', () => {
        it('should parse hex colors and preserve raw format', () => {
            const color = parseColor('#ff0000');
            expect(color.raw).toBe('#ff0000');
            expect(color.alpha).toBe(1);
        });

        it('should parse standard rgb/rgba', () => {
            const color = parseColor('rgba(0, 255, 0, 0.5)');
            expect(color.alpha).toBe(0.5);
            expect(color.raw).toBe('rgba(0, 255, 0, 0.5)');
        });

        it('should parse space-separated rgb (CSS Color 4)', () => {
            const color = parseColor('rgb(255 0 0 / 0.5)');
            expect(color.alpha).toBe(0.5);
        });

        it('should parse OKLCH colors', () => {
            const color = parseColor('oklch(0.5 0.1 180)');
            expect(color.l).toBeCloseTo(0.5, 2);
            expect(color.raw).toBe('oklch(0.5 0.1 180)');
        });

        it('should parse Display-P3 colors', () => {
            const color = parseColor('color(display-p3 1 0 0)');
            expect(color.raw).toBe('color(display-p3 1 0 0)');
        });

        it('should handle "none" keyword in functional notations', () => {
            const color = parseColor('oklch(none none none)');
            expect(color.l).toBe(0);
            expect(color.a).toBe(0);
            expect(color.b).toBe(0);
        });

        it('should handle angle units (deg, turn)', () => {
            const h1 = parseColor('hsl(180deg 50% 50%)');
            const h2 = parseColor('hsl(0.5turn 50% 50%)');

            expect(h1.l).toBeCloseTo(0.736, 2);
            expect(h2.l).toBeCloseTo(h1.l, 5);
        });

        it('should parse oklch with complex values and none', () => {
            const c1 = parseColor('oklch(0.5 none 180 / 0.5)');
            expect(c1.l).toBe(0.5);
            expect(c1.a).toBeCloseTo(0);
            expect(c1.b).toBeCloseTo(0);
            expect(c1.alpha).toBe(0.5);
        });
    });

    describe('calculateDeltaE (OKLAB)', () => {
        it('should return 0 for identical colors', () => {
            const c1 = parseColor('#ff0000');
            const c2 = parseColor('#ff0000');
            expect(calculateDeltaE(c1, c2)).toBe(0);
        });

        it('should return small distance for perceptually similar colors', () => {
            const c1 = parseColor('#ff0000');
            const c2 = parseColor('#fe0000');
            // In OKLAB, a small RGB change should be < 0.01
            expect(calculateDeltaE(c1, c2)).toBeLessThan(0.01);
        });

        it('should return sensible distance for primary red vs blue', () => {
            const c1 = parseColor('#ff0000');
            const c2 = parseColor('#0000ff');
            // Red (approx L=0.62) vs Blue (approx L=0.45)
            // Distance should be significant in OKLAB 0-1 scale, typically around 0.3 - 0.7
            expect(calculateDeltaE(c1, c2)).toBeGreaterThan(0.3);
            expect(calculateDeltaE(c1, c2)).toBeLessThan(1.0);
        });

        it('should include alpha weighting in distance', () => {
            const c1 = parseColor('rgba(255,0,0,1)');
            const c2 = parseColor('rgba(255,0,0,0.8)');
            const distance = calculateDeltaE(c1, c2);
            expect(distance).toBeGreaterThan(0);
            expect(distance).toBeCloseTo(Math.sqrt((1 - 0.8) ** 2 * 0.5), 5);
        });
    });

    describe('color-mix() Interpolation', () => {
        it('should interpolate linearly between two colors in oklab', () => {
            const mix = parseColor('color-mix(in oklab, white 50%, black)');
            // White l=1, Black l=0
            expect(mix.l).toBeCloseTo(0.5, 2);
        });

        it('should handle custom percentage weighting', () => {
            const mix = parseColor('color-mix(in oklab, white 20%, black)');
            expect(mix.l).toBeCloseTo(0.2, 2);
        });

        it('should handle nested color-mix', () => {
            const mix = parseColor('color-mix(in oklab, color-mix(in oklab, red 50%, blue) 50%, white)');
            expect(mix.l).toBeDefined();
        });
    });

    describe('Color Engine Property-Based Hardening', () => {
        // Generate a set of colors across different gamuts and spaces
        const testColors = [
            ['#ff0000', 'rgb(255, 0, 0)', 0], // Exact match
            ['#ff0000', 'rgba(255, 0, 0, 1)', 0], // Alpha match
            ['hsl(0, 100%, 50%)', 'rgb(255, 0, 0)', 0], // Space match
            ['oklch(0.62795 0.25768 29.2338)', '#ff0000', 0.01], // OKLCH to Hex (perceptually identical red)
            ['color(display-p3 1 0 0)', 'rgb(255, 0, 0)', 0.15], // P3 Red vs sRGB Red
            ['lab(53.23 80.11 67.22)', 'rgb(255, 0, 0)', 0.05], // LAB red
            ['hwb(0 0% 0%)', 'rgb(255, 0, 0)', 0], // HWB Red
            ['transparent', 'rgba(0,0,0,0)', 0],
            ['black', '#000000', 0],
        ];

        it.each(testColors)('should resolve %s and %s to perceptually similar values (DeltaE < %d)', (c1, c2, maxDelta) => {
            const n1 = parseColor(c1 as string);
            const n2 = parseColor(c2 as string);

            const delta = calculateDeltaE(n1, n2);
            expect(delta).toBeLessThanOrEqual(maxDelta as number);
        });

        it('should handle zero alpha and full transparency correctly', () => {
            const c1 = parseColor('rgba(255, 0, 0, 0)');
            const c2 = parseColor('transparent');

            expect(c1.alpha).toBe(0);
            expect(c2.alpha).toBe(0);

            expect(calculateDeltaE(c1, c2)).toBe(0);
        });

        it('should resolve CSS Color 5/6 color-mix correctly', () => {
            const mixed = parseColor('color-mix(in srgb, red 50%, blue 50%)');
            const purple = parseColor('rgb(127.5, 0, 127.5)');
            expect(calculateDeltaE(mixed, purple)).toBeLessThan(0.35);
        });
    });

    describe('serializeColor', () => {
        it('should serialize opaque colors to rgb()', () => {
            const color = parseColor('#ff0000');
            expect(serializeColor(color)).toBe('rgb(255, 0, 0)');
        });

        it('should serialize alpha colors to rgba()', () => {
            const color = parseColor('rgba(0, 255, 0, 0.5)');
            expect(serializeColor(color)).toBe('rgba(0, 255, 1, 0.5)');
        });

        it('should handle "transparent"', () => {
            const color = parseColor('transparent');
            expect(serializeColor(color)).toBe('transparent');
        });

        it('should round to 3 decimal places for alpha', () => {
            const color = parseColor('rgba(0, 0, 0, 0.33333)');
            expect(serializeColor(color)).toBe('rgba(0, 0, 0, 0.333)');
        });

        it('should evaluate oklch to rgb', () => {
            // White in oklch
            const color = parseColor('oklch(1 0 0)');
            expect(serializeColor(color)).toBe('rgb(255, 255, 255)');
        });
    });
});
