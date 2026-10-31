import { expect, it } from 'vitest';
import { xPostUrl } from '../src/shared/urls';

it('accepts the reported post and canonicalizes X media links', () => {
  const post = 'https://x.com/badlogicgames/status/2116308846721511576';
  expect(xPostUrl(post)).toBe(post);
  const quoted = 'https://x.com/badlogicgames/status/2116078693827428383';
  for (const suffix of ['/photo/1', '/video/1', '/photo/2?s=20', '/video/1/']) {
    expect(xPostUrl(quoted + suffix)).toBe(quoted);
  }
  expect(xPostUrl('https://www.twitter.com/badlogicgames/status/2116078693827428383/photo/1')).toBe(
    quoted,
  );
});

it('rejects unrelated paths and untrusted post URLs', () => {
  for (const url of [
    'http://x.com/a/status/123',
    'https://x.com.evil.example/a/status/123',
    'https://user:password@x.com/a/status/123',
    'https://x.com:444/a/status/123',
    'https://x.com/a/status/123/photo/no',
    'https://x.com/a/status/123/photo/1/extra',
    'https://x.com/a/status/123/analytics',
  ])
    expect(() => xPostUrl(url)).toThrow();
});
