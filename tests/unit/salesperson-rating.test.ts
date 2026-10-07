import { describe, expect, it } from 'vitest';
import { salespersonRatingSchema } from '../../src/modules/customers/personal.routes.js';

describe('salesperson rating input', () => {
  it.each([1, 2, 3, 4, 5])('accepts %i stars', (rating) => {
    expect(salespersonRatingSchema.parse({ rating })).toEqual({ rating });
  });

  it.each([0, 6, 2.5, '5'])('rejects invalid rating %s', (rating) => {
    expect(salespersonRatingSchema.safeParse({ rating }).success).toBe(false);
  });

  it('rejects fields that could let clients choose the salesperson', () => {
    expect(
      salespersonRatingSchema.safeParse({ rating: 5, salespersonId: 'client-selected-id' }).success
    ).toBe(false);
  });
});
