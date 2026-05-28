const mockSESSend = jest.fn();
jest.mock('@aws-sdk/client-ses', () => ({
  SESClient: jest.fn().mockImplementation(() => ({ send: mockSESSend })),
  SendRawEmailCommand: jest.fn().mockImplementation((p) => p),
}));

import { buildSubject, sendReadyReport, sendDetailReport } from './email-sender';

beforeEach(() => {
  jest.clearAllMocks();
  jest.useFakeTimers();
});

afterEach(() => {
  jest.useRealTimers();
});

describe('buildSubject', () => {
  it('formats subject correctly', () => {
    expect(buildSubject('Acme', '2026-05-27')).toBe('[WAFR] Acme - 2026-05-27');
  });
});

describe('sendReadyReport', () => {
  it('returns success with messageId on successful send', async () => {
    mockSESSend.mockResolvedValueOnce({ MessageId: 'msg-123' });

    const promise = sendReadyReport('user@test.com', Buffer.from('pdf-data'), 'ClientX', '2026-05-27');
    await jest.runAllTimersAsync();
    const result = await promise;

    expect(result.success).toBe(true);
    expect(result.messageId).toBe('msg-123');
    expect(mockSESSend).toHaveBeenCalledTimes(1);
  });

  it('retries and returns failure after max attempts', async () => {
    mockSESSend
      .mockRejectedValueOnce(new Error('Throttled'))
      .mockRejectedValueOnce(new Error('Throttled'))
      .mockRejectedValueOnce(new Error('Throttled'));

    const promise = sendReadyReport('user@test.com', Buffer.from('pdf'), 'Client', '2026-01-01');
    await jest.runAllTimersAsync();
    const result = await promise;

    expect(result.success).toBe(false);
    expect(result.error).toContain('3 attempts');
    expect(mockSESSend).toHaveBeenCalledTimes(3);
  });

  it('succeeds on retry', async () => {
    mockSESSend
      .mockRejectedValueOnce(new Error('Temp error'))
      .mockResolvedValueOnce({ MessageId: 'msg-retry' });

    const promise = sendReadyReport('user@test.com', Buffer.from('pdf'), 'Client', '2026-01-01');
    await jest.runAllTimersAsync();
    const result = await promise;

    expect(result.success).toBe(true);
    expect(result.messageId).toBe('msg-retry');
  });
});

describe('sendDetailReport', () => {
  it('sends to the fixed technical team email', async () => {
    mockSESSend.mockResolvedValueOnce({ MessageId: 'msg-detail' });

    const promise = sendDetailReport(Buffer.from('detail-pdf'), 'ClientY', '2026-05-27');
    await jest.runAllTimersAsync();
    const result = await promise;

    expect(result.success).toBe(true);
    expect(mockSESSend).toHaveBeenCalledTimes(1);
  });
});
