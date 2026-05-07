import { generateMinimumIamPolicy } from './iam-policy';

describe('generateMinimumIamPolicy', () => {
  it('returns a valid IAM policy document', () => {
    const policy = generateMinimumIamPolicy();
    expect(policy.Version).toBe('2012-10-17');
    expect(policy.Statement).toHaveLength(1);
    expect(policy.Statement[0].Effect).toBe('Allow');
    expect(policy.Statement[0].Resource).toBe('*');
  });

  it('includes prowler-additions-policy actions', () => {
    const policy = generateMinimumIamPolicy();
    const actions = policy.Statement[0].Action;
    expect(actions).toContain('account:Get*');
    expect(actions).toContain('securityhub:BatchImportFindings');
    expect(actions).toContain('securityhub:GetFindings');
    expect(actions).toContain('ssm:GetDocument');
  });

  it('includes well-architected write permissions', () => {
    const policy = generateMinimumIamPolicy();
    const actions = policy.Statement[0].Action;
    expect(actions).toContain('wellarchitected:CreateWorkload');
    expect(actions).toContain('wellarchitected:UpdateAnswer');
    expect(actions).toContain('wellarchitected:AssociateLenses');
  });

  it('includes wellarchitected:List* for read access', () => {
    const policy = generateMinimumIamPolicy();
    const actions = policy.Statement[0].Action;
    expect(actions).toContain('wellarchitected:List*');
  });
});
