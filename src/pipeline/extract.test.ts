import { describe, expect, it } from 'vitest';
import { proxyFailure, siteFailure } from './extract';

describe('proxyFailure', () => {
  it('blames the service when the proxy never answered (no JSON body)', () => {
    const e = proxyFailure(502, null);
    expect(e.kind).toBe('service');
    expect(e.message).toMatch(/Couldn’t reach the service/);
  });
  it('blames the service when it is not set up', () => {
    expect(proxyFailure(401, { error: 'unauthorized' }).kind).toBe('service');
  });
  it('blames the page for the Worker’s own upstream errors', () => {
    expect(proxyFailure(502, { error: 'upstream timed out' })).toMatchObject({ kind: 'page', message: 'The site took too long to respond.' });
    expect(proxyFailure(502, { error: 'upstream fetch failed' })).toMatchObject({ kind: 'page', message: 'The site couldn’t be reached.' });
    expect(proxyFailure(415, { error: 'unsupported content type: application/pdf' }).message).toMatch(/PDF/);
  });
});

describe('siteFailure', () => {
  it('passes 2xx/3xx and names common site errors', () => {
    expect(siteFailure(200)).toBeNull();
    expect(siteFailure(404)?.message).toBe('The page wasn’t found (404).');
    expect(siteFailure(403)?.message).toBe('The site blocked the request (403).');
    expect(siteFailure(503)?.kind).toBe('page');
  });
});
