import { VALID_AWS_REGIONS, isValidRegion } from './aws-regions';

describe('frontend aws-regions', () => {
  it('exports a non-empty array of regions', () => {
    expect(VALID_AWS_REGIONS.length).toBeGreaterThan(10);
  });

  it('isValidRegion accepts known regions', () => {
    expect(isValidRegion('us-east-1')).toBe(true);
    expect(isValidRegion('eu-central-1')).toBe(true);
  });

  it('isValidRegion rejects unknown regions', () => {
    expect(isValidRegion('mars-west-1')).toBe(false);
    expect(isValidRegion('')).toBe(false);
  });
});
