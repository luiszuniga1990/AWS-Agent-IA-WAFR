const mockWASend = jest.fn();
jest.mock('@aws-sdk/client-wellarchitected', () => ({
  WellArchitectedClient: jest.fn().mockImplementation(() => ({ send: mockWASend })),
  CreateWorkloadCommand: jest.fn().mockImplementation((p) => p),
  AssociateLensesCommand: jest.fn().mockImplementation((p) => p),
  UpdateAnswerCommand: jest.fn().mockImplementation((p) => p),
}));

import { createWorkload, associateLenses } from './wa-tool-client';

beforeEach(() => jest.clearAllMocks());

describe('createWorkload', () => {
  it('returns workloadArn and workloadId on success', async () => {
    mockWASend.mockResolvedValueOnce({
      WorkloadArn: 'arn:aws:wellarchitected:us-west-2:123:workload/wl-1',
      WorkloadId: 'wl-1',
    });

    const result = await createWorkload('TestClient', '123456789012', 'us-east-1');
    expect(result.workloadArn).toContain('wellarchitected');
    expect(result.workloadId).toBe('wl-1');
  });

  it('throws if WorkloadArn is missing', async () => {
    mockWASend.mockResolvedValueOnce({ WorkloadArn: undefined, WorkloadId: undefined });

    await expect(createWorkload('X', '123', 'us-east-1')).rejects.toThrow();
  });
});

describe('associateLenses', () => {
  it('calls WA Tool with wellarchitected lens', async () => {
    mockWASend.mockResolvedValueOnce({});

    await associateLenses('wl-1');
    expect(mockWASend).toHaveBeenCalledTimes(1);
  });
});
