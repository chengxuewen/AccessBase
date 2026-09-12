import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('nodemailer', () => ({
  createTransport: vi.fn(() => ({ sendMail: vi.fn().mockResolvedValue({}) })),
}));

import { createTransport } from 'nodemailer';
import { Mailer } from '../services/mailer.js';

describe('Mailer', () => {
  beforeEach(() => vi.clearAllMocks());

  it('fromConfig returns null when smtp host missing (fail-soft)', () => {
    expect(Mailer.fromConfig({})).toBeNull();
  });

  it('fromConfig builds transport with full config', () => {
    const m = Mailer.fromConfig({
      host: 'smtp.x.io', port: 587, user: 'u', pass: 'p', from: 'no-reply@x.io',
    });
    expect(m).not.toBeNull();
    expect(createTransport).toHaveBeenCalledWith(
      expect.objectContaining({ host: 'smtp.x.io', port: 587 }),
    );
  });

  it("fromConfig with empty from falls back to no-reply@host (options.get returns '' when unset)", async () => {
    const m = Mailer.fromConfig({ host: 'smtp.x.io', port: 587, user: 'u', pass: 'p', from: '' })!;
    await m.send('a@b.c', 'S', 'h');
    const transport = (createTransport as ReturnType<typeof vi.fn>).mock.results[0].value;
    expect(transport.sendMail).toHaveBeenCalledWith(
      expect.objectContaining({ from: 'no-reply@smtp.x.io' }),
    );
  });

  it('send delivers to recipient with subject and html', async () => {
    const m = Mailer.fromConfig({
      host: 'smtp.x.io', port: 587, user: 'u', pass: 'p', from: 'no-reply@x.io',
    })!;
    await m.send('a@b.c', 'Reset', '<b>link</b>');
    const transport = (createTransport as ReturnType<typeof vi.fn>).mock.results[0].value;
    expect(transport.sendMail).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'a@b.c', subject: 'Reset', html: '<b>link</b>' }),
    );
  });

  it('send failure throws (caller maps to log-degradation)', async () => {
    (createTransport as ReturnType<typeof vi.fn>).mockImplementationOnce(() => ({
      sendMail: vi.fn().mockRejectedValue(new Error('SMTP down')),
    }));
    const m = Mailer.fromConfig({
      host: 'smtp.x.io', port: 587, user: 'u', pass: 'p', from: 'no@x.io',
    })!;
    await expect(m.send('a@b.c', 'S', 'h')).rejects.toThrow('SMTP down');
  });
});
