import { describe, expect, it } from 'vitest';
import { archiveLabel, normalizeArchiveUrl } from '../backend/import-url';

describe('normalizeArchiveUrl', () => {
  it('rewrites GitHub archive links to codeload', () => {
    expect(normalizeArchiveUrl('https://github.com/splunk/addonfactory-splunk_sa_cim/archive/refs/heads/master.tar.gz')).toBe(
      'https://codeload.github.com/splunk/addonfactory-splunk_sa_cim/tar.gz/refs/heads/master',
    );
    expect(normalizeArchiveUrl('https://github.com/o/r/archive/v1.2.3.tar.gz')).toBe('https://codeload.github.com/o/r/tar.gz/v1.2.3');
  });
  it('leaves other URLs alone', () => {
    for (const u of ['https://example.com/TA.tgz', 'https://github.com/o/r/releases/download/v1/TA.tgz', 'https://codeload.github.com/o/r/tar.gz/main']) {
      expect(normalizeArchiveUrl(u)).toBe(u);
    }
  });
});

describe('archiveLabel', () => {
  it('labels GitHub archives as owner/repo@ref', () => {
    expect(archiveLabel('https://codeload.github.com/splunk/addonfactory-splunk_sa_cim/tar.gz/refs/heads/master')).toBe('splunk/addonfactory-splunk_sa_cim@master');
    expect(archiveLabel('https://codeload.github.com/o/r/tar.gz/v1.2.3')).toBe('o/r@v1.2.3');
    expect(archiveLabel('https://example.com/dl/TA-web%201.0.tgz')).toBe('TA-web 1.0.tgz');
  });
});
