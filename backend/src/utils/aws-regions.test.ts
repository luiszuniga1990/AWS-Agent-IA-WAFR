import { VALID_AWS_REGIONS, isValidRegion } from './aws-regions';

describe('aws-regions', () => {
  it('contains standard AWS regions', () => {
    expect(VALID_AWS_REGIONS).toContain('us-east-1');
    expect(VALID_AWS_REGIONS).toContain('eu-west-1');
    expect(VALID_AWS_REGIONS).toContain('ap-southeast-1');
  });

  it('isValidRegion returns true for valid regions', () => {
    expect(isValidRegion('us-west-2')).toBe(true);
    expect(isValidRegion('sa-east-1')).toBe(true);
  });

  it('isValidRegion returns false for invalid regions', () => {
    expect(isValidRegion('')).toBe(false);
    expect(isValidRegion('us-east-99')).toBe(false);
    expect(isValidRegion('fake-region')).toBe(false);
  });
});
